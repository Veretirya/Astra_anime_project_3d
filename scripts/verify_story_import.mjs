import { chromium, devices } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] })
const passed = [], errors = [], measurements = {}, base = 'http://localhost:5173/'
const pass = s => { passed.push(s); console.log('PASS', s) }
const button = (p, n) => p.getByRole('button', { name: n, exact: true })
async function start(p) {
  p.setDefaultTimeout(45000); p.on('pageerror', e => errors.push(e.message))
  await p.goto(base, { waitUntil: 'networkidle' }); await p.waitForFunction(() => !!window.__theatre?.rig, null, { timeout: 60000 })
  await p.evaluate(() => window.__theatre.renderer.setPixelRatio(.65))
}
async function failOperation(p, walk = false) {
  await p.locator('.head-actions .btn').click(); await p.locator('.scenario-option').first().click(); await button(p, 'Открыть сценарий').click()
  await p.locator('.start-button').click(); await p.locator('.apply-action').click(); await p.waitForFunction(() => !window.__theatre.focusTween)
  if (walk) { await p.locator('.view-switch').click(); await p.locator('.drop-menu').getByRole('button', { name:'От первого лица',exact:true }).click() }
  const q = await position(p, 'arm'); await p.mouse.click(q.x,q.y)
}
async function position(p, id) {
  await p.locator('.scene-view').scrollIntoViewIfNeeded()
  await p.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))))
  return p.evaluate(id => { const e=window.__theatre, w=id==='arm'?e.zonePosition('arm'):e.partPosition('body:'+id);w.project(e.camera);const r=e.host.getBoundingClientRect();return{x:r.left+(w.x+1)*r.width/2,y:r.top+(1-w.y)*r.height/2} }, id)
}
async function uploadPanel(p) { await button(p,'Персонаж и импорт модели').click();await p.getByRole('button',{name:/Своя модель/}).click() }
const original=gunzipSync(Buffer.from(JSON.parse(await fs.readFile('src/assets/mika-model.json','utf8')).gzipBase64,'base64'))
const textLength=original.readUInt32LE(12), doc=JSON.parse(original.subarray(20,20+textLength)), bin=original.subarray(28+textLength)
const file=(name,buffer,mimeType='application/octet-stream')=>({name,mimeType,buffer:Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer)})
try {
  const p=await browser.newPage({viewport:{width:1366,height:864}}); await start(p)
  measurements.legs=await p.evaluate(()=>{
    const e=window.__theatre,r=e.rig, l=r.segments.find(s=>s.name==='L_Foot'),h=r.segments.find(s=>s.name==='R_Foot')
    const initial=Math.abs(l.body.position.x-h.body.position.x);let max=0, finite=true
    for(let i=0;i<3600;i++){r.step(i%4===0?1/60:1/120,i/120);max=Math.max(max,Math.abs(l.body.position.x-h.body.position.x));finite&&=r.segments.every(s=>s.body.position.toArray().every(Number.isFinite))}
    const before=l.body.position.clone(),point=e.camera.position.clone().copy(before);r.beginGrab(l,point);r.dragTo(point.clone().add(e.camera.position.clone().set(.18,.13,0)));for(let i=0;i<120;i++)r.step(1/120,i/120);const lifted=l.body.position.distanceTo(before);r.endGrab();for(let i=0;i<420;i++)r.step(1/120,i/120)
    const returned=Math.abs(l.body.position.x-h.body.position.x);e.setWorkspace(true);e.setAnchored(false);r.step(1/60,10);const free=!r.onOperatingTable&&r.segments.every(s=>s.body.type===1);e.setWorkspace(false);e.setAnchored(true);e.reset();return{initial,max,finite,lifted,returned,free}
  });console.log('LEG SUPPORT',measurements.legs)
  assert.ok(measurements.legs.max<.26&&measurements.legs.returned<.27&&measurements.legs.lifted>.035&&measurements.legs.free&&measurements.legs.finite)
  pass('Operating-table foot spacing stays bounded, a held leg follows a grab, release recenters, sandbox has no guides')

  await button(p,'Включить звук').click();await failOperation(p)
  await p.locator('.reaction-frame[data-beat="voice"]').waitFor()
  assert.match(await p.locator('.film-subtitle p').innerText(),/Считаешь что моя жизнь стоит меньше человеческой\? Да ты долбаный лицемер!$/)
  const expression=await p.evaluate(()=>{const e=window.__theatre,s=e.sequence;return{mode:e.mode,weights:e.rig.face[0].morphTargetInfluences.slice(),voice:s.audio?.currentTime||0,local:s.audio?.src.startsWith('data:audio/')||false,bodyCount:e.rig.segments.length}})
  assert.equal(expression.mode,'orbit');assert.ok(expression.weights[0]<.1&&expression.weights[2]>.8&&expression.local);assert.equal(expression.bodyCount,18)
  await p.waitForFunction(()=>window.__theatre.sequence?.audio?.currentTime>.05)
  await p.waitForFunction(()=>{const e=window.__theatre,s=e.sequence;return s&&s.time>s.fallAt+.93&&e.camera.position.y<.095})
  measurements.fall=await p.evaluate(()=>{const e=window.__theatre;return{height:e.camera.position.y,tilt:e.camera.rotation.z}})
  await p.getByRole('heading',{name:'Протокол прерван',exact:true}).waitFor();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('theatre.runs.v1')).length),1)
  assert.equal(await p.evaluate(()=>window.__theatre.sequence),null);await button(p,'Закрыть окно').click()
  pass('Orbit failure: open eyes, smile, exact spoken subtitle, local audio playback, camera fall and one saved result')

  await failOperation(p,true);await p.locator('.reaction-frame').waitFor();assert.equal(await p.evaluate(()=>window.__theatre.mode),'walk')
  const before=await p.evaluate(()=>window.__theatre.sequence.startP.toArray());await p.keyboard.press('Escape');await p.getByRole('heading',{name:'Протокол прерван'}).waitFor()
  assert.deepEqual(await p.evaluate(()=>window.__theatre.camera.position.toArray()),before);assert.equal(await p.evaluate(()=>window.__theatre.camera.fov),44);await button(p,'Закрыть окно').click()
  pass('First-person failure and Escape skip restore the same camera position and field of view')

  await button(p,'Настройки').click();await p.getByRole('switch',{name:'Мягкая камера',exact:true}).click();await button(p,'Готово').click()
  await failOperation(p);await p.locator('.reaction-frame.gentle').waitFor();await p.waitForFunction(()=>{const s=window.__theatre.sequence;return s?.time>s?.fallAt+.15})
  assert.ok(await p.evaluate(()=>window.__theatre.camera.position.y>1));await p.getByRole('heading',{name:'Протокол прерван',exact:true}).waitFor();await button(p,'Закрыть окно').click()
  pass('Comfort mode keeps the dialogue and gestures but avoids the roll and floor drop')

  await button(p,'Вкладка Песочница').click();await p.waitForFunction(()=>window.__theatre.phase==='sandbox')
  const pos=await position(p,'R_Hand');await p.mouse.move(pos.x,pos.y);await p.mouse.down();await p.waitForFunction(()=>!!window.__theatre.rig.dragging)
  await p.mouse.move(pos.x+16,pos.y-22,{steps:4});assert.ok(await p.evaluate(()=>window.__theatre.strain<12));assert.equal(await p.locator('.reaction-frame').count(),0)
  for(let i=0;i<45;i++){if(await p.locator('.reaction-frame').count())break;await p.mouse.move(pos.x+(i%2?90:-90),pos.y-30,{steps:4});await p.waitForTimeout(100)}
  await p.mouse.up();await p.locator('.reaction-frame[data-kind="sandbox"][data-beat="voice"]').waitFor();assert.match(await p.locator('.film-subtitle p').innerText(),/Тебя кто вообще в хирурги взял\? Я тебе не игрушка!$/)
  await button(p,'Пропустить сцену').click();await p.getByRole('heading',{name:'Сигнал восстановлен'}).waitFor();await button(p,'Продолжить практику').click();assert.equal(await p.evaluate(()=>window.__theatre.rig.dragging),null);assert.ok(await p.evaluate(()=>window.__theatre.spoken&&window.__theatre.phase==='sandbox'))
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('theatre.runs.v1')).length),3)
  pass('Hidden handling threshold: ordinary contact is safe, rough repeated dragging triggers the second line once, no fake surgical result')

  await uploadPanel(p);const fileInput=p.locator('input[type=file]')
  await fileInput.setInputFiles(file('static.gltf',JSON.stringify({asset:{version:'2.0'},nodes:[{}]}),'model/gltf+json'));await p.locator('.avatar-error').waitFor();assert.match(await p.locator('.avatar-error').innerText(),/скелета/);assert.ok(await p.evaluate(()=>!window.__theatre.rig.model.userData.customAvatar))
  const missing=structuredClone(doc);missing.buffers[0].uri='avatar.bin'
  await fileInput.setInputFiles(file('missing.gltf',JSON.stringify(missing),'model/gltf+json'));await p.waitForFunction(()=>document.querySelector('.avatar-error')?.textContent.includes('avatar.bin'))
  const remote=structuredClone(missing);remote.buffers[0].uri='https://example.invalid/avatar.bin';let remoteRequests=0;p.on('request',r=>{if(r.url().includes('example.invalid'))remoteRequests++})
  await fileInput.setInputFiles(file('remote.gltf',JSON.stringify(remote),'model/gltf+json'));await p.waitForFunction(()=>document.querySelector('.avatar-error')?.textContent.includes('сетевые'));assert.equal(remoteRequests,0)
  await fileInput.setInputFiles(file('Aurora.glb',original,'model/gltf-binary'));await p.locator('.avatar-verified').waitFor();assert.match(await p.locator('.avatar-verified').innerText(),/VRoid/);await button(p,'Применить модель').click();await p.waitForFunction(()=>window.__theatre?.rig?.model.userData.customAvatar===true)
  assert.match(await p.locator('.patient-row').innerText(),/Aurora/);assert.equal(await p.evaluate(()=>window.__theatre.mode),'orbit')
  pass('Verified local GLB import and transactional rejection of static, incomplete, and remote models')

  const converted=structuredClone(missing), map={C_Hips:'Hips',C_Spine:'Spine',C_Chest:'Spine1',C_UpperChest:'Spine2',C_Neck:'Neck',C_Head:'Head'}
  for(const side of ['L','R']) for(const [k,n]of Object.entries({Shoulder:'Shoulder',UpperArm:'Arm',LowerArm:'ForeArm',Hand:'Hand',UpperLeg:'UpLeg',LowerLeg:'Leg',Foot:'Foot',ToeBase:'ToeBase'}))map[`${side}_${k}`]=(side==='L'?'Left':'Right')+n
  for(const n of converted.nodes){if(n.name?.startsWith('J_Bip_'))n.name='mixamorig'+(map[n.name.slice(6)]||'Accessory_'+n.name.slice(6))}
  const image=converted.images[0],bv=converted.bufferViews[image.bufferView],texture=bin.subarray(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength),extension=image.mimeType==='image/jpeg'?'jpg':'png';delete image.bufferView;image.uri='textures/face.'+extension
  await uploadPanel(p);await p.locator('input[type=file]').setInputFiles([file('Visitor.gltf',JSON.stringify(converted),'model/gltf+json'),file('avatar.bin',bin),file('face.'+extension,texture,image.mimeType)])
  await p.locator('.avatar-verified').waitFor();assert.match(await p.locator('.avatar-verified').innerText(),/Mixamo/);await button(p,'Применить модель').click();await p.waitForFunction(()=>window.__theatre?.rig?.model.userData.customAvatar&&document.querySelector('.patient-row')?.textContent.includes('Visitor'))
  await p.locator('.start-button').click();await p.locator('.apply-action').click();await p.waitForFunction(()=>window.__theatre.field.ready);assert.equal(await p.evaluate(()=>window.__theatre.field.samples.length),77)
  await button(p,'Выбрать: Шовная игла').click();for(let i=0;i<3;i++){await p.locator('.apply-action').click();await p.waitForTimeout(245)}await button(p,'Выбрать: Бинт').click();await p.locator('.apply-action').click();await p.getByRole('heading',{name:'Операция завершена'}).waitFor();await button(p,'Закрыть окно').click()
  await button(p,'Открыть Kinema Lab').click();await p.waitForFunction(()=>window.__kinema?.rig?.model.userData.customAvatar);assert.match(await p.locator('.model-info').innerText(),/Visitor/)
  await p.locator('.model-select').click();const download=p.waitForEvent('download');await p.getByRole('link',{name:'Скачать 3D-модель'}).click();const result=await download;assert.equal(result.suggestedFilename(),'Visitor.gltf');const exported=JSON.parse(await fs.readFile(await result.path(),'utf8'));assert.ok(exported.buffers[0].uri.startsWith('data:')&&exported.images[0].uri.startsWith('data:'))
  await p.getByRole('button',{name:/Своя модель/}).click();await button(p,'Вернуть Мику').click();await button(p,'Вернуть').click();await p.waitForFunction(()=>window.__kinema?.rig&&!window.__kinema.rig.model.userData.customAvatar&&document.querySelector('.model-info')?.textContent.includes('Mika'))
  pass('Mixamo-named glTF + external BIN and image: successful operation, shared Kinema character, standalone glTF export, restore original Mika')
  await p.close()

  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce'}),m=await ctx.newPage();await start(m)
  assert.equal(await m.evaluate(()=>window.__theatre.options.gentle),true);await m.locator('.mobile-start').tap();await m.locator('.apply-action').tap();await m.waitForFunction(()=>!window.__theatre.focusTween);const w=await position(m,'arm');await m.touchscreen.tap(w.x,w.y);await m.locator('.reaction-frame.gentle').waitFor();await button(m,'Пропустить сцену').tap();await m.getByRole('heading',{name:'Протокол прерван'}).waitFor();assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);await ctx.close()
  pass('Touch-only skip and automatic OS reduced-motion preference')
  assert.deepEqual(errors,[]);await fs.writeFile('artifacts/theatre-v14-verification.json',JSON.stringify({version:'1.4.0',passed,measurements,errors},null,2));console.log('Verified',passed.length,'release-specific workflows.')
}finally{await browser.close()}