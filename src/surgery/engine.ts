import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CharacterRig, type Segment } from '../studio/character'
import type { BodyState } from '../studio/types'
import { loadActiveAvatar } from '../studio/importAvatar'
import { AnatomyView } from './anatomy'
import { buildRoom, makeDrape, makeTool } from './room'
import { poseGlove } from './glove'
import { OperativeField } from './operativeField'
import { InfusionStation } from './infusion'
import { actionLabel, freshProcedure, type Procedure } from './procedure'
import { ReactionScene, type ReactionFrame, type ReactionKind } from './reaction'
import { partById, regionNames, type ContactReading, type HandMode } from './regions'
import { operations, type Pick, type Mode, type Layer, type ToolId, type Settings, type Zone, type Phase, toolById, zoneNames } from './game'

const v = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z)
export type Hover = { label: string; x: number; y: number; pick: Pick | null }
type Callbacks = { ready: () => void; error: (s: string) => void; hint: (s: string) => void; pick: (p: Pick) => void; hover: (h: Hover | null) => void; inspect: (id: string) => void; contact: (reading: ContactReading) => void; fps: (n: number) => void; reaction: (frame: ReactionFrame | null) => void; reactionEnd: (kind: ReactionKind) => void }
export type RoomSnapshot = {
  bodies: BodyState[]; anchor: number[]; anchored: boolean; gravity: number; covered: boolean
  camera: number[]; rotation: number[]; target: number[]; mode: Mode; layer: Layer; selected: ToolId | null
  part: string | null; isolated: boolean; handMode: HandMode; elapsed: number
  effects: { procedure: Procedure; mark: Zone | null; ivSeconds: number }
  handling: { strain: number; spoken: boolean }
}

export class TheatreEngine {
  scene = new T.Scene()
  camera = new T.PerspectiveCamera(44, 1, .035, 32)
  renderer: T.WebGLRenderer
  orbit: OrbitControls
  rig: CharacterRig | null = null
  mode: Mode = 'overview'
  layer: Layer = 'skin'
  anchored = true
  covered = true
  physicsWorkspace = false
  handMode: HandMode = 'grab'
  selectedPart: string | null = null
  isolated = false
  private anatomy: AnatomyView | null = null
  private cloth = makeDrape()
  private disposed = false
  private frame = 0
  private last = 0
  private elapsed = 0
  private counter = 0
  private metricTime = 0
  private observer: ResizeObserver
  private items: T.Object3D[] = []
  private pickups = new Map<ToolId, T.Group>()
  private zones = new Map<Zone, T.Mesh>()
  private target: Zone = 'monitor'
  procedure: Procedure = freshProcedure(0)
  private field = new OperativeField()
  private station: InfusionStation
  private samplingKey = ''
  private touchPick = false
  private stroke: { low: number; high: number; last: number } | null = null
  private reticle = new T.Group()
  private env: T.WebGLRenderTarget
  private selected: ToolId | null = null
  private held: T.Group | null = null
  private phase: Phase = 'ready'
  private options: Settings
  private ray = new T.Raycaster()
  private mouse = new T.Vector2()
  private pointed: Pick | null = null
  private keys = new Set<string>()
  private press = { x: 0, y: 0, lastX: 0, lastY: 0, active: false, moved: false, id: -1 }
  private dragging = false
  private dragPlane = new T.Plane()
  private dragAim = v()
  private lastDragAim = v()
  private grabDepth = 1
  private gripVelocity = v()
  private lastGripMove = 0
  private carry = false
  private contactTimer = 0
  private contactTime = 0
  private contactRing = new T.Mesh(new T.TorusGeometry(.026, .0015, 8, 38), new T.MeshBasicMaterial({ color: '#a8d8d0', depthTest: false, transparent: true, opacity: .92 }))
  private selectionRing = new T.Mesh(new T.TorusGeometry(.032, .0012, 8, 40), new T.MeshBasicMaterial({ color: '#d9bd83', depthTest: false, transparent: true, opacity: .8 }))
  private shadowTime = 0
  private rotation = new T.Euler(0, 0, 0, 'YXZ')
  private forward = v()
  private side = v()
  private markZone: Zone | null = null
  get activeBandage() { return this.procedure.dressed }
  get extracted() { return this.procedure.extracted }
  get fixedPad() { return this.procedure.fixed }
  get openedPad() { return this.procedure.opened }
  get infusion() { return this.procedure.infusion }
  private visible = true
  private sequence: ReactionScene | null = null
  private hiddenProps: { object: T.Object3D; visible: boolean }[] = []
  private strain = 0
  private spoken = false
  private pausedFrame = false
  private lastPicture = 0
  private focusTween: { from: T.Vector3; to: T.Vector3; at: T.Vector3; target: T.Vector3; t: number } | null = null

  constructor(private host: HTMLDivElement, options: Settings, private cb: Callbacks) {
    this.options = options
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, options.quality === 'high' ? 1.65 : 1.25))
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .94
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap; this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true
    const canvas = this.renderer.domElement; canvas.className = 'theatre-canvas'; canvas.tabIndex = 0
    canvas.setAttribute('aria-label', 'Интерактивная операционная с Микой и инструментальным столом')
    host.appendChild(canvas); this.scene.background = new T.Color('#354e58'); this.scene.fog = new T.FogExp2('#465d67', .065)
    const generator = new T.PMREMGenerator(this.renderer), environment = new RoomEnvironment()
    this.env = generator.fromScene(environment, .04); this.scene.environment = this.env.texture; this.scene.environmentIntensity = .49
    environment.dispose(); generator.dispose()
    this.scene.add(new T.HemisphereLight('#d5e9fa', '#52686c', .61))
    const key = new T.DirectionalLight('#fff0d6', 1.92); key.position.set(-1.7, 3.2, .6); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -2.6; key.shadow.camera.right = 2.6; key.shadow.camera.top = 2.6; key.shadow.camera.bottom = -2.6
    key.shadow.normalBias = .0009; key.shadow.bias = -.00018; this.scene.add(key)
    const cyan = new T.PointLight('#8dc8ee', 4.1, 5); cyan.position.set(-2.7, 2.0, 1.4); this.scene.add(cyan)
    const back = new T.PointLight('#ffb96d', 3, 5); back.position.set(1.7, 1.6, -2.6); this.scene.add(back)
    this.orbit = new OrbitControls(this.camera, canvas); this.orbit.enableDamping = true; this.orbit.dampingFactor = .10
    this.orbit.minDistance = .36; this.orbit.maxDistance = 4.7; this.orbit.maxPolarAngle = Math.PI * .47; this.orbit.minPolarAngle = .105
    this.orbit.enablePan = true; this.orbit.rotateSpeed = .55; this.orbit.zoomSpeed = .8; this.orbit.target.set(0, 1.066, -.12)
    this.camera.position.set(-1.48, 2.12, .82); this.orbit.update(); this.orbit.saveState()
    this.orbit.addEventListener('start', () => { this.focusTween = null })
    const room = buildRoom(this.scene); this.items = room.interactive; this.pickups = room.pickups
    this.station = new InfusionStation(this.scene)
    this.scene.add(this.field.group, this.field.dish, this.cloth, this.reticle, this.camera)
    for (const [i, r] of [.075, .088].entries()) {
      const ring = new T.Mesh(new T.TorusGeometry(r, i ? .001 : .0022, 7, 50), new T.MeshBasicMaterial({ color: '#ffbf59', transparent: true, opacity: i ? .42 : .95, depthTest: false })); ring.renderOrder = 9; this.reticle.add(ring)
    }
    this.reticle.visible = false
    for (const ring of [this.contactRing, this.selectionRing]) { ring.visible = false; ring.renderOrder = 19; this.scene.add(ring) }
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host); this.resize()
    canvas.addEventListener('pointerdown', this.down, true); canvas.addEventListener('pointermove', this.pointer, true)
    canvas.addEventListener('pointerup', this.up, true); canvas.addEventListener('pointercancel', this.cancel, true)
    canvas.addEventListener('lostpointercapture', this.lostCapture, true)
    canvas.addEventListener('wheel', this.wheel, { capture: true, passive: false })
    canvas.addEventListener('pointerleave', this.leave); canvas.addEventListener('webglcontextlost', this.contextLost)
    window.addEventListener('blur', this.cancel); document.addEventListener('visibilitychange', this.visibility)
    this.load()
  }

  private async load() {
    try {
      const model = await loadActiveAvatar()
      if (this.disposed) { this.free(model); return }
      // Face -Z becomes +Y; local head direction becomes world -Z.
      model.quaternion.setFromEuler(new T.Euler(Math.PI / 2, Math.PI, 0, 'YXZ'))
      model.position.set(0, 1.048, .856); model.updateMatrixWorld(true); this.scene.add(model)
      this.rig = new CharacterRig(model, 'patient'); this.anatomy = new AnatomyView(this.rig, this.cloth)
      this.rig.step(0, 0); this.rig.setAnchored(this.anchored)
      this.setLayer(this.layer)
      const zoneMaterial = new T.MeshBasicMaterial({ visible: false })
      for (const [id, r] of [['arm', .091], ['leg', .115], ['pad', .145]] as [Zone, number][]) {
        const m = new T.Mesh(new T.SphereGeometry(r, 10, 8), zoneMaterial); m.userData.pick = { kind: 'zone', id }; this.items.push(m); this.zones.set(id, m); this.scene.add(m)
      }
      this.updateZones(); this.renderer.shadowMap.needsUpdate = true; this.cb.ready()
      this.frame = requestAnimationFrame(this.tick)
    } catch (e) { if (!this.disposed) this.cb.error(e instanceof Error ? e.message : 'Не удалось открыть 3D-операционную.') }
  }

  private resize = () => {
    if (this.disposed) return
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false)
    if (this.mode !== 'overview' && this.rig) this.renderer.render(this.scene, this.camera)
  }

  private updateZones(dt = 0) {
    if (!this.rig) return
    for (const [id, s] of [['arm', 'R_LowerArm'], ['leg', 'R_LowerLeg'], ['pad', 'C_Spine']] as const) {
      const body = this.rig.segments.find(b => b.name === s)!.body.position
      this.zones.get(id)?.position.set(body.x, body.y + (id === 'pad' ? .12 : .028), body.z)
    }
    const physical = this.target === 'arm' || this.target === 'leg' || this.target === 'pad'
    const zone = this.markZone || (physical ? this.target : this.procedure.scenario === 0 ? 'arm' : 'pad')
    const show = this.layer === 'skin' && (this.markZone !== null || this.phase === 'sandbox' || (this.phase === 'running' && physical))
    this.field.group.visible = show
    if (show) {
      const key = `${zone}:${this.covered}`
      if (key !== this.samplingKey) { this.field.bind(this.rig, this.cloth, zone); this.samplingKey = this.field.ready ? key : '' }
      this.field.update(dt)
    }
    this.station.update(dt)
    const p = this.zonePosition(this.target); this.reticle.position.copy(p)
    if (this.selectedPart) {
      const pos = this.partPosition(this.selectedPart)
      if (pos) { this.selectionRing.position.copy(pos); this.selectionRing.quaternion.copy(this.camera.quaternion) }
    }
    if (this.target === 'monitor' || this.target === 'iv') this.reticle.quaternion.copy(this.camera.quaternion)
    else this.reticle.quaternion.setFromUnitVectors(v(0, 0, 1), this.field.normal)
    const current = operations[this.procedure.scenario].steps[this.procedure.progress]
    this.reticle.scale.setScalar((physical ? current?.tool === 'needle' ? .106 : .53 : 1) * (1 + Math.sin(this.elapsed * 2.8) * .045))
  }

  zonePosition(id: Zone) {
    if (id === 'monitor') return v(-.65, 1.63, -.94)
    if (id === 'iv') return this.station.goal()
    if (this.field.group.visible && this.field.ready && this.field.zone === id) return this.field.goal().clone()
    return this.zones.get(id)?.position.clone() || v(0, 1.16, 0)
  }

  setMode(m: Mode) {
    if (m === this.mode) { this.orbit.enabled = m === 'orbit' && !this.dragging; return }
    this.cancel(); this.mode = m; this.orbit.enabled = m === 'orbit'; this.focusTween = null
    this.cb.hover(null); this.pointed = null
    if (m === 'walk') { this.camera.position.set(1.65, 1.65, 1.22); this.camera.lookAt(0, 1.07, -.14); this.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ') }
    if (m === 'orbit') { this.orbit.reset(); this.orbit.update() }
    if (this.held) this.held.visible = m === 'walk'
    this.renderer.shadowMap.needsUpdate = true; this.resize()
  }
  setLayer(l: Layer) { if (this.layer !== l) this.cancel(); this.layer = l; this.anatomy?.set(l, this.covered); this.samplingKey = ''; this.renderer.shadowMap.needsUpdate = true }
  setCover(on: boolean) { this.covered = on; this.anatomy?.set(this.layer, on); this.samplingKey = ''; this.renderer.shadowMap.needsUpdate = true }
  setGravity(value: number) { this.rig?.setGravity(value) }
  setWorkspace(physics: boolean) { this.physicsWorkspace = physics; this.rig?.setTableSupport(!physics) }
  setHandMode(m: HandMode) { this.cancel(); this.handMode = m }
  setAnchored(on: boolean) { if (this.anchored !== on) this.cancel(); this.anchored = on; this.rig?.setAnchored(on) }
  partPosition(id: string) {
    const mesh = this.anatomy?.center(id); if (mesh) return mesh
    const part = partById.get(id); if (!part || !this.rig) return null
    const s = this.rig.segments.find(s => s.name === part.bone)
    return s ? v(s.body.position.x, s.body.position.y, s.body.position.z) : this.rig.model.getObjectByName('J_Bip_' + part.bone)?.getWorldPosition(v()) || null
  }
  selectPart(id: string | null, isolate = false, focus = false) {
    this.selectedPart = id; this.isolated = isolate; this.anatomy?.select(id, isolate)
    this.selectionRing.visible = Boolean(id && !isolate); this.renderer.shadowMap.needsUpdate = true
    const p = id && this.partPosition(id)
    if (p && focus) {
      if (this.mode === 'walk') { this.camera.lookAt(p); this.camera.updateMatrixWorld(true); this.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ') }
      else { this.focusTween = { from: this.camera.position.clone(), at: this.orbit.target.clone(), to: p.clone().add(v(-.44, .55, .43)), target: p, t: 0 } }
    }
  }
  capture(): RoomSnapshot | null {
    if (!this.rig) return null
    this.cancel()
    return { bodies: this.rig.save(), anchor: this.rig.anchor.toArray(), anchored: this.anchored, gravity: -this.rig.world.gravity.y, covered: this.covered,
      camera: this.camera.position.toArray(), rotation: this.camera.quaternion.toArray(), target: this.orbit.target.toArray(), mode: this.mode, layer: this.layer, selected: this.selected,
      part: this.selectedPart, isolated: this.isolated, handMode: this.handMode, elapsed: this.elapsed,
      effects: { procedure: { ...this.procedure }, mark: this.markZone, ivSeconds: this.station.seconds }, handling: { strain: this.strain, spoken: this.spoken } }
  }
  restore(s: RoomSnapshot) {
    if (!this.rig) return
    this.cancel(); this.setAnchored(s.anchored); this.setGravity(s.gravity); this.rig.restore(s.bodies, s.anchor); this.elapsed = s.elapsed
    this.setMode(s.mode); this.setCover(s.covered); this.setLayer(s.layer); this.setHandMode(s.handMode); this.setHeld(s.selected); this.selectPart(s.part, s.isolated)
    this.camera.position.fromArray(s.camera); this.orbit.target.fromArray(s.target); this.camera.quaternion.fromArray(s.rotation); this.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ')
    if (this.mode === 'orbit') this.orbit.update()
    this.markZone = s.effects.mark; this.samplingKey = ''; this.setProcedure(s.effects.procedure, false); this.station.seconds = s.effects.ivSeconds
    this.strain = this.options.story && this.options.sandboxStory ? s.handling?.strain || 0 : 0; this.spoken = s.handling?.spoken || false
    this.updateZones(); this.renderer.shadowMap.needsUpdate = true
  }
  setOptions(s: Settings) {
    const old = this.options; this.options = s
    if (old.sandboxStory !== s.sandboxStory || !s.story) this.strain = 0
    if (this.sequence?.kind === 'sandbox' && (!s.story || !s.sandboxStory)) this.finishReaction(false)
    if (old.traces !== s.traces) this.setProcedure(this.procedure, false)
    if (old.quality !== s.quality) { this.renderer.setPixelRatio(Math.min(devicePixelRatio, s.quality === 'high' ? 1.65 : 1.25)); this.resize() }
  }
  setPhase(p: Phase, target: Zone) {
    this.pausedFrame = false
    this.phase = p; this.target = target; this.reticle.visible = this.options.hints && p === 'running'
    this.station.set(this.procedure.infusion, p === 'paused' || p === 'complete' || p === 'failed')
    if (p !== 'running' && p !== 'sandbox' && p !== 'failed') this.cancel()
  }
  setHeld(t: ToolId | null) {
    this.cancel()
    this.selected = t
    if (this.phase === 'sandbox' || this.phase === 'failed') this.repaintField(false)
    if (this.held) { this.camera.remove(this.held); this.free(this.held, false); this.held = null }
    this.pickups.forEach((g, id) => { g.visible = id !== t })
    if (t) {
      this.held = makeTool(t); this.held.position.set(.133, -.105, -.29); this.held.rotation.set(t === 'hand' ? -.35 : -1.22, t === 'hand' ? Math.PI * 1.12 : -.33, t === 'hand' ? -.23 : -.65)
      this.held.scale.setScalar(t === 'hand' ? .82 : .72); this.camera.add(this.held); this.held.visible = this.mode === 'walk'
    }
  }
  focus(id: Zone) {
    const target = this.zonePosition(id); this.focusTween = { from: this.camera.position.clone(), at: this.orbit.target.clone(), to: target.clone().add(id === 'monitor' ? v(.44, .12, .69) : id === 'iv' ? v(.36, .09, .58) : v(-.16, .34, .21)), target, t: 0 }
  }
  reset() {
    this.finishReaction(false); this.strain = 0; this.spoken = false
    this.cancel(); this.rig?.reset(); this.markZone = null; this.samplingKey = ''; this.setProcedure(freshProcedure(this.procedure.scenario), false); this.orbit.reset(); this.orbit.update(); this.renderer.shadowMap.needsUpdate = true
    this.selectPart(null); this.contactTime = 0
  }
  setProcedure(next: Procedure, animate = true, zone?: Zone) {
    this.procedure = { ...next }
    if (zone === 'arm' || zone === 'leg' || zone === 'pad') this.markZone = zone
    if (!next.progress && !next.fixed && !next.opened && !next.extracted && !next.stitches && !next.dressed) this.markZone = null
    this.repaintField(animate)
    this.station.set(next.infusion, this.phase === 'paused' || this.phase === 'complete' || this.phase === 'failed')
    this.updateZones()
  }
  private repaintField(animate: boolean) {
    const p = this.procedure, practice = this.phase === 'sandbox' || this.phase === 'failed' || this.physicsWorkspace
    this.field.repaint(p, practice ? this.selected : operations[p.scenario].steps[p.progress]?.tool || null, this.options.traces, animate, practice)
  }
  private setRay(x: number, y: number) {
    this.camera.updateMatrixWorld(true)
    const b = this.host.getBoundingClientRect(); this.mouse.set((x - b.left) / b.width * 2 - 1, -(y - b.top) / b.height * 2 + 1); this.ray.setFromCamera(this.mouse, this.camera)
  }
  private hit() {
    const surface = this.field.hit(this.ray, this.camera, this.host.clientHeight, this.touchPick)
    const arr = this.items.filter(o => o.visible && o.parent?.visible && !(this.field.group.visible && this.field.ready && o === this.zones.get(this.field.zone)))
    const target = this.ray.intersectObjects(arr, false)[0]
    if (surface && (!target || surface.distance < target.distance)) return surface.pick
    if (target) return target.object.userData.pick as Pick
    return null
  }

  private inspectAtRay() {
    const anatomy = this.anatomy?.hit(this.ray)
    if (anatomy) { this.selectPart(anatomy.id); this.cb.inspect(anatomy.id); return true }
    const h = this.rig?.hitTest(this.ray.ray)
    if (!h) return false
    const id = 'body:' + h.segment.name
    this.selectPart(id); this.cb.inspect(id)
    this.contactRing.position.copy(h.point); this.contactRing.visible = true; this.contactRing.scale.setScalar(1); this.contactRing.material.color.set('#a8d8d0')
    this.contactRing.quaternion.copy(this.camera.quaternion); this.contactTime = 1.25
    this.cb.contact({ part: regionNames[h.segment.name], held: false, effort: 0, pinned: this.anchored && h.segment.body.mass === 0 }); return true
  }

  private beginGrip(hit: { segment: Segment; point: T.Vector3 }, carry: boolean) {
    if (!this.rig || this.phase === 'paused' || this.sequence) return false
    const id = 'body:' + hit.segment.name
    this.selectPart(id); this.cb.inspect(id)
    if (this.anchored && hit.segment.body.mass === 0) {
      this.contactTime = 2.25; this.cb.contact({ part: regionNames[hit.segment.name], held: false, effort: 0, pinned: true }); return false
    }
    this.rig.beginGrab(hit.segment, hit.point); this.carry = carry; this.dragging = true; this.orbit.enabled = false
    this.dragAim.copy(hit.point); this.lastDragAim.copy(hit.point); this.gripVelocity.set(0, 0, 0)
    this.grabDepth = this.camera.position.distanceTo(hit.point); this.lastGripMove = performance.now()
    this.dragPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(v()), hit.point)
    this.contactRing.visible = true; this.contactRing.position.copy(hit.point); this.contactRing.quaternion.copy(this.camera.quaternion)
    this.cb.contact({ part: regionNames[hit.segment.name], held: true, effort: 0 }); this.cb.hover(null)
    return true
  }

  private moveGrip(point: T.Vector3, record = true) {
    point.x = T.MathUtils.clamp(point.x, -3.48, 3.48); point.y = T.MathUtils.clamp(point.y, .075, 2.70); point.z = T.MathUtils.clamp(point.z, -3.05, 3.05)
    if (record && this.dragAim.distanceToSquared(point) > .00000001) {
      if (this.storyInput()) this.strain += Math.min(.24, this.dragAim.distanceTo(point)) * 1.85
      const now = performance.now(); this.gripVelocity.lerp(point.clone().sub(this.lastDragAim).multiplyScalar(1000 / Math.max(12, now - this.lastGripMove)), .6).clampLength(0, 3.5)
      this.lastDragAim.copy(point); this.lastGripMove = now
    }
    this.dragAim.copy(point); this.rig?.dragTo(point)
  }

  adjustDepth(delta: number) {
    if (!this.dragging || this.phase === 'paused') return
    this.grabDepth = T.MathUtils.clamp(this.grabDepth + delta, .27, 3.4)
    this.ray.setFromCamera(this.carry ? new T.Vector2() : this.mouse, this.camera)
    const point = this.ray.ray.at(this.grabDepth, v()); this.dragPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(v()), point); this.moveGrip(point)
  }
  private wheel = (e: WheelEvent) => { if (this.dragging) { e.preventDefault(); e.stopImmediatePropagation(); this.adjustDepth(T.MathUtils.clamp(e.deltaY * .0011, -.16, .16)) } }

  toggleCarry() {
    if (this.phase === 'paused' || !this.rig) return
    if (this.dragging) { this.cancel(); return }
    this.ray.setFromCamera(new T.Vector2(), this.camera)
    const h = this.handHit()
    if (h) this.beginGrip(h, true)
    else this.cb.hover({ label: 'Наведите прицел на модель', pick: null, x: .5, y: .48 })
  }

  private handHit(touch = false) {
    if (!this.rig) return null
    const hit = this.rig.hitTest(this.ray.ray)
    if (hit) return hit
    const distance = this.camera.position.distanceTo(this.zonePosition('arm'))
    const unitsPerPixel = 2 * distance * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) / Math.max(1, this.host.clientHeight)
    return this.rig.hitTest(this.ray.ray, Math.min(touch ? .045 : .026, unitsPerPixel * (touch ? 10 : 5)))
  }

  private down = (e: PointerEvent) => {
    if (this.mode === 'overview' || this.sequence || e.button !== 0 || this.phase === 'paused' || !e.isPrimary) return
    this.touchPick = e.pointerType === 'touch'
    this.press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, active: true, moved: false, id: e.pointerId }; this.setRay(e.clientX, e.clientY)
    if (this.selected === 'scalpel' && this.field.group.visible && this.field.zone === 'pad' && !this.procedure.opened && !this.procedure.dressed) {
      const t = this.field.strokeFraction(this.ray.ray)
      const hit = this.hit()
      if (t !== null && hit?.kind === 'zone' && hit.id === 'pad') { e.stopImmediatePropagation(); this.stroke = { low: t, high: t, last: t }; this.orbit.enabled = false; this.renderer.domElement.setPointerCapture(e.pointerId); return }
    }
    if ((!this.selected || this.selected === 'hand') && this.rig && !this.carry && this.layer === 'skin') {
      const h = this.handHit(e.pointerType === 'touch')
      if (h && (this.handMode === 'grab' || !this.selected)) {
        e.stopImmediatePropagation(); this.renderer.domElement.setPointerCapture(e.pointerId)
        this.beginGrip(h, false); return
      }
    }
    if (this.mode === 'walk') this.renderer.domElement.setPointerCapture(e.pointerId)
  }
  private pointer = (e: PointerEvent) => {
    if (this.mode === 'overview' || this.sequence || this.phase === 'paused' || !e.isPrimary) return
    this.setRay(e.clientX, e.clientY)
    if (this.press.active) {
      const dx = e.clientX - this.press.lastX, dy = e.clientY - this.press.lastY
      this.press.lastX = e.clientX; this.press.lastY = e.clientY
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 4) this.press.moved = true
      if (this.stroke) {
        const t = this.field.strokeFraction(this.ray.ray)
        if (t !== null) { this.stroke.low = Math.min(this.stroke.low, t); this.stroke.high = Math.max(this.stroke.high, t); this.stroke.last = t }
        return
      }
      if (this.dragging && !this.carry) { const p = this.ray.ray.intersectPlane(this.dragPlane, v()); if (p) this.moveGrip(p); return }
      if (this.mode === 'walk' && this.press.moved) { this.rotation.y -= dx * .0035; this.rotation.x = T.MathUtils.clamp(this.rotation.x - dy * .0035, -1.48, 1.43); this.camera.quaternion.setFromEuler(this.rotation) }
      if (this.press.moved) { this.cb.hover(null); return }
    }
    this.pointed = this.hit()
    if ((this.selected === 'hand' || this.layer !== 'skin') && this.options.hints && !this.dragging) {
      const h = this.anatomy?.hit(this.ray), body = !h && this.rig?.hitTest(this.ray.ray), name = h ? partById.get(h.id)?.name : body ? regionNames[body.segment.name] : undefined
      if (name) { const b = this.host.getBoundingClientRect(); this.cb.hover({ label: name, x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height, pick: null }); return }
    }
    if (this.pointed && this.options.hints) {
      const b = this.host.getBoundingClientRect(), task = operations[this.procedure.scenario].steps[this.procedure.progress]
      const label = this.pointed.kind === 'tool' ? `Взять: ${toolById(this.pointed.id).name}` : this.pointed.kind === 'specimen' ? 'Фрагмент уже в чаше' : this.phase === 'running' && this.pointed.id === task?.zone ? actionLabel(task) + (task.tool === 'needle' ? ` · ${this.procedure.stitches + 1}/3` : '') : zoneNames[this.pointed.id]
      this.cb.hover({ label, x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height, pick: this.pointed })
    } else this.cb.hover(null)
  }
  private up = (e: PointerEvent) => {
    if (!this.press.active || e.pointerId !== this.press.id) return
    if (this.stroke) {
      const f = this.stroke, moved = this.press.moved; this.setRay(e.clientX, e.clientY)
      const end = this.field.strokeFraction(this.ray.ray)
      this.cancel()
      if (!moved || (end !== null && f.high - f.low >= .72)) this.cb.pick({ kind: 'zone', id: 'pad', gesture: moved ? 'stroke' : 'click' })
      else this.cb.hint('Проведите по пунктиру от одной метки до другой или нажмите на саму линию.')
      return
    }
    const click = !this.press.moved && !this.dragging
    if (this.carry) { this.press.active = false; this.press.id = -1; if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId); return }
    if (this.dragging && performance.now() - this.lastGripMove < 125) {
      if (this.storyInput() && this.gripVelocity.length() > 1.3) this.strain += Math.min(2.4, this.gripVelocity.length() * .65)
      this.rig?.endGrab(this.gripVelocity)
    }
    this.cancel()
    if (!click) return
    this.setRay(e.clientX, e.clientY)
    if ((this.layer !== 'skin' || this.selected === 'hand') && this.inspectAtRay()) return
    const obj = this.hit(); if (obj) this.cb.pick(obj)
    else if (this.phase === 'running' && this.selected !== 'hand') this.cb.hint('Действие не выполнено. Нажмите на золотую метку или «Показать цель».')
    else this.inspectAtRay()
  }
  private cancel = () => {
    const el = this.renderer.domElement, id = this.press.id; this.keys.clear(); this.press.id = -1; this.stroke = null
    if (this.dragging) this.rig?.endGrab(); this.dragging = this.carry = false; this.press.active = false
    this.contactRing.visible = false; this.contactTime = 0; this.cb.contact(null)
    if (id >= 0 && this.host.hasPointerCapture(id)) this.host.releasePointerCapture(id)
    if (id >= 0 && el.hasPointerCapture(id)) el.releasePointerCapture(id)
    this.orbit.enabled = this.mode === 'orbit'
  }
  private leave = () => { this.pointed = null; this.cb.hover(null) }
  private lostCapture = () => { if (!this.carry && this.press.active) this.cancel() }
  private visibility = () => { this.visible = !document.hidden; this.last = this.lastPicture = 0; this.sequence?.visibility(this.visible); if (!this.visible) this.cancel() }
  interact() {
    if (this.phase === 'paused' || this.sequence) return
    this.camera.updateMatrixWorld(true)
    if (this.carry) { this.cancel(); return }
    if (this.mode === 'walk') this.ray.setFromCamera(new T.Vector2(), this.camera)
    if (this.layer !== 'skin' && this.inspectAtRay()) return
    if (this.selected === 'hand') {
      if (this.handMode === 'inspect' && this.inspectAtRay()) return
      const h = this.handHit(); if (h) { this.beginGrip(h, true); return }
    }
    const obj = this.hit(); if (obj) this.cb.pick(obj); else this.inspectAtRay()
  }
  key(code: string, on: boolean) {
    if (!on) { this.keys.delete(code); return }
    if (this.mode !== 'walk' || this.phase === 'paused') return
    if (!this.keys.has(code)) {
      // A short press still moves the player when rendering runs below the input rate.
      const f = code === 'KeyW' || code === 'ArrowUp' ? 1 : code === 'KeyS' || code === 'ArrowDown' ? -1 : 0
      const s = code === 'KeyD' || code === 'ArrowRight' ? 1 : code === 'KeyA' || code === 'ArrowLeft' ? -1 : 0
      this.move(f * .035, s * .035)
    }
    this.keys.add(code)
  }
  move(forward: number, side: number) {
    if (this.mode !== 'walk' || this.phase === 'paused' || this.sequence) return
    this.camera.getWorldDirection(this.forward); this.forward.y = 0; this.forward.normalize(); this.side.copy(this.forward).cross(v(0, 1, 0)).normalize()
    const p = this.camera.position.clone().addScaledVector(this.forward, forward).addScaledVector(this.side, side)
    p.x = T.MathUtils.clamp(p.x, -3.42, 3.42); p.z = T.MathUtils.clamp(p.z, -2.40, 3.04); p.y = 1.65
    const table = Math.abs(p.x) < .66 && Math.abs(p.z) < 1.22
    const cart = p.x > .61 && p.x < 1.40 && p.z > -.36 && p.z < .77
    if (!table && !cart) this.camera.position.copy(p)
  }
  private storyInput() { return this.options.story && this.options.sandboxStory && !this.spoken && !this.sequence && this.phase === 'sandbox' && (this.physicsWorkspace || this.procedure.scenario === 3) }
  startReaction(kind: ReactionKind) {
    if (!this.rig || !this.options.story || (kind === 'sandbox' && !this.options.sandboxStory) || this.sequence || this.disposed) return false
    this.cancel(); this.focusTween = null; this.pointed = null; this.cb.hover(null); this.orbit.enabled = false
    this.hiddenProps = [this.field.group, this.reticle, this.selectionRing, this.contactRing, ...(this.held ? [this.held] : [])].map(object => ({ object, visible: object.visible }))
    this.hiddenProps.forEach(s => { s.object.visible = false }); this.anatomy?.select(null); this.anatomy?.set('skin', this.covered)
    this.lastPicture = 0; this.station.set(this.procedure.infusion, true)
    this.sequence = new ReactionScene(kind, this.rig, this.camera, this.options.gentle, this.options.sound, this.cb.reaction)
    this.renderer.shadowMap.needsUpdate = true; return true
  }
  finishReaction(notify = true) {
    if (!this.sequence) return
    const kind = this.sequence.kind; this.sequence.stop(); this.sequence = null; this.lastPicture = 0
    this.anatomy?.set(this.layer, this.covered); this.anatomy?.select(this.selectedPart, this.isolated); this.hiddenProps.forEach(s => { s.object.visible = s.visible }); this.hiddenProps = []
    this.orbit.enabled = this.mode === 'orbit'; this.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ'); this.renderer.shadowMap.needsUpdate = true
    this.cb.reaction(null); this.last = 0; this.pausedFrame = false
    if (notify && !this.disposed) this.cb.reactionEnd(kind)
  }
  private tick = (now: number) => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick); const dt = Math.min(.045, (now - (this.last || now)) / 1000); this.last = now
    if (!this.visible) return
    if (this.sequence) {
      const movieDt = this.lastPicture ? (now - this.lastPicture) / 1000 : 0; this.lastPicture = now
      const end = this.sequence.tick(movieDt); this.renderer.render(this.scene, this.camera); if (end) this.finishReaction(); return
    }
    if (this.mode === 'overview') return
    if (this.phase === 'paused') {
      if (!this.pausedFrame) { this.renderer.render(this.scene, this.camera); this.pausedFrame = true }
      return
    }
    {
      if (this.carry) { this.ray.setFromCamera(new T.Vector2(), this.camera); this.moveGrip(this.ray.ray.at(this.grabDepth, v())) }
      this.elapsed += dt; this.rig?.step(dt, this.elapsed)
      if (this.storyInput()) {
        const holding = this.dragging && this.rig?.dragging
        this.strain = Math.max(0, this.strain + (holding ? .48 + (this.rig?.gripEffort() || 0) * .33 : -.10) * dt)
        if (this.strain >= 12) { this.spoken = true; if (this.startReaction('sandbox')) return }
      }
      if (this.dragging && this.rig?.dragging) {
        const effort = this.rig.gripEffort(), pos = this.rig.gripCenter(); if (pos) this.contactRing.position.copy(pos)
        this.contactRing.quaternion.copy(this.camera.quaternion); this.contactRing.scale.setScalar(1 + effort * .5)
        this.contactRing.material.color.set('#9acfc9').lerp(new T.Color('#efbb71'), Math.min(1, effort * 1.8))
        if (now - this.contactTimer > 100) { this.contactTimer = now; this.cb.contact({ held: true, part: regionNames[this.rig.dragging.name], effort }) }
      } else if (this.contactTime > 0) { this.contactTime -= dt; if (this.contactTime <= 0) { this.contactRing.visible = false; this.cb.contact(null) } }
      if (this.held && this.selected === 'hand') { poseGlove(this.held, this.dragging ? .85 : .08); this.held.rotation.z = -.23 + Math.sin(this.elapsed * 1.2) * .012 }
      if (this.rig) {
        const pelvis = this.rig.segments[0]; this.cloth.position.set(pelvis.body.position.x - pelvis.restP.x, pelvis.body.position.y - pelvis.restP.y, pelvis.body.position.z - pelvis.restP.z)
        this.cloth.scale.y = 1 + Math.sin(this.elapsed * 1.4) * .0013
        this.cloth.updateMatrixWorld(true)
      }
      this.updateZones(dt)
      if (this.mode === 'walk') { const f = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')); const s = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')); if (f || s) this.move(f * dt * 1.23, s * dt * 1.23) }
    }
    if (this.focusTween) { const f = this.focusTween; f.t = Math.min(1, f.t + dt * 2.7); const q = 1 - (1 - f.t) ** 3; this.camera.position.lerpVectors(f.from, f.to, q); this.orbit.target.lerpVectors(f.at, f.target, q); if (f.t === 1) this.focusTween = null }
    if (this.mode === 'orbit') this.orbit.update()
    if (this.rig?.needsShadowUpdate && now - this.shadowTime > (this.dragging ? 75 : 145)) { this.renderer.shadowMap.needsUpdate = true; this.shadowTime = now }
    this.renderer.render(this.scene, this.camera)
    this.counter++; if (now - this.metricTime > 1100) { this.cb.fps(Math.min(240, Math.round(1000 * this.counter / Math.max(1, now - this.metricTime)))); this.counter = 0; this.metricTime = now }
  }
  private contextLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(this.frame); this.finishReaction(); this.cb.error('3D-контекст был прерван. Перезапустите операционную.') }
  private free(obj: T.Object3D, mats = true) {
    const gs = new Set<T.BufferGeometry>(), ms = new Set<T.Material>(), ts = new Set<T.Texture>()
    obj.traverse(o => { if (o instanceof T.Mesh) { gs.add(o.geometry); if (o instanceof T.SkinnedMesh) o.skeleton.dispose(); if (mats) for (const m of Array.isArray(o.material) ? o.material : [o.material]) ms.add(m) } })
    gs.forEach(g => g.dispose()); ms.forEach(m => { Object.values(m).forEach(value => { if (value instanceof T.Texture) ts.add(value) }); m.dispose() }); ts.forEach(t => t.dispose())
  }
  dispose() {
    this.disposed = true; this.finishReaction(false); cancelAnimationFrame(this.frame); this.observer.disconnect(); this.cancel(); this.orbit.dispose()
    const c = this.renderer.domElement
    c.removeEventListener('pointerdown', this.down, true); c.removeEventListener('pointermove', this.pointer, true); c.removeEventListener('pointerup', this.up, true); c.removeEventListener('pointercancel', this.cancel, true); c.removeEventListener('pointerleave', this.leave); c.removeEventListener('webglcontextlost', this.contextLost)
    c.removeEventListener('lostpointercapture', this.lostCapture, true)
    c.removeEventListener('wheel', this.wheel, true)
    window.removeEventListener('blur', this.cancel); document.removeEventListener('visibilitychange', this.visibility)
    this.anatomy?.dispose(); this.free(this.scene); this.env.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); c.remove()
  }
}