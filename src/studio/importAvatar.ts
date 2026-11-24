import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { getMikaBuffer } from './modelAsset'
import { CharacterRig } from './character'

type Resource = { uri?: string; byteLength?: number; mimeType?: string; bufferView?: number }
type AvatarDoc = { asset: { version: string }; buffers?: Resource[]; images?: Resource[]; skins?: { joints: number[] }[]; nodes?: unknown[]; accessors?: { count: number; type: string }[]; extensionsRequired?: string[] }
export type ImportedAvatar = { name: string; data: ArrayBuffer; format: 'glb' | 'gltf'; bones: number; triangles: number; facial: boolean; bytes: number; profile: string }
const MiB = 1024 * 1024
const MAX_SIZE = 48 * MiB
const cleanName = (name: string) => name.toLowerCase().replace(/^.*:/, '').replace(/mixamorig\d*|[^a-z0-9]/g, '')
const axes = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
const aliases: Record<string, string[]> = {
  C_Hips: ['hips', 'pelvis'], C_Spine: ['spine', 'spine01'], C_Chest: ['chest', 'spine1', 'spine02'],
  C_UpperChest: ['upperchest', 'spine2', 'spine03'], C_Neck: ['neck', 'neck01'], C_Head: ['head'],
}
for (const side of ['L', 'R']) {
  const prefix = side === 'L' ? 'left' : 'right', short = side.toLowerCase()
  for (const [part, names] of Object.entries({ Shoulder: ['shoulder', 'clavicle'], UpperArm: ['upperarm', 'arm'], LowerArm: ['lowerarm', 'forearm'], Hand: ['hand', 'wrist'], UpperLeg: ['upperleg', 'upleg', 'thigh'], LowerLeg: ['lowerleg', 'leg', 'calf', 'shin'], Foot: ['foot', 'ankle'], ToeBase: ['toebase', 'toe', 'toes', 'ball'] })) {
    aliases[`${side}_${part}`] = names.flatMap(n => [prefix + n, n + short, short + n])
  }
  for (const [j, finger] of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].entries()) for (let n = 1; n <= 3; n++) {
    const f = finger.toLowerCase(), vrm = ['proximal', 'intermediate', 'distal'][n - 1]
    aliases[`${side}_${finger}${n}`] = [prefix + f + vrm, prefix + 'hand' + f + n, prefix + 'hand' + (j === 4 ? 'pinky' : f) + n, f + '0' + n + short]
  }
}
const required = ['C_Hips', 'C_Spine', 'C_Head', ...['L', 'R'].flatMap(s => ['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map(n => `${s}_${n}`))]
let current: ImportedAvatar | null = null
let revision = 0
const listeners = new Set<() => void>()
export const getAvatarRevision = () => revision
export const getActiveAvatar = () => current
export function subscribeAvatar(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
export function commitAvatar(avatar: ImportedAvatar | null) { current = avatar; revision++; listeners.forEach(fn => fn()) }
export const activeAvatarName = () => current?.name || 'Мика'
export const activeAvatarBuffer = () => current ? Promise.resolve(current.data) : getMikaBuffer()

function documentOf(bytes: ArrayBuffer, binary: boolean): AvatarDoc {
  let json: string
  if (binary) {
    if (bytes.byteLength < 24) throw new Error('Файл GLB неполный.')
    const v = new DataView(bytes), n = v.getUint32(12, true)
    if (v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== bytes.byteLength || v.getUint32(16, true) !== 0x4e4f534a || n > bytes.byteLength - 20) throw new Error('Это не полный файл GLB версии 2.0.')
    json = new TextDecoder().decode(new Uint8Array(bytes, 20, n))
  } else json = new TextDecoder().decode(bytes)
  let doc: AvatarDoc
  try { doc = JSON.parse(json) } catch { throw new Error('Не удалось прочитать JSON glTF. Проверьте экспорт файла.') }
  if (!doc?.asset || doc.asset.version !== '2.0') throw new Error('Нужен GLB или glTF версии 2.0.')
  if (!doc.skins?.some(s => Array.isArray(s.joints) && s.joints.length >= 15)) throw new Error('У модели нет подходящего скелета. Экспортируйте гуманоид с костями и весами вершин, а не статичную сетку.')
  if ((doc.nodes?.length || 0) > 3500 || (doc.skins?.length || 0) > 64) throw new Error('Слишком сложная сцена. Экспортируйте только одного персонажа.')
  if ((doc.accessors || []).some(a => !Number.isFinite(a.count) || a.count < 0 || a.count > 4000000) || (doc.buffers || []).reduce((n, b) => n + (b.byteLength || 0), 0) > MAX_SIZE) throw new Error('Объём геометрии превышает лимит локального импорта (48 МБ).')
  if (doc.extensionsRequired?.some(e => /draco|meshopt|basisu/i.test(e))) throw new Error('Этот экспорт требует дополнительного декодера. Сохраните GLB без Draco, Meshopt и KTX2.')
  return doc
}

function asDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((ok, fail) => { const r = new FileReader(); r.onerror = () => fail(new Error(`Не удалось прочитать ${file.name}.`)); r.onload = () => ok(String(r.result)); r.readAsDataURL(new Blob([file], { type: mime })) })
}
async function consolidate(doc: AvatarDoc, files: File[]) {
  const cache = new Map<string, string>()
  for (const asset of [...(doc.buffers || []), ...(doc.images || [])]) {
    const uri = asset.uri; if (!uri) continue
    if (/^data:/i.test(uri)) {
      if (!/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,/i.test(uri)) throw new Error('Разрешены встроенные буферы и изображения PNG, JPEG, WebP.')
      continue
    }
    if (/^[a-z][a-z\d+.-]*:|^[\\/]/i.test(uri)) throw new Error('Внешние сетевые ссылки не загружаются. Выберите локальные текстуры и .bin вместе с моделью.')
    const name = decodeURIComponent(uri).replace(/\\/g, '/').split('/').pop()!
    const matches = files.filter(f => f.name === name)
    if (matches.length !== 1) throw new Error(`Нужен файл «${name}». Выберите модель, её .bin и все текстуры одновременно.`)
    if (!cache.has(uri)) {
      const isImage = doc.images?.includes(asset), ext = name.split('.').pop()?.toLowerCase()
      if (isImage && !['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) throw new Error('Для текстур поддерживаются PNG, JPEG и WebP.')
      cache.set(uri, await asDataUrl(matches[0], isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/octet-stream'))
    }
    asset.uri = cache.get(uri)
  }
}

function localLoader() {
  const manager = new T.LoadingManager()
  manager.setURLModifier(url => { if (url.startsWith('data:') || url.startsWith('blob:')) return url; throw new Error('Не найден локальный ресурс модели. Сетевые запросы отключены.') })
  return new GLTFLoader(manager)
}

export function disposeAvatar(model: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(), ms = new Set<T.Material>(), ts = new Set<T.Texture>()
  model.traverse(m => { if (m instanceof T.Mesh) { gs.add(m.geometry); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => ms.add(x)); if (m instanceof T.SkinnedMesh) m.skeleton.dispose() } })
  ms.forEach(m => { Object.values(m).forEach(t => { if (t instanceof T.Texture) ts.add(t) }); m.dispose() }); gs.forEach(g => g.dispose()); ts.forEach(t => t.dispose())
}

function adapt(scene: T.Group) {
  const bones = new Set<T.Bone>(), map = new Map<string, T.Bone>()
  let triangles = 0, weighted = 0, facial = false
  scene.traverse(o => {
    if (!(o instanceof T.Mesh)) return
    const geometry = o.geometry, count = geometry.attributes.position?.count || 0
    triangles += Math.floor((geometry.index?.count || count) / 3)
    if (o instanceof T.SkinnedMesh && geometry.attributes.skinIndex && geometry.attributes.skinWeight) {
      weighted += count; o.skeleton.bones.forEach(b => bones.add(b))
      const a = geometry.attributes.position
      for (let i = 0; i < a.count; i++) if (![a.getX(i), a.getY(i), a.getZ(i)].every(Number.isFinite)) throw new Error('В сетке есть некорректные координаты.')
    }
    if (o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) facial = true
  })
  if (!weighted || triangles < 4 || triangles > 350000) throw new Error('Нужна модель с весами вершин, не более 350 000 треугольников.')
  for (const [key, names] of Object.entries(aliases)) {
    const b = [...bones].find(b => b.name === 'J_Bip_' + key) || [...bones].find(b => names.includes(cleanName(b.name)))
    if (b) map.set(key, b)
  }
  const missing = required.filter(k => !map.has(k))
  if (missing.length) throw new Error(`Скелет не распознан: ${missing.slice(0, 4).join(', ')}. Поддерживаются кости VRoid, Mixamo и стандартного humanoid.`)
  const profile = map.get('C_Hips')!.name.startsWith('J_Bip_') ? 'VRoid' : /mixamorig/i.test(map.get('C_Hips')!.name) ? 'Mixamo' : 'Humanoid'
  map.forEach((b, key) => { b.name = 'J_Bip_' + key })
  scene.updateMatrixWorld(true)
  const wp = (key: string) => map.get(key)!.getWorldPosition(new T.Vector3())
  const hips = wp('C_Hips'), head = wp('C_Head'), feet = wp('L_Foot').lerp(wp('R_Foot'), .5)
  const up = head.clone().sub(hips).normalize(), right = wp('R_UpperArm').sub(wp('L_UpperArm')); right.addScaledVector(up, -right.dot(up)).normalize()
  const front = right.clone().cross(up).normalize(), span = head.clone().sub(feet).dot(up)
  if (!Number.isFinite(span) || span < .015 || span > 10000 || right.lengthSq() < .9 || up.lengthSq() < .9) throw new Error('Некорректная исходная поза. Нужен стоящий персонаж в A- или T-позе.')
  const basis = new T.Matrix4().makeBasis(right, up, front), aligned = new T.Group(), root = new T.Group()
  aligned.quaternion.setFromRotationMatrix(basis).invert(); aligned.scale.setScalar(1.285 / span); aligned.add(scene); root.add(aligned); root.updateMatrixWorld(true)
  const anchor = wp('C_Hips'); aligned.position.set(-anchor.x, .94405 - anchor.y, -.00584 - anchor.z); root.updateMatrixWorld(true)
  const descendant = (child: T.Object3D, parent: T.Object3D) => { let n: T.Object3D | null = child; while (n) { if (n === parent) return true; n = n.parent } return false }
  for (const side of ['L', 'R']) for (const [a, b] of [['UpperArm', 'LowerArm'], ['LowerArm', 'Hand'], ['UpperLeg', 'LowerLeg'], ['LowerLeg', 'Foot']]) {
    const x = `${side}_${a}`, y = `${side}_${b}`, length = wp(x).distanceTo(wp(y))
    if (!descendant(map.get(y)!, map.get(x)!) || length < .035 || length > .68) throw new Error('Неверная иерархия или пропорции конечностей. Проверьте привязку скелета.')
  }
  // Supply missing spinal pivots without changing the inverse bind matrices of the skin.
  for (const [key, parent, child, frac] of [['C_Chest', 'C_Spine', 'C_Head', .34], ['C_UpperChest', 'C_Chest', 'C_Head', .44], ['C_Neck', 'C_UpperChest', 'C_Head', .65]] as const) {
    if (map.has(key)) continue
    const a = map.get(parent)!, target = wp(parent).lerp(wp(child), frac), old = [...a.children]
    const bone = new T.Bone(); bone.name = 'J_Bip_' + key; a.add(bone); bone.position.copy(a.worldToLocal(target)); bone.updateWorldMatrix(true, false)
    for (const n of old) if (descendant(map.get(child)!, n) || ['L_UpperArm','R_UpperArm'].some(k => descendant(map.get(k)!, n))) bone.attach(n)
    map.set(key, bone)
  }
  const chains = [['C_Hips', 'C_Spine', 'C_Chest', 'C_UpperChest', 'C_Neck', 'C_Head'], ...['L', 'R'].flatMap(side => [
    ['C_Hips', side + '_UpperLeg', side + '_LowerLeg', side + '_Foot'], ['C_UpperChest', side + '_UpperArm', side + '_LowerArm', side + '_Hand'],
  ])]
  for (const chain of chains) for (let i = 1; i < chain.length; i++) {
    if (!descendant(map.get(chain[i])!, map.get(chain[i - 1])!)) throw new Error(`Несовместимая цепочка ${chain[i - 1]} / ${chain[i]}. Нужен связный гуманоидный скелет.`)
  }
  for (const side of ['L', 'R']) {
    const marker = (key: string, parent: string, target: T.Vector3) => {
      if (map.has(key)) return
      const p = map.get(parent)!, b = new T.Bone(); b.name = 'J_Bip_' + key; p.add(b); b.position.copy(p.worldToLocal(target)); map.set(key, b); b.updateWorldMatrix(true, false)
    }
    const wrist = wp(side + '_Hand'), dir = wrist.clone().sub(wp(side + '_LowerArm')).normalize()
    marker(side + '_Middle1', side + '_Hand', wrist.clone().addScaledVector(dir, .068))
    marker(side + '_Middle2', side + '_Middle1', wp(side + '_Middle1').addScaledVector(dir, .026))
    marker(side + '_ToeBase', side + '_Foot', wp(side + '_Foot').add(axes(0, -.045, -.092)))
  }
  root.userData.customAvatar = true; root.updateMatrixWorld(true)
  return { model: root, stats: { bones: bones.size, triangles, facial, profile } }
}

export async function inspectAvatar(files: File[]): Promise<ImportedAvatar> {
  if (!files.length || files.length > 40 || files.reduce((n, f) => n + f.size, 0) > MAX_SIZE) throw new Error('Выберите одну модель и её ресурсы общим размером до 48 МБ (до 40 файлов).')
  const main = files.filter(f => /\.(glb|gltf)$/i.test(f.name))
  if (main.length !== 1) throw new Error('Выберите ровно один файл .glb или .gltf. Для glTF также добавьте связанные .bin и текстуры.')
  let data = await main[0].arrayBuffer(); const binary = /\.glb$/i.test(main[0].name), doc = documentOf(data, binary)
  if (!binary) { await consolidate(doc, files); data = new TextEncoder().encode(JSON.stringify(doc)).buffer }
  else if ([...(doc.buffers || []), ...(doc.images || [])].some(x => x.uri && !x.uri.startsWith('data:'))) throw new Error('В GLB есть внешние ссылки. Экспортируйте GLB со встроенными текстурами или glTF с файлами ресурсов.')
  const parsed = await localLoader().parseAsync(data, '')
  try {
    const { model, stats } = adapt(parsed.scene)
    model.quaternion.setFromEuler(new T.Euler(Math.PI / 2, Math.PI, 0, 'YXZ')); model.position.set(0, 1.048, .856); model.updateMatrixWorld(true)
    // Build and settle a candidate rig off-screen before replacing the live session.
    const probe = new CharacterRig(model, 'patient')
    try {
      for (let i = 0; i < 12; i++) probe.step(1 / 120, i / 120)
      if (probe.segments.length !== 18 || probe.segments.some(s => ![...s.body.position.toArray(), ...s.body.quaternion.toArray(), s.start.distanceTo(s.end)].every(Number.isFinite) || s.start.distanceTo(s.end) < .003)) throw new Error('Скелет не прошёл проверку физики. Выберите модель с непустыми сегментами и A/T-позой.')
    } finally { disposeAvatar(probe.visual) }
    return { data, format: binary ? 'glb' : 'gltf', name: main[0].name.replace(/\.(glb|gltf)$/i, '').slice(0, 48) || 'Персонаж', bytes: data.byteLength, ...stats }
  } finally { disposeAvatar(parsed.scene) }
}

export async function loadActiveAvatar() {
  const asset = current, data = asset?.data || await getMikaBuffer()
  const gltf = await localLoader().parseAsync(data, '')
  if (!asset) return gltf.scene
  try { return adapt(gltf.scene).model } catch (error) { disposeAvatar(gltf.scene); throw error }
}