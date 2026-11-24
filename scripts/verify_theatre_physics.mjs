import { chromium, devices } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] })
const passed = [], errors = []
const pass = x => { passed.push(x); console.log('PASS', x) }
async function ready(p) {
  p.setDefaultTimeout(20000); p.on('pageerror', e => errors.push(e.message))
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__theatre?.rig, null, { timeout: 60000 })
  await p.evaluate(() => window.__theatre.renderer.setPixelRatio(.60))
}
const button = (p, n) => p.getByRole('button', { name: n, exact: true })
const sw = (p, n) => p.getByRole('switch', { name: n, exact: true })
async function coords(p, id) {
  return p.evaluate(name => { const e = window.__theatre, b = e.host.getBoundingClientRect(), v = e.partPosition(name).project(e.camera); return { x: b.left + (v.x + 1) * b.width / 2, y: b.top + (1 - v.y) * b.height / 2 } }, id)
}
async function inspect(p, name, group, alone = false, type = 'Органы') {
  await button(p, 'Открыть карту модели').click(); const dialog = p.getByRole('dialog')
  await dialog.getByRole('button', { name: type, exact: true }).click()
  await p.getByRole('searchbox', { name: 'Найти область или орган' }).fill(name)
  await button(p, `Выбрать область: ${name}, ${group}`).click(); await button(p, alone ? 'Изолировать' : 'Показать в 3D').click()
}
async function tab(p, name) { await button(p, 'Вкладка ' + name).click() }
try {
  const p = await browser.newPage({ viewport: { width: 1366, height: 864 }, deviceScaleFactor: 1 }); await ready(p)
  await button(p, 'Снять покрывало').click()
  const cloth = await p.evaluate(() => { const e = window.__theatre; return { drape: e.cloth.visible, covered: e.covered, clothes: e.rig.meshes.filter(m => /Ivory woven|Dusty lilac|Charcoal pleated|Cocoa slouch/.test(m.material.name)).map(m => m.visible), dynamic: e.rig.segments.filter(s => s.body.type === 1).length, hand: e.rig.segments.find(s => s.name === 'R_Hand').body.mass } })
  assert.equal(cloth.drape, false); assert.equal(cloth.covered, false); assert.equal(cloth.clothes.length, 4); assert.ok(cloth.clothes.every(Boolean)); assert.equal(cloth.dynamic, 14); assert.ok(cloth.hand > 0)
  await button(p, 'Вернуть покрывало').click(); assert.equal(await p.evaluate(() => window.__theatre.cloth.visible), true)
  pass('Removable and replaceable drape, original wardrobe, relaxed dynamic limbs with a secured torso')
  await button(p, 'Все слои').click(); assert.ok(await p.evaluate(() => Object.values(window.__theatre.anatomy.groups).every(a => a.every(o => o.visible))))
  await inspect(p, 'Правая почка', 'Внутренние органы', true)
  assert.equal(await p.evaluate(() => window.__theatre.selectedPart), 'organ:Правая почка')
  assert.equal(await p.evaluate(() => [...window.__theatre.anatomy.objects.values()].flat().filter(o => o.visible).length), 1)
  await inspect(p, 'Указательный · фаланга 3', 'Левая кисть', true, 'Скелет')
  assert.equal(await p.evaluate(() => window.__theatre.selectedPart), 'bone:L_Index3')
  await button(p, 'Снять выделение').click(); await button(p, 'Кожа').click()
  pass('All-layer view, searchable selection of occluded organs and individual phalanges, isolation and clear')
  await p.locator('.start-button').click(); await p.locator('.apply-action').click(); await button(p, 'Выбрать: Шовная игла').click(); await button(p, 'Снять покрывало').click(); for (let i=0;i<3;i++) { await p.locator('.apply-action').click(); await p.waitForTimeout(250) }
  assert.ok(await p.evaluate(() => window.__theatre.field.zone === 'arm' && window.__theatre.field.samples.length === 77))
  await p.locator('.start-button').click(); const surgicalState = await p.evaluate(() => window.__theatre.capture())
  pass('Uncovered practice marks attach to the moving forearm instead of the table')
  await tab(p, 'Песочница'); assert.ok(await p.getByRole('heading', { name: 'Песочница', exact: true }).isVisible())
  assert.deepEqual(await p.evaluate(() => {const e=window.__theatre;return[e.phase,e.anchored,e.covered,e.selected,e.rig.world.gravity.y]}), ['sandbox',false,false,'hand',-9.81])
  await button(p, 'Луна').click(); assert.equal(await p.evaluate(() => window.__theatre.rig.world.gravity.y), -1.62)
  await button(p, 'Невесомость').click(); assert.equal(Math.abs(await p.evaluate(() => window.__theatre.rig.world.gravity.y)), 0)
  await p.getByRole('slider', { name: 'Сила гравитации' }).fill('4.20'); assert.equal(await p.evaluate(() => window.__theatre.rig.world.gravity.y), -4.2)
  await sw(p, 'Фиксация корпуса').click(); assert.equal(await p.evaluate(() => window.__theatre.rig.anchored), true); await sw(p, 'Фиксация корпуса').click()
  pass('Independent sandbox defaults, editable gravity, Moon and zero-G presets, real anchoring')
  await p.keyboard.press('KeyG'); await button(p, 'Земля').click(); await p.waitForTimeout(220)
  const hand = await coords(p, 'body:R_Hand'); await p.mouse.move(hand.x, hand.y); await p.mouse.down(); await p.mouse.move(hand.x + 22, hand.y - 65, { steps: 5 })
  await p.waitForFunction(() => !!window.__theatre.rig.dragging)
  await p.evaluate(() => {const e=window.__theatre;for(let i=0;i<35;i++)e.rig.step(1/120,e.elapsed+i/120)})
  assert.ok(await p.locator('.contact-readout').isVisible()); assert.equal(await p.evaluate(() => window.__theatre.rig.world.constraints.length),18)
  assert.ok(await p.evaluate(() => {const n=window.__theatre.rig.gripEffort();return Number.isFinite(n)&&n>=0&&n<=1}))
  await p.mouse.up(); assert.equal(await p.evaluate(() => window.__theatre.rig.dragging === null),true)
  pass('Gloved drag, bounded solver-force meter, and release without a frozen or lingering constraint')
  await p.locator('.physics-actions .ghost').click(); await p.locator('.return-confirm').getByRole('button', { name: 'Вернуть', exact: true }).click()
  await p.locator('.physics-transport button').click(); await p.waitForFunction(() => window.__theatre.mode === 'walk')
  await inspect(p,'Левая кисть','Руки',false,'Тело'); await p.keyboard.press('KeyG')
  assert.equal(await p.evaluate(()=>window.__theatre.mode),'walk')
  await p.waitForTimeout(160)
  const palm = await coords(p,'body:L_Hand'); await p.mouse.move(palm.x,palm.y); await p.mouse.down();
  const pointerResult = await p.evaluate(({x,y})=>{const e=window.__theatre;return{drag:e.rig.dragging?.name,mode:e.mode,phase:e.phase,tool:e.selected,handMode:e.handMode,anchored:e.anchored,coords:[x,y],element:document.elementFromPoint(x,y)?.outerHTML.slice(0,160),press:e.press,hit:e.rig.hitTest(e.ray.ray)?.segment.name,layer:e.layer,dialog:document.querySelector('[role=dialog]')?.textContent.slice(0,40),pelvis:e.rig.segments[0].body.position.toArray(),currentHand:e.partPosition('body:L_Hand').toArray(),camera:e.camera.position.toArray()}},palm)
  assert.ok(pointerResult.drag,JSON.stringify(pointerResult)); await p.mouse.move(palm.x+8,palm.y-52,{steps:3}); await p.mouse.up()
  await inspect(p,'Таз','Голова и корпус',false,'Тело'); await p.keyboard.press('KeyE'); await p.waitForFunction(()=>window.__theatre.carry)
  const before=await p.evaluate(()=>({d:window.__theatre.grabDepth,p:window.__theatre.camera.position.toArray(),aim:window.__theatre.dragAim.toArray()}))
  await p.keyboard.down('KeyW'); await p.waitForTimeout(200); await p.keyboard.up('KeyW'); await p.waitForTimeout(200); await button(p,'Приблизить удерживаемую модель').click()
  assert.ok(await p.evaluate(d=>window.__theatre.grabDepth < d,before.d)); assert.notDeepEqual(await p.evaluate(()=>window.__theatre.camera.position.toArray()),before.p)
  await p.keyboard.press('KeyE'); assert.equal(await p.evaluate(()=>window.__theatre.rig.dragging===null),true)
  assert.ok(await p.evaluate(()=>window.__theatre.held?.visible && window.__theatre.held.userData.fingers.length===5))
  pass('First-person mouse grab, hands-free carry, depth adjustment, walking, and the articulated visible glove')
  await p.locator('.physics-actions .amber').click(); const sandboxState=await p.evaluate(()=>window.__theatre.capture())
  await tab(p,'Операционная'); assert.equal(await p.evaluate(()=>window.__theatre.phase),'paused'); assert.equal(await p.locator('.progress-row .mono').innerText(),'2 / 3')
  const restore=await p.evaluate(()=>window.__theatre.capture());assert.deepEqual(restore.bodies.map(b=>b.p),surgicalState.bodies.map(b=>b.p));assert.deepEqual(restore.camera,surgicalState.camera);assert.equal(restore.covered,surgicalState.covered);assert.equal(restore.selected,'needle');assert.equal(restore.effects.mark,'arm')
  await tab(p,'Песочница'); const back=await p.evaluate(()=>window.__theatre.capture());assert.equal(back.mode,'walk'); assert.deepEqual(back.camera,sandboxState.camera);assert.deepEqual(back.bodies.map(b=>b.p),sandboxState.bodies.map(b=>b.p));assert.equal(await p.evaluate(()=>window.__theatre.phase),'paused')
  pass('Round-trip workspace switching preserves poses, camera, task, tool, clinical marks and paused state for both tabs')
  await tab(p,'Операционная');await p.locator('.start-button').click();await button(p,'Выбрать: Бинт').click();await p.locator('.apply-action').click();assert.ok(await p.getByRole('heading',{name:'Операция завершена'}).isVisible());await p.close()
  pass('Paused surgical operation can still finish after independent sandbox experiments')
  const c=await browser.newContext({...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1});const m=await c.newPage();await ready(m)
  await button(m,'Снять покрывало').tap(); await button(m,'Вкладка Песочница').tap();await m.locator('.physics-transport button').tap()
  await inspect(m,'Таз','Голова и корпус',false,'Тело');await m.locator('.grab-action').tap();await m.waitForFunction(()=>window.__theatre.carry)
  await button(m,'Вправо').tap();await button(m,'Отдалить удерживаемую модель').tap();const b=await m.locator('.scene-view').boundingBox();const x=b.x+b.width*.6,y=b.y+b.height*.4
  const touch=await c.newCDPSession(m);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+30,y:y+4}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await m.evaluate(()=>window.__theatre.carry),true)
  await button(m,'Отпустить').tap();assert.equal(await m.evaluate(()=>window.__theatre.rig.dragging===null),true)
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);await c.close()
  pass('Phone: drape toggle, sandbox navigation, touch carry, look-around while holding, release, no horizontal overflow')
  assert.deepEqual(errors,[]);await fs.writeFile('artifacts/theatre-physics-verification.json',JSON.stringify({passed,errors},null,2));console.log('Verified',passed.length,'new-feature workflows.')
} finally { await browser.close() }