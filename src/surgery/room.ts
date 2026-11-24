import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Pick, ToolId } from './game'
import { makeGlove } from './glove'

type Point = [number, number, number]
const vec = (p: Point) => new T.Vector3(...p)
const material = (color: string, metalness = .1, roughness = .49) => new T.MeshStandardMaterial({ color, metalness, roughness })
const steel = material('#b8c5c7', .85, .23), darkSteel = material('#58666a', .7, .36)
const pale = material('#bdc5c1', .26, .48), dark = material('#233033', .26, .43)
const rubber = material('#263031', .05, .82), teal = material('#275765', .02, .91)
const ivory = material('#e4e3d6', .12, .44), blue = material('#457284', .2, .44)
const warm = new T.MeshBasicMaterial({ color: '#ffe1ad' }), white = new T.MeshBasicMaterial({ color: '#e6f4ee' })
const amber = new T.MeshBasicMaterial({ color: '#f0b240' }), mint = new T.MeshBasicMaterial({ color: '#8ae6bb' })
function mesh(parent: T.Object3D, geo: T.BufferGeometry, mat: T.Material, p: Point) {
  const obj = new T.Mesh(geo, mat); obj.position.set(...p); obj.castShadow = true; obj.receiveShadow = true; parent.add(obj); return obj
}
function box(g: T.Object3D, p: Point, s: Point, mat: T.Material, r = 0) {
  return mesh(g, r ? new RoundedBoxGeometry(...s, 2, r) : new T.BoxGeometry(...s), mat, p)
}
function cyl(g: T.Object3D, p: Point, r: number, h: number, mat: T.Material, n = 20) {
  return mesh(g, new T.CylinderGeometry(r, r, h, n), mat, p)
}
function sphere(g: T.Object3D, p: Point, s: Point, mat: T.Material) {
  const o = mesh(g, new T.SphereGeometry(1, 20, 16), mat, p); o.scale.set(...s); return o
}
function tube(g: T.Object3D, pts: Point[], r: number, mat: T.Material) {
  return mesh(g, new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(vec)), Math.max(12, pts.length * 6), r, 7, false), mat, [0, 0, 0])
}
function rod(g: T.Object3D, a: Point, b: Point, r: number, mat: T.Material) {
  const av = vec(a), bv = vec(b), d = bv.clone().sub(av)
  const o = cyl(g, av.clone().lerp(bv, .5).toArray() as Point, r, d.length(), mat, 12)
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); return o
}
function ring(g: T.Object3D, p: Point, r: number, w: number, mat: T.Material) { return mesh(g, new T.TorusGeometry(r, w, 8, 30), mat, p) }
function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  draw(canvas.getContext('2d')!); const t = new T.CanvasTexture(canvas); t.colorSpace = T.SRGBColorSpace; return t
}
function label(g: T.Object3D, text: string, p: Point, w: number, h: number, bg: string, fg: string) {
  const tex = canvasTexture(512, 128, c => { c.fillStyle = bg; c.fillRect(0, 0, 512, 128); c.fillStyle = fg; c.font = 'bold 58px monospace'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(text, 256, 65, 480) })
  const pl = mesh(g, new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex }), p); pl.castShadow = false; return pl
}
function wheels(g: T.Object3D, w: number, d: number) {
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) {
    cyl(g, [x, .12, z], .016, .13, steel)
    const tire = cyl(g, [x, .052, z], .051, .034, rubber); tire.rotation.z = Math.PI / 2
    const hub = cyl(g, [x + .003, .052, z], .024, .038, darkSteel); hub.rotation.z = Math.PI / 2
  }
}

export function monitorTexture() {
  return canvasTexture(768, 448, c => {
    c.fillStyle = '#081415'; c.fillRect(0, 0, 768, 448)
    c.strokeStyle = '#172b29'; c.lineWidth = 1
    for (let i = 0; i < 768; i += 20) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 448); c.stroke() }
    for (let i = 0; i < 448; i += 20) { c.beginPath(); c.moveTo(0, i); c.lineTo(768, i); c.stroke() }
    c.fillStyle = '#c8d4ce'; c.font = '17px monospace'; c.fillText('THEATRE    /    MIKA    /    PATIENT 001', 20, 27)
    for (let row = 0; row < 3; row++) {
      const y = 108 + row * 133, color = ['#70e5b2', '#86d5e3', '#e7c57b'][row]
      c.strokeStyle = color; c.lineWidth = 3; c.beginPath()
      for (let x = 16; x < 605; x++) {
        const p = x % 100; let a = 0
        if (row === 0) a = p < 5 ? p * 1.4 : p < 11 ? (11 - p) * 1.1 : p > 32 && p < 39 ? -(p - 32) * 2.2 : p >= 39 && p < 43 ? -15 + (p - 39) * 18 : p >= 43 && p < 48 ? 57 - (p - 43) * 13.7 : p >= 48 && p < 57 ? -10 + (p - 48) : p > 66 && p < 87 ? Math.sin((p - 66) / 21 * Math.PI) * 9 : .8 * Math.sin(x)
        else a = row === 1 ? Math.max(0, Math.sin(x * .054)) ** 2 * 30 : Math.sin(x * .044) * 14 + Math.cos(x / 9) * 4
        if (x === 16) c.moveTo(x, y - a); else c.lineTo(x, y - a)
      }
      c.stroke(); c.fillStyle = color; c.font = 'bold 54px monospace'; c.fillText(['72', '99', '120'][row], 623, y + 9)
      c.font = '16px monospace'; c.fillText(['ECG   II', 'SpO2   %', 'NIBP   mmHg'][row], 20, y - 54)
    }
  })
}

export function makeTool(id: ToolId) {
  if (id === 'hand') { const hand = makeGlove(); hand.userData.pick = { kind: 'tool', id }; return hand }
  const g = new T.Group(); g.name = `tool-${id}`
  if (id === 'scalpel') {
    box(g, [0, 0, -.037], [.019, .006, .14], steel, .003)
    for (let i = 0; i < 18; i++) box(g, [0, .0032, -.09 + i * .005], [.017, .001, .0016], darkSteel)
    const shape = new T.Shape(); shape.moveTo(-.009, 0); shape.lineTo(.009, 0); shape.lineTo(.009, .051); shape.quadraticCurveTo(.006, .068, -.008, .081); shape.closePath()
    const b = mesh(g, new T.ExtrudeGeometry(shape, { depth: .0018, bevelEnabled: false }), steel, [0, .002, .026]); b.rotation.x = Math.PI / 2
  } else if (id === 'tweezers') {
    for (const side of [-1, 1]) { tube(g, [[0, 0, -.088], [side * .007, .003, -.065], [side * .012, .002, .02], [side * .006, .002, .088]], .0031, steel)
      for (let i = 0; i < 13; i++) box(g, [side * .01, .004, -.045 + i * .0035], [.0055, .0018, .0013], darkSteel) }
  } else if (id === 'clamp') {
    for (const s of [-1, 1]) {
      const r = ring(g, [s * .022, 0, -.078], .015, .0025, steel); r.rotation.x = Math.PI / 2
      tube(g, [[s * .018, 0, -.065], [s * .013, .001, -.027], [0, .002, .014], [-s * .0045, .003, .076], [-s * .003, .006, .09]], .0027, steel)
    } cyl(g, [0, .004, .013], .0045, .004, darkSteel)
  } else if (id === 'needle') {
    mesh(g, new T.TorusGeometry(.028, .0016, 8, 42, Math.PI * 1.48), steel, [0, .004, 0]).rotation.x = Math.PI / 2
    tube(g, [[.028, 0, 0], [.044, .004, -.026], [.067, .002, .006], [.058, .003, .062], [.021, 0, .091]], .0008, blue)
  } else if (id === 'bandage') {
    const roll = cyl(g, [0, .029, 0], .029, .069, ivory, 34); roll.rotation.z = Math.PI / 2
    for (let i = 0; i < 7; i++) { const r = ring(g, [.035, .029, 0], .006 + i * .0033, .0009, pale); r.rotation.y = Math.PI / 2 }
    const tail = box(g, [.001, .001, .035], [.068, .001, .052], ivory); tail.rotation.y = -.12
  } else {
    box(g, [0, .014, 0], [.099, .03, .158], material('#b9d9df', .1, .19), .012)
    box(g, [0, .03, .002], [.068, .001, .052], ivory)
    for (const s of [-1, 1]) { const p = cyl(g, [s * .022, .013, -.092], .004, .033, blue); p.rotation.x = Math.PI / 2 }
  }
  batchStatic(g)
  g.userData.pick = { kind: 'tool', id } satisfies Pick
  return g
}

export function batchStatic(root: T.Group) {
  root.updateMatrixWorld(true)
  const bins = new Map<T.Material, T.BufferGeometry[]>()
  root.traverse(o => {
    if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return
    let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld)
    if (g.index) { const flat = g.toNonIndexed(); g.dispose(); g = flat }
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key)
    const arr = bins.get(o.material) || []; arr.push(g); bins.set(o.material, arr)
  })
  root.traverse(o => { if (o instanceof T.Mesh) o.geometry.dispose() }); root.clear()
  bins.forEach((gs, m) => { const geo = mergeGeometries(gs); gs.forEach(g => g.dispose()); if (geo) { const o = new T.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; root.add(o) } })
}

export function buildRoom(scene: T.Scene) {
  const root = new T.Group(), interactive: T.Object3D[] = [], pickups = new Map<ToolId, T.Group>()
  scene.add(root)
  function target(geometry: T.BufferGeometry, position: Point, pick: Pick) {
    const o = mesh(scene, geometry, new T.MeshBasicMaterial({ visible: false }), position); o.userData.pick = pick; interactive.push(o); return o
  }
  const tiles = canvasTexture(512, 512, c => {
    c.fillStyle = '#778b91'; c.fillRect(0, 0, 512, 512)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) { const v = (x + y) % 3 * 3; c.fillStyle = `rgb(${113 + v},${136 + v},${146 + v})`; c.fillRect(x * 256 + 1, y * 128 + 1, 254, 126); c.strokeStyle = '#9aadb1'; c.strokeRect(x * 256 + 2, y * 128 + 2, 252, 124) }
  }); tiles.wrapS = tiles.wrapT = T.RepeatWrapping; tiles.repeat.set(3, 2)
  const wall = new T.MeshStandardMaterial({ map: tiles, roughness: .53, metalness: .16 })
  const floorMat = material('#52666b', .23, .34)
  box(root, [0, -.055, 0], [8.4, .1, 8.4], floorMat)
  box(root, [0, 1.6, -3.3], [7.6, 3.2, .08], wall)
  box(root, [-3.8, 1.6, 0], [.08, 3.2, 6.7], wall)
  box(root, [3.8, 1.6, 0], [.08, 3.2, 6.7], wall)
  box(root, [0, 1.6, 3.35], [7.6, 3.2, .08], wall)
  box(root, [0, 3.23, 0], [7.6, .08, 6.7], pale)
  for (let i = -7; i <= 7; i++) { box(root, [i * .55, .0006, 0], [.002, .001, 7.2], darkSteel); box(root, [0, .0006, i * .55], [7.6, .001, .002], darkSteel) }
  for (const z of [-3.22, 3.27]) { box(root, [0, .09, z], [7.53, .18, .025], darkSteel); box(root, [0, 1.09, z], [7.53, .045, .043], steel) }
  for (const x of [-3.72, 3.72]) box(root, [x, .09, 0], [.025, .18, 6.5], darkSteel)
  for (const x of [-2.7, -.8, 1.1, 2.9]) {
    box(root, [x, 3.167, -.7], [1.2, .04, .39], darkSteel)
    box(root, [x, 3.139, -.7], [1.14, .012, .33], white)
  }
  // Cabinets, instrument storage, gas outlets, and a closed clinical door.
  for (let i = 0; i < 5; i++) {
    const x = -3.1 + i * .81
    box(root, [x, .46, -2.95], [.79, .87, .51], pale, .014)
    for (let y = 0; y < 3; y++) { box(root, [x, .21 + y * .25, -2.683], [.747, .23, .02], material(y === 0 ? '#9eafaf' : '#b2bcba'), .006); box(root, [x, .27 + y * .25, -2.661], [.24, .017, .029], darkSteel, .005) }
    box(root, [x, .922, -2.91], [.81, .058, .65], steel, .006)
    for (let j = 0; j < 2; j++) { const q = cyl(root, [x - .19 + j * .16, 1.025, -2.96], .035 + .01 * j, .15, j ? blue : ivory); cyl(root, [q.position.x, 1.115, -2.96], .031, .023, darkSteel) }
  }
  box(root, [-1.4, 1.81, -3.08], [4.2, .10, .28], darkSteel, .008)
  box(root, [-1.4, 1.749, -3.05], [4.12, .016, .19], warm)
  for (let i = 0; i < 4; i++) {
    const x = -2.89 + i * .85
    box(root, [x, 2.12, -3.02], [.82, .53, .30], pale, .01)
    box(root, [x, 2.12, -2.858], [.72, .43, .02], material('#6c8a96', .3, .18), .006)
    box(root, [x + .32, 2.1, -2.836], [.012, .12, .014], steel)
  }
  box(root, [2.9, 1.07, -3.25], [1.1, 2.14, .09], darkSteel)
  box(root, [2.9, 1.06, -3.19], [1.02, 2.06, .06], material('#859b9a', .2, .5))
  box(root, [2.9, 1.49, -3.15], [.34, .51, .02], dark, .03)
  box(root, [2.9, 1.49, -3.136], [.302, .472, .009], material('#415e68', .35, .14), .024)
  box(root, [2.57, 1.01, -3.11], [.17, .023, .055], steel, .007)
  label(root, 'O R   /   0 1', [2.9, 2.35, -3.23], 1.05, .22, '#202e34', '#c5d7d5')
  label(root, 'SURGICAL  THEATRE', [-.8, 1.51, -3.24], 1.7, .14, '#7c9298', '#d5e1dc')
  for (let i = 0; i < 7; i++) { const x = -2.4 + i * .22; box(root, [x, 1.27, -3.20], [.19, .12, .03], ivory); const s = cyl(root, [x, 1.27, -3.17], .027, .026, i % 3 ? blue : amber); s.rotation.x = Math.PI / 2 }
  // Pedestal, segmented cushions and articulated arm boards.
  box(root, [0, .095, 0], [.50, .14, 1.05], pale, .05)
  box(root, [0, .27, .04], [.32, .27, .49], darkSteel, .022)
  for (let i = 0; i < 4; i++) box(root, [0, .40 + i * .077, .04], [.30 - i * .025, .11, .47 - i * .032], i % 2 ? steel : pale, .012)
  box(root, [0, .735, 0], [.47, .15, 1.84], darkSteel, .028)
  box(root, [0, .817, 0], [.73, .075, 2.14], steel, .026)
  for (const [z, len] of [[-.79, .49], [-.13, .76], [.57, .64], [.99, .17]]) box(root, [0, .881, z], [.704, .079, len], teal, .029)
  for (const sign of [-1, 1]) {
    box(root, [sign * .366, .799, -.01], [.024, .04, 1.75], steel, .006)
    box(root, [sign * .444, .896, -.145], [.205, .045, .69], teal, .022)
    rod(root, [sign * .28, .777, -.31], [sign * .49, .855, -.24], .017, steel)
    for (const z of [-.79, -.13, .58]) { const k = cyl(root, [sign * .383, .79, z], .034, .028, rubber); k.rotation.z = Math.PI / 2 }
  }
  const pillow = sphere(root, [0, .953, -.708], [.267, .064, .202], material('#849ba1', .02, .93)); pillow.rotation.z = -.047
  // Instrument cart with real selectable objects.
  const cart = new T.Group(); cart.position.set(.98, 0, .2); root.add(cart)
  wheels(cart, .52, .80)
  for (const x of [-.26, .26]) for (const z of [-.40, .40]) cyl(cart, [x, .498, z], .012, .82, steel)
  box(cart, [0, .32, 0], [.57, .022, .86], darkSteel, .013)
  box(cart, [0, .92, 0], [.61, .035, .91], steel, .018)
  box(cart, [0, .941, 0], [.55, .008, .85], material('#60747b', .55, .3), .006)
  for (const x of [-.294, .294]) box(cart, [x, .951, 0], [.012, .043, .884], steel, .005)
  for (const z of [-.443, .443]) box(cart, [0, .951, z], [.60, .043, .012], steel, .004)
  tube(cart, [[-.26, .92, .41], [-.26, 1.024, .45], [.26, 1.024, .45], [.26, .92, .41]], .012, steel)
  const ids: ToolId[] = ['scalpel', 'tweezers', 'clamp', 'needle', 'bandage', 'iv', 'hand']
  ids.forEach((id, i) => {
    const tg = makeTool(id); tg.position.set(id === 'hand' ? .97 : .84 + (i % 2) * .245, .952, id === 'hand' ? .352 : -.09 + Math.floor(i / 2) * .28); tg.rotation.y = .16; scene.add(tg); pickups.set(id, tg)
    const o = mesh(tg, new T.BoxGeometry(.13, .068, .218), new T.MeshBasicMaterial({ visible: false }), [0, .014, 0]); o.userData.pick = { kind: 'tool', id }; interactive.push(o)
  })
  const tower = new T.Group(); tower.position.set(-.72, 0, -.99); tower.rotation.y = 1.03; root.add(tower)
  wheels(tower, .43, .40); box(tower, [0, .22, 0], [.55, .094, .53], pale, .026)
  box(tower, [0, .61, -.02], [.45, .72, .38], pale, .024)
  for (let i = 0; i < 3; i++) { box(tower, [0, .42 + i * .18, .179], [.405, .13, .015], darkSteel, .008); box(tower, [-.026, .46 + i * .18, .195], [.21, .013, .025], steel) }
  box(tower, [0, 1.011, 0], [.57, .082, .50], pale, .02)
  box(tower, [0, 1.17, -.03], [.40, .22, .36], ivory, .021)
  box(tower, [-.06, 1.17, .16], [.206, .115, .011], dark)
  for (let i = 0; i < 3; i++) { const k = cyl(tower, [.076 + i * .036, 1.17, .172], .012, .014, steel); k.rotation.x = Math.PI / 2 }
  for (const x of [-.246, .246]) { cyl(tower, [x, .73, .15], .042, .33, material('#a6bfbd', .36, .22)); cyl(tower, [x, .92, .15], .039, .039, blue) }
  cyl(tower, [0, 1.37, -.025], .042, .26, darkSteel)
  box(tower, [0, 1.615, -.024], [.58, .397, .088], pale, .024)
  box(tower, [0, 1.62, .027], [.538, .352, .023], rubber, .012)
  mesh(tower, new T.PlaneGeometry(.506, .31), new T.MeshBasicMaterial({ map: monitorTexture() }), [0, 1.628, .041])
  sphere(tower, [.203, 1.454, .037], [.006, .006, .004], mint)
  target(new T.BoxGeometry(.64, .46, .15), [-.72, 1.61, -1], { kind: 'zone', id: 'monitor' })
  tube(root, [[-.73, 1.11, -.79], [-.68, .38, -.62], [-.42, .28, -.55], [-.40, .84, -.51], [-.24, 1.01, -.50]], .006, rubber)
  tube(root, [[-.66, 1.02, -.77], [-.48, .74, -.67], [-.39, .78, -.86], [-.27, .96, -.78]], .016, material('#77999e', .17, .51))
  // IV stand, visible fluid, controller, line, and a suspended five-lens light.
  const stand = new T.Group(); stand.position.set(.53, 0, -1.23); root.add(stand)
  cyl(stand, [0, .99, 0], .014, 1.88, steel); cyl(stand, [0, .49, 0], .023, .80, pale)
  for (let i = 0; i < 5; i++) { const a = i * 2 * Math.PI / 5; rod(stand, [0, .12, 0], [Math.sin(a) * .22, .059, Math.cos(a) * .22], .017, darkSteel); sphere(stand, [Math.sin(a) * .22, .035, Math.cos(a) * .22], [.035, .035, .024], rubber) }
  tube(stand, [[-.13, 1.86, 0], [-.14, 1.943, 0], [0, 1.951, 0], [.14, 1.943, 0], [.135, 1.875, 0]], .006, steel)
  cyl(stand, [.132, 1.626, 0], .008, .018, pale)
  box(stand, [0, 1.22, .009], [.144, .19, .105], ivory, .015); box(stand, [0, 1.241, .068], [.107, .080, .013], dark)
  tube(stand, [[.131, 1.55, 0], [.142, 1.11, .03], [.05, .69, .19], [-.18, .73, .50], [-.32, .96, .77]], .003, pale)
  target(new T.BoxGeometry(.25, .85, .16), [.60, 1.5, -1.22], { kind: 'zone', id: 'iv' })
  cyl(root, [0, 3.1, -.7], .14, .15, pale); cyl(root, [0, 2.79, -.7], .05, .58, steel)
  rod(root, [0, 2.6, -.7], [-.67, 2.6, -.39], .036, pale); sphere(root, [-.67, 2.59, -.39], [.077, .077, .077], pale)
  rod(root, [-.67, 2.58, -.39], [-.78, 2.32, -.13], .032, pale)
  const lamp = new T.Group(); lamp.position.set(-.78, 2.25, -.1); lamp.rotation.z = .45; lamp.rotation.x = -.13; root.add(lamp)
  cyl(lamp, [0, 0, 0], .35, .095, pale, 60); cyl(lamp, [0, -.052, 0], .329, .02, darkSteel, 60)
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; const x = .201 * Math.cos(a), z = .201 * Math.sin(a); cyl(lamp, [x, -.068, z], .091, .024, steel, 28); cyl(lamp, [x, -.085, z], .079, .011, warm, 28); const r = ring(lamp, [x, -.092, z], .059, .002, ivory); r.rotation.x = Math.PI / 2; sphere(lamp, [x, -.091, z], [.039, .009, .039], white) }
  cyl(lamp, [0, -.13, 0], .032, .16, pale)
  batchStatic(root)
  return { interactive, pickups }
}

export function makeDrape() {
  const cols = 56, rows = 80, p: number[] = [], indices: number[] = [], uv: number[] = []
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, t = j / rows, x = (u - .5) * .91, z = -.504 + t * 1.58
    const radius = .188 + .064 * Math.exp(-((t - .40) ** 2) / .028) + .037 * Math.exp(-((t - .09) ** 2) / .012)
    const body = (1 - Math.min(1, (Math.abs(x) / radius) ** 1.6)) ** .62
    const height = .168 + .084 * Math.exp(-((t - .09) ** 2) / .021) + .052 * Math.exp(-((t - .37) ** 2) / .035) + .114 * Math.exp(-((z - .81) ** 2) / .012)
    const folds = .006 * Math.sin(x * 38 + t * 9) + .005 * Math.cos(t * 29 + x * 13) + .003 * Math.sin(t * 82 + x * 19) * (1 - t)
    const overhang = Math.max(0, (Math.abs(x) - .34) / .115)
    p.push(x + .004 * Math.sin(t * 26) * overhang, .956 + body * height + folds - overhang * .247 - .019 * t ** 3, z + .006 * Math.sin(u * 20 + t * 3))
    uv.push(u, t * 2.2)
    if (i < cols && j < rows) { const a = j * (cols + 1) + i, b = a + cols + 1; indices.push(a, b, a + 1, a + 1, b, b + 1) }
  }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals()
  const tex = canvasTexture(256, 256, c => { c.fillStyle = '#1e4c5b'; c.fillRect(0, 0, 256, 256); for (let i = 0; i < 256; i += 2) { c.fillStyle = '#2c586188'; c.fillRect(0, i, 256, 1); c.fillStyle = '#58747c44'; c.fillRect(i, 0, 1, 256) } }); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(5, 5)
  const cloth = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: .94, side: T.DoubleSide })); cloth.castShadow = true; cloth.receiveShadow = true; cloth.name = 'Sterile surgical drape'; return cloth
}