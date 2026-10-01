// Preparation only. It never edits Nginx, env, certificates, registry or grants.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseEnv, isDeepStrictEqual } from 'node:util'
export function originPlan(registry, existingPorts, nginx, additions) {
  const valid = p => Number.isInteger(p) && p >= 1024 && p <= 65535 && ![5173, 5174].includes(p)
  assert(existingPorts.length && existingPorts.every(valid) && additions.length && additions.every(valid), 'Invalid preview ports')
  assert(registry.version === 1 && Array.isArray(registry.services), 'Registry schema')
  for (const port of additions) assert(registry.services.some(s => s.port === port && typeof s.identity === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.identity)), 'Port must be registered with durable identity: ' + port)
  const old = [...new Set(existingPorts)].sort((a, b) => a - b), added = [...new Set(additions)].filter(p => !old.includes(p)).sort((a, b) => a - b)
  assert(added.length, 'No new ports')
  const ports = [...old, ...added].sort((a, b) => a - b), host = p => `p${p}.danhkhai.io.vn`
  const oldNames = old.map(host).join(' '), names = ports.map(host).join(' '), newNames = added.map(host).join(' ')
  assert.equal((nginx.match(new RegExp('server_name ' + oldNames.replaceAll('.', '\\.') + ';', 'g')) || []).length, 2, 'Review unknown Nginx baseline instead of broadening it')
  assert(nginx.includes('default 0;') && nginx.includes('proxy_pass http://127.0.0.1:5174;'), 'Existing exact-host gateway boundary required')
  assert(ports.length <= 100, 'Preview origin plan is bounded to 100 exact hosts')
  const certificate = nginx.match(/ssl_certificate \/etc\/letsencrypt\/live\/(codex-preview-ports(?:-v[1-9][0-9]*)?)\/fullchain\.pem;/)?.[1]
  assert(certificate && nginx.includes(`ssl_certificate_key /etc/letsencrypt/live/${certificate}/privkey.pem;`), 'Review unknown certificate lineage')
  const version = certificate === 'codex-preview-ports' ? 1 : Number(certificate.split('-v')[1])
  assert(Number.isSafeInteger(version) && version < 1000, 'Certificate lineage limit')
  const nextCertificate = `codex-preview-ports-v${version + 1}`
  for (const p of old) assert(nginx.includes(host(p) + ' 1;'), 'Existing exact map missing host')
  const active = nginx.replace('default 0;', 'default 0;\n' + added.map(p => `    ${host(p)} 1;`).join('\n'))
    .replaceAll('server_name ' + oldNames + ';', 'server_name ' + names + ';')
    .replaceAll(`/live/${certificate}/`, `/live/${nextCertificate}/`)
    .replace('Seven isolated preview hosts', 'Explicit isolated preview hosts')
  const bootstrap = nginx + `\n# New hosts: ACME only; never bypass the preview gateway.\nserver {
    listen 80; listen [::]:80;
    server_name ${newNames};
    location ^~ /.well-known/acme-challenge/ { root /var/lib/codex-preview-acme; try_files $uri =404; }
    location / { return 503; }
}
server {
    listen 443 ssl; listen [::]:443 ssl;
    server_name ${newNames};
    ssl_reject_handshake on;
}
`
  return { ports, added, hosts: ports.map(host), envPatch: { CODEX_REMOTE_PREVIEW_SHARE_PORTS: ports.join(',') }, bootstrap, active,
    certbotArguments: ['certonly', '--webroot', '-w', '/var/lib/codex-preview-acme', '--cert-name', nextCertificate, ...ports.flatMap(p => ['-d', host(p)]), '--deploy-hook', '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'] }
}
export function patchSharePorts(bytes, existing, next) {
  const key = 'CODEX_REMOTE_PREVIEW_SHARE_PORTS', before = parseEnv(bytes.toString()), lines = bytes.toString().split('\n')
  const matches = lines.map((line, index) => /^\s*(?:export\s+)?CODEX_REMOTE_PREVIEW_SHARE_PORTS\s*=/.test(line) ? index : -1).filter(i => i >= 0)
  assert.equal(matches.length, 1, 'Missing/duplicate preview port configuration')
  assert.equal(before[key], existing.join(','), 'Preview port baseline drift')
  assert(next.every(p => Number.isInteger(p) && p >= 1024 && p <= 65535 && ![5173, 5174].includes(p)) && new Set(next).size === next.length && existing.every(p => next.includes(p)), 'Invalid expansion')
  lines[matches[0]] = key + '=' + next.join(',')
  const result = Buffer.from(lines.join('\n'))
  assert(isDeepStrictEqual(parseEnv(result.toString()), { ...before, [key]: next.join(',') }), 'Unrelated environment changed')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [registryFile, nginxFile, currentPorts, extraPorts, output] = process.argv.slice(2)
  assert(output && extraPorts && currentPorts, 'Usage: node share-origin-plan.mjs SERVICES NGINX EXISTING_CSV ADD_CSV NEW_OUTPUT_DIRECTORY')
  const parse = s => s.split(',').map(Number), registryBytes = readFileSync(registryFile), nginxBytes = readFileSync(nginxFile)
  const plan = originPlan(JSON.parse(registryBytes), parse(currentPorts), nginxBytes.toString(), parse(extraPorts))
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  mkdirSync(output, { mode: 0o700 })
  for (const [name, bytes] of Object.entries({ 'nginx-bootstrap.conf': plan.bootstrap, 'nginx-active.conf': plan.active,
    'plan.json': JSON.stringify({ ...plan, bootstrap: undefined, active: undefined, status: 'prepared-not-activated', preimages: { registry: hash(registryBytes), nginx: hash(nginxBytes) }, candidate: { bootstrap: hash(plan.bootstrap), active: hash(plan.active) } }, null, 2) + '\n' })) writeFileSync(resolve(output, name), bytes, { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ prepared: true, hosts: plan.hosts, productionMutation: false }))
}
