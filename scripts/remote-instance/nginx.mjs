// New-instance renderer only. Never renders or replaces the legacy codex site.
export const HOST = 'remote.danhkhai.io.vn'
export const CERT = 'codex-remote-secure'
export const PORT = 5174
export function renderNginx(mode) {
  if (!['bootstrap', 'parked', 'active'].includes(mode)) throw Error('Unknown remote site mode')
  const http = `server {
    listen 80;
    listen [::]:80;
    server_name ${HOST};
    if ($host != ${HOST}) { return 421; }
    location ^~ /.well-known/acme-challenge/ { root /var/lib/codex-preview-acme; try_files $uri =404; }
    location / { return 308 https://${HOST}$request_uri; }
}`
  const tls = mode === 'bootstrap' ? '    ssl_reject_handshake on;' : `    ssl_certificate /etc/letsencrypt/live/${CERT}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${CERT}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;`
  const forwarding = `        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For "";
        proxy_set_header Forwarded "";
        proxy_set_header CF-Connecting-IP "";
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 1h;`
  const routes = mode === 'active' ? `    include /etc/nginx/snippets/codex-cloudflare-real-ip.conf;
    client_max_body_size 26m;
    location = /workboard { return 303 /services; }
    location ^~ /workboard/ { return 303 /services; }
    location = /api/secure/request {
        client_max_body_size 36m;
        client_body_timeout 60s;
        proxy_pass http://127.0.0.1:${PORT};
${forwarding}
        proxy_set_header Upgrade "";
        proxy_set_header Connection "";
        proxy_request_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:${PORT};
${forwarding}
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $codex_remote_secure_connection;
    }` : '    add_header Cache-Control "no-store" always;\n    location / { return 503; }'
  const map = mode === 'active' ? 'map $http_upgrade $codex_remote_secure_connection { default upgrade; \'\' close; }\n' : ''
  return `# remote.danhkhai.io.vn NEW instance; ${mode}; legacy and preview sites excluded.\n${map}${http}\nserver {\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    server_name ${HOST};\n    if ($host != ${HOST}) { return 421; }\n${tls}\n${routes}\n}\n`
}
