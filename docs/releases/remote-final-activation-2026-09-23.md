# Remote security instance — LIVE, old app retained

Task `ea9e77cc-cc67-4bc7-8abb-0e430402e68f`, completed 23 September 2026.
Actual worker receipt: `gpt-6-astra/max`, turn
`01a0cc61-d008-7e81-9d2b-1a523507dd5e`. No delegation or model test turn.

The user authorized using the existing independent snapshot, deleting only its
46 archived conversations, retaining 27 unarchived conversations and useful
knowledge, and activating `https://remote.danhkhai.io.vn`. The old
`https://codex.danhkhai.io.vn` stays available until the user says otherwise.
Full(strict) is user-confirmed, not an independent Cloudflare rule/API audit.

## Actual publication

| Component | Verified live state |
| --- | --- |
| New runtime | `/root/RUNNING-SERVICES/codex-remote-secure`, loopback5174 |
| New gateway / native | PID1940721 / PID1940729; gateway enabled; no restart loop |
| Old gateway | PID1934453, unchanged during this task |
| Old main | `7b8c20a74aef1bd37d92eb807e640615bd72974c`, unchanged |
| Workboard | PID1941876; scoped server/drop-in change, original data/session rows retained |
| Nginx | Master PID284687 retained; scoped reload completed |
| New Hours | Separate generator/service/timer enabled; oneshot Result=success |
| Application source | Accepted `10f52e9410dd593e9182483701f043b43338ccf1`, security80843c0 + reviewed Leader/native-create fixes |
| Installed application | 90 backend files and 25 matching client files; accepted bytes reused, no rebuild |
| Services | New registry populated before handing over the URL; old registry not edited by this worker |

Private evidence and guarded preimages/backups:
`/root/.local/state/codex-remote/remote-activation-ea9e77cc/`.
The independent worktree is `/root/WORKTREES/cr-remote-final-activation`, branch
`deploy/remote-final-activation`, from exactfedf6ea. Helpers were committed as
b12cc89 (purge/Hours), a6f7cd8 (creator identity), 21b08cc (Workboard/routes).
No old source/runtime/client replacement, old gateway stop/restart, initial
cutover runner, old release/seal change, or original native/Vault purge occurred.

`activation-manifest.json` SHA256:
`8cf92077a21d1a1c584905cb94dcf99e54723391abab1e04a5dbb2474a583c03`.
It captures exact live inventories and evidence, not a reusable authorization or
an immutable snapshot of subsequently changing user state. Its helperHead is
21b08cc; the later documentation commit changes no installed application bytes.
The accepted package manifest remains
`88f43bd538941920120a7d98612e84ed5866ffb019049a14782510f414b5d536`.

## Snapshot deletion and independent ownership

Offline, exclusive checks preceded mutation: new service/timer inactive, no
process holding a native snapshot descriptor/home, shared deployment lock,
expected46/27 counts and regular independent files. A durable exact-ID/file/hash
plan was written first. SQLite association columns were enumerated across
state/history/memory; secure deletion, VACUUM, integrity and FK checks completed.

46 archived threads were removed together with associated native history,
rollout files, history/index records and generated Vault transcript exports.
1,499 files were removed. The 27 remaining rollout hashes and nondeleted database
rows were verified unchanged **before native startup**. Maintained Context.md,
topic notes and operational backup evidence were kept. Original `/root/.codex`
and original Vault were not purged; those originals remain the recovery source.
No new duplicate transcript archive was made.

The live copied DB has27 unarchived/0 archived rows. Native `/api/threads`
returns12 under its existing list/workspace behavior; do not claim27 visible
cards. The other15 rows remain in the DB; five have projected history. Current
rollout event counts alone do not prove these are empty conversations. One
retained file has one malformed JSONL line and is byte-identical to its pre-purge
copy; it was not repaired. Native startup subsequently changed one other rollout.
The copied state remains the 22September16:54Z snapshot, not a continuous sync.
Later old-app work does not appear automatically in the new instance.

CODEX_HOME, CODEX_SQLITE_HOME, actual TOML sqlite_home, Vault, sessions, read state,
push state, Services, temp uploads and Hours all point at
`/root/.local/state/codex-remote-secure`. Actual native process environment/FDs
were checked; it does not open original mutable native state. Shared executable
package bytes are intentional. Original orchestration jobs remain old-only;
the copied scheduler starts empty and no task/model turn was replayed.

Hours keeps a timestamp-only `hours/activity-baseline.json` aggregate so deleting
archived transcripts cannot lower prior estimates. The adapter unions intervals
with the new instance's activity without double counting; accepted pause/epoch
logic remains in the unchanged generator. Read-only before/after API proof shows
no historical daily total loss and unchanged pause/timer/revision; no Pause/Resume
was called. Old Hours JS/map/generator/template remain unchanged. Both runtimes:

- JS `b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93`
- map `6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8`

## Key boundary and startup evidence

Immediately before key creation, authenticated **actual old HTTP Files** returned
403 for an owned nonsecret canary in the final key directory and200 for a normal
project file. This uses the live7b8c20a/PID1934453 boundary, not chmod/path secrecy.
New login password is the approved existing password; session secret is newly
random and independent. Required encryption is explicit; no plaintext fallback.

The key was generated once with O_EXCL, anchored directory/file descriptors,
fsync, and a creator-derived identity retained across binding/start checks.
The first prestart check failed because the operator child inherited old env
variables, which take precedence over Node's env-file. **systemctl start had not
run.** A clean-environment prestart passed. Explicit recovery inspected the known
failure, revalidated the exact original creator digest/device/inode/metadata,
held descriptors again, and started the new service. No unknown key adoption,
regeneration, rotation, old-stop operation or automatic mutation retry occurred.
A later verifier incorrectly expected27 list API rows; it stopped verification
without stopping/restarting the healthy instance. The subsequent DB/list evidence
records27 retained and12 listed accurately. Historical failed-attempt receipts
are preserved; final live receipts supersede their readiness status.

Private retrieval, **run by the user in their SSH session on this VPS**:

```sh
python3 -c 'import json; print(json.load(open("/root/.local/state/codex-remote-secure/secure-owner/owner-key.json"))["key"])'
```

Paste that value into **Khóa mã hóa riêng** after signing in with the usual login
password. Save it privately in a password manager; reload requires unlock again.
The task never printed this value in tools, logs, Git, Vault or URLs. The key file
is root-owned0600 under a0700 directory, outside allowed Files roots. Normal
restart reuses this file; do not run init/rotate as a restart/recovery shortcut.
Intentional root/native fullAccess or active frontend/XSS compromise remains
outside the agreed security target; this does not encrypt server history at rest.

## Preview and Workboard integration

Only remote and the exactseven preview hosts were activated toward5174:
p2345,p5180,p5210,p5211,p5212,p5213,p5215.danhkhai.io.vn. Existing certificates were
reused. The reviewed real-IP snippet was installed with an absence guard.
The remote tunnel has36m request limit; `/workboard*` on remote redirects to
`/services` for unlock/ticket. Old codex vhost/route bytes remain unchanged.
All five host Nginx temp directories remain www-data:root0700 with stable inodes.

Changing Workboard's sole expected Origin to loopback would break the old direct
route. The staged helper applies the accepted bc66e80 framing delta plus an
explicit optional canonical-loopback Origin alongside the original codex Origin.
Only `WORKBOARD_ISOLATED_PREVIEW=1` enables it. The new ancestor is exactly
https://remote.danhkhai.io.vn; parent Origin is not granted API authority.
CSRF, secure cookies, data path, account and session logic are retained. Fake
fixture login/save/logout controls passed for both routes; no real Workboard
login/task/save/logout was used. Logical account/session/state/backup/attempt
hashes were equal across the one scoped Workboard restart.

| Installed file | SHA256 |
| --- | --- |
| remote active site | eaefa3c234f3d67b199e6c80b4d99ef70d669518eb7d457e9070cf4ca563a4bd |
| preview active site | dc6b0432056c2e9f8fccf2838cd95e7edaefdd1e5ef37c7a501399e351d52b13 |
| CF real-IP snippet | 0abf967d02ba79488a8fba4db48df6adf2f874f944399a8f5ef2e603bf9dbccc |
| Workboard server.py | 90aa64acc805c178b0f1f4d3617bac59a382e791b73fa4c02da06fd76237f91f |
| Workboard remote-preview.conf | 0056d0be58f48dbd650412a25e3443ce032777f56274040e30f9a5d435211b7f |
| new Hours adapter | ff3277a088def766c8661fe6c7ab39f5f830724e44a0628cc0931e044fed8875 |

The isolated combined Nginx fixture rejects unknown Host421. Live IPv6 preview
as default also returns421. Live IPv4 unknown Host selects an **unrelated existing
public portfolio** (200), while private API paths return404; body hashes match
neither admin app. This is not a route into remote or arbitrary preview ports.
No unrelated default vhost was changed, and global unknown-host421 is not claimed.

## Verification and measured limits

27 focused unit controls:9 purge/Hours/snapshot,5 creator identity,11 Workboard,
2 routing; one actual combined nonroot/restricted-filesystem Nginx fixture with
all five private temp paths; helper lint0. All heavy jobs sequential through
codex-heavy, one worker/bounded heap. Accepted broad application/protocol/Leader
results were reused by byte hashes, not rerun as another security audit.

Actual live evidence includes:

- 22 normal-trust origin/public checks, plus8 final old/new health and complete
  index-body hash checks. All7 preview hosts deny unauthenticated401/no-store;
  legacy private API on new instance returns403. New encrypted session, Files,
  Services, Hours, native account rate limits, threads/pending and SSE work.
- Real Chromium desktop1280×900/mobile390×844 login/unlock, compatible password
  fields, Plan toggle without a turn, binary download65536bytes, locked UI,
  reload unlock and multitab lock. Workboard login page embeds with parent DOM
  isolation. No real Safari/iOS device test is claimed.
- Browser encrypted file responses:285,660 →17,347 body bytes after reload for
  identical UI actions. Measurement counts completed encrypted bodies, excluding
  compression/transport headers. IDB19 ciphertext entries held no fixture path,
  plaintext or owner key; localStorage held no owner key; updated file bytes
  appeared. Early CDP transfer accounting under service workers was unsuitable;
  the corrected full-body measurement is the final evidence, not a code fix.
- Live Vite preview:52,696 →2,449 transfer bytes on reload with304; HMR showed
  changed source. Separate5215/5213 grants did not cross ports. Parent logout
  closed WebSocket and HTTP stream; cached grant and replayed ticket returned401.
  Owned fixture servers/files were removed afterwards.

These are fixture measurements, not a prediction of latency on the user's device.
App cache limits/large-download/Safari limitations remain those of the accepted
security release. Existing draft/storage encryption is outside that scope.

## Operations after this task

Inspect current state without replaying any initialization:

```sh
systemctl status codex-remote-secure.service codex-remote-secure-hours.timer
curl -fsS https://remote.danhkhai.io.vn/api/healthz
cd /root/RUNNING-SERVICES/codex-remote-secure
env -i PATH=/usr/local/bin:/usr/bin:/bin node \
  --env-file=/root/.local/state/codex-remote-secure/instance.env scripts/services.mjs list
```

Use matching encrypted maintenance commands with the explicit new env-file;
ordinary `npm` in the old checkout addresses the old instance. On unknown failure,
keep phase/creation receipts, inspect service/native PIDs and destination hashes,
and diagnose before any retry. Do not rotate/adopt a key, restore a DB, install
old plaintext backend, or invoke the initial stop-old cutover runner. Any future
new-instance restart must honor its own ALL-idle checks. The old app remains live.
