import * as T from 'three'
import * as C from 'cannon-es'
import type { BodyState } from './types'
import { RestFrameCone } from './jointFrames'
import { captureFaceFrame, type FaceFrame } from './faceFrame'

const cv = (v: T.Vector3) => new C.Vec3(v.x, v.y, v.z)
const tv = (v: C.Vec3) => new T.Vector3(v.x, v.y, v.z)
const tq = (q: C.Quaternion) => new T.Quaternion(q.x, q.y, q.z, q.w)
const cq = (q: T.Quaternion) => new C.Quaternion(q.x, q.y, q.z, q.w)
const worldPos = (b: T.Object3D) => b.getWorldPosition(new T.Vector3())
const unitUp = new T.Vector3(0, 1, 0)

export type Segment = {
  name: string; label: string; bone: T.Object3D; body: C.Body; mass: number;
  start: C.Vec3; end: C.Vec3; restP: C.Vec3; restQ: C.Quaternion; radius: number;
  parent?: Segment
}

export class CharacterRig {
  world = new C.World({ gravity: new C.Vec3(0, -9.81, 0), allowSleep: true })
  segments: Segment[] = []
  anchor = new T.Vector3()
  anchored = true
  dragging: Segment | null = null
  moving = false
  meshes: T.Mesh[] = []
  face: T.Mesh[] = []
  readonly faceFrame: FaceFrame
  visual = new T.Group()
  private joints: T.Mesh[] = []
  private links: T.Mesh[] = []
  private grab: C.PointToPointConstraint | null = null
  private target = new C.Body({ type: C.Body.KINEMATIC, collisionFilterGroup: 0, collisionFilterMask: 0 })
  private jointMaterial = new T.MeshBasicMaterial({ color: 0xcaef9a, depthTest: false, transparent: true, opacity: .95 })
  private linkMaterial = new T.MeshBasicMaterial({ color: 0xb9dd8b, depthTest: false, transparent: true, opacity: .7 })
  private restBlend = 1
  private isDynamic = false
  private moveStart: C.Vec3[] = []
  private moveAnchor = new T.Vector3()
  private dir = new T.Vector3()
  private pinnedPoses = new Map<string, { p: C.Vec3; q: C.Quaternion }>()
  private relaxedFingers: { bone: T.Object3D; hand: Segment; side: number; rest: number; flex: number; speed: number; weight: number }[] = []
  private grabPoint = new C.Vec3()
  private grabGoal = new C.Vec3()
  private accumulator = 0
  private onOperatingTable = true
  private legReturn = { L: 1, R: 1 }
  private links3D: { a: Segment; b: Segment; pivotA: C.Vec3; pivotB: C.Vec3; rest: C.Quaternion; axis: C.Vec3; swing: number; twist: number; hinge: boolean; min: number; max: number }[] = []
  private hinges: { a: Segment; b: Segment; axis: C.Vec3; rest: C.Quaternion; min: number; max: number }[] = []

  constructor(public model: T.Group, private poseMode: 'studio' | 'patient' = 'studio') {
    const solver = this.world.solver as C.GSSolver
    solver.iterations = 38
    solver.tolerance = .0001
    this.world.broadphase = new C.SAPBroadphase(this.world)
    this.world.defaultContactMaterial.friction = .44
    this.world.defaultContactMaterial.restitution = .035
    this.world.defaultContactMaterial.contactEquationStiffness = 2e6
    const floor = new C.Body({ mass: 0, shape: new C.Plane(), collisionFilterGroup: 1, collisionFilterMask: -1 })
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    floor.position.y = poseMode === 'patient' ? 0 : -.056
    this.world.addBody(floor)
    const table = new C.Body({ mass: 0,
      shape: poseMode === 'patient' ? new C.Box(new C.Vec3(.353, .08, 1.08)) : new C.Cylinder(.612, .612, .056, 48),
      position: new C.Vec3(0, poseMode === 'patient' ? .84 : -.028, 0), collisionFilterGroup: 1, collisionFilterMask: -1 })
    this.world.addBody(table)
    this.world.addBody(this.target)
    this.world.addEventListener('preStep', () => {
      if (!this.dragging || this.anchored) return
      const error = this.target.position.vsub(this.dragging.body.pointToWorldFrame(this.grabPoint))
      const correction = error.scale(26), root = this.segments[0].body
      correction.y += Math.max(0, -this.world.gravity.y) * .58
      root.velocity.scale(3.1, error); correction.vsub(error, correction)
      const acceleration = correction.length(); if (acceleration > 22) correction.scale(22 / acceleration, correction)
      for (const s of this.segments) {
        // Distribute the bulk lifting force; the wrist connection controls the local pose.
        s.body.force.vadd(correction.scale(s.mass), s.body.force)
      }
    })
    if (poseMode === 'patient') {
      this.world.addBody(new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(.297, .018, .448)), position: new C.Vec3(.98, .925, .20), collisionFilterGroup: 1 }))
      for (const side of [-1, 1]) this.world.addBody(new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(.104, .023, .347)), position: new C.Vec3(side * .444, .896, -.145), collisionFilterGroup: 1, collisionFilterMask: -1 }))
      this.world.addBody(new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(.197, .039, .165)), position: new C.Vec3(0, .958, -.71), collisionFilterGroup: 1, collisionFilterMask: -1 }))
      // The sandbox uses the actual room boundaries rather than an unbounded floor.
      for (const side of [-1, 1]) {
        this.world.addBody(new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(.045, 1.60, 3.3)), position: new C.Vec3(3.76 * side, 1.6, 0), collisionFilterGroup: 1 }))
        this.world.addBody(new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(3.8, 1.60, .045)), position: new C.Vec3(0, 1.6, 3.3 * side), collisionFilterGroup: 1 }))
      }
    }
    model.traverse(obj => {
      if (obj instanceof T.Mesh) {
        this.meshes.push(obj)
        obj.castShadow = true
        obj.receiveShadow = false
        obj.frustumCulled = false
        if (obj.morphTargetInfluences?.length) this.face.push(obj)
        const material = obj.material as T.MeshStandardMaterial
        if (material.isMeshStandardMaterial && /SKIN|_EYE|_FACE/.test(material.name)) {
          material.roughness = .95
          const amount = material.name.includes('SKIN') ? '.57' : '.91'
          material.onBeforeCompile = shader => {
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
              `outgoingLight = mix(outgoingLight, diffuseColor.rgb, ${amount});\n#include <opaque_fragment>`)
          }
          material.customProgramCacheKey = () => `mika-skin-${amount}`
          material.toneMapped = false
        }
      }
    })
    this.faceFrame = captureFaceFrame(model)
    this.pose()
    this.createBodies()
    this.world.addEventListener('preStep', () => this.dampJointMotion())
    this.world.addEventListener('preStep', () => this.limitHinges())
    this.world.addEventListener('postStep', () => this.stabilizeJoints())
    this.world.addEventListener('postStep', () => this.resolveSupport())
    if (poseMode === 'patient') {
      this.configurePatientBodies(true)
      for (let i = 0; i < 72; i++) this.world.step(1 / 120)
      for (const s of this.segments) {
        s.restP.copy(s.body.position); s.restQ.copy(s.body.quaternion)
        s.body.velocity.setZero(); s.body.angularVelocity.setZero()
      }
      this.capturePins(); this.sync()
      for (const side of ['L', 'R']) {
        const hand = this.segments.find(s => s.name === `${side}_Hand`)!
        for (const [i, digit] of ['Index', 'Middle', 'Ring', 'Little', 'Thumb'].entries()) for (let j = 1; j <= 3; j++) {
          const bone = this.model.getObjectByName(`J_Bip_${side}_${digit}${j}`); if (!bone) continue
          this.relaxedFingers.push({ bone, hand, side: side === 'L' ? -1 : 1, rest: bone.rotation.z, flex: 0, speed: 0, weight: (digit === 'Thumb' ? .3 : .62 + i * .10) * (.5 + j * .14) })
        }
      }
    }
    this.visual.visible = false
    this.visual.name = 'Anatomical joint overlay'
  }

  private get(name: string) {
    const b = this.model.getObjectByName(`J_Bip_${name}`)
    if (!b) throw new Error(`В модели отсутствует сустав ${name}`)
    return b
  }

  private pointBone(name: string, childName: string, direction: number[]) {
    const bone = this.get(name), child = this.get(childName)
    bone.parent!.updateWorldMatrix(true, false)
    const desired = new T.Vector3(...direction as [number, number, number]).normalize()
    const old = bone.getWorldQuaternion(new T.Quaternion()), from = worldPos(child).sub(worldPos(bone)).normalize()
    const worldQ = new T.Quaternion().setFromUnitVectors(from, desired).multiply(old)
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(worldQ))
    bone.updateWorldMatrix(false, true)
  }

  private pose() {
    if (this.model.userData.customAvatar) {
      const stand = this.poseMode === 'studio'
      for (const side of ['L', 'R']) {
        const s = side === 'L' ? -1 : 1
        const direction = (x: number, y: number, z: number) => new T.Vector3(x, y, z).normalize().applyQuaternion(this.model.getWorldQuaternion(new T.Quaternion())).toArray()
        this.pointBone(`${side}_UpperArm`, `${side}_LowerArm`, direction(s * (stand ? .29 : .61), -.88, -.03))
        this.pointBone(`${side}_LowerArm`, `${side}_Hand`, direction(s * (stand ? .16 : .32), -.93, -.10))
        this.pointBone(`${side}_UpperLeg`, `${side}_LowerLeg`, direction(s * .035, -1, -.022))
        this.pointBone(`${side}_LowerLeg`, `${side}_Foot`, direction(s * .008, -1, .021))
      }
      this.model.updateMatrixWorld(true); return
    }
    if (this.poseMode === 'patient') {
      this.get('C_Head').rotation.set(.015, -.24, .012)
      this.get('C_Head').scale.setScalar(1.07)
      this.get('C_Hips').rotation.z = -.008
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? -1 : 1
        this.get(`${side}_UpperArm`).rotation.set(-.035, sign * .044, -sign * (side === 'L' ? .89 : .77))
        this.get(`${side}_LowerArm`).rotation.set(-.08, sign * .072, -sign * (side === 'L' ? .26 : .34))
        this.get(`${side}_Hand`).rotation.set(sign * .23, sign * .12, sign * .045)
        for (const [i, finger] of ['Index', 'Middle', 'Ring', 'Little'].entries()) {
          for (let j = 1; j < 4; j++) this.get(`${side}_${finger}${j}`).rotation.z = -sign * (.09 + i * .037 + j * .012)
        }
        this.get(`${side}_Thumb1`).rotation.y = sign * .18
        this.get(`${side}_UpperLeg`).rotation.z = sign * .03
      }
      this.model.updateMatrixWorld(true)
      return
    }
    this.get('C_Hips').rotation.set(0, -.045, .022)
    this.get('C_Chest').rotation.set(-.025, .065, -.03)
    this.get('C_Head').rotation.set(.025, -.085, -.075)
    this.get('C_Head').scale.setScalar(1.15)
    this.pointBone('R_UpperArm', 'R_LowerArm', [.30, -.95, -.04])
    this.pointBone('R_LowerArm', 'R_Hand', [.12, -.95, -.24])
    this.pointBone('L_UpperArm', 'L_LowerArm', [-.59, -.78, -.23])
    this.pointBone('L_LowerArm', 'L_Hand', [.29, .92, -.25])
    this.pointBone('L_Hand', 'L_Middle1', [.55, .82, .18])
    this.get('R_Hand').rotation.set(-.08, .24, -.09)
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1
      for (const [i, finger] of ['Index', 'Middle', 'Ring', 'Little'].entries()) {
        for (let j = 1; j <= 3; j++) {
          this.get(`${side}_${finger}${j}`).rotation.z = -sign * (.075 + i * .045 + (side === 'L' ? .1 : 0))
        }
      }
    }
    this.get('L_UpperLeg').rotation.set(-.055, -.075, -.085)
    this.get('L_LowerLeg').rotation.x = .11
    this.get('R_UpperLeg').rotation.set(.025, .03, .055)
    this.get('C_Hips').position.y -= .037
    this.model.updateMatrixWorld(true)
  }

  private createBodies() {
    const specs: [string, string | null, string | null, number, number, string, number][] = [
      ['C_Hips', 'C_Spine', null, .088, 6.4, 'Таз', .22],
      ['C_Spine', 'C_Chest', 'C_Hips', .069, 3.5, 'Поясница', .26],
      ['C_Chest', 'C_UpperChest', 'C_Spine', .081, 4.3, 'Корпус', .25],
      ['C_UpperChest', 'C_Neck', 'C_Chest', .08, 4.1, 'Грудной отдел', .22],
      ['C_Neck', 'C_Head', 'C_UpperChest', .032, .65, 'Шея', .4],
      ['C_Head', null, 'C_Neck', .103, 3.4, 'Голова', .52],
    ]
    for (const side of ['L', 'R']) {
      const l = side === 'L' ? 'Левая' : 'Правая'
      specs.push(
        [`${side}_UpperArm`, `${side}_LowerArm`, 'C_UpperChest', .032, 1.2, `${l} рука`, 1.4],
        [`${side}_LowerArm`, `${side}_Hand`, `${side}_UpperArm`, .026, .85, `${l} рука`, 1.35],
        [`${side}_Hand`, `${side}_Middle3`, `${side}_LowerArm`, .022, .36, `${l} кисть`, .72],
        [`${side}_UpperLeg`, `${side}_LowerLeg`, 'C_Hips', .057, 4.3, `${l} нога`, 1.05],
        [`${side}_LowerLeg`, `${side}_Foot`, `${side}_UpperLeg`, .044, 2.4, `${l} голень`, 1.15],
        [`${side}_Foot`, `${side}_ToeBase`, `${side}_LowerLeg`, .028, .7, `${l} стопа`, .55],
      )
    }
    const jointGeometry = new T.SphereGeometry(.012, 10, 8)
    const linkGeometry = new T.CylinderGeometry(.003, .006, 1, 7)
    for (const [name, childName, parentName, radius, mass, label, angle] of specs) {
      const bone = this.get(name)
      const start = worldPos(bone)
      const end = name.endsWith('_Hand') ? worldPos(this.get(name.slice(0, 2) + 'Middle1')).lerp(worldPos(this.get(name.slice(0, 2) + 'Middle2')), .15)
        : childName ? worldPos(this.get(childName)) : bone.localToWorld(new T.Vector3(0, .184, .005))
      const localDir = end.clone().sub(start)
      const q = bone.getWorldQuaternion(new T.Quaternion())
      const body = new C.Body({ mass, position: cv(start.clone().lerp(end, .5)), quaternion: cq(q),
        linearDamping: .17, angularDamping: .70, collisionFilterGroup: 2, collisionFilterMask: 1,
        sleepSpeedLimit: .045, sleepTimeLimit: .6 })
      const len = localDir.length()
      const localAxis = localDir.clone().normalize().applyQuaternion(q.clone().invert())
      const orientation = new T.Quaternion().setFromUnitVectors(unitUp, localAxis)
      const half = Math.max(0, len / 2 - radius * .7)
      body.addShape(new C.Sphere(radius), cv(localAxis.clone().multiplyScalar(half)))
      if (half > .005) {
        body.addShape(new C.Sphere(radius), cv(localAxis.clone().multiplyScalar(-half)))
        body.addShape(new C.Cylinder(radius * .94, radius * .94, half * 2, 8), new C.Vec3(), cq(orientation))
      }
      this.world.addBody(body)
      const parent = this.segments.find(s => s.name === parentName)
      const seg: Segment = { name, label, bone, body, mass, start: body.pointToLocalFrame(cv(start)),
        end: body.pointToLocalFrame(cv(end)), restP: body.position.clone(), restQ: body.quaternion.clone(), radius, parent }
      if (parent && /LowerArm|LowerLeg/.test(name)) {
        const parentDir = tv(parent.body.pointToWorldFrame(parent.end)).sub(tv(parent.body.pointToWorldFrame(parent.start))).normalize()
        const childDir = localDir.clone().normalize()
        const bend = Math.acos(T.MathUtils.clamp(parentDir.dot(childDir), -1, 1))
        const axis = parentDir.clone().cross(childDir)
        if (axis.lengthSq() < .0001) axis.set(1, 0, 0)
        axis.normalize()
        const axisA = parent.body.vectorToLocalFrame(cv(axis))
        const joint = new C.HingeConstraint(parent.body, body, {
          pivotA: parent.body.pointToLocalFrame(cv(start)), pivotB: seg.start,
          axisA, axisB: body.vectorToLocalFrame(cv(axis)), collideConnected: false, maxForce: 1800,
        })
        joint.equations.forEach(eq => eq.setSpookParams(2e7, 5, 1 / 120))
        this.world.addConstraint(joint)
        this.hinges.push({ a: parent, b: seg, axis: axisA,
          rest: parent.body.quaternion.inverse().mult(body.quaternion), min: -.035 - bend, max: 2.55 - bend })
        this.links3D.push({ a: parent, b: seg, pivotA: parent.body.pointToLocalFrame(cv(start)), pivotB: seg.start,
          rest: parent.restQ.inverse().mult(seg.restQ), axis: axisA, swing: 0, twist: 0, hinge: true, min: -.035 - bend, max: 2.55 - bend })
      } else if (parent) {
        const axis = cv(localDir.normalize())
        const twist = name.includes('UpperArm') ? .82 : name.includes('Hand') ? .48 : .36
        const joint = new RestFrameCone(parent.body, body, {
          pivotA: parent.body.pointToLocalFrame(cv(start)), pivotB: seg.start,
          axisA: parent.body.vectorToLocalFrame(axis), axisB: body.vectorToLocalFrame(axis),
          angle, twistAngle: twist, collideConnected: false, maxForce: 1800,
        })
        joint.equations.forEach(eq => eq.setSpookParams(2e7, 5, 1 / 120))
        this.world.addConstraint(joint)
        this.links3D.push({ a: parent, b: seg, pivotA: parent.body.pointToLocalFrame(cv(start)), pivotB: seg.start,
          rest: parent.restQ.inverse().mult(seg.restQ), axis: parent.body.vectorToLocalFrame(axis), swing: angle, twist, hinge: false, min: 0, max: 0 })
      }
      this.segments.push(seg)
      this.setKinematic(seg, true)
      const joint = new T.Mesh(jointGeometry, this.jointMaterial)
      const link = new T.Mesh(linkGeometry, this.linkMaterial)
      link.renderOrder = 90
      joint.renderOrder = 91
      this.visual.add(joint, link)
      this.joints.push(joint)
      this.links.push(link)
    }
    // Neighbouring capsules share joints; separated limbs should still collide.
    const all = (1 << (this.segments.length + 1)) - 1
    this.segments.forEach((s, i) => { s.body.collisionFilterGroup = 1 << (i + 1); s.body.collisionFilterMask = all })
    for (let i = 0; i < this.segments.length; i++) {
      const a = this.segments[i]
      const a0 = tv(a.body.pointToWorldFrame(a.start)), a1 = tv(a.body.pointToWorldFrame(a.end)), dir = a1.clone().sub(a0).normalize()
      const line = new T.Line3(a0, a1), ray = new T.Ray(a0, dir)
      for (const b of this.segments.slice(i + 1)) {
        const b0 = tv(b.body.pointToWorldFrame(b.start)), b1 = tv(b.body.pointToWorldFrame(b.end)), nearA = new T.Vector3(), nearB = new T.Vector3()
        ray.distanceSqToSegment(b0, b1, nearA, nearB)
        line.closestPointToPoint(nearA, true, nearA)
        new T.Line3(b0, b1).closestPointToPoint(nearA, true, nearB)
        if (a.parent === b || b.parent === a || a.parent?.parent === b || b.parent?.parent === a ||
          nearA.distanceTo(nearB) < a.radius + b.radius + .006 || (a.name.startsWith('C_') && b.name.startsWith('C_'))) {
          a.body.collisionFilterMask &= ~b.body.collisionFilterGroup
          b.body.collisionFilterMask &= ~a.body.collisionFilterGroup
        }
      }
    }
  }

  private limitHinges() {
    for (const h of this.hinges) {
      const a = h.a.body, b = h.b.body
      if (a.type !== C.Body.DYNAMIC && b.type !== C.Body.DYNAMIC) continue
      const delta = a.quaternion.inverse().mult(b.quaternion).mult(h.rest.inverse())
      const sin = delta.x * h.axis.x + delta.y * h.axis.y + delta.z * h.axis.z
      let angle = 2 * Math.atan2(sin, delta.w)
      if (angle > Math.PI) angle -= Math.PI * 2
      if (angle < -Math.PI) angle += Math.PI * 2
      const error = T.MathUtils.clamp(angle, h.min, h.max) - angle
      if (Math.abs(error) < .001) continue
      const axis = a.vectorToWorldFrame(h.axis)
      const rate = b.angularVelocity.vsub(a.angularVelocity).dot(axis)
      const invA = a.invInertiaWorld.vmult(axis).dot(axis), invB = b.invInertiaWorld.vmult(axis).dot(axis)
      const inertia = 1 / Math.max(.01, invA + invB)
      const torque = axis.scale(T.MathUtils.clamp((error * 320 - rate * 28) * inertia, -5, 5))
      if (b.type === C.Body.DYNAMIC) b.torque.vadd(torque, b.torque)
      if (a.type === C.Body.DYNAMIC) a.torque.vsub(torque, a.torque)
    }
  }

  private dampJointMotion() {
    for (const j of this.links3D) {
      const a = j.a.body, b = j.b.body
      if (b.type !== C.Body.DYNAMIC || b.sleepState === C.Body.SLEEPING) continue
      const rate = b.angularVelocity.vsub(a.angularVelocity), speed = rate.length()
      if (speed < .0001) continue
      const axis = rate.scale(1 / speed)
      const inv = a.invInertiaWorld.vmult(axis).dot(axis) + b.invInertiaWorld.vmult(axis).dot(axis)
      if (inv < .001) continue
      const torque = rate.scale(Math.min(8 / inv, 4 / speed))
      b.torque.vsub(torque, b.torque)
      if (a.type === C.Body.DYNAMIC) a.torque.vadd(torque, a.torque)
    }
  }

  private stabilizeJoints() {
    for (const j of this.links3D) {
      const a = j.a.body, b = j.b.body
      if (b.type !== C.Body.DYNAMIC) continue
      const delta = a.quaternion.inverse().mult(b.quaternion).mult(j.rest.inverse())
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
      const sin = delta.x * j.axis.x + delta.y * j.axis.y + delta.z * j.axis.z
      const twist = new C.Quaternion(j.axis.x * sin, j.axis.y * sin, j.axis.z * sin, delta.w)
      if (sin * sin + delta.w * delta.w < 1e-10) twist.set(0, 0, 0, 1); else twist.normalize()
      const swing = delta.mult(twist.inverse()), aTwist = 2 * Math.atan2(sin, delta.w)
      const aSwing = 2 * Math.acos(T.MathUtils.clamp(swing.w, -1, 1))
      const legSide = j.b.name.startsWith('L_') ? 'L' : 'R'
      const legSupport = this.poseMode === 'patient' && this.anchored && this.onOperatingTable && /UpperLeg|LowerLeg|Foot/.test(j.b.name) ? this.legReturn[legSide] : 0
      const swingLimit = T.MathUtils.lerp(j.swing, Math.min(j.swing, .028), legSupport)
      const twistLimit = T.MathUtils.lerp(j.twist, Math.min(j.twist, .045), legSupport)
      const low = j.hinge ? T.MathUtils.lerp(j.min, Math.max(j.min, -.025), legSupport) : -twistLimit
      const high = j.hinge ? T.MathUtils.lerp(j.max, Math.min(j.max, .11), legSupport) : twistLimit
      const limit = T.MathUtils.clamp(aTwist, low, high)
      let corrected = Math.abs(aTwist - limit) > 1e-5
      if (aSwing > swingLimit + .0001) {
        const dir = new C.Vec3(swing.x, swing.y, swing.z); dir.normalize()
        swing.setFromAxisAngle(dir, swingLimit); corrected = true
      }
      if (corrected) {
        twist.setFromAxisAngle(j.axis, limit)
        b.quaternion.copy(a.quaternion.mult(swing).mult(twist).mult(j.rest)); b.quaternion.normalize()
        const relative = b.angularVelocity.vsub(a.angularVelocity), axis = a.vectorToWorldFrame(j.axis)
        if (j.hinge) {
          let rate = relative.dot(axis)
          if ((aTwist >= high && rate > 0) || (aTwist <= low && rate < 0)) rate = 0
          b.angularVelocity.copy(a.angularVelocity.vadd(axis.scale(rate)))
        } else {
          const rate = relative.dot(axis)
          if ((aTwist >= high && rate > 0) || (aTwist <= low && rate < 0)) b.angularVelocity.vsub(axis.scale(rate), b.angularVelocity)
        }
        b.updateInertiaWorld(true)
      }
      // Render bones have fixed length. Keep colliders on that same articulated chain.
      const pivot = a.pointToWorldFrame(j.pivotA), childPivot = b.pointToWorldFrame(j.pivotB)
      const correction = pivot.vsub(childPivot)
      if (correction.lengthSquared() > 1e-14) { b.position.vadd(correction, b.position); b.aabbNeedsUpdate = true }
      const spin = b.angularVelocity.length()
      if (spin > 13) b.angularVelocity.scale(13 / spin, b.angularVelocity)
    }
  }

  private resolveSupport() {
    if (this.anchored || this.moving) return
    // Leave a contact skin for the solver. Clearing every overlap would remove the
    // persistent contacts and repeatedly drop the whole character back onto the floor.
    const contactSkin = .004
    let lift = 0
    const supported = new Set<C.Body>()
    for (const s of this.segments) {
      for (let i = 0; i < s.body.shapes.length; i++) {
        const shape = s.body.shapes[i]
        if (!(shape instanceof C.Sphere)) continue
        const p = s.body.pointToWorldFrame(s.body.shapeOffsets[i])
        let top = this.poseMode === 'patient' ? 0 : -.056
        if (this.poseMode === 'studio' && Math.hypot(p.x, p.z) < .608) top = 0
        if (this.poseMode === 'patient') {
          // Only resolve the top of a support when the body is already above its edge.
          if (Math.abs(p.x) < .352 && Math.abs(p.z) < 1.07 && p.y > .84) top = .92
          if (Math.abs(Math.abs(p.x) - .444) < .102 && Math.abs(p.z + .145) < .345 && p.y > .86) top = .919
          if (Math.abs(p.x - .98) < .295 && Math.abs(p.z - .20) < .445 && p.y > .88) top = .943
        }
        const depth = top - (p.y - shape.radius)
        if (depth > -.0015) supported.add(s.body)
        lift = Math.max(lift, depth)
      }
    }
    // Correct the whole island: lifting just the hand would open the wrist seam again.
    if (lift > contactSkin) for (const s of this.segments) {
      s.body.position.y += lift - contactSkin; s.body.aabbNeedsUpdate = true
    }
    for (const b of supported) {
      if (b.velocity.y < 0) b.velocity.y = 0
      b.angularVelocity.scale(this.dragging ? .94 : .81, b.angularVelocity)
      b.velocity.x *= .985; b.velocity.z *= .985
    }
  }

  hitTest(ray: T.Ray, padding = 0) {
    let distance = Infinity
    let selected: Segment | null = null
    for (const segment of this.segments) {
      const near = new T.Vector3()
      const d2 = ray.distanceSqToSegment(tv(segment.body.pointToWorldFrame(segment.start)),
        tv(segment.body.pointToWorldFrame(segment.end)), near)
      const r = segment.radius * 1.14 + padding
      if (d2 > r * r) continue
      const depth = near.distanceTo(ray.origin) - Math.sqrt(Math.max(0, r * r - d2))
      if (depth < distance && depth > 0) { distance = depth; selected = segment }
    }
    return selected ? { segment: selected, point: ray.at(distance, new T.Vector3()) } : null
  }

  private setKinematic(s: Segment, value: boolean) {
    s.body.type = value ? C.Body.KINEMATIC : C.Body.DYNAMIC
    s.body.mass = value ? 0 : s.mass
    s.body.updateMassProperties()
    s.body.updateInertiaWorld(true)
    s.body.wakeUp()
  }

  private capturePins() {
    this.pinnedPoses.clear()
    for (const s of this.segments) if (s.name.startsWith('C_') && s.name !== 'C_Neck' && s.name !== 'C_Head') {
      this.pinnedPoses.set(s.name, { p: s.body.position.clone(), q: s.body.quaternion.clone() })
    }
  }

  private configurePatientBodies(anchored: boolean) {
    this.isDynamic = true
    for (const s of this.segments) {
      const pin = anchored && s.name.startsWith('C_') && s.name !== 'C_Neck' && s.name !== 'C_Head'
      this.setKinematic(s, pin)
      if (pin) { s.body.velocity.setZero(); s.body.angularVelocity.setZero() }
    }
  }

  setGravity(value: number) {
    this.world.gravity.y = -T.MathUtils.clamp(Number.isFinite(value) ? value : 9.81, 0, 25)
    this.segments.forEach(s => s.body.wakeUp())
  }

  setTableSupport(on: boolean) {
    this.onOperatingTable = on
    if (!on) this.legReturn.L = this.legReturn.R = 0
    this.segments.forEach(s => s.body.wakeUp())
  }

  gripCenter() { return this.dragging ? tv(this.dragging.body.pointToWorldFrame(this.grabPoint)) : null }
  gripEffort() {
    if (!this.grab) return 0
    return Math.min(1, Math.hypot(...this.grab.equations.map(e => e.multiplier)) / 400)
  }

  setAnchored(value: boolean) {
    if (this.anchored === value) return
    this.endGrab()
    this.anchored = value
    if (this.poseMode === 'patient') {
      this.capturePins(); this.configurePatientBodies(value)
      return
    }
    const hips = this.segments[0]
    if (value) {
      const ground = Math.hypot(hips.body.position.x, hips.body.position.z) > .612 ? -.056 : 0
      this.anchor.set(hips.body.position.x - hips.restP.x, Math.max(ground, hips.body.position.y - hips.restP.y),
        hips.body.position.z - hips.restP.z)
      this.restBlend = 0
    }
    this.isDynamic = !value
    this.segments.forEach(s => {
      this.setKinematic(s, value)
      s.body.velocity.setZero()
      s.body.angularVelocity.setZero()
    })
  }

  pick(point: T.Vector3) {
    let best: Segment = this.segments[0]
    let distance = Infinity
    for (const s of this.segments) {
      const line = new T.Line3(tv(s.body.pointToWorldFrame(s.start)), tv(s.body.pointToWorldFrame(s.end)))
      const near = line.closestPointToPoint(point, true, new T.Vector3())
      const d = point.distanceTo(near) - s.radius * .35
      if (d < distance) { distance = d; best = s }
    }
    return best
  }

  beginGrab(s: Segment, point: T.Vector3) {
    this.endGrab()
    this.dragging = s
    this.isDynamic = true
    const group = s.name.slice(0, 2)
    if (this.poseMode === 'patient') {
      this.configurePatientBodies(this.anchored)
    } else for (const part of this.segments) {
      const sameLimb = group !== 'C_' && part.name.startsWith(group) &&
        /Arm|Hand/.test(part.name) === /Arm|Hand/.test(s.name)
      this.setKinematic(part, this.anchored && !sameLimb && part !== s)
    }
    this.target.position.copy(cv(point))
    this.grabGoal.copy(this.target.position)
    this.target.velocity.setZero(); this.grabPoint = s.body.pointToLocalFrame(cv(point))
    const capacity = this.anchored ? 220 : Math.max(420, this.segments.reduce((sum, part) => sum + part.mass, 0) * Math.max(1, -this.world.gravity.y) * 1.75)
    this.grab = new C.PointToPointConstraint(s.body, this.grabPoint.clone(), this.target, new C.Vec3(), capacity)
    this.grab.equations.forEach(eq => eq.setSpookParams(6e4, 6, 1 / 120))
    this.world.addConstraint(this.grab)
  }

  dragTo(point: T.Vector3) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) return
    this.grabGoal.copy(cv(point))
    if (this.anchored && this.dragging && /Arm|Hand/.test(this.dragging.name)) {
      const arm = this.segments.find(s => s.name === this.dragging!.name.slice(0, 2) + 'UpperArm')!
      const shoulder = arm.body.pointToWorldFrame(arm.start), reach = this.grabGoal.vsub(shoulder)
      const length = reach.length(), maxReach = this.dragging.name.includes('UpperArm') ? .23 : .545
      if (length > maxReach) this.grabGoal.copy(shoulder.vadd(reach.scale(maxReach / length)))
    }
    this.dragging?.body.wakeUp()
  }

  endGrab(velocity?: T.Vector3) {
    if (this.grab) { this.world.removeConstraint(this.grab); this.grab = null }
    if (this.dragging && !this.anchored && velocity) {
      const v = velocity.clone().clampLength(0, 5)
      this.dragging.body.velocity.vadd(cv(v.multiplyScalar(.55)), this.dragging.body.velocity)
    }
    if (this.dragging && this.poseMode === 'patient') {
      this.configurePatientBodies(this.anchored)
    } else if (this.dragging && this.anchored) {
      this.restBlend = 0
      this.isDynamic = false
      this.segments.forEach(s => { this.setKinematic(s, true); s.body.velocity.setZero(); s.body.angularVelocity.setZero() })
    }
    this.dragging = null; this.target.velocity.setZero()
  }

  beginMove() {
    this.endGrab()
    this.moving = true
    this.moveStart = this.segments.map(s => s.body.position.clone())
    this.moveAnchor.copy(this.anchor)
    this.segments.forEach(s => { this.setKinematic(s, true); s.body.velocity.setZero(); s.body.angularVelocity.setZero() })
  }

  moveBy(delta: T.Vector3) {
    this.segments.forEach((s, i) => s.body.position.copy(this.moveStart[i].vadd(cv(delta))))
    this.anchor.copy(this.moveAnchor).add(delta)
    this.sync()
  }

  endMove() {
    if (!this.moving) return
    this.moving = false
    this.segments.forEach(s => this.setKinematic(s, this.anchored))
    this.isDynamic = !this.anchored
  }

  step(dt: number, time: number) {
    if (!this.moving) {
      if (this.isDynamic) {
        if (this.poseMode === 'patient' && this.anchored) {
          for (const s of this.segments) {
            const pose = this.pinnedPoses.get(s.name); if (!pose) continue
            const breathing = (s.name === 'C_Chest' || s.name === 'C_UpperChest') ? Math.sin(time * 1.39) * .0018 : 0
            s.body.position.copy(pose.p); s.body.position.y += breathing; s.body.quaternion.copy(pose.q); s.body.aabbNeedsUpdate = true
          }
          for (const j of this.links3D) {
            if (j.b.body.type !== C.Body.KINEMATIC) continue
            const p = j.a.body.pointToWorldFrame(j.pivotA), offset = j.b.body.quaternion.vmult(j.pivotB)
            p.vsub(offset, j.b.body.position); j.b.body.aabbNeedsUpdate = true
          }
        }
        const h = 1 / 120
        this.accumulator += Math.min(Math.max(dt, 0), h * 8)
        while (this.accumulator + 1e-10 >= h) {
          if (this.poseMode === 'patient' && this.onOperatingTable && this.anchored) for (const side of ['L', 'R'] as const) {
            const holdingLeg = this.dragging?.name.startsWith(side + '_') && /Leg|Foot/.test(this.dragging.name)
            this.legReturn[side] = holdingLeg ? 0 : Math.min(1, this.legReturn[side] + h * 1.8)
          }
          if (this.grab) {
            const offset = this.grabGoal.vsub(this.target.position), length = offset.length()
            const speed = Math.min(2.6, length * 24)
            this.target.velocity.copy(length > 1e-7 ? offset.scale(speed / length) : new C.Vec3())
          }
          this.world.step(h); this.accumulator = Math.max(0, this.accumulator - h)
        }
        for (const s of this.segments) {
          const speed = s.body.velocity.length()
          if (speed > 11) s.body.velocity.scale(11 / speed, s.body.velocity)
          const spin = s.body.angularVelocity.length()
          if (spin > 21) s.body.angularVelocity.scale(21 / spin, s.body.angularVelocity)
        }
      } else {
        this.restBlend = Math.min(1, this.restBlend + dt * 2.4)
        const a = this.restBlend >= 1 ? 1 : 1 - Math.exp(-dt * 10)
        const breath = Math.sin(time * 1.65) * .0018
        const previous = new Map(this.segments.map(s => [s, s.body.quaternion.clone()]))
        for (const s of this.segments) {
          const p = s.restP.vadd(cv(this.anchor))
          p.y += breath * Math.max(0, (s.restP.y - .75) * 1.5)
          s.body.position.lerp(p, a, s.body.position)
          const j = this.links3D.find(link => link.b === s)
          if (j) {
            const rel = previous.get(j.a)!.inverse().mult(previous.get(s)!)
            rel.slerp(j.rest, a, rel); s.body.quaternion.copy(j.a.body.quaternion.mult(rel))
            const pivot = j.a.body.pointToWorldFrame(j.pivotA), offset = s.body.quaternion.vmult(j.pivotB)
            pivot.vsub(offset, s.body.position)
          } else s.body.quaternion.slerp(s.restQ, a, s.body.quaternion)
          s.body.aabbNeedsUpdate = true
        }
      }
    }
    const blink = time % 4.85
    if (this.poseMode === 'patient' && dt > 0) {
      // Secondary finger flex follows palm orientation and motion, not a looping pose.
      const h = Math.min(.035, dt)
      for (const f of this.relaxedFingers) {
        const localG = f.hand.body.vectorToLocalFrame(this.world.gravity)
        const goal = f.side * f.weight * T.MathUtils.clamp(localG.y * .014 - localG.z * .009 + f.hand.body.angularVelocity.x * .016, -.25, .25)
        f.speed += ((goal - f.flex) * 37 - f.speed * 10) * h; f.flex += f.speed * h
        f.bone.rotation.z = f.rest + f.flex
      }
    }
    for (const mesh of this.face) {
      const value = this.poseMode === 'patient' ? 1 : blink > 4.60 ? Math.sin((blink - 4.60) / .25 * Math.PI) : 0
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary || {})) if (/^(blink|eyeblink(left|right)?|blink_[lr]|fcl_eye_close(_[lr])?)$/i.test(name) && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value
    }
    this.sync()
  }

  get needsShadowUpdate() { return this.moving || this.restBlend < 1 || (this.isDynamic && this.segments.some(s => s.body.type === C.Body.DYNAMIC && s.body.sleepState !== C.Body.SLEEPING)) }

  sync() {
    for (const [i, s] of this.segments.entries()) {
      const start = tv(s.body.pointToWorldFrame(s.start))
      const parent = s.bone.parent!
      // Segments are parent-first. Do not traverse every finger and atlas mesh 18 times.
      parent.updateWorldMatrix(i === 0, false)
      if (i === 0) s.bone.position.copy(parent.worldToLocal(start.clone()))
      const parentQ = parent.getWorldQuaternion(new T.Quaternion()).invert()
      s.bone.quaternion.copy(parentQ.multiply(tq(s.body.quaternion)))
      s.bone.updateWorldMatrix(false, false)
      if (this.visual.visible) {
        const end = tv(s.body.pointToWorldFrame(s.end))
        this.joints[i].position.copy(start)
        this.links[i].position.copy(start).lerp(end, .5)
        this.dir.copy(end).sub(start)
        this.links[i].scale.y = this.dir.length()
        this.links[i].quaternion.setFromUnitVectors(unitUp, this.dir.normalize())
      }
    }
    this.model.updateMatrixWorld(true)
  }

  reset() {
    this.endGrab()
    this.endMove()
    this.anchor.set(0, 0, 0); this.accumulator = 0
    this.restBlend = 1
    this.relaxedFingers.forEach(f => { f.flex = f.speed = 0; f.bone.rotation.z = f.rest })
    this.isDynamic = !this.anchored
    this.segments.forEach(s => {
      s.body.position.copy(s.restP); s.body.quaternion.copy(s.restQ)
      s.body.velocity.setZero(); s.body.angularVelocity.setZero()
      s.body.force.setZero(); s.body.torque.setZero()
      s.body.aabbNeedsUpdate = true
      this.setKinematic(s, this.anchored)
    })
    if (this.poseMode === 'patient') { this.capturePins(); this.configurePatientBodies(this.anchored) }
    this.sync()
  }

  save(): BodyState[] {
    return this.segments.map(s => ({ name: s.name, p: s.body.position.toArray(),
      q: s.body.quaternion.toArray(), v: s.body.velocity.toArray(), w: s.body.angularVelocity.toArray() }))
  }

  restore(states: BodyState[], anchor: number[]) {
    this.endGrab()
    this.endMove()
    this.anchor.fromArray(anchor); this.accumulator = 0
    for (const s of this.segments) {
      const b = states.find(state => state.name === s.name)
      if (!b) continue
      s.body.position.set(b.p[0], b.p[1], b.p[2])
      s.body.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3])
      s.body.velocity.set(b.v[0], b.v[1], b.v[2])
      s.body.angularVelocity.set(b.w[0], b.w[1], b.w[2])
      s.body.aabbNeedsUpdate = true
      s.body.previousPosition.copy(s.body.position); s.body.interpolatedPosition.copy(s.body.position)
      s.body.previousQuaternion.copy(s.body.quaternion); s.body.interpolatedQuaternion.copy(s.body.quaternion)
      s.body.force.setZero(); s.body.torque.setZero(); s.body.updateInertiaWorld(true)
      s.body.wakeUp()
    }
    if (this.poseMode === 'patient') { this.capturePins(); this.configurePatientBodies(this.anchored) }
    this.sync()
  }
}