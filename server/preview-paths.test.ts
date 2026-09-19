import { expect, it } from 'vitest'
import { previewPath, rewritePreviewText } from './preview-paths.js'

it('rewrites local references without duplicating prefixes or touching external URLs', () => {
  expect(previewPath(3000, '/assets/app.js?q=1')).toBe('/preview/3000/assets/app.js?q=1')
  expect(previewPath(3000, '/preview/3000/assets/app.js')).toBe('/preview/3000/assets/app.js')
  expect(previewPath(3000, 'http://localhost:3000/api')).toBe('/preview/3000/api')
  expect(previewPath(3000, 'https://example.com/app.js')).toBe('https://example.com/app.js')
  expect(previewPath(3000, './app.js')).toBe('./app.js')
})
it('rewrites module imports and CSS resources while preserving ordinary application data', () => {
  expect(rewritePreviewText('import x from "/x.js"; import("/lazy.js"); const s="/untouched-data";', 'application/javascript', 3000))
    .toBe('import x from "/preview/3000/x.js"; import("/preview/3000/lazy.js"); const s="/untouched-data";')
  expect(rewritePreviewText('a{background:url(/img/a.png)} @import "/style.css";', 'text/css', 3000))
    .toBe('a{background:url(/preview/3000/img/a.png)} @import "/preview/3000/style.css";')
  expect(rewritePreviewText('{"path":"/untouched"}', 'application/json', 3000)).toBe('{"path":"/untouched"}')
})
