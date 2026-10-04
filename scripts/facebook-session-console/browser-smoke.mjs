import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import('/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs')
const directory = await mkdtemp(path.join(tmpdir(), 'fb-console-browser-'))
const listener = net.createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const service = spawn(process.execPath, [path.join(here, 'server.mjs')], {
  env: { ...process.env, FB_SESSION_STATE_DIR: directory, FB_SESSION_PORT: String(port) },
  stdio: 'ignore',
})
let browser
try {
  const address = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(address)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(address)
  assert.equal(await page.title(), 'Facebook session')
  assert.equal(await page.locator('#manager').isVisible(), false)
  await page.locator('#access-code').fill((await readFile(path.join(directory, 'access-code'), 'utf8')).trim())
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.locator('#manager').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#phase').innerText(), 'Not started')
  assert.equal(await page.locator('#login').isDisabled(), true)
  await page.locator('summary').click()
  assert.equal(await page.getByLabel('2Captcha API key').isVisible(), true)
  await page.close()
  process.stdout.write('Browser smoke passed\n')
} finally {
  if (browser) await browser.close()
  service.kill('SIGTERM')
  await new Promise(resolve => service.once('exit', resolve))
  await rm(directory, { recursive: true, force: true })
}
