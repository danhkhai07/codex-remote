import { historyFixtureConfig } from '../server/fixtures/history-store.mjs'
// Fake native protocol and canary files only; no user thread or model turn.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { CodexAppServer } from '../dist-server/codex-app-server.js'
import { RemoteController } from '../dist-server/controller.js'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp('/tmp/security-files-browser-')
await writeFile(join(root, 'readme.md'), 'ALLOWED PROJECT CANARY')
await writeFile(join(root, '.env'), 'DENIED SECRET CANARY')
const app = new CodexAppServer(process.execPath, [resolve('server/fixtures/plan-questions.mjs')])
const config = { ...historyFixtureConfig(), host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'fake fixture password', sessionSecret: 'x'.repeat(48), sessionTtlSeconds: 600, codexBin: 'unused', workspaceRoots: ['/tmp'], fileRoots: [root], production: true }
const controller = new RemoteController(config, app), server = createRemoteHttpServer(config, controller, resolve('dist'), null)
const browser = await chromium.launch({ headless: true })
try {
  await controller.start(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.publicOrigin = new URL(`http://127.0.0.1:${server.address().port}`)
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 600 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow' }), page = await context.newPage()
    await page.route('**/api/conversation-groups', route => route.fulfill({ json: { revision: 0, groups: [], assignments: {} } }))
    await context.request.post(`${config.publicOrigin}api/session/login`, { headers: { Origin: config.publicOrigin.origin }, data: { password: config.password } })
    await page.goto(config.publicOrigin.origin); await page.locator('#instruction').waitFor()
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    const files = page.getByRole('dialog', { name: 'Files', exact: true })
    await files.getByRole('alert').waitFor()
    await files.getByRole('alert').getByRole('button', { name: root, exact: true }).click()
    const entry = files.getByRole('button', { name: /readme.md/ }).first()
    await entry.waitFor(); assert.equal(await files.getByText('.env', { exact: true }).count(), 0)
    await entry.click(); await page.getByText('ALLOWED PROJECT CANARY', { exact: true }).waitFor()
    if (process.env.SECURITY_SCREENSHOTS) {
      await mkdir(process.env.SECURITY_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.SECURITY_SCREENSHOTS, `allowed-files-${viewport.width}x${viewport.height}.png`) })
    }
    console.log(`PASS file roots recovery and allowed preview ${viewport.width}x${viewport.height}`)
    await context.close()
  }
} finally {
  await browser.close(); controller.stop(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true })
}
