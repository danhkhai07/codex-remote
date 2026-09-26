import { historyFixtureConfig } from '../server/fixtures/history-store.mjs'
// Real app renderers and encrypted HTTP, with disposable files/native history only.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createRemoteHttpServer } from '../dist-server/http-app.js'
import { RemoteController } from '../dist-server/controller.js'
import { CodexAppServer } from '../dist-server/codex-app-server.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = await mkdtemp(join(tmpdir(), 'markdown-table-browser-'))
const files = join(root, 'project'), dist = join(root, 'dist')
const random = length => randomBytes(length).toString('base64url')
const material = { version: 1, app: random(18), generation: random(18), key: random(32) }
const markdown = `# Markdown table fixture

## Bảng ngắn
| Tên | Trạng thái |
| --- | --- |
| Bản dựng | Sẵn sàng |

## Bảng nội dung
| Hạng mục | Mô tả tiếng Việt | Người phụ trách | Kết quả |
| --- | --- | --- | --- |
| Giao diện | Nội dung trong ô được phép xuống nhiều dòng để bảng vừa khung đọc. | Nhóm sản phẩm | Hoàn tất |

## Chuỗi dài
| Loại | Nội dung |
| --- | --- |
| URL | [Đường dẫn đầy đủ](https://example.test/reports/this-is-a-deliberately-long-path-with-query?project=codex-remote&viewport=mobile) |
| Hash | \`0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\` |

## Bảng nhiều cột
| Một | Hai | Ba | Bốn | Năm | Sáu |
| --- | --- | --- | --- | --- | --- |
| Alpha | Bravo | Charlie | Delta | Echo | Foxtrot |

\`\`\`text
OUTSIDE_TABLE_CODE_MUST_KEEP_ITS_OWN_SCROLL_BEHAVIOR_0123456789abcdefghijklmnopqrstuvwxyz
\`\`\`
`

let browser, server, controller
try {
  await mkdir(files); await cp(resolve('dist'), dist, { recursive: true })
  const note = join(files, 'Bảng Markdown.md'); await writeFile(note, markdown)
  const keyFile = join(root, 'owner-key.json'); await writeFile(keyFile, JSON.stringify(material), { mode: 0o600 })
  const config = { ...historyFixtureConfig(), host: '127.0.0.1', port: 0, publicOrigin: new URL('http://127.0.0.1'), password: 'FAKE markdown table password', sessionSecret: 'markdown-table-fixture'.repeat(3), sessionTtlSeconds: 600, codexBin: 'unused', production: true, workspaceRoots: [files], fileRoots: [files], fileAccess: 'owner-full', secureApiRequired: true, secureKeyFile: keyFile, sessionStateFile: join(root, 'sessions.json') }
  const fixture = join(root, 'native.mjs')
  const source = await readFile(resolve('server/fixtures/plan-questions.mjs'), 'utf8')
  const oldHistory = "text: `History ${i}\\n\\n${'Long conversation context. '.repeat(30)}`"
  const nativeSource = source
    .replace("'./history-store.mjs'", JSON.stringify(resolve('server/fixtures/history-store.mjs')))
    .replace("cwd: '/tmp'", `cwd: ${JSON.stringify(files)}`)
    .replace(oldHistory, `text: i === 44 ? ${JSON.stringify(markdown)} : \`History \${i}\``)
  assert(nativeSource.includes('Markdown table fixture'), 'Native Markdown replacement must apply')
  await writeFile(fixture, nativeSource)
  const native = new CodexAppServer(process.execPath, [fixture])
  controller = new RemoteController(config, native); await controller.start()
  server = createRemoteHttpServer(config, controller, dist, null); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  config.port = server.address().port; config.publicOrigin = new URL(`http://127.0.0.1:${config.port}`)
  browser = await chromium.launch({ headless: true })
  const screenshots = process.env.MARKDOWN_TABLE_SCREENSHOTS
  if (screenshots) await mkdir(screenshots, { recursive: true })
  const results = []

  const unlock = async page => {
    await page.getByLabel('Khóa mã hóa riêng', { exact: true }).fill(material.key)
    await page.getByRole('button', { name: 'Mở khóa', exact: true }).click()
  }
  const inspect = async (page, surface, width) => {
    const scope = surface === 'chat' ? page.locator('.message-markdown').filter({ hasText: 'Markdown table fixture' }) : page.locator('.file-markdown-preview')
    await scope.getByRole('heading', { name: 'Bảng ngắn', exact: true }).waitFor()
    const wrappers = scope.locator('.markdown-table-scroll')
    assert.equal(await wrappers.count(), 4)
    const metrics = await wrappers.evaluateAll(elements => elements.map(element => ({ client: element.clientWidth, scroll: element.scrollWidth })))
    for (const index of [0, 1, 2]) assert(metrics[index].scroll <= metrics[index].client + 1, `${surface} ordinary table ${index} should fit at ${width}`)
    if (width <= 768) assert(metrics[3].scroll > metrics[3].client, `${surface} many-column table should scroll locally at ${width}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${surface} must not overflow the document`)
    const proseCell = wrappers.nth(1).locator('td').nth(1)
    if (width <= 390) assert((await proseCell.boundingBox()).height > 48, `${surface} prose cell should wrap at ${width}`)
    assert.equal(await wrappers.nth(2).getByRole('link', { name: 'Đường dẫn đầy đủ', exact: true }).count(), 1)
    assert((await wrappers.nth(2).locator('code').innerText()).endsWith('abcdef'))
    const codeBlock = scope.locator('pre')
    assert((await codeBlock.innerText()).includes('OUTSIDE_TABLE_CODE_MUST_KEEP_ITS_OWN_SCROLL_BEHAVIOR'))
    assert.equal(await codeBlock.evaluate(element => getComputedStyle(element).overflowX), 'auto')
    return metrics.map(metric => metric.scroll > metric.client + 1)
  }

  for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'allow' }), page = await context.newPage()
    page.setDefaultTimeout(20000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(config.publicOrigin.origin)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const password = page.getByLabel('Mật khẩu đăng nhập', { exact: true })
    if (!await password.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click()
    await password.fill(config.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await unlock(page)
    if (!await page.getByRole('heading', { name: 'Markdown table fixture', exact: true }).isVisible().catch(() => false)) {
      const openConversations = page.getByRole('button', { name: 'Open conversations', exact: true })
      if (await openConversations.isVisible().catch(() => false)) await openConversations.click()
      const fixtureThread = page.locator('.thread-row').filter({ hasText: 'Plan question fixture' })
      await fixtureThread.evaluate(element => element.click())
    }
    const chat = await inspect(page, 'chat', viewport.width)
    if (screenshots) await page.screenshot({ path: join(screenshots, `chat-${viewport.width}.png`), fullPage: true })
    await page.goto(`${config.publicOrigin.origin}/files?${new URLSearchParams({ path: note })}`); await unlock(page)
    const file = await inspect(page, 'files', viewport.width)
    if (screenshots) await page.screenshot({ path: join(screenshots, `files-${viewport.width}.png`), fullPage: true })
    assert.deepEqual(errors, [])
    results.push({ viewport: `${viewport.width}x${viewport.height}`, chat, files: file, documentOverflow: false })
    await context.close()
  }
  console.log(JSON.stringify({ realMarkdownRenderers: true, encryptedHttp: true, modelTurns: 0, results }))
} catch (error) {
  for (const [index, page] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) {
    await page.screenshot({ path: `/tmp/markdown-table-failure-${index}.png`, fullPage: true }).catch(() => {})
  }
  throw error
} finally {
  await browser?.close(); controller?.stop()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(root, { recursive: true, force: true })
}
