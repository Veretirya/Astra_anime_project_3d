import { chromium, devices } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] })
const errors = [], passed = [], pass = message => { passed.push(message); console.log('PASS', message) }
const button = (p, name) => p.getByRole('button', { name, exact: true })
const toggle = p => p.getByRole('switch', { name: 'Катсцены в песочнице', exact: true })
async function ready(p) {
  p.setDefaultTimeout(25000); p.on('pageerror', e => errors.push(e.message))
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.__theatre?.rig, null, { timeout: 60000 })
}

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 864 }, deviceScaleFactor: 1 }); await ready(page)
  const shots = await page.evaluate(async () => {
    const { ReactionScene } = await import('/src/surgery/reaction.ts')
    const e = window.__theatre, rig = e.rig, cam = e.camera, original = e.capture()
    const vec = (x = 0, y = 0, z = 0) => cam.position.clone().set(x, y, z), quat = () => cam.quaternion.clone().identity()
    const world = o => o.getWorldPosition(vec()), bone = key => rig.model.getObjectByName(key), deg = a => a * 180 / Math.PI
    const head = bone('J_Bip_C_Head'), iris = rig.meshes.find(m => m.material.name.includes('EyeIris'))
    const lids = [bone('J_Adj_L_FaceEye'), bone('J_Adj_R_FaceEye')], savedBodies = rig.save(), result = []
    const poses = [['left',[-1.4,.3,0],0], ['right',[1.4,.3,0],0], ['headboard',[0,.26,-1.4],0], ['foot-end',[0,.21,1.5],0],
      ['walk',[1.65,.55,1.22],0], ['overhead',[.02,2.5,.03],0], ['side-lying',[.5,1.3,.7],1.45], ['face-down',[-1.4,1.0,.1],3.05]]
    for (const [name, offset, roll] of poses) for (const gentle of [false, true]) {
      rig.restore(savedBodies, [0,0,0]); e.setCover(roll === 0); e.setLayer('skin')
      if (roll) {
        const turn = quat().setFromAxisAngle(vec(0,0,1), roll), pivot = world(head)
        const bodies = savedBodies.map(b => ({...b, p:vec().fromArray(b.p).sub(pivot).applyQuaternion(turn).add(vec(-1.12,.20,.1)).toArray(), q:quat().fromArray(b.q).premultiply(turn).toArray()}))
        rig.restore(bodies,[0,0,0])
      }
      const at = world(head); cam.aspect = gentle ? 390/844 : 1366/864; cam.updateProjectionMatrix(); cam.position.copy(at).add(vec(...offset)); cam.lookAt(at); cam.updateMatrixWorld(true)
      const before = cam.quaternion.clone(), start = cam.position.clone(), fov = cam.fov
      const initial = new Map(); rig.model.traverse(o => { if (o.isBone) initial.set(o,o.quaternion.clone()) })
      const s = new ReactionScene(roll ? 'sandbox' : 'operation',rig,cam,gentle,false,()=>{})
      let maxAngle=0, maxPupilAngle=0, maxScreenOffset=0, maxAltitude=0, handHits=0, coverHits=0, headTurn=0
      for (const t of [s.voiceAt, s.voiceAt+.6, s.fallAt-.5]) {
        s.tick(t-s.time)
        const hp = head.getWorldQuaternion(quat()), eyes= head.localToWorld(rig.faceFrame.center.clone()), toLens=cam.position.clone().sub(eyes).normalize()
        maxAngle=Math.max(maxAngle,deg(rig.faceFrame.forward.clone().applyQuaternion(hp).angleTo(toLens)))
        headTurn=Math.max(headTurn,deg(head.quaternion.angleTo(initial.get(head))))
        const points=[vec(),vec()], counts=[0,0], attr=iris.geometry.attributes.position
        for (let i=0;i<attr.count;i++) { const j=attr.getX(i)<0?0:1; points[j].add(iris.getVertexPosition(i,vec()).applyMatrix4(iris.matrixWorld));counts[j]++ }
        points.forEach((p,i)=>p.divideScalar(counts[i]));const middle=points[0].clone().lerp(points[1],.5), pivots=world(lids[0]).lerp(world(lids[1]),.5)
        // Independently check the actually skinned iris vertices, not the director's target.
        maxPupilAngle=Math.max(maxPupilAngle,deg(middle.clone().sub(pivots).angleTo(cam.position.clone().sub(middle))))
        const body=rig.meshes.find(m=>m.material.name.includes('Body_00_SKIN'));body.computeBoundingSphere()
        for (const p of points) {
          const ndc=p.clone().project(cam);maxScreenOffset=Math.max(maxScreenOffset,Math.abs(ndc.x),Math.abs(ndc.y));maxAltitude=Math.max(maxAltitude,cam.position.y)
          const ray=new e.ray.constructor(cam.position.clone(),p.clone().sub(cam.position).normalize(),cam.near,cam.position.distanceTo(p)-.002)
          if(ray.intersectObject(body,false).length)handHits++
          if(e.cloth.visible&&ray.intersectObject(e.cloth,false).length)coverHits++
        }
      }
      s.stop()
      const restored=cam.position.distanceTo(start)<1e-9&&cam.quaternion.angleTo(before)<1e-6&&cam.fov===fov&&[...initial].every(([b,q])=>b.quaternion.angleTo(q)<1e-6)
      result.push({name,gentle,maxAngle,maxPupilAngle,maxScreenOffset,handHits,coverHits,headTurn,maxAltitude,restored})
    }
    e.restore(original);return result
  })
  console.log('Shots:',JSON.stringify(shots))
  for(const shot of shots){assert.ok(shot.restored,`Pose restoration: ${shot.name}`);assert.ok(shot.maxAngle<.5,`Head alignment: ${shot.name}`);assert.ok(shot.maxPupilAngle<3,`Pupil alignment: ${shot.name}`);assert.ok(shot.maxScreenOffset<.63,`Eye framing: ${shot.name}`);assert.equal(shot.handHits+shot.coverHits,0,`Eyes occluded: ${shot.name}`)}
  assert.ok(shots.some(s=>s.headTurn>15));pass('Eye contact throughout speech from six entry angles and two ragdoll poses, desktop and portrait framing, pose restored')

  // Old preference records must keep the old enabled-by-default behaviour.
  await page.evaluate(()=>localStorage.setItem('theatre.preferences.v1',JSON.stringify({sound:false,story:true,quality:'balanced',hints:true,traces:true})))
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__theatre?.rig)
  await button(page,'Вкладка Песочница').click();assert.equal(await toggle(page).getAttribute('aria-checked'),'true')
  await page.evaluate(()=>{window.__theatre.strain=11.8});await toggle(page).click();assert.equal(await toggle(page).getAttribute('aria-checked'),'false')
  assert.deepEqual(await page.evaluate(()=>{const e=window.__theatre;return[e.strain,e.storyInput(),e.startReaction('sandbox'),e.options.story,JSON.parse(localStorage.getItem('theatre.preferences.v1')).sandboxStory]}),[0,false,false,true,false])
  await page.evaluate(()=>window.__theatre.renderer.setPixelRatio(.65))
  const hand=await page.evaluate(()=>{const e=window.__theatre,h=e.partPosition('body:R_Hand').project(e.camera),b=e.host.getBoundingClientRect();return{x:b.left+(h.x+1)*b.width/2,y:b.top+(1-h.y)*b.height/2}})
  await page.mouse.move(hand.x,hand.y);await page.mouse.down();await page.waitForFunction(()=>!!window.__theatre.rig.dragging)
  for(let i=0;i<30;i++)await page.mouse.move(hand.x+(i%2?85:-85),hand.y-31,{steps:4})
  await page.mouse.up();assert.equal(await page.evaluate(()=>window.__theatre.strain),0);assert.equal(await page.locator('.reaction-frame').count(),0)
  pass('Disabled sandbox neither accumulates hidden tension nor fires the scene; physical dragging still works')
  await button(page,'Вкладка Операционная').click();await page.locator('.start-button').click();await page.locator('.apply-action').click();await page.waitForFunction(()=>!window.__theatre.focusTween)
  const arm=await page.evaluate(()=>{const e=window.__theatre,p=e.zonePosition('arm').project(e.camera),r=e.host.getBoundingClientRect();return[r.x+(p.x+1)*r.width/2,r.y+(1-p.y)*r.height/2]})
  await page.mouse.click(...arm);await page.locator('.reaction-frame[data-kind="operation"]').waitFor();await button(page,'Пропустить сцену').click();await page.getByRole('heading',{name:'Протокол прерван',exact:true}).waitFor()
  pass('Sandbox opt-out does not disable the actual surgical failure reaction')
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__theatre?.rig);await button(page,'Вкладка Песочница').click();assert.equal(await toggle(page).getAttribute('aria-checked'),'false')
  await toggle(page).click();assert.equal(await page.evaluate(()=>window.__theatre.storyInput()),true);assert.equal(await page.evaluate(()=>window.__theatre.strain),0)
  await button(page,'Настройки').click();await page.getByRole('switch',{name:'Четвёртая стена',exact:true}).click();await button(page,'Готово').click();assert.equal(await toggle(page).isDisabled(),true)
  assert.deepEqual(await page.evaluate(()=>[window.__theatre.startReaction('operation'),window.__theatre.startReaction('sandbox')]),[false,false])
  pass('Choice survives reload, re-enabling starts with a clean counter, global story-off remains authoritative')
  await page.close()
  const ctx=await browser.newContext({...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1}),p=await ctx.newPage();await ready(p);await button(p,'Вкладка Песочница').tap();await toggle(p).tap();assert.equal(await toggle(p).getAttribute('aria-checked'),'false');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);await ctx.close()
  pass('Sandbox control is reachable by touch without horizontal overflow')
  assert.deepEqual(errors,[]);await fs.writeFile('artifacts/theatre-v141-verification.json',JSON.stringify({version:'1.4.1',passed,shots,errors},null,2))
} finally { await browser.close() }