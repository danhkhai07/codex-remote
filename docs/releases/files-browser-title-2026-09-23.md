# File browser tab titles

Candidate only; no publication or restart. Based on Services middle-click
`44dd72601383ab74b371c302f1e9c6cb80d9de4f`, itself based on live frontend
`9ca8c1855633135d095ddec0c8c8c90b3b5f5e5b`. Integrate both commits for that
lineage, or cherry-pick this focused title commit independently.

The shared FileViewer sets the top-level tab title to the authenticated metadata
basename followed by ` · Codex Remote`. This covers the standalone `/files` page,
chat file links and Files browser selections. Loading/error/directory attempts
use `Files · Codex Remote`; missing paths retain the default page title. Names
are never taken directly from a locked URL. Cleanup restores the prior title
on viewer close or SecureGate unmount, without overwriting a newer title written
by another page. Preview iframe/application titles are untouched.

The owner Files browser fixture exercises Unicode names, file-to-file navigation,
Back/Forward, new tabs before/after unlock, reload, error/directory/missing paths,
HTML isolation, conversation viewer close, and Lock at desktop/mobile sizes.
It uses only disposable fake files, sessions and native RPC. No production
content/key or model turns are involved.

Verification logs: `/tmp/files-title-check.log` (lint/typecheck/server/client
build/PWA pass; initial browser setup rejected the older source backend's key
root policy), then `/tmp/files-title-browser.log` using a private copy of the
live owner-full `dist-server` artifacts. The frontend lineage contains owner-full
client changes but does not include that separately deployed backend source.
Do not publish the old backend compiled from this frontend branch. This
candidate changes only FileViewer, the browser fixture and this document.

Final lint and browser acceptance passed at 1280×800, 390×844 and 320×700
through codex-heavy unit `codex-heavy-853c4412a08249cabecab9d103db8b91.service`.
The cross-tab Lock check confirms a live file title returns to the default
without reloading. Screenshots: `/tmp/files-title-browser/owner-direct-*.png`.
Chromium only; no physical Safari test. No production publication/restart.
