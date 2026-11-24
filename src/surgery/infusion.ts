import * as T from 'three'
import type { Pick } from './game'

export class InfusionStation {
  root = new T.Group()
  bag = new T.Group()
  fluid: T.Mesh<T.BoxGeometry, T.MeshStandardMaterial>
  private drop: T.Mesh
  private lamp: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>
  private display: T.CanvasTexture
  private canvas = document.createElement('canvas')
  private connected = false
  private suspended = false
  private target = new T.Vector3(.662, 1.744, -1.20)
  seconds = 0
  private drawSeconds = -1

  constructor(scene: T.Scene) {
    const glass = new T.MeshStandardMaterial({ color: '#c1dae0', roughness: .20, metalness: .12, transparent: true, opacity: .39, depthWrite: false })
    const housing = new T.Mesh(new T.BoxGeometry(.112, .208, .050), glass); this.bag.add(housing)
    this.fluid = new T.Mesh(new T.BoxGeometry(.100, .170, .039), new T.MeshStandardMaterial({ color: '#9cc8d1', roughness: .23, metalness: .05, transparent: true, opacity: .84 })); this.bag.add(this.fluid)
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128
    const c = canvas.getContext('2d')!; c.fillStyle = '#e0e6df'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#365868'; c.font = 'bold 34px monospace'; c.fillText('IV / 06', 18, 51); c.fillRect(18, 71, 218, 2); c.font = '17px monospace'; c.fillText('SIMULATION', 18, 103)
    const tex = new T.CanvasTexture(canvas); tex.colorSpace = T.SRGBColorSpace
    const label = new T.Mesh(new T.PlaneGeometry(.090, .045), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide })); label.position.set(0, .008, .026); this.bag.add(label)
    this.bag.position.set(.662, 1.736, -1.23); this.bag.name = 'Mounted IV bag'; this.bag.visible = false
    const chamber = new T.Mesh(new T.CylinderGeometry(.0125, .010, .058, 20), glass); chamber.position.set(.662, 1.587, -1.23)
    this.drop = new T.Mesh(new T.SphereGeometry(.0041, 10, 8), new T.MeshBasicMaterial({ color: '#8dded7' })); this.drop.scale.y = 1.35; this.drop.visible = false
    this.lamp = new T.Mesh(new T.SphereGeometry(.005, 10, 8), new T.MeshBasicMaterial({ color: '#687875' })); this.lamp.position.set(.568, 1.197, -1.157)
    this.canvas.width = 256; this.canvas.height = 128; this.display = new T.CanvasTexture(this.canvas); this.display.colorSpace = T.SRGBColorSpace
    const screen = new T.Mesh(new T.PlaneGeometry(.104, .077), new T.MeshBasicMaterial({ map: this.display })); screen.position.set(.53, 1.241, -1.152)
    const guide = new T.Mesh(new T.TorusGeometry(.018, .0017, 7, 32), new T.MeshBasicMaterial({ color: '#a5c7cb' })); guide.position.set(.662, 1.858, -1.23)
    this.root.add(this.bag, chamber, this.drop, this.lamp, screen, guide); this.root.userData.pick = { kind: 'zone', id: 'iv' } satisfies Pick; scene.add(this.root); this.draw()
  }
  goal() { return this.target.clone() }
  private draw() {
    const c = this.canvas.getContext('2d')!; c.fillStyle = '#102224'; c.fillRect(0, 0, 256, 128); c.fillStyle = this.connected ? '#8de0b9' : '#d8bc8d'; c.font = '18px monospace'; c.fillText('IV-01 / SIM', 12, 26); c.font = 'bold 35px monospace'; c.fillText(this.connected ? this.suspended ? 'PAUSED' : 'FLOW' : 'STANDBY', 12, 69)
    c.fillStyle = '#354e4b'; c.fillRect(12, 94, 228, 12); if (this.connected) { c.fillStyle = '#7dc9ac'; c.fillRect(12, 94, 228 * Math.max(.1, 1 - this.seconds / 7200), 12) }; this.display.needsUpdate = true
  }
  set(on: boolean, suspended: boolean) {
    const changed = on !== this.connected || suspended !== this.suspended
    this.connected = on; this.suspended = suspended; this.bag.visible = on
    if (!on) this.seconds = 0
    this.drop.visible = on; if (changed) this.draw(); this.update(0)
  }
  update(dt: number) {
    if (!this.connected) { this.lamp.material.color.set('#687875'); return }
    if (!this.suspended) this.seconds += dt
    const second = Math.floor(this.seconds); if (second !== this.drawSeconds) { this.drawSeconds = second; this.draw() }
    const fraction = (this.seconds * 1.55) % 1
    this.drop.position.set(.662, 1.606 - .038 * fraction * fraction, -1.23)
    this.drop.scale.setScalar(.78 + .22 * fraction); this.drop.scale.y *= 1.35
    this.lamp.material.color.set(this.suspended ? '#c4a773' : fraction < .22 ? '#bfefd3' : '#6cab8b')
    const level = Math.max(.10, 1 - this.seconds / 7200)
    this.fluid.scale.y = level; this.fluid.position.y = -.092 + .085 * level
  }
}