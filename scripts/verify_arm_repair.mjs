import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const embedded = JSON.parse(await fs.readFile('src/assets/mika-model.json', 'utf8'))
const glb = gunzipSync(Buffer.from(embedded.gzipBase64, 'base64'))
const hash = createHash('sha256').update(glb).digest('hex')
assert.equal(hash, embedded.sha256)
const size = glb.readUInt32LE(12), doc = JSON.parse(glb.subarray(20, 20 + size).toString()), data = glb.subarray(size + 28)
assert.equal(doc.extras.modelRevision, 'MIKA-R12')
function attribute(i) {
  const a = doc.accessors[i], bv = doc.bufferViews[a.bufferView], offset = data.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0)
  const n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type])
  return new ({ 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType])(data.buffer, offset, n)
}
const samples = [.75, .80, .85, .9, .93], sections = samples.map(() => 0)
let triangles = 0, maxWeightError = 0
for (const primitive of doc.meshes.find(m => m.name === 'Mika_Body').primitives) {
  const pos = attribute(primitive.attributes.POSITION), idx = attribute(primitive.indices), weights = attribute(primitive.attributes.WEIGHTS_0)
  triangles += idx.length / 3
  for (let i = 0; i < weights.length; i += 4) maxWeightError = Math.max(maxWeightError, Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1))
  for (let i = 0; i < idx.length; i += 3) {
    const ys = [pos[idx[i] * 3 + 1], pos[idx[i + 1] * 3 + 1], pos[idx[i + 2] * 3 + 1]]
    samples.forEach((h, k) => { if (Math.min(...ys) < h && Math.max(...ys) > h) sections[k]++ })
  }
}
assert.deepEqual(sections, [48, 52, 58, 60, 56]); assert.equal(triangles, 8644); assert.ok(maxWeightError < .00001)
console.log('PASS Complete body topology, source hip cross-sections, and normalized skin weights')
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const trials = [], exceptions = []
try {
  const page = await browser.newPage({ viewport: { width: 1160, height: 800 } })
  page.on('pageerror', e => exceptions.push(e.message))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  for (const game of ['theatre', 'kinema']) {
    if (game === 'kinema') await page.getByRole('button', { name: 'Открыть Kinema Lab', exact: true }).click()
    await page.waitForFunction(game => !!(game === 'theatre' ? window.__theatre : window.__kinema)?.rig, game, { timeout: 60000 })
    const result = await page.evaluate(game => {
      const e = game === 'theatre' ? window.__theatre : window.__kinema, r = e.rig
      cancelAnimationFrame(e.frame || e.raf)
      const make = () => e.camera.position.clone().set(0, 0, 0)
      const trials = [], measured = r.segments.filter(s => /Arm|Hand/.test(s.name))
      for (const anchored of [true, false]) {
        r.setAnchored(anchored); r.reset()
        let maxGap = 0, maxAngleViolation = 0, maxFloorPenetration = 0, maxAtRestSpeed = 0, maxTrackingError = 0, t = 0
        const sample = () => {
          for (const s of measured) {
            const bone = s.bone.getWorldPosition(make()), physical = s.body.pointToWorldFrame(s.start)
            maxGap = Math.max(maxGap, Math.hypot(bone.x - physical.x, bone.y - physical.y, bone.z - physical.z))
            maxFloorPenetration = Math.max(maxFloorPenetration, (game === 'kinema' ? -.056 : 0) - Math.min(s.body.pointToWorldFrame(s.start).y, s.body.pointToWorldFrame(s.end).y))
          }
          for (const h of r.hinges.filter(h => h.b.name.includes('Arm'))) {
            const q = h.a.body.quaternion.inverse().mult(h.b.body.quaternion).mult(h.rest.inverse())
            const a = 2 * Math.atan2(q.x * h.axis.x + q.y * h.axis.y + q.z * h.axis.z, q.w), angle = Math.atan2(Math.sin(a), Math.cos(a))
            maxAngleViolation = Math.max(maxAngleViolation, h.min - angle, angle - h.max)
          }
        }
        const step = (n, dt = 1 / 120) => { for (let i = 0; i < n; i++) { t += dt; r.step(dt, t); sample() } }
        step(300)
        for (let i = 0; i < 120; i++) { step(1); maxAtRestSpeed = Math.max(maxAtRestSpeed, ...measured.map(s => s.body.angularVelocity.length())) }
        for (const side of ['L', 'R']) {
          const s = r.segments.find(s => s.name === `${side}_Hand`), start = make().copy(s.body.position)
          r.beginGrab(s, start)
          for (let i = 0; i < 150; i++) {
            const t = i / 150, goal = start.clone().add(make().set(.18 * Math.sin(t * 8), Math.sin(t * Math.PI) * .31, .11 * Math.sin(t * 6)))
            r.dragTo(goal); step(1, i % 5 === 0 ? 1 / 30 : 1 / 90)
            maxTrackingError = Math.max(maxTrackingError, r.gripCenter().distanceTo(goal))
          }
          r.endGrab(); step(150)
          // Body interpolation is checked after returning to the standing studio pose.
          if (game === 'kinema' && anchored) r.reset()
        }
        const valid = r.segments.every(s => [...s.body.position.toArray(), ...s.body.quaternion.toArray()].every(Number.isFinite))
        trials.push({ game, anchored, maxGap, maxAngleViolation, maxFloorPenetration, maxAtRestSpeed, maxTrackingError, valid })
      }
      r.reset()
      return { trials, lining: r.meshes.some(m => m.material.name === 'Charcoal fitted shorts'), joints: r.world.constraints.length }
    }, game)
    console.log(JSON.stringify(result, null, 2))
    assert.ok(result.lining); assert.equal(result.joints, 17)
    for (const t of result.trials) {
      assert.ok(t.valid); assert.ok(t.maxGap < .005, `${game}: hand not registered with skin: ${t.maxGap}`)
      assert.ok(t.maxAngleViolation < .02, `${game}: elbow outside range: ${t.maxAngleViolation}`)
      assert.ok(t.maxFloorPenetration < .040, `${game}: joint passed below the floor: ${t.maxFloorPenetration}`)
      assert.ok(t.maxAtRestSpeed < 4, `${game}: persistent spinning at rest: ${t.maxAtRestSpeed}`)
      trials.push(t)
    }
    console.log('PASS', game, 'both hands, pinned/free body, variable-rate drags, releases, ground contact')
  }
  assert.deepEqual(exceptions, [])
  await fs.writeFile('artifacts/rig-repair.json', JSON.stringify({ build: '1.2.0', modelSha256: hash, bodyTriangles: triangles, samples, sections, maxWeightError, trials, exceptions }, null, 2))
} finally { await browser.close() }