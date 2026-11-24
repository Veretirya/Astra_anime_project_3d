import * as T from 'three'

const color = new T.MeshStandardMaterial({ color: '#89b6c7', roughness: .55, metalness: .035 })
const cuffColor = new T.MeshStandardMaterial({ color: '#6496a8', roughness: .72 })
const foldColor = new T.MeshStandardMaterial({ color: '#7ba6b6', roughness: .6 })
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
const up = v(0, 1, 0)

export function makeGlove() {
  const hand = new T.Group(); hand.name = 'Examination glove'
  const skin = (g: T.Object3D, x: number, y: number, z: number, rx: number, ry: number, rz: number, m = color) => {
    const o = new T.Mesh(new T.SphereGeometry(1, 14, 10), m); o.position.set(x, y, z); o.scale.set(rx, ry, rz); g.add(o); return o
  }
  skin(hand, 0, .021, -.004, .044, .018, .050)
  skin(hand, -.025, .018, -.011, .023, .017, .036).rotation.y = -.18
  skin(hand, 0, .02, -.055, .032, .015, .027)
  const cuff = new T.Mesh(new T.CylinderGeometry(1, 1.08, .034, 24), color)
  cuff.scale.set(.031, 1, .017); cuff.rotation.x = -Math.PI / 2; cuff.position.set(0, .02, -.078); hand.add(cuff)
  const seam = new T.Mesh(new T.TorusGeometry(1, .085, 7, 36), cuffColor); seam.scale.set(.034, .018, .012); seam.position.set(0, .02, -.096); hand.add(seam)
  const fingers: T.Group[] = []
  for (let i = 0; i < 5; i++) {
    const thumb = i === 4, g = new T.Group(), r = thumb ? .0094 : .0074 - i * .00043
    g.position.set(thumb ? -.034 : -.025 + i * .0167, .022, thumb ? -.016 : .025 - i * .0014)
    g.rotation.y = thumb ? -.72 : -.075 + i * .05
    const length = [.078, .085, .079, .066, .057][i]
    const points = [v(0, 0, 0), v(-.001, .0035, length * .43), v(-.0022, -.0005, length * .75), v(-.0034, -.012, length)]
    for (let j = 0; j < 3; j++) {
      const a = points[j], b = points[j + 1], d = b.clone().sub(a), rad = r * (1 - j * .095)
      const o = new T.Mesh(new T.CylinderGeometry(rad * .91, rad, d.length(), 12), color)
      o.position.copy(a).lerp(b, .5); o.quaternion.setFromUnitVectors(up, d.normalize()); g.add(o)
      skin(g, a.x, a.y, a.z, rad, rad * .98, rad)
      if (j) { const wrinkle = new T.Mesh(new T.TorusGeometry(rad * .96, .00058, 5, 15, Math.PI * 1.29), foldColor); wrinkle.position.copy(a); wrinkle.position.z += .001; g.add(wrinkle) }
    }
    const end = points[3]; skin(g, end.x, end.y, end.z, r * .76, r * .75, r * .84)
    hand.add(g); fingers.push(g)
  }
  hand.userData.fingers = fingers
  return hand
}

export function poseGlove(hand: T.Group, amount: number) {
  for (const [i, finger] of (hand.userData.fingers as T.Group[] || []).entries()) {
    finger.rotation.x = .06 + amount * (i === 4 ? .40 : .56 + i * .06)
  }
}