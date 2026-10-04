import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { workerEnvironment } from './server.mjs'

if (process.argv[2] === '--child') {
  const { chromium } = await import('/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs')
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', headless: false, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    process.stdout.write('DISPLAY_READY\n')
  } finally { await browser.close() }
} else {
  assert.ok(process.env.DISPLAY)
  assert.ok(process.env.XAUTHORITY)
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], {
    env: workerEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  for await (const chunk of child.stdout) output += chunk.toString('utf8')
  const code = await new Promise(resolve => child.once('exit', resolve))
  assert.equal(code, 0, 'child browser must launch with the forwarded Xvfb authority')
  assert.match(output, /DISPLAY_READY/)
  process.stdout.write('Worker Xvfb handoff passed\n')
}
