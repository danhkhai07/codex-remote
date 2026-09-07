---
name: codex-remote-control
description: Run, expose, inspect, or troubleshoot the private Codex Remote Control phone client and its local App Server bridge. Use for requests about the remote phone UI, its ngrok tunnel, or access to persistent local Codex threads; do not use for ordinary Codex work unrelated to that control surface.
---

# Codex Remote Control

Operate from the Codex Remote app root (the directory containing `package.json`).
All deployment-specific values come from its ignored `.env`. Read `docs/codex-remote-control.md` before changing configuration,
exposure, authentication or process lifecycle.

## Invariants

- Keep the Node gateway on loopback. Expose it only through the exact configured
  HTTPS origin, a private VPN or SSH forwarding.
- Never expose Codex App Server itself. The gateway owns its `stdio` transport.
- Never print, commit, place on a command line or forward
  `CODEX_REMOTE_PASSWORD`, `CODEX_REMOTE_SESSION_SECRET`, mail credentials or
  Codex/OpenAI credentials. Confirm presence or length without displaying value.
- Keep workspace roots canonical and explicit. Do not accept a browser-supplied
  path outside `CODEX_REMOTE_WORKSPACE_ROOTS`.
- Completion alerts use server-side Web Push and the PWA service worker, not
  browser SSE. Preserve the private `.remote-push.json` state across deployment;
  never print or commit its VAPID private key or device subscriptions. Verify
  the active worker supports push before reporting the bell enabled. Distinguish
  injected browser tests from actual delivery to an opted-in device.
- Preserve `workspace-write` and explicit workspace roots. YOLO may set `never`
  for future authenticated turns. Preserve the user's saved device preference
  across reloads, logout/login and gateway restarts; change it only through an
  explicit user toggle. Keep the active mode visibly indicated.
- Sending email, publishing a tunnel, stopping another service, pushing source
  or changing remote state still requires the user's request to cover that
  action.

## Operate

1. Run `git status --short --branch` and preserve user-owned changes.
2. Use `npm ci` only for a new checkout or changed lockfile.
3. Run `npm run check` after changing the client. Build production assets
   before serving them.
4. Check `npm run status` before starting another instance. If port 5173
   belongs to an unrelated process, report the collision instead of terminating
   it.
5. Start the app with `npm start`; it loads the private local `.env` automatically.
   Keep the process supervised, then verify `/api/healthz` locally.
6. When the user requests a tunnel, use the exact public origin in `.env` as its
   URL and run it as a separate supervised process. If the configured listener uses another loopback address,
   pass `http://<loopback-host>:5173` as ngrok's target. Verify the public health
   endpoint and login page without disclosing credentials.
7. Leave both processes running when phone review is requested. Report the
   public URL, local health, tunnel health, selected workspace and checks run.

Treat Codex thread storage as the durable conversation source. The pending-request
map and bounded event ring are process-local. Restart only when active turns are
idle. Signed browser sessions survive a restart when their signing secret is
preserved and the session has not expired; stored threads can be resumed.
