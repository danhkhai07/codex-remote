import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const template = readFileSync('working-hours/dashboard.template.html', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
 for (const width of [1280, 390, 320]) {
  for (const hours of [null, 0, 2.25]) {
   const page = await browser.newPage({ viewport: { width, height: 1000 } })
   await page.clock.install({ time: new Date('2026-09-23T12:00:00+07:00') })
   const days = hours === null ? [] : [{date: '2026-09-23', hours, source: 'recorded'}]
   await page.setContent(template.replace('__WORK_DATA__', JSON.stringify({today: '2026-09-23', generated: '2026-09-23T05:00:00Z', timezone: 'Asia/Ho_Chi_Minh', days})))
   assert.equal(await page.locator('#today-worked').count(), 0)
   for (const range of ['7', '30', 'all']) {
    await page.locator('#range').selectOption(range)
    assert.equal(await page.locator('.bar-column').count(), range === 'all' ? 1 : Number(range))
    assert.equal(await page.locator('.bar-column').last().getAttribute('data-date'), '2026-09-23')
    assert.equal(await page.locator('#chart').evaluate(chart => chart.lastElementChild.getBoundingClientRect().right <= chart.getBoundingClientRect().right + 1), true)
    assert.match(await page.locator('.bar-column').last().getAttribute('aria-label'), hours === null ? /Unknown/ : hours === 0 ? /0h 00m/ : /2h 15m/)
   }
   await page.locator('#range').selectOption('month')
   assert.equal(await page.locator('.bar-column').count(), 31)
   assert.equal(await page.locator('.bar-column').last().getAttribute('data-date'), '2026-08-31')
   assert.match(await page.locator('#cards .card').nth(2).innerText(), /No data/)
   await page.locator('#range').selectOption('7')
   assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth), false)
   if (hours === 2.25 && process.env.HOURS_SCREENSHOTS) {
    mkdirSync(process.env.HOURS_SCREENSHOTS, {recursive: true})
    await page.locator('#chart').scrollIntoViewIfNeeded()
    await page.screenshot({path: `${process.env.HOURS_SCREENSHOTS}/chart-${width}.png`})
   }
   await page.close()
  }
  console.log(`PASS ranges ${width}: today7/30/all empty/unknown/zero/known; previous month and complete averages unchanged`)
 }
} finally { await browser.close() }
