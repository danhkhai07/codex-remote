# Today total publication preflight — 2026-09-23

Task `6d2c75b1-4ca6-4f82-91ef-82b6fefb7e79`, base/product
`de8070787ce70df760fa769a4c21afc23f94891d`. Publication stopped before writes:
the permitted NEW-only template replacement cannot reach the current Hours page.

## Observed route mismatch

NEW `dist/index.html` loads `/assets/index-CmTpYjdk.js`. That exact loaded
bundle sets the Hours path to
`/root/VAULTS/Flint-Software/Working-Hours/index.html`; its File Viewer timer
bridge also compares against that exact old path. No NEW alias was found in
the running server's file resolver. Authenticated encrypted GETs on NEW port
5174 (secure API required), via the existing maintenance client, confirmed:

| HTML path | HTTP | Response SHA256, matching that file on disk |
| --- | --- | --- |
| `/root/VAULTS/Flint-Software/Working-Hours/index.html` | 200 | `902bf0f0240c69e8a19db3dc223879d74d67f98d1be382ba66c1a7ca673b7cf2` |
| `/root/.local/state/codex-remote-secure/hours/index.html` | 200 | `f4b94e6377dee9820d4d6495b5ba79282e81beb9eab911e91363b7f37b318fc8` |

Both lack `id="today-worked"`. These are distinct documents, not an alias.
Both the NEW runtime source template and isolated Hours template still have
SHA `a6f80820e4a9c7c3a8034913b9aefacba03586144081451a9e6a30be4a31e1fe`.
Reviewed target SHA is
`82a2d3bb545d987f84eb411f064d811bf245e06bf75ea6c37ab4e710cd1c983c`.

## Generator and publication mechanics

NEW Hours service runs `codex-heavy --label remote-hours -- python3 -B
scripts/remote-instance/hours-update.py --generator working-hours/update.py
--native /root/.local/state/codex-remote-secure/native
--hours /root/.local/state/codex-remote-secure/hours` from the NEW publication.
The adapter overrides generator ROOT; that generator reads
`ROOT/dashboard.template.html` on every invocation, holds `ROOT/.writer.lock`,
and atomically regenerates `ROOT/index.html`. The HTTP HTML route reads disk
for each request. Template publication itself therefore needs no restart.
The shared deployment mutex is the mkdir/owner protocol at
`/root/.local/state/codex-remote/deployment.lock`, as used by the reviewed NEW
owner-files publisher. No lock was acquired and no generator was invoked here.

## Required integration before claiming live

Root must coordinate the Hours path and File Viewer bridge with the concurrent
frontend integration, or explicitly authorize a narrowly reviewed path mapping.
Changing either is outside this template-only deployment's prohibition on
client/backend changes. Updating OLD Hours or adding a filesystem alias would
also violate NEW-only scope and would obscure the separate accounting data.
After that dependency is addressed: capture fresh baselines, acquire shared
publication lock, preserve private template/derived backups, preimage-check,
publish reviewed template to NEW authoritative Hours ROOT, regenerate through
the adapter, and verify encrypted reads of the exact paths used by the frontend.
Do not restore Hours state or use an OLD service restart.

Services currently has no Hours record; none was created and the removed Files
entry was not recreated. No production file/state/config/key/client/backend or
service lifecycle was changed. Existing fixture/build evidence remains valid;
no broad rerun can resolve this observed routing mismatch. This is **not live**.
