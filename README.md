# Codex Remote

Standalone phone client and local Codex App Server bridge.

Requirements: Node 22.23.2, the Codex CLI installed on the host, and a working
Codex login on that host. Codex Remote starts `codex app-server` itself.

```sh
cd /path/to/codex-remote
cp .env.example .env
# Edit .env with this machine's values before starting.
npm ci
npm run check
npm start
```

`npm start`, `npm run dev`, and `npm run status` load the ignored `.env`.
Keep credentials and `.remote-push.json` private; preserve both across moves.
See [operation and configuration](docs/codex-remote-control.md).

All deployment-specific values belong in `.env`: public origin, gateway password,
session secret, Codex binary, and workspace roots. Historical Codex threads retain
their original workspace path; changing roots does not rewrite those histories.

Images: attach, paste, or drop up to four PNG/JPEG/WebP files, 10 MB each.
Uploads remain local and session-owned. Accepted images remain available until
the turn completes, with a 24-hour cleanup fallback for missing completion
events. Unsent images expire after ten minutes; restarting clears temporary
uploads. Failed sends retain the browser draft for retry.
