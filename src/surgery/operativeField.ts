import * as T from 'three'
import type { CharacterRig } from '../studio/character'
import type { Pick, ToolId, Zone } from './game'
import { freshProcedure, type Procedure } from './procedure'

type Attachment = { mesh: T.Mesh; a: number; b: number; c: number; bary: T.Vector3; flip: number }
const UP = new T.Vector3(0, 1, 0)
const V = () => new T.Vector3()
const worldVertex = (m: T.Mesh, index: number, result: T.Vector3) => m.getVertexPosition(index, result).applyMatrix4(m.matrixWorld)

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h)
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath()
}

// Sample the visible mesh once. Barycentric attachments follow skinned triangles,
// so the artwork conforms to the arm, clothing, or drape without a floating box.
export class OperativeField {
  readonly group = new T.Group()
  readonly canvas = document.createElement('canvas')
  readonly texture: T.CanvasTexture
  readonly surface: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>
  readonly fragment = new T.Mesh(new T.IcosahedronGeometry(.0088, 0), new T.MeshStandardMaterial({ color: '#62b8c8', roughness: .36, metalness: .36, flatShading: true }))
  readonly samples: Attachment[] = []
  readonly markers: T.Mesh[] = []
  readonly strokeEnds = [V(), V()]
  readonly center = V()
  readonly normal = UP.clone()
  readonly tray = new T.Vector3(.985, .970, -.165)
  readonly dish = new T.Group()
  readonly cols = 10
  readonly rows = 6
  zone: Zone = 'arm'
  ready = false
  private attachmentBone = 'C_Spine'
  private procedure = freshProcedure(0)
  private practice = false
  private action: ToolId | null = null
  private traces = true
  private transfer = 1
  private transferFrom = V()
  private width = .074
  private depth = .033
  private a = V(); private b = V(); private c = V(); private n = V(); private point = V()
  private ray = new T.Raycaster()

  constructor() {
    this.canvas.width = 512; this.canvas.height = 256; this.texture = new T.CanvasTexture(this.canvas); this.texture.colorSpace = T.SRGBColorSpace
    const count = (this.rows + 1) * (this.cols + 1), uvs: number[] = [], ix: number[] = []
    for (let j = 0; j <= this.rows; j++) for (let i = 0; i <= this.cols; i++) {
      uvs.push(i / this.cols, 1 - j / this.rows)
      if (i === this.cols || j === this.rows) continue
      const a = j * (this.cols + 1) + i, b = a + this.cols + 1; ix.push(a, b, a + 1, a + 1, b, b + 1)
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage)); geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); geo.setIndex(ix)
    this.surface = new T.Mesh(geo, new T.MeshBasicMaterial({ map: this.texture, transparent: true, alphaTest: .045, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, toneMapped: false }))
    this.surface.renderOrder = 7; this.surface.name = 'Surface-bound practice marking'; this.surface.frustumCulled = false
    this.group.add(this.surface, this.fragment); this.group.visible = false; this.fragment.scale.set(1.2, .77, .90)
    for (let i = 0; i < 3; i++) {
      const m = new T.Mesh(new T.SphereGeometry(.0052, 10, 7), new T.MeshBasicMaterial({ visible: false })); this.group.add(m); this.markers.push(m)
    }
    const cup = new T.Mesh(new T.CylinderGeometry(.040, .028, .009, 36), new T.MeshStandardMaterial({ color: '#84999c', metalness: .67, roughness: .32 })); cup.position.copy(this.tray); cup.position.y = .954
    const rim = new T.Mesh(new T.TorusGeometry(.039, .002, 7, 36), new T.MeshStandardMaterial({ color: '#c5d3d2', metalness: .8, roughness: .22 })); rim.rotation.x = Math.PI / 2; rim.position.copy(cup.position); rim.position.y += .006
    this.dish.add(cup, rim); this.dish.name = 'Specimen cup'
  }

  bind(rig: CharacterRig, cloth: T.Mesh, zone: Zone) {
    this.ready = false; this.samples.length = 0; this.zone = zone
    if (zone !== 'arm' && zone !== 'leg' && zone !== 'pad') return
    const s = rig.segments.find(s => s.name === (zone === 'arm' ? 'R_LowerArm' : zone === 'leg' ? 'R_LowerLeg' : 'C_Spine'))!
    this.attachmentBone = s.name
    const center = V().copy(s.body.position), start = V().copy(s.body.pointToWorldFrame(s.start)), end = V().copy(s.body.pointToWorldFrame(s.end))
    const along = zone === 'pad' ? new T.Vector3(1, 0, 0) : end.sub(start).setY(0).normalize()
    if (along.lengthSq() < .1) along.set(0, 0, 1)
    const across = along.clone().cross(UP).normalize()
    this.width = zone === 'pad' ? .088 : .070; this.depth = zone === 'pad' ? .045 : .028
    const meshes = rig.meshes.filter(m => m.visible && (rig.model.userData.customAvatar ? m instanceof T.SkinnedMesh : /Body_00_SKIN|Dusty lilac|Ivory woven|Umber waist|Cocoa slouch|Knitted rib/.test((m.material as T.Material).name)))
    if (cloth.visible) meshes.push(cloth)
    for (const m of meshes) { m.updateWorldMatrix(true, false); if (m instanceof T.SkinnedMesh) m.computeBoundingSphere() }
    const down = new T.Vector3(0, -1, 0), origin = V()
    const project = (x: number, z: number) => {
      origin.copy(center).addScaledVector(along, x).addScaledVector(across, z); origin.y += .32
      this.ray.set(origin, down); this.ray.near = 0; this.ray.far = .54
      const hits = this.ray.intersectObjects(meshes, false).filter(h => h.face)
      const hit = hits[0]; if (!hit?.face) return null
      const m = hit.object as T.Mesh, f = hit.face
      worldVertex(m, f.a, this.a); worldVertex(m, f.b, this.b); worldVertex(m, f.c, this.c)
      const bary = T.Triangle.getBarycoord(hit.point, this.a, this.b, this.c, V()); if (!bary) return null
      return { mesh: m, a: f.a, b: f.b, c: f.c, bary, flip: T.Triangle.getNormal(this.a, this.b, this.c, this.n).dot(UP) < 0 ? -1 : 1 }
    }
    const middle = project(0, 0); if (!middle) return
    for (let j = 0; j <= this.rows; j++) for (let i = 0; i <= this.cols; i++) {
      this.samples.push(project((i / this.cols - .5) * this.width, (j / this.rows - .5) * this.depth) || middle)
    }
    this.surface.userData.pick = { kind: 'zone', id: zone } satisfies Pick
    this.fragment.userData.pick = this.procedure.extracted ? { kind: 'specimen' } : { kind: 'zone', id: zone }
    this.markers.forEach((m, i) => { m.userData.pick = { kind: 'zone', id: zone, marker: i } satisfies Pick })
    this.ready = true; this.draw(); this.texture.needsUpdate = true; this.update(0)
  }

  isBoundTo(bone: string) { return this.ready && this.attachmentBone === bone }

  setState(next: Procedure, action: ToolId | null, traces: boolean, animate: boolean) {
    if (next.extracted && !this.procedure.extracted && animate) { this.transferFrom.copy(this.fragment.position); this.transfer = 0 }
    else if (!animate || !next.extracted) this.transfer = 1
    this.procedure = { ...next }; this.action = action; this.traces = traces
    this.fragment.userData.pick = next.extracted ? { kind: 'specimen' } : { kind: 'zone', id: this.zone }
    this.draw()
  }

  private draw() {
    const c = this.canvas.getContext('2d')!, p = this.procedure
    c.clearRect(0, 0, 512, 256); c.lineCap = 'round'; c.lineJoin = 'round'
    if (p.dressed) {
      rounded(c, 24, 19, 464, 216, 27); c.fillStyle = '#c9d0bf'; c.fill(); c.save(); c.clip()
      c.fillStyle = '#e6e7d7'; c.fillRect(30, 24, 452, 204)
      for (let i = -180; i < 690; i += 7) { c.strokeStyle = '#a9b4a35c'; c.lineWidth = 2; c.beginPath(); c.moveTo(i, 15); c.lineTo(i + 82, 244); c.stroke() }
      for (let i = 25; i < 240; i += 5) { c.fillStyle = '#9fac9c4d'; c.fillRect(20, i, 480, 1.8) }
      for (let i = 0; i < 8; i++) { c.strokeStyle = '#aebaa526'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(30, 50 + i * 20); c.quadraticCurveTo(228, 32 + i * 20, 485, 56 + i * 20); c.stroke() }
      c.restore(); c.strokeStyle = '#aab69f'; c.lineWidth = 5; rounded(c, 38, 33, 436, 184, 17); c.stroke(); return
    }
    const practice = this.zone === 'pad'
    if (practice) { rounded(c, 8, 8, 496, 240, 29); c.fillStyle = '#d1c6b1e8'; c.fill(); c.strokeStyle = '#8a9388'; c.lineWidth = 3; c.stroke() }
    else { rounded(c, 25, 25, 462, 205, 26); c.fillStyle = '#4c696c38'; c.fill() }
    c.strokeStyle = p.fixed ? '#68ac9e' : '#d4ac70'; c.lineWidth = 6
    for (const x of [40, 472]) for (const y of [36, 218]) { c.beginPath(); c.moveTo(x + (x < 100 ? 26 : -26), y); c.lineTo(x, y); c.lineTo(x, y + (y < 100 ? 19 : -19)); c.stroke() }
    c.strokeStyle = this.traces ? (p.opened || p.stitches ? '#996c65' : '#aa8170') : '#ae986e'; c.lineWidth = p.opened ? 9 : 5
    c.setLineDash(p.opened || p.stitches ? [] : [16, 8]); c.beginPath(); c.moveTo(81, 129); c.bezierCurveTo(182, 110, 311, 143, 430, 126); c.stroke(); c.setLineDash([])
    for (let i = 0; i < (this.practice ? 1 : 3); i++) {
      const x = 154 + 102 * i, done = p.stitches > i, active = this.action === 'needle' && i === p.stitches
      if (done) {
        c.strokeStyle = '#334f5c'; c.lineWidth = 8; c.beginPath(); c.moveTo(x - 7, 98); c.bezierCurveTo(x + 7, 105, x + 4, 143, x + 8, 154); c.stroke()
        c.lineWidth = 3; c.beginPath(); c.moveTo(x + 9, 153); c.lineTo(x + 19, 164); c.stroke()
      } else if (this.action === 'needle') {
        for (const y of [100, 154]) { c.beginPath(); c.arc(x, y, active ? 12 : 7, 0, Math.PI * 2); c.fillStyle = active ? '#f8bf52' : '#8ba69e'; c.fill(); c.strokeStyle = '#51462f'; c.lineWidth = active ? 5 : 3; c.stroke() }
        if (active) { c.fillStyle = '#3b463f'; c.font = 'bold 29px monospace'; c.textAlign = 'center'; c.fillText(String(i + 1), x, 77) }
      }
    }
  }

  private samplePosition(u: number, v: number, target = V()) {
    const attr = this.surface.geometry.attributes.position
    const x = T.MathUtils.clamp(u, 0, 1) * this.cols, y = T.MathUtils.clamp(v, 0, 1) * this.rows
    const i = Math.min(this.cols - 1, Math.floor(x)), j = Math.min(this.rows - 1, Math.floor(y)), fx = x - i, fy = y - j
    const a = j * (this.cols + 1) + i, b = a + this.cols + 1
    target.set(0, 0, 0)
    for (const [k, w] of [[a, (1 - fx) * (1 - fy)], [a + 1, fx * (1 - fy)], [b, (1 - fx) * fy], [b + 1, fx * fy]]) target.addScaledVector(this.point.fromBufferAttribute(attr, k), w)
    return target
  }

  update(dt: number) {
    if (!this.ready) return
    const attr = this.surface.geometry.attributes.position, mid = Math.floor(this.samples.length / 2)
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i]; worldVertex(s.mesh, s.a, this.a); worldVertex(s.mesh, s.b, this.b); worldVertex(s.mesh, s.c, this.c)
      T.Triangle.getNormal(this.a, this.b, this.c, this.n).multiplyScalar(s.flip)
      this.point.copy(this.a).multiplyScalar(s.bary.x).addScaledVector(this.b, s.bary.y).addScaledVector(this.c, s.bary.z).addScaledVector(this.n, .00035)
      attr.setXYZ(i, this.point.x, this.point.y, this.point.z)
      if (i === mid) { this.center.copy(this.point); this.normal.copy(this.n) }
    }
    attr.needsUpdate = true; this.surface.geometry.computeBoundingSphere(); this.surface.geometry.computeBoundingBox()
    this.markers.forEach((m, i) => { this.samplePosition(.30 + .20 * i, .5, m.position); m.visible = this.action === 'needle' && (!this.practice || i === 0) && !this.procedure.dressed })
    this.samplePosition(.16, .50, this.strokeEnds[0]); this.samplePosition(.84, .50, this.strokeEnds[1])
    this.fragment.visible = this.zone === 'pad' && (this.procedure.extracted || this.procedure.fixed || this.procedure.opened)
    if (this.procedure.extracted) {
      this.transfer = Math.min(1, this.transfer + dt / .65); const t = this.transfer, f = t * t * (3 - 2 * t)
      this.fragment.position.lerpVectors(this.transferFrom, this.tray, f); this.fragment.position.y += Math.sin(t * Math.PI) * .14
    } else this.fragment.position.copy(this.center).addScaledVector(this.normal, .0049)
    this.group.updateMatrixWorld(true)
  }
  repaint(next: Procedure, action: ToolId | null, traces: boolean, animate = true, practice = false) { this.practice = practice; this.setState(next, action, traces, animate); this.texture.needsUpdate = true; this.update(0) }
  goal() { return this.action === 'needle' && this.procedure.stitches < 3 ? this.markers[this.procedure.stitches].position : this.action === 'tweezers' && !this.procedure.extracted ? this.fragment.position : this.center }
  hit(ray: T.Raycaster, camera: T.Camera, height: number, touch: boolean) {
    if (!this.group.visible || !this.ready) return null
    this.group.updateMatrixWorld(true)
    const objects: T.Object3D[] = [...this.markers.filter(m => m.visible), ...(this.fragment.visible ? [this.fragment] : []), this.surface]
    const direct = ray.intersectObjects(objects, false)[0]
    if (direct) return { pick: direct.object.userData.pick as Pick, distance: direct.distance }
    const aim = this.goal(), distance = ray.ray.origin.distanceTo(aim)
    const px = camera instanceof T.PerspectiveCamera ? 2 * distance * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, height) : .001
    if (ray.ray.distanceToPoint(aim) < Math.min(.035, px * (touch ? 17 : 7)) && aim.clone().sub(ray.ray.origin).dot(ray.ray.direction) > 0) return { pick: { kind: 'zone', id: this.zone } as Pick, distance }
    return null
  }
  strokeFraction(ray: T.Ray) {
    const p = ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(this.normal, this.center), V())
    if (!p) return null
    const line = new T.Line3(this.strokeEnds[0], this.strokeEnds[1]), q = line.closestPointToPoint(p, true, V())
    return q.distanceTo(p) <= this.heightTolerance ? T.MathUtils.clamp(line.closestPointToPointParameter(p, false), 0, 1) : null
  }
  private get heightTolerance() { return this.depth * .65 }
}