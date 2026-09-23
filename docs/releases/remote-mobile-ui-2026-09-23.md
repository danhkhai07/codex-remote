# Remote mobile menus and secure login — LIVE 23 September 2026

Task `3ae4151f-d789-4bde-9799-0004174d1504`, CR3. User explicitly requested a mobile menu fix, cleaner login/unlock, removal of the floating lock button and publication on **remote.danhkhai.io.vn**. Earlier uncertainty about which screen the user meant is superseded. Actual native turn receipt: `01a0cd9e-b71e-7ac2-804f-e9ea2b2b93f0`, **gpt-6-astra/high**; no delegation.

## Published change

Frontend **142464769c035bcc11096cc1d35b22558b149e15**, branch `fix/remote-mobile-menus-login`, from `4de7808e2438c523b0e233c10e3f566c932b8e6a` (accepted app10f52e9 lineage). Menu commit0b6c787; gate/fixtures commit1424647. No PR. Keep `/root/WORKTREES/cr-remote-mobile-menus-login` for NEW lineage integration; never merge encrypted source into OLD main.

The old conversation/folder components rendered every panel and relied on native `popover="auto"` hiding. An engine ignoring that attribute renders all panels. A fixture reproduces their overlap by removing the browser hiding behavior. IMG_8483 was unavailable at its supplied path: this does **not** establish the exact iPhone/Safari version or independently reproduce that device. The implementation gap and resulting overlap were reproduced.

`ActionMenu` mounts only the open panel in a portal, independently of native Popover API. It measures/clamps the panel to the viewport, dismisses other menus, and closes on outside pointer/focus, Escape, Tab leaving the group, scrolling/resizing, conversation and sidebar changes. Escape restores trigger focus; actions retain their callbacks/disabled conditions. Closed logo details content has explicit CSS hiding.

SecureGate reuses the old brand lockup and form/button styling, with responsive headings, spacing, labeled password-manager-compatible login/key inputs and error/busy states. Lifecycle epochs, proof, encrypted transport and logout logic are unchanged. The floating control is removed; **Lock app** remains in the logo menu. Distinct field identities preserve the distinction between login password and encryption key.

## Checks

Heavy work used codex-heavy sequentially, VITEST_MAX_WORKERS=1 and Node heap1024MiB.

- Lint0 warnings/errors; initial full typecheck and final client typecheck; clean client build/PWA validation pass.
- 13 tests across secure-migration, shell-worker, screenState and pinnedFiles pass.
- Real SecureGate/SessionRegistry two-tab lifetime fixture passes delayed setup/proof across Lock, newer unlock preservation, migration/unmount cancellation, delayed cache/mutation/picker/writer cancellation and normal controls. The harness lock button is fixture-only; the existing secure-api browser fixture now invokes its test-harness lock method. No broad protocol suite repeated.
- Chromium and Playwright WebKit at1280/320/375/390px: singular/closed menus, viewport, focus/Escape/Tab, programmatic conversation switch, drawer/outside dismissal, rename dialog, login/unlock/error/busy and real encrypted fake-session logout pass. Final clean package rerun passes both engines at390. **Not physical iPhone Safari.** WebKit sometimes reports a cancelled setup fetch during first service-worker takeover/reload; recorded separately, with action assertions starting after the worker controls a usable app. No action-phase menu errors.
- Live isolated Chromium390 context with touch: actual login/proof/unlock, menu tap/dismiss, no overflow/floating control and logo Lock revoking only its own session pass. No model turn or Hours action. Credentials only consumed privately in memory; screenshots contain empty public gate fields. No owner key in secure packets or legacy private browser dispatch; plaintext private API403.
- 25 deployed client hashes,40 full-body public/loopback checks and8 literal import references pass. Old hashed assets retained. Backend90, Hours/helpers/config/key, OLD backend/client/main and four service identities match baseline. NEW PID1940721 and OLD1934453 unchanged; no restart.

## Publication evidence

Root-private directory: `/root/.local/state/codex-remote/remote-ui-3ae4151f/`.

`LIVE.json` SHA256 **9629de72bb049687dd5f42a8a8488e923a97ec97a9c0810d0cbbb44a34039821** records live verification at **2026-09-23T10:02:34.021Z** and binds candidate/publication/assets/browser/Services/check receipts. `attempt2/candidate.json` inventories25 files; `attempt2/published.json` records10 writes. Shared deployment lock, exact destination/parent preimages, verified private client backup and pre/post invariants guarded publication. Assets first/index last; unchanged worker/static bytes skipped. No activation runner, key initialization, Nginx edit or restart.

First packaging attempt aborted **before any write** on a vendor map collision. The clean package retains the existing docx-preview map after proving identical JavaScript and every map field except source path locations, including mappings/names/source content. `map-reuse.json` records this. Initial stale hashed build assets were moved aside and excluded from the final25 files.

Build isolation incident: an initial temporary dist-server symlink let typecheck touch runtime output. It was removed; the sole differing artifact, event-hub.js.map, was restored from the accepted immutable payload after hash verification. All90 backend artifact bytes/modes match accepted baseline; no runtime JavaScript byte change or process restart. Later checks used local directories/private dependency copy. See `build-isolation-correction.json`; never recreate that symlink.

NEW Services was updated via matching encrypted CLI under env-i; OLD Services untouched. Runtime frontend now follows1424647, backend accepted10f52e9/security808. Future builds must use this retained worktree/lineage instead of older copied runtime source. An already-open tab can use logo **Reload app** or reload once and unlock again.

Images in the evidence directory:

- before-menus-chromium-390.png: old client with unsupported-popover rendering simulated, not the missing user image.
- before-unlock-390.png: prior live empty unlock screen.
- menus-webkit-390.png, unlock-webkit-390.png, login-webkit-390.png: fake fixture after.
- live-unlock-390.png, live-login-390.png: actual public empty gate after publication.

Logs and failed fixture attempts retained. `attempt2/backup/dist` is the exact prepublication client backup. No automatic rollback or state restore: inspect journal/current hashes under shared lock for any unknown future failure. Never copy dist-server, restart OLD, rotate keys or replay initial activation for a frontend issue.
