import * as T from 'three'
import type { CharacterRig } from '../studio/character'
import voices from './assets/voice/clips.json'

export type ReactionKind = 'operation' | 'sandbox'
export type SceneBeat = 'wake' | 'reach' | 'voice' | 'fall' | 'end'
export type ReactionFrame = { kind: ReactionKind; beat: SceneBeat; progress: number; gentle: boolean; audio: boolean }
export const dialogue = {
  operation: 'Считаешь что моя жизнь стоит меньше человеческой? Да ты долбаный лицемер!',
  sandbox: 'Тебя кто вообще в хирурги взял? Я тебе не игрушка!',
}
const v = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z)
const ease = (t: number) => { t = T.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t) }
const pos = (o: T.Object3D) => o.getWorldPosition(v())
const rotation = (o: T.Object3D) => o.getWorldQuaternion(new T.Quaternion())

function turnWorld(bone: T.Object3D, delta: T.Quaternion, fraction: number) {
  if (fraction <= 0) return
  const turn = new T.Quaternion().slerp(delta, fraction)
  bone.quaternion.copy(rotation(bone.parent!).invert().multiply(turn.multiply(rotation(bone)))).normalize()
  bone.updateWorldMatrix(false, false)
}

// This is an authored camera/character performance. The physics world is never driven
// through the camera path; every rendered pose is restored when the sequence ends.
export class ReactionScene {
  time = 0
  readonly voiceAt = 1.28
  readonly fallAt: number
  readonly duration: number
  private startP: T.Vector3
  private startQ: T.Quaternion
  private startUp: T.Vector3
  private startFov: number
  private gripView = new T.PerspectiveCamera()
  private joints = new Map<T.Object3D, T.Quaternion>()
  private expressions = new Map<T.Mesh, number[]>()
  private head: T.Object3D
  private turnChain: { joint: T.Object3D; share: number }[]
  private turn = new T.Quaternion()
  private shotDirection: T.Vector3
  private armSide: 'L' | 'R'
  private upperArm: T.Object3D
  private forearm: T.Object3D
  private palm: T.Object3D
  private gripP = v()
  private gripQ = new T.Quaternion()
  private floorP = v()
  private audio: HTMLAudioElement | null = null
  private voiceStarted = false
  private lastFrame = ''
  private stopped = false
  constructor(readonly kind: ReactionKind, private rig: CharacterRig, private camera: T.PerspectiveCamera, readonly gentle: boolean, private sound: boolean, private frame: (v: ReactionFrame) => void) {
    this.fallAt = this.voiceAt + (kind === 'operation' ? 4.64 : 3.47) + .36; this.duration = this.fallAt + 1.65
    this.startP = camera.position.clone(); this.startQ = camera.quaternion.clone(); this.startFov = camera.fov; this.startUp = camera.up.clone()
    const get = (n: string) => rig.model.getObjectByName('J_Bip_' + n)!
    const face = rig.faceFrame
    this.head = face.head
    this.turnChain = ([['C_Spine', .12], ['C_Chest', .14], ['C_UpperChest', .17], ['C_Neck', .20], ['C_Head', .37]] as const).map(([name, share]) => ({ joint: get(name), share }))
    const worldHead = rotation(this.head), front = face.forward.clone().applyQuaternion(worldHead), up = face.up.clone().applyQuaternion(worldHead)
    const right = front.clone().cross(up).normalize(), eyes = this.head.localToWorld(face.center.clone())
    const incoming = this.startP.clone().sub(eyes).normalize()
    const yaw = T.MathUtils.clamp(Math.atan2(incoming.dot(right), incoming.dot(front)), -.91, .91)
    const pitch = T.MathUtils.clamp(Math.asin(T.MathUtils.clamp(incoming.dot(up), -1, 1)), -.48, .52)
    // Meet the player partway: turn the torso/neck and bring a rear camera around to the face.
    this.shotDirection = front.clone().multiplyScalar(Math.cos(yaw) * Math.cos(pitch)).addScaledVector(right, Math.sin(yaw) * Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize()
    if (this.shotDirection.y < .36) {
      this.shotDirection.y = 0
      if (this.shotDirection.lengthSq() < .001) this.shotDirection.copy(incoming).setY(0)
      if (this.shotDirection.lengthSq() < .001) this.shotDirection.set(1, 0, 0)
      this.shotDirection.setLength(Math.sqrt(1 - .36 ** 2)); this.shotDirection.y = .36
    }
    if (Math.abs(eyes.x) > 3.0 && this.shotDirection.x * eyes.x > 0) this.shotDirection.x *= -1
    if (Math.abs(eyes.z) > 2.7 && this.shotDirection.z * eyes.z > 0) this.shotDirection.z *= -1
    const nearLens = eyes.clone().addScaledVector(this.shotDirection, .48)
    this.armSide = pos(get('L_UpperArm')).distanceToSquared(nearLens) + .005 < pos(get('R_UpperArm')).distanceToSquared(nearLens) ? 'L' : 'R'
    this.upperArm = get(this.armSide + '_UpperArm'); this.forearm = get(this.armSide + '_LowerArm'); this.palm = get(this.armSide + '_Hand')
    rig.model.traverse(o => { if (o instanceof T.Bone) this.joints.set(o, o.quaternion.clone()) })
    rig.face.forEach(m => { if (m.morphTargetInfluences) this.expressions.set(m, [...m.morphTargetInfluences]) })
    if (sound) { this.audio = new Audio(voices[kind]); this.audio.preload = 'auto'; this.audio.volume = .79; this.audio.load() }
    this.stage(0)
  }
  private aim(a: T.Object3D, b: T.Object3D, direction: T.Vector3) {
    const from = pos(b).sub(pos(a)).normalize(), base = a.getWorldQuaternion(new T.Quaternion())
    const desired = new T.Quaternion().setFromUnitVectors(from, direction.normalize()).multiply(base)
    a.quaternion.copy(a.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(desired)); a.updateWorldMatrix(false, true)
  }
  private reach(target: T.Vector3, amount: number, outward: T.Vector3, up: T.Vector3) {
    const s = pos(this.upperArm), e = pos(this.forearm), w = pos(this.palm), a = s.distanceTo(e), b = e.distanceTo(w)
    const d = target.clone().sub(s), distance = T.MathUtils.clamp(d.length(), Math.abs(a - b) + .002, (a + b) * .966); d.normalize()
    const pole = outward.clone().addScaledVector(up, -.75); pole.addScaledVector(d, -pole.dot(d))
    if (pole.lengthSq() < .001) { pole.copy(e).sub(s); pole.addScaledVector(d, -pole.dot(d)) }
    pole.normalize()
    const t = (a * a - b * b + distance * distance) / (2 * distance)
    const elbow = s.clone().addScaledVector(d, t).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - t * t)))
    const uq = this.upperArm.quaternion.clone(), lq = this.forearm.quaternion.clone()
    this.aim(this.upperArm, this.forearm, elbow.clone().sub(s))
    this.aim(this.forearm, this.palm, s.clone().addScaledVector(d, distance).sub(elbow))
    this.upperArm.quaternion.slerp(uq, 1 - amount); this.forearm.quaternion.slerp(lq, 1 - amount)
    const sign = this.armSide === 'R' ? -1 : 1
    this.palm.rotateZ(sign * .18 * amount)
    const middle = this.rig.model.getObjectByName(`J_Bip_${this.armSide}_Middle1`)
    if (middle && amount > 0) {
      const fingerDir = pos(middle).sub(pos(this.palm)).normalize(), toEdge = outward.clone().addScaledVector(up, .43).normalize()
      const wristTurn = new T.Quaternion().setFromUnitVectors(fingerDir, toEdge)
      turnWorld(this.palm, wristTurn, amount * Math.min(1, .62 / Math.max(.001, fingerDir.angleTo(toEdge))))
    }
    for (const f of ['Index', 'Middle', 'Ring', 'Little']) for (let i = 1; i <= 3; i++) this.rig.model.getObjectByName(`J_Bip_${this.armSide}_${f}${i}`)?.rotateZ(sign * amount * (i === 1 ? .16 : .28))
  }
  private stage(t: number) {
    const wake = ease(t / .8), reach = ease((t - .28) / 1.04), talk = t >= this.voiceAt && t < this.fallAt - .22, drop = T.MathUtils.clamp((t - this.fallAt) / .88, 0, 1)
    this.joints.forEach((q, b) => b.quaternion.copy(q))
    const turn = ease((t - .045) / 1.02)
    const spine = this.turnChain[0].joint, towardHead = pos(this.head).sub(pos(spine)).normalize()
    const rise = new T.Quaternion().setFromUnitVectors(towardHead, towardHead.clone().add(v(0, .29, 0)).normalize())
    turnWorld(spine, rise, wake)
    this.turn.setFromUnitVectors(this.rig.faceFrame.forward.clone().applyQuaternion(rotation(this.head)), this.shotDirection)
    for (const { joint, share } of this.turnChain) turnWorld(joint, this.turn, share * turn)
    const face = this.rig.faceFrame, eyeCenter = this.head.localToWorld(face.center.clone())
    const faceUp = face.up.clone().applyQuaternion(rotation(this.head)), focus = eyeCenter.clone().addScaledVector(faceUp, -.018)
    const fov = this.gentle ? 43 : 45, tanHalf = Math.tan(T.MathUtils.degToRad(fov / 2))
    const distance = Math.max(this.gentle ? .57 : .475, face.width / (2 * tanHalf * Math.max(.25, this.camera.aspect) * .73))
    this.gripP.copy(eyeCenter).addScaledVector(this.shotDirection, distance)
    this.gripView.position.copy(this.gripP); this.gripView.up.copy(faceUp); this.gripView.lookAt(focus); this.gripQ.copy(this.gripView.quaternion)
    const right = v(1, 0, 0).applyQuaternion(this.gripQ), forward = v(0, 0, -1).applyQuaternion(this.gripQ), screenUp = v(0, 1, 0).applyQuaternion(this.gripQ)
    const side = pos(this.upperArm).sub(eyeCenter).dot(right) >= 0 ? 1 : -1, outward = right.multiplyScalar(side)
    const edge = T.MathUtils.clamp(.175 * tanHalf * this.camera.aspect * .94, .045, .17)
    const gripPoint = this.gripP.clone().addScaledVector(outward, edge).addScaledVector(forward, .175).addScaledVector(screenUp, -.175 * tanHalf * .72)
    this.reach(gripPoint, reach, outward, screenUp)
    const blend = ease((t - .06) / (this.gentle ? 1.15 : 1.03))
    const from = this.startP.clone().sub(eyeCenter), fromLength = from.length()
    if (fromLength < .001) from.copy(this.shotDirection); else from.divideScalar(fromLength)
    const arc = new T.Quaternion().setFromUnitVectors(from, this.shotDirection)
    const travel = from.applyQuaternion(new T.Quaternion().slerp(arc, blend))
    this.camera.position.copy(eyeCenter).addScaledVector(travel, T.MathUtils.lerp(fromLength, distance, blend))
    this.gripView.position.copy(this.camera.position); this.gripView.lookAt(focus)
    this.camera.quaternion.slerpQuaternions(this.startQ, this.gripView.quaternion, blend)
    this.camera.fov = T.MathUtils.lerp(this.startFov, fov, blend)
    for (const eye of face.eyes) {
      const axis = eye.forward.clone().applyQuaternion(rotation(eye.bone)), look = this.camera.position.clone().sub(pos(eye.bone)).normalize()
      turnWorld(eye.bone, new T.Quaternion().setFromUnitVectors(axis, look), wake * Math.min(1, .17 / Math.max(.0001, axis.angleTo(look))))
    }
    this.rig.model.updateMatrixWorld(true)
    this.expressions.forEach((rest, m) => {
      const weights = m.morphTargetInfluences!; weights.splice(0, weights.length, ...rest)
      for (const [name, i] of Object.entries(m.morphTargetDictionary || {})) {
        const n = name.toLowerCase()
        if (/blink|eye_close/.test(n)) weights[i] = (rest[i] ?? 1) * (1 - wake)
        else if (/lipsmile|mouthsmile|^smile$|joy|happy/.test(n)) weights[i] = T.MathUtils.lerp(rest[i] || 0, n === 'smile' ? .55 : .96, reach)
        else if (/mouthopen|jawopen|^aa$|mouth_a/.test(n)) weights[i] = talk ? .12 + .32 * Math.abs(Math.sin(t * 13.2) * Math.cos(t * 4.3)) : .08 + reach * .10
      }
    })
    if (drop > 0 && !this.gentle) {
      const sign = this.gripP.x < 0 ? -1 : 1
      this.floorP.set(sign * Math.max(.77, Math.abs(this.gripP.x) + .28), .085, this.gripP.z + .19)
      const falling = drop * drop; this.camera.position.lerp(this.floorP, falling); this.camera.position.y += Math.sin(drop * Math.PI) * .043
      const roll = -1.53 * ease(Math.min(1, drop * 3.4)) + Math.sin(drop * 10) * .12 * (1 - drop)
      this.camera.rotateZ(roll); this.camera.rotateX(-.39 * ease(drop)); this.camera.rotateY(.17 * Math.sin(drop * Math.PI)); this.camera.fov += 9 * ease(drop)
    }
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true)
    if (t >= this.voiceAt && !this.voiceStarted) { this.voiceStarted = true; if (this.sound) void this.audio?.play().catch(() => { this.sound = false }) }
    const beat: SceneBeat = t < .30 ? 'wake' : t < this.voiceAt ? 'reach' : t < this.fallAt ? 'voice' : t < this.fallAt + .95 ? 'fall' : 'end'
    const progress = Math.min(1, t / this.duration), key = `${beat}/${Math.floor(progress * 40)}/${this.sound}`
    if (this.lastFrame !== key) { this.lastFrame = key; this.frame({ kind: this.kind, beat, progress, gentle: this.gentle, audio: this.sound }) }
  }
  tick(dt: number) { if (this.stopped) return true; this.time = Math.min(this.duration, this.time + dt); this.stage(this.time); return this.time >= this.duration }
  visibility(visible: boolean) { if (!this.audio) return; if (!visible) this.audio.pause(); else if (this.voiceStarted && this.sound && this.time < this.fallAt && !this.audio.ended) void this.audio.play().catch(() => {}) }
  stop() {
    if (this.stopped) return; this.stopped = true
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null }
    this.joints.forEach((q, b) => b.quaternion.copy(q)); this.expressions.forEach((rest, m) => m.morphTargetInfluences?.splice(0, rest.length, ...rest)); this.rig.model.updateMatrixWorld(true)
    this.camera.position.copy(this.startP); this.camera.quaternion.copy(this.startQ); this.camera.fov = this.startFov; this.camera.up.copy(this.startUp); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true)
  }
}