import { chromium, devices } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] })
const passed = [], errors = [], gaps = []
const pass = message => { passed.push(message); console.log('PASS', message) }
const btn = (p, name) => p.getByRole('button', { name, exact: true })
async function ready(p) {
  p.setDefaultTimeout(20000); p.on('pageerror', e => errors.push(e.message))
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForFunction(() => !!window.__theatre?.rig)
  await p.evaluate(() => window.__theatre.renderer.setPixelRatio(.72))
}
async function scenario(p, n, touch = false) {
  await p.locator('.head-actions .btn').click(); await p.locator('.scenario-option').nth(n).click(); await btn(p, 'Открыть сценарий').click()
  await (touch ? p.locator('.mobile-start').tap() : p.locator('.start-button').click()); await p.waitForTimeout(120)
  await p.waitForFunction(() => !window.__theatre.focusTween)
}
async function point(p, kind, arg = 0) {
  return p.evaluate(({ kind, arg }) => {
    const e = window.__theatre, f = e.field, b = e.host.getBoundingClientRect()
    let v = kind === 'marker' ? f.markers[arg].position.clone() : kind === 'stone' ? f.fragment.position.clone() : kind === 'surface' ? f.center.clone() : kind === 'line' ? f.strokeEnds[arg].clone() : e.zonePosition(kind)
    v.project(e.camera); const x = b.left + (v.x + 1) * b.width / 2, y = b.top + (1 - v.y) * b.height / 2
    return { x, y, element: document.elementFromPoint(x, y)?.className, inView: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }
  }, { kind, arg })
}
async function click(p, kind, arg = 0, touch = false) {
  await p.waitForFunction(() => !window.__theatre.focusTween)
  await p.locator('.scene-view').scrollIntoViewIfNeeded()
  const q = await point(p, kind, arg)
  assert.ok(q.inView, 'Target outside camera: ' + JSON.stringify(q)); assert.equal(q.element, 'theatre-canvas', 'Target must receive a real canvas interaction: ' + JSON.stringify(q))
  if (touch) await p.touchscreen.tap(q.x, q.y); else await p.mouse.click(q.x, q.y)
  await p.waitForTimeout(245)
}
async function expectStep(p, value) { assert.equal(await p.evaluate(() => window.__theatre.procedure.progress), value) }
async function take(p, name, touch = false) {
  const t = btn(p, 'Выбрать: ' + name)
  if (await t.getAttribute('aria-pressed') !== 'true') await (touch ? t.tap() : t.click())
}
async function settle(p) { await p.waitForTimeout(120); await p.waitForFunction(() => !window.__theatre.focusTween) }
async function gap(p, name) {
  const g = await p.evaluate(() => {
    const e = window.__theatre, f = e.field, attr = f.surface.geometry.attributes.position, v = e.camera.position.clone(), a = v.clone(), b = v.clone(), c = v.clone(), pt = v.clone()
    let max = 0
    for (const [i, s] of f.samples.entries()) {
      const pos = (index, out) => s.mesh.getVertexPosition(index, out).applyMatrix4(s.mesh.matrixWorld)
      pt.copy(pos(s.a, a)).multiplyScalar(s.bary.x).addScaledVector(pos(s.b, b), s.bary.y).addScaledVector(pos(s.c, c), s.bary.z)
      max = Math.max(max, pt.distanceTo(v.fromBufferAttribute(attr, i)))
    }
    return { offsetMm: max * 1000, boundVertices: f.samples.length, surfaces: [...new Set(f.samples.map(s => s.mesh.name))] }
  })
  assert.equal(g.boundVertices, 77); assert.ok(g.offsetMm <= .37, 'Field floats above its mesh: ' + g.offsetMm); gaps.push({ name, ...g })
}
try {
  const p = await browser.newPage({ viewport: { width: 1366, height: 864 }, deviceScaleFactor: 1 }); await ready(p)
  await scenario(p, 0); await click(p, 'monitor'); await take(p, 'Шовная игла'); await settle(p)
  await gap(p, 'forearm with drape'); await click(p, 'marker', 1); assert.equal(await p.evaluate(() => window.__theatre.procedure.stitches), 0)
  await click(p, 'marker', 0); await click(p, 'marker', 0); assert.equal(await p.evaluate(() => window.__theatre.procedure.stitches), 1)
  await btn(p, 'Снять покрывало').click(); await p.waitForTimeout(130); await gap(p, 'uncovered skinned forearm')
  await click(p, 'marker', 1); await click(p, 'marker', 2); await expectStep(p, 2)
  await take(p, 'Бинт'); await click(p, 'surface'); assert.ok(await p.getByRole('heading', { name: 'Операция завершена' }).isVisible()); await expectStep(p, 3)
  await gap(p, 'conforming final dressing'); assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('theatre.runs.v1')).length), 1)
  pass('First case entirely through the canvas: three ordered pairs, no duplicate credit, dressing, exactly one result')
  await btn(p, 'Закрыть окно').click(); await scenario(p, 1); await click(p, 'monitor'); await take(p, 'Зажим'); await click(p, 'surface'); await expectStep(p, 2)
  await gap(p, 'fragment field on cloth'); await take(p, 'Пинцет'); await click(p, 'stone'); await expectStep(p, 3)
  await p.waitForFunction(() => window.__theatre.field.fragment.position.distanceTo(window.__theatre.field.tray) < .001, null, { timeout: 15000 })
  assert.ok(await p.locator('.specimen-receipt').isVisible()); await take(p, 'Бинт')
  // The tray is deliberately a distinct inspection target, not a second wound.
  await p.evaluate(() => { const e = window.__theatre; e.focusTween = null; e.orbit.target.copy(e.field.tray); e.camera.position.copy(e.field.tray).add(e.camera.position.clone().set(-.2,.38,.18)); e.orbit.update() })
  await click(p, 'stone'); await expectStep(p, 3); assert.match(await p.locator('.toast').innerText(), /Фрагмент уже в чаше/)
  await btn(p, 'Показать цель').click(); await settle(p); await click(p, 'surface'); await expectStep(p, 4)
  assert.ok(await p.getByRole('heading', { name: 'Операция завершена' }).isVisible()); await btn(p, 'Закрыть окно').click()
  pass('Reproduction fixed: extraction to the cup, helpful tray click, bandage on the original site, 4/4 report')
  await scenario(p, 2); await take(p, 'Капельница'); assert.match(await p.locator('.iv-readout').innerText(), /Пакет не подключён/)
  assert.equal(await p.evaluate(() => window.__theatre.station.bag.visible), false)
  await click(p, 'iv'); await expectStep(p, 1); assert.match(await p.locator('.iv-readout').innerText(), /Подача включена/)
  assert.ok(await p.evaluate(() => window.__theatre.station.drop.visible && window.__theatre.station.bag.visible && window.__theatre.infusion))
  await p.locator('.start-button').click(); const sec = await p.evaluate(() => window.__theatre.station.seconds); await p.waitForTimeout(400); assert.equal(await p.evaluate(() => window.__theatre.station.seconds), sec); await p.locator('.start-button').click()
  await click(p, 'monitor'); await take(p, 'Скальпель'); await settle(p)
  const a = await point(p, 'line', 0), b = await point(p, 'line', 1)
  await p.mouse.move(a.x,a.y); await p.mouse.down(); await p.mouse.move(a.x+(b.x-a.x)*.22,a.y+(b.y-a.y)*.22,{steps:4}); await p.mouse.up(); await expectStep(p,2)
  await p.mouse.move(a.x,a.y); await p.mouse.down(); await p.mouse.move(b.x,b.y,{steps:9}); await p.mouse.up(); await p.waitForTimeout(250); await expectStep(p,3)
  await take(p,'Пинцет'); await click(p,'stone'); await take(p,'Шовная игла'); for(let i=0;i<3;i++) await click(p,'marker',i)
  await expectStep(p,5); await take(p,'Бинт'); await click(p,'surface'); await expectStep(p,6); assert.ok(await p.locator('.result-checks').isVisible()); await btn(p,'Закрыть окно').click()
  pass('Third case: visible packet mounting, flow and pause, guided stroke, extraction, three pairs, final report')
  await scenario(p,3); await take(p,'Скальпель'); await p.locator('.view-switch').click(); await p.locator('.drop-menu').getByRole('button',{name:'Свободная камера',exact:true}).click()
  await p.evaluate(()=>window.__theatre.focus('pad')); await settle(p); await click(p,'surface'); await take(p,'Пинцет'); await click(p,'stone'); await take(p,'Бинт'); await click(p,'surface')
  assert.ok(await p.locator('.practice-report').isVisible()); assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('theatre.runs.v1')).length),3)
  await btn(p,'Новое упражнение').click(); assert.equal(await p.evaluate(()=>window.__theatre.procedure.dressed),false)
  pass('Free exercise has a clear finish and reset, without a fictitious scored operation')
  await p.close()
  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1}), m=await ctx.newPage();await ready(m)
  await scenario(m,1,true); await click(m,'monitor',0,true); await take(m,'Зажим',true); await click(m,'surface',0,true); await take(m,'Пинцет',true);await click(m,'stone',0,true);await take(m,'Бинт',true);await click(m,'surface',0,true)
  assert.ok(await m.getByRole('heading',{name:'Операция завершена'}).isVisible());assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);await ctx.close()
  pass('Touch-only fragment case: visible targets and real canvas taps through to completion')
  assert.deepEqual(errors,[]);await fs.writeFile('artifacts/theatre-operations-v13.json',JSON.stringify({passed,geometry:gaps,errors},null,2)); console.log('Surface samples:',JSON.stringify(gaps));
} finally {await browser.close()}