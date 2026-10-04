import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs'
import { classifyPageStage, detectPageStage } from './worker.mjs'

test('ambiguous pages and imported cookies cannot prove authentication', () => {
  assert.equal(classifyPageStage({ hasCookies: true }), 'unknown')
  assert.equal(classifyPageStage({ captcha: true, codeStep: true, code: true }), 'captcha')
  assert.equal(classifyPageStage({ codeStep: true }), 'two-factor-loading')
  assert.equal(classifyPageStage({ checkpoint: true, hasCookies: true, accountControl: true }), 'checkpoint')
  assert.equal(classifyPageStage({ otherCode: true, codeStep: true, code: true }), 'other-code')
})

test('Playwright replays CAPTCHA to code form and navigation without contacting Facebook', async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()
  let document = ''
  const captcha = '<iframe src="https://www.fbsbx.com/captcha/arkose/iframe/"></iframe>'
  // Fulfil every request locally, including the nested frames from the real capture.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    const body = url.hostname === 'www.facebook.com' ? document
      : url.hostname === 'www.fbsbx.com' ? '<iframe src="https://meta-api.arkoselabs.com/v2/enforcement.html"></iframe>'
        : '<input type="hidden" name="fc-token">'
    return route.fulfill({ status: 200, contentType: 'text/html', body })
  })
  try {
    const page = await context.newPage()
    async function show(path, html) {
      document = html
      await page.goto(`https://www.facebook.com${path}`)
      return (await detectPageStage(page, context)).kind
    }
    const authentication = '/two_step_verification/authentication/'
    assert.equal(await show(authentication, captcha), 'captcha')
    // The exact broad route that previously triggered the code-input timeout.
    assert.equal(await show(authentication, '<div>Loading…</div>'), 'checkpoint')
    assert.equal(await show('/two_step_verification/two_factor/', '<div>Loading…</div>'), 'two-factor-loading')
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.autocomplete = 'one-time-code'
      document.body.append(input)
    })
    assert.equal((await detectPageStage(page, context)).kind, 'two-factor')
    assert.equal(await page.locator('input').inputValue(), '')
    assert.equal(await show('/two_step_verification/two_factor/', `<div>Enter your authentication app code</div><input autocomplete="one-time-code"><div style="display:none">${captcha}</div>`), 'two-factor')
    assert.equal(await show(authentication, '<p>Complete a challenge to verify you’re a human</p>'), 'captcha')
    assert.equal(await show('/checkpoint/', '<p>Confirm with a video selfie</p>'), 'identity')
    assert.equal(await show('/two_step_verification/two_factor/', '<p>Enter the code sent to your email</p><input type="text">'), 'other-code')
    assert.equal(await show('/', '<input name="email"><input name="pass" type="password">'), 'login')
    assert.equal(await show('/', '<p>Incorrect password</p><input name="email">'), 'login-rejected')
    await context.addCookies(['c_user', 'xs'].map(name => ({ name, value: 'fixture-only', domain: '.facebook.com', path: '/' })))
    assert.equal(await show('/', '<p>Loading…</p>'), 'unknown')
    assert.equal(await show('/', '<button aria-label="Account">Account menu</button>'), 'authenticated')
    assert.equal(await show('/checkpoint/', '<button aria-label="Account">Account menu</button>'), 'checkpoint')
  } finally {
    await context.close()
    await browser.close()
  }
})
