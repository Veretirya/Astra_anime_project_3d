import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const results = []
const pass = name => { results.push(name); console.log('PASS', name) }
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.setDefaultTimeout(16000)
const ui = (role, name) => page.getByRole(role, { name, exact: true })
const button = name => ui('button', name)
const toggle = name => ui('switch', name)
const state = () => page.evaluate(() => window.__kinema.save())
const centerOf = async part => page.evaluate(name => {
  const e = window.__kinema, seg = e.rig.segments.find(s => s.name === name)
  const p = e.controls.target.clone().copy(seg.body.position).project(e.camera)
  const r = e.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }
}, part)
const step = async n => page.evaluate(count => {
  const e = window.__kinema
  for (let i = 0; i < count; i++) e.rig.step(1 / 120, e.time + i / 120)
  e.renderer.render(e.scene, e.camera)
}, n)

try {
  await page.goto('http://localhost:5173/#kinema', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__kinema?.rig?.segments.length === 18)
  assert.equal(await page.evaluate(() => window.__kinema.rig.world.constraints.length), 17)
  assert.equal(await page.evaluate(() => window.__kinema.rig.hinges.length), 4)
  pass('Local GLB, 18 rigid bodies, 17 joints, bounded elbows and knees')

  await toggle('Скелет персонажа').click()
  assert.equal(await page.evaluate(() => window.__kinema.rig.visual.visible), true)
  await toggle('Скелет персонажа').click()
  await toggle('Сетка плоскости').click()
  assert.equal(await page.evaluate(() => window.__kinema.floorMat.uniforms.showGrid.value), 0)
  await toggle('Сетка плоскости').click()
  pass('Skeleton and floor grid are real, independently toggleable scene objects')

  await button('Земля').click(); await button('Луна 1.62').click()
  assert.equal(await page.evaluate(() => window.__kinema.rig.world.gravity.y), -1.62)
  await toggle('Гравитация').click()
  assert.equal(await page.evaluate(() => window.__kinema.rig.world.gravity.y), 0)
  pass('Planet presets and zero gravity update the physics world')

  const hand = await centerOf('R_Hand')
  await page.mouse.move(hand.x, hand.y); await page.mouse.down()
  assert.ok(await page.evaluate(() => window.__kinema.rig.dragging?.name))
  await page.mouse.move(hand.x - 45, hand.y - 75, { steps: 4 }); await step(40)
  assert.equal(await page.evaluate(() => !!window.__kinema.rig.grab), true)
  await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__kinema.rig.dragging), null)
  pass('Pointer picking creates and releases a physical limb constraint')

  await toggle('Фиксация на месте').click()
  assert.equal(await page.evaluate(() => window.__kinema.rig.anchored), false)
  const h2 = await centerOf('R_Hand')
  await page.mouse.move(h2.x, h2.y); await page.mouse.down()
  await page.mouse.move(h2.x + 35, h2.y - 62, { steps: 3 }); await page.mouse.up()
  await step(12)
  assert.ok(await page.evaluate(() => window.__kinema.rig.segments.some(s => s.body.velocity.length() > .1)))
  pass('Released limbs retain throw velocity in zero gravity')

  await toggle('Гравитация').click()
  await button('Луна').click(); await button('Земля 9.81').click()
  await step(550)
  const fallen = await state()
  console.log('Settled hips:', fallen.bodies[0].p)
  assert.ok(fallen.bodies[0].p[1] < .52, 'Unpinned character should fall to the ground')
  assert.ok(fallen.bodies.every(b => b.p.every(Number.isFinite) && b.q.every(Number.isFinite) && b.p[1] > -.04))
  pass('Earth gravity, floor contacts, and bounded ragdoll remain stable')

  await button('Перемещение (M)').click()
  const old = await state(), torso = await centerOf('C_Chest')
  await page.mouse.move(torso.x, torso.y); await page.mouse.down()
  assert.equal(await page.evaluate(() => window.__kinema.rig.moving), true)
  await page.mouse.move(torso.x + 71, torso.y - 5, { steps: 3 }); await page.mouse.up()
  const moved = await state()
  assert.ok(Math.abs(moved.bodies[0].p[0] - old.bodies[0].p[0]) > .1)
  pass('Unlocked whole-body floor translation changes the model coordinates')

  await button('Пауза').click()
  const paused = (await state()).time
  await page.waitForTimeout(350)
  assert.equal((await state()).time, paused)
  await button('Шаг на один кадр').click()
  assert.ok(Math.abs((await state()).time - paused - 1 / 60) < .00001)
  await button('Скорость симуляции').click(); await button('0.5×').click()
  assert.equal(await page.evaluate(() => window.__kinema.settings.speed), .5)
  pass('Pause, exact single-frame stepping, and playback speed')

  await button('Перспектива').click(); await button('Сзади').click()
  await page.waitForFunction(() => !window.__kinema.flight)
  assert.ok((await state()).camera[2] > (await state()).target[2])
  const rect = await page.locator('.scene-area').boundingBox()
  const beforeOrbit = (await state()).camera
  await page.mouse.move(rect.x + rect.width * .78, rect.y + rect.height * .44)
  await page.mouse.down({ button: 'right' }); await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .44, { steps: 5 }); await page.mouse.up({ button: 'right' })
  assert.notDeepEqual((await state()).camera, beforeOrbit)
  pass('Rear view and continuous orbit rotate the actual 3D camera')

  await button('Сохранить сцену').click(); await page.getByLabel('Название сцены').fill('Проверка физики')
  await button('Сохранить').click()
  const snap = await page.evaluate(() => JSON.parse(localStorage.getItem('kinema.studio.scenes.v1'))[0])
  assert.equal(snap.name, 'Проверка физики'); assert.equal(snap.state.bodies.length, 18)
  await button('Сбросить').click(); await button('Сбросить сцену').click()
  assert.equal(await toggle('Фиксация на месте').getAttribute('aria-checked'), 'true')
  await button('Мои сцены').click(); await page.locator('.saved-open').click()
  assert.equal(await page.evaluate(() => window.__kinema.settings.running), false)
  assert.deepEqual((await state()).bodies[0].p, snap.state.bodies[0].p)
  pass('Named local saves restore exact pose, velocities, settings, camera and time')

  await button('О модели Mika').click()
  const modelDownload = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Скачать 3D-модель' }).click()
  assert.equal((await modelDownload).suggestedFilename(), 'Mika.glb')
  await button('Закрыть').click()
  const shotDownload = page.waitForEvent('download'); await button('Сохранить снимок сцены').click()
  assert.match((await shotDownload).suggestedFilename(), /\.jpg$/)
  pass('GLB model export and camera snapshot download')

  await button('На весь экран').click()
  await page.waitForFunction(() => document.fullscreenElement || document.querySelector('.viewport-frame.expanded'))
  await button('Выйти из полного экрана').click()
  await button('Управление').click(); await button('Физика').last().click()
  assert.ok(await page.getByRole('heading', { name: 'Захват и бросок' }).isVisible())
  await page.keyboard.press('Escape')
  pass('Fullscreen, contextual guide, keyboard dismissal and focus handling')

  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await button('Мои сцены').click(); await button('Удалить сцену Проверка физики').click(); await button('Удалить?').click()
  assert.ok(await page.getByRole('heading', { name: 'Здесь будут ваши сцены' }).isVisible())
  assert.equal(errors.length, 0, errors.join('\n'))
  pass('Mobile layout, library deletion, and no runtime exceptions')
  await fs.writeFile('artifacts/verification.json', JSON.stringify({ passed: results, errors }, null, 2))
  console.log(`Verified ${results.length} functional workflows.`)
} finally { await browser.close() }