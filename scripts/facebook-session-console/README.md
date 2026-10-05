# Facebook accounts

A shared, access-code-protected dashboard for manually managing browser sessions.
Open the service on private preview port 5217 through Codex Remote Services.
The interface uses one row per account, a light theme, and a browser panel that
works on desktop and mobile.

## Use

1. Unlock with the existing console access code.
2. Select **Add account** and enter the account ID/email, password and,
   optionally, the authenticator secret.
3. Choose **Start login** on that account. Complete verification yourself in
   the browser panel. The current authenticator code is available when the
   page requests it; email/SMS codes must come from your own inbox or phone.
4. Choose **Use saved session** to reopen that account's existing Chromium
   profile. It does not create a fresh login; if Facebook presents a checkpoint,
   the same manual browser remains available so you can continue it. Choose
   **Stop browser** to end the active browser. **Lock** hides the dashboard and
   clears access from the current page; it does not log the Facebook account out.

One browser can run at a time. Each account has separate credentials, browser
profile and verification marker. Everyone with access to this shared console
can manage its accounts; this is not a separate login system for each person.
There are no batch login or engagement actions. The active worker uses ordinary
Playwright with Chromium and manual verification; it does not call a CAPTCHA
solver, inject challenge tokens or configure evasion proxies.

Each account stays on one compact, selectable row. Its Facebook display name
and profile picture are refreshed from `/me` only after that saved browser
session is authenticated as the expected account. Before the first successful
check, the login identifier is used as the temporary label. Its status is derived from real state:
**Not logged in** when there is no verification marker, **Logged in** when a
verified marker exists, and **Locked** when an owner marks the account locked.
Locked accounts cannot start a browser job. The activity tag shows the current
browser job or **Idle**; it does not trigger an action. An account with a saved
session offers **Use saved session** instead of asking for another login.

The browser stays open for manual input for up to 30 minutes. Click/tap or drag
on the image and use the text, keyboard and scroll controls. On a small screen,
use the browser panel's zoom and internal scrolling. The image relay cannot
provide a webcam for a video-selfie requirement. Stage detection can be affected
by Facebook changing its pages; an unknown page remains available for manual
inspection and is not counted as a successful login.

## Data and migration

State is private under `/root/.local/state/facebook-session-console`, with
directories mode 0700 and credential files mode 0600. The console access code
remains at `access-code`; retrieve it over SSH when needed:

```sh
sudo cat /root/.local/state/facebook-session-console/access-code
```

The first start creates an account registry. The previous one-account entry
points to its existing root-level `account.json`, `browser-profile` and
`storage-state.json`; migration does not move or copy that profile. Accounts
added later get their own directories. Existing secrets, including any legacy
solver key, are not returned by the API. A legacy solver key is not used by
the new worker.

Profile names and avatar captures are stored in the account's private directory
with mode 0600. The worker captures the visible Facebook profile picture instead
of exposing its CDN URL or asking for a manual upload. Avatar reads require the
same console access code and never expose filesystem paths.

`storage-state.json` is a secret-free verification marker. Browser cookies
remain in the account's profile. A new marker is written only after a second
browser process can verify the saved session. A marker's existence reports a
previously verified session, not proof that Facebook still accepts it now.

The API requires `X-Session-Console-Key` on every request. Lists contain masked
identifiers and no passwords, cookies or authenticator secrets. Browser frames
are held in memory and returned without caching. TOTP codes are returned only
for the active account during its authenticator step. Account IDs are stable
internal IDs; a request for another account cannot control the active browser.
Editing blank password/secret fields preserves those values. The login ID is
immutable to prevent reassigning a saved profile to another account.

## Runtime and checks

The standalone unit is `facebook-session-console.service`, listening only on
`127.0.0.1:5217`. The authenticated preview gateway remains in front of it.
The console's own access code is required as well. This service is independent
of the main Codex Remote gateway.

The server launches `worker_manual.mjs` with Node. It imports the locally
installed `playwright-core` from
`/root/.local/share/facebook-headless/node_modules/playwright-core/index.mjs`
(overridable with `FB_PLAYWRIGHT_MODULE`), and uses `FB_CHROME_PATH` for Chromium.
Xvfb supplies the display. Each job receives its own `FB_SESSION_STATE_DIR`.
Credentials pass over the child process's stdin and are not command arguments.
The old workers remain in source for rollback and are not used by this server.

Use `codex-heavy` for focused API, worker and browser fixture checks. Fixtures
must use dummy credentials and local pages; they must not create paid CAPTCHA
tasks, Facebook logins, likes, views or production accounts.

Active checks from the repository worktree:

```sh
codex-heavy --label facebook-accounts-api -- env TMPDIR=/tmp node --test scripts/facebook-session-console/console.node.mjs scripts/facebook-session-console/accounts.node.mjs
codex-heavy --label facebook-manual-worker -- env TMPDIR=/tmp node --test scripts/facebook-session-console/worker-manual.node.mjs
codex-heavy --label facebook-accounts-ui -- env TMPDIR=/tmp node scripts/facebook-session-console/accounts-ui-smoke.mjs
codex-heavy --label facebook-accounts-integration -- env TMPDIR=/tmp node scripts/facebook-session-console/accounts-integration-smoke.mjs
```

Node-runner fixtures use `.node.mjs` so the main app's Vitest run does not
collect them as empty suites. Set `TMPDIR=/tmp` for the main repository check;
private `.local` paths are intentionally denied by Files policy tests.

Before publishing, capture exact runtime preimages and verify the standalone
browser is idle. Back up the current code and registry/config metadata, replace
reviewed files, then restart only `facebook-session-console.service`.
Verify authenticated account-list health, anonymous access rejection, complete
static file hashes and preservation of the old account/profile/marker. Do not
restart the main Codex Remote service for this app. Update the existing Services
entry with its registration identity preserved. Keep rollback code and avoid
rolling back account data after new accounts have been created.
