import assert from 'node:assert/strict'
import test from 'node:test'
import { HOSTS } from './common.mjs'
import { restrictPreviewHosts, renderProxyConfigs } from './proxy-configs.mjs'
const preview = [80, 443].map(port => `server { listen ${port}; server_name ${HOSTS.join(' ')}; location / { proxy_pass http://127.0.0.1:5173; } }`).join('\n')
test('exact host guard is server-wide in both blocks, with no wildcard map entries', () => {
  const output = restrictPreviewHosts(preview)
  assert.equal((output.match(/if \(\$codex_preview_allowed_host = 0\) \{ return 421; \}/g) ?? []).length, 2)
  for (const host of HOSTS) assert(output.includes(`    ${host} 1;`))
  assert(output.startsWith('map $host $codex_preview_allowed_host {\n    default 0;'))
  assert(!output.includes('hostnames;')); assert(!output.includes('*.')); assert(!output.includes('default_server'))
})
test('unknown, missing or wildcard template names abort staging rather than widening policy', () => {
  for (const replacement of ['*.danhkhai.io.vn', 'p9999.danhkhai.io.vn', '']) assert.throws(() => restrictPreviewHosts(preview.replace(HOSTS[0], replacement)), /allowlist-drift/)
  assert.throws(() => restrictPreviewHosts(restrictPreviewHosts(preview)), /already-present/)
})
test('bookmarks use services, tunnel is included once, maintenance closes admin root', () => {
  const input = { admin: '    location = /workboard { return 303 /preview/5180/workboard/; }\n    location ^~ /workboard/ { rewrite ^/workboard/(.*)$ /preview/5180/workboard/$1 redirect; }',
    cutover: 'location / { proxy_pass http://127.0.0.1:5173; }', preview,
    secureLocation: 'location = /api/secure/request { client_max_body_size 36m; }' }
  const result = renderProxyConfigs(input)
  assert.equal((result['admin-active.conf'].match(/return 303 \/services;/g) ?? []).length, 2)
  assert(!result['admin-active.conf'].includes('/preview/5180'))
  assert.equal((result['admin-active.conf'].match(/client_max_body_size 36m/g) ?? []).length, 1)
  assert(result['admin-maintenance.conf'].includes('no-store')); assert(result['admin-maintenance.conf'].includes('return 503;'))
  assert.throws(() => renderProxyConfigs({ ...input, admin: input.admin.replace('/preview/5180/workboard/;', '/elsewhere;') }), /template-drift/)
})
