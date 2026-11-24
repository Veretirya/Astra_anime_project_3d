import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => console.error('PAGE ERROR', e.message))
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log(msg.type(), msg.text().slice(0, 300)) })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__theatre?.rig, null, { timeout: 60000 })
  await page.waitForTimeout(400)
  await fs.mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/theatre-desktop.png', fullPage: true })
  console.log('Page dimensions:', await page.evaluate(() => ({ w: innerWidth, h: innerHeight, scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth })))
  await page.getByRole('button', { name: 'Осмотреть в 3D', exact: true }).click()
  await page.waitForTimeout(800)
  await page.evaluate(() => cancelAnimationFrame(window.__theatre.frame))
  await page.screenshot({ path: 'artifacts/theatre-live.png', fullPage: true, animations: 'disabled', timeout: 90000 })
  console.log('Live scene:', await page.evaluate(() => { const e = window.__theatre; return { physicsBodies: e.rig.segments.length, joints: e.rig.world.constraints.length, render: e.renderer.info.render, meshes: e.rig.meshes.length, head: e.rig.segments.find(s => s.name === 'C_Head').body.position, arm: e.zonePosition('arm'), camera: e.camera.position } }))
  await page.getByRole('button', { name: 'Свободная камера', exact: true }).click()
  await page.getByRole('button', { name: 'Общий вид', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400)
  await page.screenshot({ path: 'artifacts/theatre-mobile.png', fullPage: true })
} finally { await browser.close() }