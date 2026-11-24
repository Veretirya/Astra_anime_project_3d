import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { loadActiveAvatar } from './importAvatar'
import { CharacterRig } from './character'
import { defaults, type Settings, type SceneState, type View, type Metrics } from './types'

type Callbacks = {
  ready: (joints: number) => void
  metrics: (m: Metrics) => void
  hint: (message: string) => void
  drag: (label: string | null) => void
  resume: () => void
  error: (message: string) => void
  camera: (theta: number, phi: number) => void
}

const v3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z)

function platformTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const c = canvas.getContext('2d')!
  c.fillStyle = '#323736'
  c.fillRect(0, 0, 1024, 1024)
  c.translate(512, 512)
  for (let i = -8; i <= 8; i++) {
    c.strokeStyle = '#3f4541'; c.lineWidth = .9
    c.beginPath(); c.moveTo(-512, i * 80); c.lineTo(512, i * 80)
    c.moveTo(i * 80, -512); c.lineTo(i * 80, 512); c.stroke()
  }
  for (const [r, color, width] of [[492, '#6b746a', 1.6], [467, '#778374', 1.5], [443, '#50594f', 1]] as const) {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke()
  }
  for (let i = 0; i < 120; i++) {
    c.save(); c.rotate(i * Math.PI / 60)
    c.fillStyle = i % 10 === 0 ? '#acc48f' : '#737e72'
    c.fillRect(-1, -486, i % 10 === 0 ? 3 : 1.6, i % 10 === 0 ? 13 : 6)
    c.restore()
  }
  const tex = new T.CanvasTexture(canvas)
  tex.colorSpace = T.SRGBColorSpace
  return tex
}

const floorVert = `varying vec3 wp;
void main(){wp=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`
const floorFrag = `varying vec3 wp; uniform float showGrid;
void main(){
  vec2 p=wp.xz/.25;
  vec2 d=abs(fract(p+.5)-.5)/max(fwidth(p),vec2(.001));
  float line=1.-min(min(d.x,d.y),1.);
  float major=1.-min(min(abs(fract(p.x/4.+.5)-.5)/max(fwidth(p.x/4.),.001),abs(fract(p.y/4.+.5)-.5)/max(fwidth(p.y/4.),.001)),1.);
  float dist=length(wp.xz);
  float fade=exp(-dist*.39);
  vec3 color=mix(vec3(.145,.165,.151),vec3(.20,.225,.204),fade);
  color+=vec3(.14,.16,.14)*(line*.6+major*.35)*showGrid*fade;
  gl_FragColor=vec4(color, min(1.,fade*1.7));
}`

export class StudioEngine {
  scene = new T.Scene()
  camera = new T.PerspectiveCamera(31, 1, .025, 80)
  renderer: T.WebGLRenderer
  controls: OrbitControls
  rig: CharacterRig | null = null
  settings: Settings = { ...defaults }
  time = 0
  private observer: ResizeObserver
  private disposed = false
  private raf = 0
  private previous = 0
  private frames = 0
  private metricAt = 0
  private floorMat = new T.ShaderMaterial({ vertexShader: floorVert, fragmentShader: floorFrag,
    transparent: true, depthWrite: false, uniforms: { showGrid: { value: 1 } } })
  private ray = new T.Raycaster()
  private pointer = new T.Vector2()
  private dragPlane = new T.Plane()
  private dragStart = v3()
  private dragLast = v3()
  private dragTime = 0
  private velocity = v3()
  private interaction: 'grab' | 'move' | null = null
  private activePointer = -1
  private marker = new T.Mesh(new T.SphereGeometry(.013, 12, 12), new T.MeshBasicMaterial({ color: '#c6f993', depthTest: false }))
  private shadow: T.Mesh
  private flight: { from: T.Vector3; to: T.Vector3; at: T.Vector3; target: T.Vector3; t: number } | null = null

  constructor(private host: HTMLDivElement, private cb: Callbacks) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true,
      powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.04
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.domElement.setAttribute('aria-label', 'Интерактивная 3D-модель Мики. Перетаскивайте персонажа за конечности или вращайте сцену.')
    this.renderer.domElement.setAttribute('role', 'img')
    this.renderer.domElement.tabIndex = 0
    this.renderer.domElement.className = 'studio-canvas'
    this.host.appendChild(this.renderer.domElement)
    const bg = document.createElement('canvas'); bg.width = 1200; bg.height = 850
    const ctx = bg.getContext('2d')!
    const gradient = ctx.createRadialGradient(555, 320, 25, 570, 330, 710)
    gradient.addColorStop(0, '#5b605b'); gradient.addColorStop(.48, '#424843'); gradient.addColorStop(1, '#292f2b')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, bg.width, bg.height)
    const bgTex = new T.CanvasTexture(bg); bgTex.colorSpace = T.SRGBColorSpace
    this.scene.background = bgTex
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true; this.controls.dampingFactor = .12
    this.controls.minDistance = .42; this.controls.maxDistance = 9
    this.controls.maxPolarAngle = Math.PI * .484; this.controls.minPolarAngle = .12
    this.controls.panSpeed = .65; this.controls.zoomSpeed = .8; this.controls.rotateSpeed = .65
    this.controls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE }
    this.controls.addEventListener('change', () => this.cb.camera(this.controls.getAzimuthalAngle(), this.controls.getPolarAngle()))
    this.controls.addEventListener('start', () => { this.flight = null })
    this.setView('perspective', false)
    this.addLights()
    this.shadow = this.addStage()
    this.marker.visible = false; this.marker.renderOrder = 100; this.scene.add(this.marker)
    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.down, true)
    canvas.addEventListener('pointermove', this.move, true)
    canvas.addEventListener('pointerup', this.up, true)
    canvas.addEventListener('pointercancel', this.up, true)
    canvas.addEventListener('lostpointercapture', this.up, true)
    canvas.addEventListener('webglcontextlost', this.contextLost)
    this.observer = new ResizeObserver(this.resize); this.observer.observe(this.host)
    this.resize()
    this.load()
  }

  private async load() {
    try {
      const model = await loadActiveAvatar()
      if (this.disposed) { this.freeObject(model); return }
      this.scene.add(model)
      this.rig = new CharacterRig(model)
      this.scene.add(this.rig.visual)
      this.update(this.settings)
      this.rig.step(0, 0)
      this.renderer.shadowMap.needsUpdate = true
      this.renderer.render(this.scene, this.camera)
      this.cb.ready(this.rig.world.constraints.length)
      this.raf = requestAnimationFrame(this.tick)
    } catch (e) {
      if (!this.disposed) this.cb.error(e instanceof Error ? e.message : 'Не удалось загрузить 3D-модель')
    }
  }

  private addLights() {
    this.scene.add(new T.HemisphereLight('#fff2e8', '#adb2a4', 1.42))
    const key = new T.DirectionalLight('#fff1e3', 2.15)
    key.position.set(2.2, 4, -3.3); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -2.3; key.shadow.camera.right = 2.3
    key.shadow.camera.top = 2.6; key.shadow.camera.bottom = -1.5
    key.shadow.bias = -.00035; key.shadow.normalBias = .0015; key.shadow.radius = 4
    this.scene.add(key)
    const fill = new T.DirectionalLight('#c7d6e6', .67); fill.position.set(-2, 1.3, -2); this.scene.add(fill)
    const rim = new T.DirectionalLight('#f4dfcf', 2.1); rim.position.set(-1.5, 2.8, 2.4); this.scene.add(rim)
  }

  private addStage() {
    const floor = new T.Mesh(new T.PlaneGeometry(150, 150), this.floorMat)
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.057; this.scene.add(floor)
    const platform = (r: number, h: number, y: number, color: string, top?: T.Material) => {
      const m = new T.MeshStandardMaterial({ color, metalness: .36, roughness: .62 })
      const p = new T.Mesh(new T.CylinderGeometry(r, r + .005, h, 160), [m, top || m, m])
      p.position.y = y; p.receiveShadow = true; this.scene.add(p)
    }
    platform(.595, .028, -.04, '#242a25')
    platform(.615, .019, -.022, '#333c34')
    platform(.609, .015, -.0085, '#363e36', new T.MeshStandardMaterial({ map: platformTexture(), roughness: .8, metalness: .1 }))
    const ring = (r: number, width: number, a: number, angle: number, c: string, y: number) => {
      const m = new T.Mesh(new T.RingGeometry(r - width, r, 180, 1, a, angle), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }))
      m.rotation.x = -Math.PI / 2; m.position.y = y; this.scene.add(m)
    }
    ring(.605, .0018, 0, Math.PI * 2, '#8a9a7d', .0003)
    for (let i = 0; i < 3; i++) ring(.603, .0042, i * Math.PI * 2 / 3 + .1, .76, '#b3cc90', .0005)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
    const c = canvas.getContext('2d')!, g = c.createRadialGradient(64, 64, 1, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,.54)'); g.addColorStop(.4, 'rgba(0,0,0,.29)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g; c.fillRect(0, 0, 128, 128)
    const shadow = new T.Mesh(new T.PlaneGeometry(.52, .33), new T.MeshBasicMaterial({ map: new T.CanvasTexture(canvas), transparent: true, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .001; this.scene.add(shadow)
    return shadow
  }

  private resize = () => {
    if (this.disposed) return
    const { width, height } = this.host.getBoundingClientRect()
    if (width < 1 || height < 1) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix()
    this.renderer.render(this.scene, this.camera)
  }

  update(s: Settings) {
    this.settings = { ...s }
    if (this.rig) {
      this.rig.setAnchored(s.anchored)
      this.rig.world.gravity.set(0, s.gravityEnabled ? -s.gravity : 0, 0)
      this.rig.visual.visible = s.skeleton
      this.rig.segments.forEach(p => p.body.wakeUp())
      this.rig.sync()
    }
    this.floorMat.uniforms.showGrid.value = s.grid ? 1 : 0
    this.host.dataset.tool = s.tool
  }

  setView(view: View, smooth = true) {
    const root = this.rig?.segments[0]
    const x = root?.body.position.x || 0, z = root?.body.position.z || 0
    const y = this.rig && !this.rig.anchored ? Math.max(.4, this.rig.segments[0].body.position.y) : .76
    const dest = v3(x, y, z)
    const offset = view === 'perspective' ? v3(.84, .42, -3.52) : view === 'front' ? v3(0, .07, -3.62) : view === 'side' ? v3(3.62, .12, 0) : v3(0, .1, 3.62)
    if (smooth) this.flight = { from: this.camera.position.clone(), to: dest.clone().add(offset),
      at: this.controls.target.clone(), target: dest, t: 0 }
    else { this.camera.position.copy(dest).add(offset); this.controls.target.copy(dest); this.controls.update() }
  }

  private rayFrom(e: PointerEvent) {
    const b = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1)
    this.ray.setFromCamera(this.pointer, this.camera)
  }

  private down = (e: PointerEvent) => {
    if (!this.rig || e.button !== 0 || this.settings.tool === 'orbit' || e.shiftKey || e.ctrlKey || e.altKey || this.activePointer >= 0) return
    this.rayFrom(e)
    const capsule = this.rig.hitTest(this.ray.ray)
    let hit = capsule
    if (!hit) {
      // Skinned bounds move with the ragdoll and cannot be cached at its spawn point.
      this.rig.meshes.forEach(m => { if (m instanceof T.SkinnedMesh) m.computeBoundingSphere() })
      const surface = this.ray.intersectObjects(this.rig.meshes, false)[0]
      if (surface) hit = { point: surface.point, segment: this.rig.pick(surface.point) }
    }
    if (!hit) return
    e.stopImmediatePropagation(); e.preventDefault()
    if (this.settings.tool === 'move' && this.settings.anchored) {
      this.cb.hint('Отключите фиксацию в инспекторе, чтобы переместить Мику.'); return
    }
    if (!this.settings.running) this.cb.resume()
    this.flight = null
    this.activePointer = e.pointerId
    this.renderer.domElement.setPointerCapture(e.pointerId)
    this.controls.enabled = false
    const { point, segment } = hit
    if (this.settings.tool === 'move') {
      this.interaction = 'move'
      this.dragPlane.setFromNormalAndCoplanarPoint(v3(0, 1, 0), point)
      this.rig.beginMove(); this.cb.drag('Перемещение персонажа')
    } else {
      this.interaction = 'grab'
      this.dragPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(v3()), point)
      this.rig.beginGrab(segment, point); this.cb.drag(segment.label)
    }
    this.dragStart.copy(point); this.dragLast.copy(point); this.dragTime = performance.now(); this.velocity.set(0, 0, 0)
    this.marker.position.copy(point); this.marker.visible = true
    this.host.dataset.dragging = 'true'
  }

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer || !this.rig || !this.interaction) return
    this.rayFrom(e)
    const p = this.ray.ray.intersectPlane(this.dragPlane, v3())
    if (!p) return
    p.y = T.MathUtils.clamp(p.y, .018, 4.2)
    p.x = T.MathUtils.clamp(p.x, -4, 4); p.z = T.MathUtils.clamp(p.z, -4, 4)
    const now = performance.now(), dt = Math.max(.008, (now - this.dragTime) / 1000)
    this.velocity.lerp(p.clone().sub(this.dragLast).multiplyScalar(1 / dt), .55)
    if (this.interaction === 'move') this.rig.moveBy(p.clone().sub(this.dragStart))
    else this.rig.dragTo(p)
    this.dragLast.copy(p); this.dragTime = now; this.marker.position.copy(p)
  }

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return
    this.release()
  }

  private release() {
    const pointer = this.activePointer; this.activePointer = -1
    this.rig?.endGrab(performance.now() - this.dragTime < 140 ? this.velocity : undefined)
    this.rig?.endMove()
    this.interaction = null; this.marker.visible = false; this.controls.enabled = true
    if (pointer >= 0 && this.renderer.domElement.hasPointerCapture(pointer)) this.renderer.domElement.releasePointerCapture(pointer)
    this.host.dataset.dragging = 'false'; this.cb.drag(null)
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(.06, (now - (this.previous || now)) / 1000); this.previous = now
    if (document.hidden) return
    if (this.settings.running) {
      const t = dt * this.settings.speed
      this.time += t; this.rig?.step(t, this.time)
    }
    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + dt * 3)
      const t = 1 - (1 - this.flight.t) ** 3
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, t)
      this.controls.target.lerpVectors(this.flight.at, this.flight.target, t)
      if (this.flight.t === 1) this.flight = null
    }
    this.controls.update()
    if (this.rig) {
      if (this.rig.needsShadowUpdate || this.interaction) this.renderer.shadowMap.needsUpdate = true
      const p = this.rig.segments[0].body.position
      this.shadow.position.x = p.x; this.shadow.position.z = p.z
      const outside = Math.hypot(p.x, p.z) > .58
      this.shadow.position.y = outside ? -.053 : .001
      this.shadow.visible = p.y < 1.3
      if (p.y < -2 || Math.abs(p.x) > 25 || Math.abs(p.z) > 25) {
        this.rig.reset(); this.cb.hint('Персонаж возвращён в рабочую область.')
      }
    }
    this.renderer.render(this.scene, this.camera)
    if (!this.metricAt) this.metricAt = now
    this.frames++
    if (now - this.metricAt > 750) {
      const fps = Math.min(240, Math.round(this.frames * 1000 / (now - this.metricAt)))
      const p = this.rig?.segments[0].body.position
      this.cb.metrics({ fps, time: this.time, x: p?.x || 0, y: p?.y || 0, z: p?.z || 0 })
      this.frames = 0; this.metricAt = now
    }
  }

  reset() {
    this.release(); this.rig?.reset(); this.time = 0; this.setView('perspective')
    this.renderer.shadowMap.needsUpdate = true
    this.cb.metrics({ fps: 0, time: 0, x: 0, y: .94, z: 0 })
  }

  stepFrame() {
    const dt = 1 / 60; this.time += dt; this.rig?.step(dt, this.time)
    this.renderer.render(this.scene, this.camera)
  }

  save(): SceneState {
    return { bodies: this.rig?.save() || [], anchor: this.rig?.anchor.toArray() || [0, 0, 0],
      camera: this.camera.position.toArray(), target: this.controls.target.toArray(), time: this.time }
  }

  restore(s: SceneState) {
    this.release(); this.flight = null; this.rig?.restore(s.bodies, s.anchor)
    this.renderer.shadowMap.needsUpdate = true
    this.camera.position.fromArray(s.camera); this.controls.target.fromArray(s.target)
    this.time = s.time; this.controls.update(); this.renderer.render(this.scene, this.camera)
  }

  snapshot(width = 640) {
    this.renderer.render(this.scene, this.camera)
    const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width / this.camera.aspect)
    c.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', .87)
  }

  portrait() {
    const c = new T.PerspectiveCamera(19, 1, .02, 30)
    c.position.set(.15, 1.51, -.92); c.lookAt(0, 1.43, -.01)
    const original = this.renderer.getSize(new T.Vector2())
    this.renderer.setSize(320, 320, false); this.renderer.render(this.scene, c)
    const data = this.renderer.domElement.toDataURL('image/webp', .93)
    this.renderer.setSize(original.x, original.y, false); this.renderer.render(this.scene, this.camera)
    return data
  }

  private contextLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(this.raf); this.cb.error('Графический контекст потерян. Перезапустите 3D-вид.') }

  private freeObject(root: T.Object3D) {
    const materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>(), textures = new Set<T.Texture>()
    root.traverse(o => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m)
        if (o instanceof T.SkinnedMesh) o.skeleton.dispose()
      }
    })
    materials.forEach(m => { Object.values(m).forEach(v => { if (v instanceof T.Texture) textures.add(v) }); m.dispose() })
    textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose())
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect()
    this.controls.dispose(); this.rig?.endGrab()
    const c = this.renderer.domElement
    c.removeEventListener('pointerdown', this.down, true); c.removeEventListener('pointermove', this.move, true)
    c.removeEventListener('pointerup', this.up, true); c.removeEventListener('pointercancel', this.up, true)
    c.removeEventListener('lostpointercapture', this.up, true); c.removeEventListener('webglcontextlost', this.contextLost)
    this.freeObject(this.scene); if (this.scene.background instanceof T.Texture) this.scene.background.dispose()
    this.renderer.dispose(); this.renderer.forceContextLoss(); c.remove()
  }
}