import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
page.on('pageerror', e => console.error('PAGE ERROR:', e.message))
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 350)) })
await page.goto('http://localhost:5173/#kinema', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__kinema?.rig, null, { timeout: 60000 })
await page.waitForTimeout(800)
const assets = await page.evaluate(() => ({
  portrait: window.__kinema.portrait(),
  stage: window.__kinema.snapshot(1600),
  info: window.__kinema.renderer.info.render,
  bodies: window.__kinema.rig.segments.length,
}))
console.log('Render:', assets.info, 'Rigid bodies:', assets.bodies)
await fs.writeFile('public/images/mika-portrait.webp', Buffer.from(assets.portrait.split(',')[1], 'base64'))
await fs.writeFile('public/images/scene-poster.jpg', Buffer.from(assets.stage.split(',')[1], 'base64'))
await fs.copyFile('public/images/mika-portrait.webp', 'src/assets/mika-portrait.webp')
await fs.copyFile('public/images/scene-poster.jpg', 'src/assets/scene-poster.jpg')
await page.locator('.model-avatar').evaluate(img => img.src = '/images/mika-portrait.webp?t=' + Date.now())
await page.waitForTimeout(500)
await fs.mkdir('artifacts', { recursive: true })
await page.screenshot({ path: 'artifacts/studio-desktop.png', fullPage: true })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
await page.screenshot({ path: 'artifacts/studio-mobile.png', fullPage: true })
await browser.close()