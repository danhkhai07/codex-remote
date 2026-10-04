import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import('/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs')
const directory = await mkdtemp(path.join(tmpdir(), 'fb-manual-browser-'))
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] })
let service
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.setContent('<body style="background:white"><strong>Fixture challenge</strong></body>')
  const frame = (await page.screenshot({ type: 'jpeg', quality: 75 })).toString('base64')
  const worker = path.join(directory, 'stub-worker.mjs')
  await writeFile(worker, String.raw`
let buffer = '', started = false
process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf8')
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n')
    const line = JSON.parse(buffer.slice(0, index))
    buffer = buffer.slice(index + 1)
    if (!started) {
      started = true
      process.stdout.write(JSON.stringify({ phase: 'Solve CAPTCHA in this page', manual: true }) + '\n')
      process.stdout.write(JSON.stringify({ frame: '${frame}' }) + '\n')
    } else if (line.type === 'click') {
      process.stdout.write(JSON.stringify({ phase: 'Clicked ' + line.x + ',' + line.y, manual: false }) + '\n')
      setTimeout(() => process.exit(0), 100)
    }
  }
})
`, { mode: 0o600 })
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  service = spawn(process.execPath, [path.join(here, 'server.mjs')], {
    env: { ...process.env, FB_SESSION_STATE_DIR: directory, FB_SESSION_PORT: String(port),
      FB_SESSION_PYTHON: process.execPath, FB_SESSION_WORKER: worker },
    stdio: 'ignore',
  })
  const root = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(root)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  const code = (await readFile(path.join(directory, 'access-code'), 'utf8')).trim()
  await page.goto(root)
  await page.locator('#access-code').fill(code)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByText('Account and 2Captcha settings').click()
  await page.locator('[name="account"]').fill('1234567890')
  await page.locator('[name="password"]').fill('fixture-pass')
  await page.locator('[name="totpSecret"]').fill('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  await page.getByRole('button', { name: 'Save settings' }).click()
  assert.equal(await page.locator('#manual-captcha').isChecked(), true)
  await page.getByRole('button', { name: 'Start login' }).click()
  await page.locator('#manual-panel').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#browser-frame')?.naturalWidth === 1280)
  await page.locator('#browser-frame').click({ position: { x: 320, y: 230 } })
  await page.waitForFunction(() => /^Clicked \d+,\d+$/.test(document.querySelector('#phase')?.textContent || ''), null, { timeout: 8000 })
  assert.equal(await page.locator('#manual-panel').isVisible(), false)
  await page.close()
  process.stdout.write('Manual browser UI: unlocked frame rendered and mapped click reached worker\n')
} finally {
  if (service) {
    service.kill('SIGTERM')
    await new Promise(resolve => service.once('exit', resolve))
  }
  await browser.close()
  await rm(directory, { recursive: true, force: true })
}
