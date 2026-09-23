# UI + first-claim PWA fix on remote

Task49be13f2-3bb1-44d3-a714-f89b5c91e868. CR3 integrated CR2's reviewed focused84acffdea5480a4c1443088df91632611a6a5300 onto deployed UIc9425a1/1424647 in a NEW worktree, `/root/WORKTREES/cr-remote-ui-pwa-integration`. No recursive workers. Actual receipt: gpt-6-astra/high, turn01a0cdbc-a0e4-7372-9e46-5644149d606d.

Branch `fix/remote-ui-pwa-integration`. Product cherry-pick **aed96d80bc51b21bdd720c3b0a990082b7c89684**; verified frontend source **ae2bd95a613bbb204ac64dd4167e1008d5d12ba8** also repairs the old logo browser fixture's setup response and deferred details-toggle assertion. No PR. Accepted CR2 delivery SHA2e993b961b6ca195764bb8c38e75016cc499b9d85395cea0fc5a0f708ab56ecc was checked against exact pushedcf5d590.

## Behavior and scope

The first service-worker controller claim now retains the existing page/RAM key. Replacement of a previously controlling worker, including SKIP_WAITING, still flushes screen state and reloads exactly once. Main wiring and the14-line pwaController helper are the only additional product changes. SecureGate, styles, App, ActionMenu and secureApi bytes remain identical to the UI release.

The complete client preserves the singular mobile menus, branded login/unlock and removal of the floating Lock button. Existing Lock app remains in the logo menu. Login password and unlock key remain separately labeled; no401-to-password redirect added.

**Cold reopen/reload still discards the RAM key.** With a valid persistent cookie the user needs only the encryption key, not another password. No durable CryptoKey/raw-key persistence, trusted-device toggle, session TTL change or credential protocol change is included. The separate opt-in device-trust decision remains with the user/leader; it is not a deployment gate for this fix.

## Checks

All heavy checks/build/browser/publication guards ran through codex-heavy sequentially,1worker, Node heap1024MiB. Lint0, client typecheck,7 focused shell-worker/migration tests, clean complete client build and PWA validation pass.

Merged-source real browser fixture passes first claim retaining RAM key, worker replacement reloading once, background resume, cookie retention across page/tab/browser restart, unlock without repeating password, two-tab Lock, fake-key rotation rejection, logout replay401, expiry401 and zero native effects. CR2's inverse before/after evidence is reused; no need to rerun a known vulnerable build.

Complete built UI tested in Chromium and WebKit1280/390: menu/focus/Escape/Tab/conversation/sidebar dismissal, fake login/proof/unlock/error/busy and logout pass. Previous320/375 UI evidence is reused because those product files are byte-identical. Logo/settings regression verifies desktop/mobile Reload, retained conversation/draft/storage, waiting worker/controllerchange, and no turn/interrupt/logout side effects. The old logo fixture required a valid public setup fixture and waiting for asynchronous details toggle; both corrected without product changes.

These are automated engines, not physical iPhone Safari. Production model turns and Hours mutations were not performed. No backend build/output symlink was used: dependencies and accepted backend fixture bytes are private local copies.

## Publication and evidence

Evidence root: `/root/.local/state/codex-remote/remote-ui-pwa-49be13f2/`.

**LIVE verified 2026-09-23T10:17:03.741Z**. LIVE.json SHA256 **62b826b5d61885a79c07817a127a1389e4aca63adfd3ef67e69276ef489263b7**. All25 client disk hashes and40 public/loopback body checks pass;8 literal import references resolve. NEW PID1940721 and OLD1934453 remain unchanged; backend90/Hours/helpers/key/config and OLD main/client/backend match baseline.

The candidate contains25 matching files, with9 actual client writes. Its unchanged docx-preview JavaScript retains the existing immutable source map after equality checks of all map fields except source path locations. All old hashed assets remain. Exact preimages/parents and baseline hashes were checked under the shared deployment lock; verified backup in `backup/dist`; assets first/index last. No OLD changes, gateway restart, key initialization/rotation, config/Nginx edit, backend/Hours/helper/state deployment, initial activation replay or old seal mutation.

`candidate.json` and `published.json` bind artifacts/write order; `check.log`, `logo-final.log`, `browser.json`, `assets-live.json`, `live-smoke.json` and `LIVE.json` hold checks. Full public/loopback body hashes and live login/unlock/touch menu/logo Lock use only an isolated owned browser session; no credential screenshots or logs. NEW Services is updated with the combined branch/source. OLDmain7b8c20a remains independent.

Future frontend builds must include this combined lineage; never deploy CR2's standalone older UI over it. For any unknown publication failure inspect the journal and current hashes under the shared lock before corrective action; do not restore databases, rotate keys or restart OLD. Previously open pages may use Reload app for the update and then enter the key once.
