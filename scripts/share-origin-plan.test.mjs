import { it, expect } from 'vitest'
import { originPlan, patchSharePorts } from './share-origin-plan.mjs'
const ports = [2345, 5180, 5210, 5211, 5212, 5213, 5215]
const hosts = ports.map(p => `p${p}.danhkhai.io.vn`).join(' ')
const nginx = `map $host $allow { default 0;\n${ports.map(p => `p${p}.danhkhai.io.vn 1;`).join('\n')} }
server { server_name ${hosts}; }
server { server_name ${hosts}; ssl_certificate /etc/letsencrypt/live/codex-preview-ports/fullchain.pem; ssl_certificate_key /etc/letsencrypt/live/codex-preview-ports/privkey.pem; proxy_pass http://127.0.0.1:5174; }`
const registry = { version: 1, services: [5217, 5221, 5222].map(port => ({ port, identity: '11111111-1111-4111-8111-111111111111' })) }
it('prepares only registered exact HTTPS hosts while retaining private gateway and every existing host', () => {
  const plan = originPlan(registry, ports, nginx, [5221, 5217, 5222])
  expect(plan.ports).toEqual([...ports, 5217, 5221, 5222])
  for (const p of plan.ports) expect(plan.active).toContain(`p${p}.danhkhai.io.vn 1;`)
  expect(plan.active).toContain('proxy_pass http://127.0.0.1:5174;')
  expect(plan.active).not.toContain('*'); expect(plan.active).not.toContain('proxy_pass http://127.0.0.1:5221')
  expect(plan.bootstrap.startsWith(nginx)).toBe(true); expect(plan.bootstrap).toContain('ssl_reject_handshake on;')
  expect(plan.envPatch.CODEX_REMOTE_PREVIEW_SHARE_PORTS).toBe(plan.ports.join(','))
  expect(plan.certbotArguments).toContain('codex-preview-ports-v2')
})
it('rejects unregistered, gateway, malformed and drifted host plans', () => {
  for (const additions of [[5999], [5174], [443], [NaN]]) expect(() => originPlan(registry, ports, nginx, additions)).toThrow()
  expect(() => originPlan(registry, ports, nginx.replace('default 0;', 'default 1;'), [5221])).toThrow()
  expect(() => originPlan(registry, ports, nginx.replace('server_name', 'unknown'), [5221])).toThrow()
})

it('patches only the preview ports value with drift/duplicate checks and retains all unrelated bytes', () => {
  const prefix = '# fixture\nSECRET="fake-only"\nCODEX_REMOTE_SECURE_API=required\n'
  const original = Buffer.from(prefix + 'CODEX_REMOTE_PREVIEW_SHARE_PORTS="' + ports.join(',') + '"\n')
  const patched = patchSharePorts(original, ports, [...ports, 5221]).toString()
  expect(patched.startsWith(prefix)).toBe(true); expect(patched).toContain('CODEX_REMOTE_PREVIEW_SHARE_PORTS=' + [...ports, 5221].join(','))
  expect(() => patchSharePorts(Buffer.from(original + 'CODEX_REMOTE_PREVIEW_SHARE_PORTS=5221\n'), ports, [...ports, 5221])).toThrow()
  expect(() => patchSharePorts(original, [5221], [5221])).toThrow()
  expect(() => patchSharePorts(original, ports, [5221])).toThrow()
})

it('supports the next registered-port expansion after this rollout without overwriting an old certificate lineage', () => {
  const first = originPlan(registry, ports, nginx, [5217, 5221, 5222])
  const next = originPlan({ ...registry, services: [...registry.services, { port: 5223, identity: '22222222-2222-4222-8222-222222222222' }] }, first.ports, first.active, [5223])
  expect(next.active).toContain('/live/codex-preview-ports-v3/fullchain.pem')
  expect(next.certbotArguments).toContain('codex-preview-ports-v3')
  expect(next.ports).toContain(5223); expect(next.ports).toEqual([...first.ports, 5223])
})
