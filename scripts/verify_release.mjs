import { chromium, devices } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = path.resolve('dist')
const standalonePath = '/nested/studio/index.html'
const original = JSON.parse(await fs.readFile('src/assets/mika-model.json', 'utf8'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const mime = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.zip': 'application/zip' }
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')
  // Reproduce the real publication: the page exists, but no GLB route does.
  if (url.pathname.endsWith('.glb')) { response.writeHead(404).end(); return }
  const file = path.resolve(root, '.' + (['/', standalonePath].includes(url.pathname) ? '/index.html' : url.pathname))
  if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return }
  try {
    const data = await fs.readFile(file)
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data)
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const exceptions = [], failedAssets = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => exceptions.push(e.message))
  page.on('response', r => { if (r.status() >= 400) failedAssets.push(r.url()) })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' })
  await page.locator('.three-host.loaded').waitFor({ timeout: 60000 })
  assert.equal(await page.title(), 'Kinema Lab · Студия симуляции')
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1))
  await page.getByRole('button', { name: 'Руководство по студии', exact: true }).click()
  for (const name of ['Офлайн-версия', 'Исходный проект']) {
    const event = page.waitForEvent('download')
    await page.getByRole('link', { name, exact: true }).click()
    const download = await event
    assert.equal(await download.failure(), null)
    assert.ok((await fs.stat(await download.path())).size > 1_000_000)
  }
  await page.close()
  console.log('PASS Production build, desktop viewport fit, portable and source downloads')

  const phone = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 })
  const mobile = await phone.newPage()
  const url = `http://127.0.0.1:${server.address().port}${standalonePath}`
  const unexpectedRequests = []
  await phone.route(/^https?:/, async route => {
    if (route.request().url() === url) return route.continue()
    unexpectedRequests.push(route.request().url())
    return route.fulfill({ status: 404, body: 'Not found' })
  })
  await phone.addInitScript(() => Object.defineProperty(window, 'DecompressionStream', { value: undefined }))
  mobile.on('pageerror', e => exceptions.push(e.message))
  await mobile.goto(url, { waitUntil: 'networkidle' })
  await mobile.locator('.three-host.loaded').waitFor({ timeout: 60000 })
  assert.equal(await mobile.locator('.scene-error').count(), 0)
  const bounds = await mobile.locator('.studio-canvas').boundingBox()
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height * .42
  const touch = await phone.newCDPSession(mobile)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await mobile.locator('.grab-indicator').waitFor()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 15, y: y - 35 }] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await mobile.getByRole('switch', { name: 'Фиксация на месте' }).tap()
  assert.equal(await mobile.getByRole('switch', { name: 'Фиксация на месте' }).getAttribute('aria-checked'), 'false')
  await mobile.getByRole('button', { name: 'Пауза', exact: true }).tap()
  await mobile.getByRole('button', { name: 'О модели Mika' }).tap()
  const mobileDownload = mobile.waitForEvent('download')
  await mobile.getByRole('link', { name: 'Скачать 3D-модель' }).tap()
  const model = await fs.readFile(await (await mobileDownload).path())
  assert.equal(digest(model), original.sha256)
  assert.deepEqual(unexpectedRequests, [])
  await phone.close()
  console.log('PASS Mobile touch grab, unpin, pause and bit-identical GLB export with every asset route returning 404')

  const ctx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 800 } })
  const local = await ctx.newPage()
  local.on('pageerror', e => exceptions.push(e.message))
  let remoteRequests = 0
  local.on('request', r => { if (/^https?:/.test(r.url())) remoteRequests++ })
  await local.goto(pathToFileURL(path.resolve('public/downloads/kinema-studio.html')).href, { waitUntil: 'load' })
  await local.locator('.three-host.loaded').waitFor({ timeout: 60000 })
  assert.ok(await local.getByRole('heading', { name: 'Студия симуляции' }).isVisible())
  await local.getByRole('switch', { name: 'Фиксация на месте' }).click()
  await local.getByRole('switch', { name: 'Скелет персонажа' }).click()
  await local.getByRole('button', { name: 'Пауза', exact: true }).click()
  await local.getByRole('button', { name: 'О модели Mika' }).click()
  const event = local.waitForEvent('download')
  await local.getByRole('link', { name: 'Скачать 3D-модель' }).click()
  const downloaded = await event
  assert.equal(digest(await fs.readFile(await downloaded.path())), original.sha256)
  assert.equal(remoteRequests, 0)
  assert.deepEqual(exceptions, [])
  assert.deepEqual(failedAssets, [])
  console.log('PASS Disconnected file:// HTML: live 3D, physics, skeleton, GLB export, zero network requests')
  await fs.writeFile('artifacts/release-verification.json', JSON.stringify({ production: 'passed', offlineFile: 'passed',
    missingModelRoute: 'passed', mobileTouch: 'passed', externalStartupAssets: unexpectedRequests,
    exportedModelSha256: original.sha256, remoteRequests, exceptions, failedAssets }, null, 2))
} finally { await browser.close(); server.close() }