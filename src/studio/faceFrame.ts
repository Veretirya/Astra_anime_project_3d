import * as T from 'three'

export type FaceFrame = {
  head: T.Object3D
  center: T.Vector3
  forward: T.Vector3
  up: T.Vector3
  width: number
  eyes: { bone: T.Bone; forward: T.Vector3 }[]
}

// Measure in the unposed avatar's anatomical frame, not in a lying patient's world axes.
export function captureFaceFrame(model: T.Group): FaceFrame {
  model.updateMatrixWorld(true)
  const head = model.getObjectByName('J_Bip_C_Head')!
  const rotation = model.getWorldQuaternion(new T.Quaternion()), inverseHead = head.getWorldQuaternion(new T.Quaternion()).invert()
  const forward = new T.Vector3(0, 0, -1).applyQuaternion(rotation), up = new T.Vector3(0, 1, 0).applyQuaternion(rotation)
  const headPoint = head.getWorldPosition(new T.Vector3()), right = forward.clone().cross(up).normalize()
  const pivots: (T.Bone | undefined)[] = [undefined, undefined]
  head.traverse(bone => {
    if (!(bone instanceof T.Bone)) return
    const name = bone.name.toLowerCase().replace(/[^a-z]/g, '').replace(/^mixamorig/, '')
    if (/^(jadjlfaceeye|jbipleye|lefteye|eyel|leye)$/.test(name)) pivots[0] = bone
    if (/^(jadjrfaceeye|jbipreye|righteye|eyer|reye)$/.test(name)) pivots[1] = bone
  })
  const center = headPoint.clone().addScaledVector(up, .068).addScaledVector(forward, .065)
  const pupils = [new T.Box3(), new T.Box3()], p = new T.Vector3()
  model.traverse(mesh => {
    if (!(mesh instanceof T.Mesh) || Array.isArray(mesh.material) || !/iris|pupil/i.test(mesh.material.name)) return
    const count = mesh.geometry.attributes.position?.count || 0
    for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 800))) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld)
      if (p.distanceToSquared(headPoint) > .10) continue
      const index = p.clone().sub(headPoint).dot(right) < 0 ? 0 : 1
      pupils[index].expandByPoint(p)
    }
  })
  let width = .235
  if (pivots[0] && pivots[1]) {
    const l = pivots[0].getWorldPosition(new T.Vector3()), r = pivots[1].getWorldPosition(new T.Vector3())
    center.copy(l).lerp(r, .5).addScaledVector(forward, .024)
  }
  if (pupils.every(box => !box.isEmpty())) {
    const left = pupils[0].getCenter(new T.Vector3()), right = pupils[1].getCenter(new T.Vector3())
    center.copy(left).lerp(right, .5); width = T.MathUtils.clamp(left.distanceTo(right) * 3.4, .195, .28)
    if (pivots[0] && pivots[1]) {
      const between = pivots[0].getWorldPosition(new T.Vector3()).lerp(pivots[1].getWorldPosition(new T.Vector3()), .5)
      const measured = center.clone().sub(between).normalize()
      if (measured.dot(forward) > .86) forward.copy(measured)
    }
  }
  up.addScaledVector(forward, -up.dot(forward)).normalize()
  return {
    head, center: head.worldToLocal(center), width,
    forward: forward.clone().applyQuaternion(inverseHead).normalize(), up: up.applyQuaternion(inverseHead).normalize(),
    eyes: pivots.filter((b): b is T.Bone => !!b).map(bone => ({ bone, forward: forward.clone().applyQuaternion(bone.getWorldQuaternion(new T.Quaternion()).invert()) })),
  }
}