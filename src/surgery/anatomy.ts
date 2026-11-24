import * as T from 'three'
import type { CharacterRig, Segment } from '../studio/character'
import type { Layer } from './game'
import { partById } from './regions'

const colors = { bones: '#d4d5b8', muscle: '#b6827f', organs: '#c39485' }
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z)

export class AnatomyView {
  private groups: Record<Exclude<Layer, 'skin' | 'combined'>, T.Group[]> = { muscle: [], organs: [], bones: [] }
  private materials = new Map<T.Mesh, T.Material | T.Material[]>()
  private ghost = new T.MeshBasicMaterial({ color: '#77bbca', transparent: true, opacity: .075, depthWrite: false, side: T.FrontSide })
  private holders = new Map<string, T.Group>()
  organs: T.Object3D[] = []
  private mats: T.Material[] = []
  private objects = new Map<string, T.Mesh[]>()
  private originals = new Map<T.Mesh, T.Material>()
  private highlight = new T.MeshStandardMaterial({ color: '#dfbc87', emissive: '#b98e51', emissiveIntensity: .27, roughness: .62 })
  private dim = new T.MeshBasicMaterial({ color: '#8cc4c8', transparent: true, opacity: .09, depthWrite: false })
  private boneGhost = new T.MeshStandardMaterial({ color: colors.bones, transparent: true, opacity: .37, depthWrite: false, roughness: .78 })
  private muscleGhost = new T.MeshStandardMaterial({ color: colors.muscle, transparent: true, opacity: .10, depthWrite: false })
  private currentLayer: Layer = 'skin'
  private covered = true
  private selected: string | null = null
  private isolated = false

  constructor(private rig: CharacterRig, private cloth: T.Mesh) {
    for (const body of rig.meshes) this.materials.set(body, body.material)
    const boneMat = new T.MeshStandardMaterial({ color: colors.bones, roughness: .74 })
    const muscleMat = new T.MeshStandardMaterial({ color: colors.muscle, roughness: .8 })
    this.mats.push(boneMat, muscleMat)
    const holder = (type: Exclude<Layer, 'skin' | 'combined'>, bone: T.Object3D) => {
      const key = type + bone.uuid; let g = this.holders.get(key)
      if (!g) { g = new T.Group(); g.visible = false; g.userData.partId = `${type === 'bones' ? 'bone' : type}:${bone.name.replace('J_Bip_', '')}`; bone.add(g); this.holders.set(key, g); this.groups[type].push(g) }
      return g
    }
    const oval = (g: T.Object3D, position: T.Vector3, size: T.Vector3, m: T.Material) => { const o = new T.Mesh(new T.SphereGeometry(1, 16, 12), m); o.position.copy(position); o.scale.copy(size); g.add(o); return o }
    const tube = (g: T.Object3D, pts: T.Vector3[], rad: number, m: T.Material) => { const o = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), pts.length * 5, rad, 7, false), m); g.add(o); return o }
    const segment = (s: Segment, type: 'muscle' | 'bones') => {
      const g = holder(type, s.bone), start = s.bone.getWorldPosition(v(0, 0, 0))
      const end = s.body.pointToWorldFrame(s.end), localEnd = s.bone.worldToLocal(v(end.x, end.y, end.z))
      const length = start.distanceTo(v(end.x, end.y, end.z)), rad = s.radius * (type === 'bones' ? .35 : .77)
      if (length < .004) return
      if (type === 'bones') {
        const core = new T.Mesh(new T.CylinderGeometry(rad * .71, rad * .76, length * .9, 12), boneMat)
        core.position.copy(localEnd).multiplyScalar(.5); core.quaternion.setFromUnitVectors(v(0, 1, 0), localEnd.clone().normalize()); g.add(core)
        oval(g, v(0, 0, 0), v(rad * 1.16, rad, rad), boneMat); oval(g, localEnd, v(rad, rad, rad), boneMat)
      } else {
        const m = oval(g, localEnd.clone().multiplyScalar(.48), v(rad * 1.12, length * .49, rad), muscleMat)
        m.quaternion.setFromUnitVectors(v(0, 1, 0), localEnd.clone().normalize())
      }
    }
    for (const s of rig.segments) if (!s.name.startsWith('C_')) { segment(s, 'bones'); segment(s, 'muscle') }
    const get = (name: string) => rig.model.getObjectByName(`J_Bip_${name}`)!
    const chest = get('C_Chest'), hips = get('C_Hips'), head = get('C_Head')
    const ribs = holder('bones', chest)
    for (let i = 0; i < 12; i++) {
      const y = .154 - i * .016, radius = .094 + Math.sin(i / 12 * Math.PI) * .028
      for (const d of [-1, 1]) tube(ribs, [v(d * .01, y, .035), v(d * radius * .68, y + .005, .033), v(d * radius, y - .013, -.025), v(d * radius * .74, y - .029, -.076), v(d * .015, y - .018, -.084)], .004, boneMat)
    }
    for (let i = 0; i < 19; i++) oval(ribs, v(0, -.17 + i * .019, .039), v(.022, .010, .018), boneMat).userData.partId = 'bone:C_Spine'
    oval(ribs, v(0, .065, -.083), v(.013, .08, .006), boneMat)
    const pelvis = holder('bones', hips)
    for (const s of [-1, 1]) { const m = oval(pelvis, v(s * .059, -.008, .005), v(.051, .072, .043), boneMat); m.rotation.z = -s * .42 }
    const skull = holder('bones', head); oval(skull, v(0, .087, .005), v(.084, .101, .091), boneMat); oval(skull, v(0, .022, -.034), v(.057, .042, .046), boneMat)
    for (const part of ['L', 'R']) for (const finger of ['Index', 'Middle', 'Ring', 'Little', 'Thumb']) for (let i = 1; i <= 3; i++) {
      const b = get(`${part}_${finger}${i}`); if (!b) continue
      const g = holder('bones', b), end = b.children[0]?.position.clone() || v(part === 'L' ? -.019 : .019, 0, 0)
      tube(g, [v(0, 0, 0), end.clone().multiplyScalar(.5), end], .0024, boneMat)
    }
    const muscles = holder('muscle', chest)
    for (const s of [-1, 1]) {
      const m = oval(muscles, v(s * .061, .100, -.027), v(.064, .087, .052), muscleMat); m.rotation.z = s * .27
      for (let i = 0; i < 4; i++) oval(muscles, v(s * .038, -.015 - i * .037, -.055), v(.038, .024, .022), muscleMat)
    }
    const organs = holder('organs', chest)
    const module = (name: string, pos: T.Vector3, size: T.Vector3, color: string, rotation = 0) => {
      const mat = new T.MeshStandardMaterial({ color, roughness: .67 }); this.mats.push(mat)
      const o = oval(organs, pos, size, mat); o.name = name; o.rotation.z = rotation; o.userData.organ = name; this.organs.push(o); return o
    }
    module('Левое лёгкое', v(-.059, .077, -.012), v(.048, .091, .05), '#a5bec2', -.11)
    module('Правое лёгкое', v(.059, .078, -.012), v(.049, .094, .053), '#a5bec2', .10)
    module('Сердце', v(-.018, .041, -.056), v(.035, .049, .029), '#b8767c', -.4)
    module('Печень', v(.036, -.040, -.031), v(.079, .033, .05), '#aa8273', -.18)
    module('Желудок', v(-.049, -.056, -.033), v(.033, .047, .035), '#c2a48d', -.43)
    for (const d of [-1, 1]) module(d > 0 ? 'Правая почка' : 'Левая почка', v(d * .054, -.084, .018), v(.021, .035, .022), '#a38091', d * .24)
    const tract = new T.MeshStandardMaterial({ color: '#c7a88e', roughness: .71 }); this.mats.push(tract)
    const points: T.Vector3[] = []; for (let i = 0; i < 48; i++) points.push(v(Math.sin(i * .68) * (.062 - i * .00037), -.10 - i * .0018, -.033 + .013 * Math.cos(i * .68)))
    const gut = tube(organs, points, .010, tract); gut.userData.organ = 'Кишечник'; this.organs.push(gut)
    for (const [layer, groups] of Object.entries(this.groups)) for (const g of groups) for (const child of g.children) {
      if (!(child instanceof T.Mesh)) continue
      const id: string = child.userData.organ ? 'organ:' + child.userData.organ : child.userData.partId || g.userData.partId
      if (!partById.has(id)) continue
      child.userData.partId = id; child.userData.anatomyLayer = layer
      const meshes = this.objects.get(id) || []; meshes.push(child); this.objects.set(id, meshes); this.originals.set(child, child.material)
    }
  }

  set(layer: Layer, covered = this.covered) {
    this.currentLayer = layer; this.covered = covered
    for (const [id, gs] of Object.entries(this.groups)) gs.forEach(g => { g.visible = id === layer || layer === 'combined' })
    this.cloth.visible = layer === 'skin' && covered
    this.rig.meshes.forEach(m => {
      const original = this.materials.get(m)!
      const name = Array.isArray(original) ? '' : original.name
      if (layer === 'skin') {
        m.visible = !covered || !/Ivory woven|Wrap seam|Dusty lilac|Charcoal pleated|Umber waist|Cocoa slouch|Knitted rib|Velvet choker/.test(name)
        m.material = original
        return
      }
      m.visible = (this.rig.model.userData.customAvatar ? m instanceof T.SkinnedMesh : /SKIN|Charcoal fitted shorts/.test(name)) && !this.isolated
      if (m.visible) m.material = this.ghost
    })
    for (const [id, meshes] of this.objects) for (const m of meshes) {
      const match = id === this.selected
      m.visible = !this.isolated || !this.selected || match
      m.material = match ? this.highlight : this.selected && this.isolated ? this.dim : layer === 'combined' && m.userData.anatomyLayer === 'bones' ? this.boneGhost : layer === 'combined' && m.userData.anatomyLayer === 'muscle' ? this.muscleGhost : this.originals.get(m)!
    }
  }
  select(id: string | null, isolate = false) { this.selected = id; this.isolated = Boolean(id && isolate && !id.startsWith('body:')); this.set(this.currentLayer) }
  hit(ray: T.Raycaster) {
    if (this.currentLayer === 'skin') return null
    const visible: T.Mesh[] = []
    for (const meshes of this.objects.values()) for (const m of meshes) if (m.visible && m.parent?.visible) visible.push(m)
    const h = ray.intersectObjects(visible, false)[0]
    return h ? { id: h.object.userData.partId as string, point: h.point, distance: h.distance } : null
  }
  center(id: string) {
    const meshes = this.objects.get(id); if (!meshes?.length) return null
    const box = new T.Box3().makeEmpty()
    for (const m of meshes) { m.updateWorldMatrix(true, false); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)) }
    return box.getCenter(new T.Vector3())
  }
  dispose() { for (const m of [this.ghost, this.highlight, this.dim, this.boneGhost, this.muscleGhost, ...this.mats]) m.dispose(); this.materials.forEach((m, o) => { o.material = m }); this.originals.forEach((m, o) => { o.material = m }) }
}