import { HOSTS, assert } from './common.mjs'

/** Stage only. Keep the seven-host boundary even when preview is an IPv6 default. */
export function restrictPreviewHosts(preview) {
  const names = [...preview.matchAll(/server_name\s+([^;]+);/g)].map(match => match[1].trim().split(/\s+/))
  assert(names.length === 2 && names.every(list => JSON.stringify(list) === JSON.stringify(HOSTS)), 'preview-host-allowlist-drift')
  assert(!preview.includes('$codex_preview_allowed_host'), 'preview-host-guard-already-present')
  const map = 'map $host $codex_preview_allowed_host {\n    default 0;\n' + HOSTS.map(host => `    ${host} 1;`).join('\n') + '\n}\n\n'
  return map + preview.replace(/(server_name\s+[^;]+;)/g, '$1\n    if ($codex_preview_allowed_host = 0) { return 421; }')
}

/** Shared by the final builder and the owned readiness fixture; no live writes. */
export function renderProxyConfigs({ admin, cutover, preview, secureLocation }) {
  assert(admin.includes('return 303 /preview/5180/workboard/;') && admin.includes('rewrite ^/workboard/(.*)$ /preview/5180/workboard/$1 redirect;'), 'legacy-workboard-template-drift')
  const secureAdmin = admin.replace('return 303 /preview/5180/workboard/;', 'return 303 /services;')
    .replace('rewrite ^/workboard/(.*)$ /preview/5180/workboard/$1 redirect;', 'return 303 /services;')
  assert(cutover.includes('location / { proxy_pass http://127.0.0.1:5173; }'), 'maintenance-template-drift')
  return {
    'admin-active.conf': secureAdmin.replace('    location = /workboard', secureLocation + '\n    location = /workboard'),
    'admin-maintenance.conf': cutover.replace('location / { proxy_pass http://127.0.0.1:5173; }', 'location / { add_header Cache-Control "no-store" always; return 503; }'),
    'preview-active.conf': restrictPreviewHosts(preview),
  }
}
