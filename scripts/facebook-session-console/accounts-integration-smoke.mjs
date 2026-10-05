import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import('/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs')
const directory = await mkdtemp('/tmp/facebook-accounts-integration-')
const output = process.env.FB_ACCOUNTS_EVIDENCE || '/tmp/facebook-accounts-integration-evidence'
const avatarPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
let server, browser
try {
  await mkdir(output, { recursive: true })
  const legacy = JSON.stringify({ account: '11111111111', password: 'fixture-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', captchaKey: 'legacy-ignored-fixture' })
  await writeFile(path.join(directory, 'account.json'), legacy, { mode: 0o600 })
  await writeFile(path.join(directory, 'storage-state.json'), '{"fixture":true}', { mode: 0o600 })
  browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] })
  const imagePage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await imagePage.setContent('<html><body style="font:24px sans-serif;background:#fff;padding:24px"><h1>Local verification fixture</h1><p>Use the manual controls to continue.</p></body></html>')
  const frame = (await imagePage.screenshot({ type: 'jpeg' })).toString('base64')
  await imagePage.close()
  const worker = path.join(directory, 'fixture-worker.mjs')
  const code = `import readline from 'node:readline';import fs from 'node:fs';import path from 'node:path';
let started=false,stage=0;const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{const value=JSON.parse(line);if(!started){started=true;if(value.captchaKey)throw Error('Unexpected solver credential');send({phase:'Continue in browser',manual:true,manualStage:'captcha'});send({frame:${JSON.stringify(frame)}});return}
if(stage===0&&value.type==='click'){stage=1;send({phase:'Authenticator code required',manual:true,manualStage:'two-factor'})}
else if(stage===1&&value.type==='text'){stage=2;send({phase:'Email code required',manual:true,manualStage:'other-code'})}
else if(stage===2&&value.type==='click'){fs.writeFileSync(path.join(process.env.FB_SESSION_STATE_DIR,'storage-state.json'),'{"fixture":true}',{mode:0o600});send({phase:'Session ready',result:'Fixture completed',manual:false});setTimeout(()=>process.exit(0),60)}});
process.on('SIGINT',()=>process.exit(0));`
  await writeFile(worker, code)
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  server = spawn(process.execPath, [path.join(here, 'server.mjs')], { env: { ...process.env, FB_SESSION_STATE_DIR: directory, FB_SESSION_PORT: String(port), FB_SESSION_WORKER: worker }, stdio: 'ignore' })
  const origin = `http://127.0.0.1:${port}`
  for (let retry = 0; retry < 100; retry++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const access = (await readFile(path.join(directory, 'access-code'), 'utf8')).trim()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(origin)
  await page.locator('#access-code').fill(access)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await page.locator('#manager').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.account-row').count(), 1)
  assert.equal(await page.locator('#selected-session').textContent(), 'Logged in')
  assert.equal(await page.locator('#start-login').isHidden(), true)
  assert.equal(await page.getByRole('button', { name: 'Use saved session' }).isVisible(), true)
  await page.locator('#add-account').click()
  await page.locator('#field-label').fill('Support team')
  await page.locator('#field-avatar').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: avatarPng })
  await page.locator('#field-account').fill('22222222222')
  await page.locator('#field-password').fill('second-fixture-password')
  await page.locator('#field-totp').fill('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  await page.locator('#save-account').click()
  await page.locator('#account-dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.account-row').count(), 2)
  assert.equal(await page.locator('#selected-heading').textContent(), 'Support team')
  await page.locator('.account-row').filter({ hasText: 'Support team' }).locator('.account-avatar-image:not([hidden])').waitFor()
  await page.locator('#edit-account').click()
  await page.locator('#field-label').fill('Support & review')
  assert.equal(await page.locator('#field-password').inputValue(), '')
  await page.locator('#save-account').click()
  await page.locator('#account-dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#selected-heading').textContent(), 'Support & review')
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.equal(await page.locator('.account-row').first().evaluate(row => getComputedStyle(row).gridTemplateRows.split(' ').length), 1)
    await page.screenshot({ path: path.join(output, `accounts-${width}.png`), fullPage: true })
  }
  await page.locator('#start-login').click()
  await page.locator('#manual-panel').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('#browser-frame').naturalWidth === 1280)
  await page.locator('#browser-frame').click({ position: { x: 50, y: 30 } })
  await page.locator('#totp-panel').waitFor({ state: 'visible' })
  await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#totp-code').textContent))
  const otp = await page.locator('#totp-code').textContent()
  await page.locator('#manual-text').fill(otp)
  await page.locator('#send-text').click()
  await page.locator('#totp-panel').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#manual-panel').isVisible(), true)
  await page.locator('#browser-frame').click({ position: { x: 50, y: 30 } })
  await page.locator('#manual-panel').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#selected-session').textContent(), 'Logged in')
  assert.equal(await readFile(path.join(directory, 'account.json'), 'utf8'), legacy)
  assert.equal(await readFile(path.join(directory, 'storage-state.json'), 'utf8'), '{"fixture":true}')
  await page.locator('#lock').click()
  await page.locator('#manager').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#browser-frame').getAttribute('src'), null)
  assert.equal(await page.locator('#totp-code').textContent(), '')
  assert.deepEqual(pageErrors, [])
  console.log('PASS: real server + UI add/edit/migrate, manual stages, separate saved markers, Lock, desktop/390/320; only local fixtures')
} finally {
  await browser?.close()
  if (server?.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise(resolve => server.once('exit', resolve))
  }
  await rm(directory, { recursive: true, force: true })
}
