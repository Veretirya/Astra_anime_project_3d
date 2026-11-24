import { chromium, devices } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] })
const report = [], errors = [], badResponses = []
const pass = name => { report.push(name); console.log('PASS', name) }
const p = await browser.newPage({ viewport: { width: 1366, height: 864 }, deviceScaleFactor: 1 })
p.setDefaultTimeout(20000)
p.on('pageerror', err => errors.push(err.message)); p.on('response', r => { if (r.status() >= 400) badResponses.push([r.status(), r.url().slice(0, 100)]) })
const btn = name => p.getByRole('button', { name, exact: true })
const close = () => btn('Закрыть окно').click()
const tool = n => btn(`Выбрать: ${n}`).click()
const use = async () => {
  const before = await p.evaluate(() => window.__theatre.procedure.progress)
  for (let i = 0; i < 4; i++) {
    await p.locator('.apply-action').click()
    if (await p.getByRole('dialog').count() || await p.evaluate(() => window.__theatre.procedure.progress) !== before) return
    await p.waitForTimeout(250)
  }
  throw new Error('The requested stage did not advance')
}
async function choose(i) {
  await p.locator('.head-actions .btn').click(); await p.locator('.scenario-option').nth(i).click(); await btn('Открыть сценарий').click()
}
async function view(name) { await p.locator('.view-switch').click(); await p.locator('.drop-menu').getByRole('button', { name, exact: true }).click() }
async function worldPoint(kind, id) {
  return p.evaluate(({ kind, id }) => {
    const e = window.__theatre, box = e.host.getBoundingClientRect()
    const o = kind === 'tool' ? e.pickups.get(id).position.clone() : kind === 'bone' ? e.camera.position.clone().copy(e.rig.segments.find(s => s.name === id).body.position) : e.zonePosition(id)
    o.project(e.camera); return { x: box.left + (o.x + 1) * box.width / 2, y: box.top + (1 - o.y) * box.height / 2 }
  }, { kind, id })
}
try {
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.__theatre?.rig, null, { timeout: 60000 })
  assert.deepEqual(await p.evaluate(() => [window.__theatre.rig.segments.length, window.__theatre.rig.world.constraints.length, window.__theatre.pickups.size]), [18, 17, 7])
  assert.equal(await p.locator('.tool-tile').count(), 7); assert.equal(await p.title(), 'THEATRE · Операционная')
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1))
  pass('Embedded original Mika, 18 rigid bodies, 17 joints, seven tools, viewport fit')
  await btn('Атлас').click(); await btn('Описание: Пинцет').click(); await btn('Взять инструмент').click()
  assert.equal(await btn('Выбрать: Пинцет').getAttribute('aria-pressed'), 'true')
  await btn('Выбрать: Зажим').hover(); await p.keyboard.press('KeyE'); assert.equal(await btn('Выбрать: Зажим').getAttribute('aria-pressed'), 'true')
  await p.keyboard.press('Digit4'); assert.equal(await btn('Выбрать: Шовная игла').getAttribute('aria-pressed'), 'true')
  await p.keyboard.press('KeyQ'); assert.equal(await p.locator('.tool-tile.selected').count(), 0)
  pass('Atlas, numeric shortcuts, contextual E pickup, and Q release')
  await btn('Осмотреть в 3D').click(); await p.waitForFunction(() => window.__theatre.mode === 'orbit')
  // Reduce test-only rasterization cost when Chromium uses its software GPU.
  await p.evaluate(() => window.__theatre.renderer.setPixelRatio(.65))
  await btn('Органы').click(); assert.equal(await p.evaluate(() => window.__theatre.layer), 'organs'); assert.ok(await p.evaluate(() => window.__theatre.anatomy.organs.length >= 8))
  await btn('Скелет').click(); assert.equal(await p.evaluate(() => window.__theatre.anatomy.groups.bones.every(g => g.visible)), true)
  await btn('Мышцы').click(); assert.equal(await p.evaluate(() => window.__theatre.anatomy.groups.muscle.every(g => g.visible)), true)
  await btn('Кожа').click(); pass('Four distinct anatomical views with bone-attached organ models')
  const pt = await worldPoint('bone', 'L_Hand'); await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x - 14, pt.y - 27, { steps: 3 })
  assert.ok(await p.evaluate(() => !!window.__theatre.rig.dragging)); await p.mouse.up()
  assert.equal(await p.evaluate(() => window.__theatre.rig.dragging === null), true)
  await p.locator('.patient-row').click(); await p.getByRole('switch', { name: 'Фиксация на столе' }).click(); await close()
  assert.equal(await p.evaluate(() => window.__theatre.rig.anchored), false)
  await p.evaluate(() => { const rig = window.__theatre.rig; for (let i = 0; i < 120; i++) rig.step(1 / 120, i / 120) })
  assert.ok(await p.evaluate(() => window.__theatre.rig.segments.every(s => [s.body.position.x, s.body.position.y, s.body.position.z].every(Number.isFinite))))
  pass('Actual pointer limb grab, release, table anchoring, and gravity contacts')
  await choose(0); await p.locator('.start-button').click(); await use(); await tool('Шовная игла'); await use(); await tool('Бинт'); await use()
  assert.ok(await p.getByRole('heading', { name: 'Операция завершена', exact: true }).isVisible())
  assert.equal(await p.evaluate(() => window.__theatre.activeBandage), true); await close()
  pass('First scenario completes with real task progress and visible dressing')
  await choose(1); await p.locator('.start-button').click(); await use(); await tool('Шовная игла')
  await p.waitForFunction(() => !window.__theatre.focusTween)
  const wrong = await worldPoint('zone', 'pad'); await p.mouse.click(wrong.x, wrong.y)
  await p.getByRole('button', { name: 'Пропустить сцену', exact: true }).click()
  await p.getByRole('heading', { name: 'Протокол прерван', exact: true }).waitFor()
  assert.ok(await p.getByRole('heading', { name: 'Протокол прерван', exact: true }).isVisible()); await btn('Свободная практика').click()
  assert.equal(await p.evaluate(() => window.__theatre.phase), 'sandbox')
  pass('Mismatched instrument fails the quest while the sandbox remains playable')
  await choose(1); await p.locator('.start-button').click(); await use(); await tool('Зажим'); await use(); await tool('Пинцет'); await use()
  assert.equal(await p.evaluate(() => window.__theatre.extracted && window.__theatre.fixedPad), true)
  await tool('Бинт'); await use(); await close()
  pass('Second scenario uses the clamp and moves the fragment onto the tray')
  await choose(2); await p.locator('.start-button').click(); await tool('Капельница'); await use(); assert.equal(await p.evaluate(() => window.__theatre.infusion), true)
  await use(); await tool('Скальпель'); await use(); assert.equal(await p.evaluate(() => window.__theatre.openedPad), true)
  await tool('Пинцет'); await use(); await tool('Шовная игла'); await use(); await tool('Бинт'); await use(); await close()
  pass('Advanced six-stage scenario, infusion controller, cassette, and completion')
  await choose(3); await p.locator('.start-button').click(); await view('От первого лица')
  const before = await p.evaluate(() => window.__theatre.camera.position.toArray()); await btn('Влево').click(); const after = await p.evaluate(() => window.__theatre.camera.position.toArray()); assert.notDeepEqual(after, before)
  await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up('KeyW'); assert.notDeepEqual(await p.evaluate(() => window.__theatre.camera.position.toArray()), after)
  await p.locator('.start-button').click(); const frozen = await p.locator('.playback>span').first().innerText(); await p.waitForTimeout(1100); assert.equal(await p.locator('.playback>span').first().innerText(), frozen)
  await p.locator('.start-button').click(); assert.equal(await p.evaluate(() => window.__theatre.phase), 'sandbox')
  pass('First-person walking, touch arrows, pause, and correct sandbox resume')
  await btn('Журнал сессии').click(); await p.locator('.dialog-tabs button').nth(1).click(); assert.equal(await p.locator('.run-list>div').count(), 4)
  const download = p.waitForEvent('download'); await btn('Скачать журнал').click(); assert.equal((await download).suggestedFilename(), 'theatre-session.json'); await close()
  await btn('Настройки').click(); await p.getByRole('switch', { name: 'Подсказки в сцене' }).click(); await btn('Готово').click(); await p.reload({ waitUntil: 'networkidle' })
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('theatre.preferences.v1')).hints), false)
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('theatre.runs.v1')).length), 4)
  pass('Local results persistence, journal export, and saved preferences')
  await p.waitForFunction(() => window.__theatre?.rig); await btn('На весь экран').click(); await p.waitForFunction(() => document.fullscreenElement || document.querySelector('.viewport.expanded')); await btn('Выйти из полного экрана').click()
  await btn('Справка').click(); await p.keyboard.press('Escape'); assert.equal(await p.getByRole('dialog').count(), 0)
  pass('Fullscreen, keyboard-accessible dialogs and guide')
  await p.close()
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  const mobile = await ctx.newPage(); mobile.on('pageerror', err => errors.push(err.message))
  await mobile.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await mobile.waitForFunction(() => window.__theatre?.rig)
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth === innerWidth))
  assert.ok((await mobile.locator('.mobile-start').boundingBox()).y < 650); await mobile.locator('.mobile-start').tap(); await mobile.locator('.apply-action').tap()
  await mobile.getByRole('button', { name: 'Выбрать: Шовная игла', exact: true }).tap(); for (let i=0;i<3;i++) { await mobile.locator('.apply-action').tap(); await mobile.waitForTimeout(250) }; await mobile.getByRole('button', { name: 'Выбрать: Бинт', exact: true }).tap(); await mobile.locator('.apply-action').tap()
  assert.ok(await mobile.getByRole('heading', { name: 'Операция завершена', exact: true }).isVisible()); await ctx.close()
  pass('Mobile touch-only completion, visible start control, and no horizontal overflow')
  assert.deepEqual(errors, []); assert.deepEqual(badResponses, []); await fs.writeFile('artifacts/theatre-verification.json', JSON.stringify({ passed: report, errors, badResponses }, null, 2))
  console.log('Verified', report.length, 'game workflows.')
} finally { await browser.close() }