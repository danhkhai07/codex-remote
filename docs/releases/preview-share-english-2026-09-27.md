# Preview sharing English UI delivery

- Task: `9414e640-ef26-4442-9c1c-f7e39ae08ce5`
- Accepted LIVE base: `8664f1fa3a5118f85110e8d7634ebe88b73caba1`
- Product commit: `3bf3a41c517593259eb2fcbe74826ef96d50e524`
- Branch: `fix/preview-share-english`
- NEW frontend release: `/root/.local/state/codex-remote-secure/releases/preview-share-english-3bf3a41`
- LIVE marker SHA-256: `904e29ba352497e955c1e10d656654c36341d17c2cde5a0f515f5e5c44090bf0`

The sidebar gear action and the complete preview-sharing dialog now use English copy. This includes labels, actions, loading, empty, error, retry, TTL and status descriptions, notices, and accessibility names. The encrypted API, permissions, share lifecycle, stored registry and grants are unchanged.

## Validation

- Preview-share helper Vitest: 4/4.
- Lint, typecheck, client build, and PWA validation: passed.
- Encrypted fake-API browser: Chromium 1280, 390, and 320 passed; StrictMode 1280 passed.
- Integrated temporary backend and anonymous recipient: Chromium 1280, 390, and 320 passed create/copy/open/revoke/expiry/Lock. No production share or model turn was created.
- Screenshots: `/root/.local/state/codex-remote-secure/evidence/preview-share-english-20260927/` and `/root/.local/state/codex-remote-secure/evidence/preview-share-english-integrated-20260927/`.
- Physical Safari/iOS was not tested.

## Publication

The release captured a fresh `8664f1f` runtime baseline and backup under the shared publication lock. It published the whole matching 25-file client graph with assets first and `index.html` last, retaining older hashed assets for open tabs. The only same-name/different-byte artifact was `assets/docx-preview-ByvNPTF_.js.map`; its non-path source-map fields and source basenames matched, so the immutable LIVE byte was retained.

Public and loopback `/`, `/files`, and every active client artifact matched the candidate. Main JavaScript SHA-256 is `8c1216bddb7a1d1d62253c56c8cf3555d4256d8862f1eb74140c9357318c1949`; `index.html` is `a75e5393ca1c9b4b8b8d267df772c0f713f62d8268b6a0c3155272856c354c2e`. The backend stayed on PID `3473745`; no restart occurred. Backend, config, owner key, native state, Hours, preview registry/grants, and disabled OLD service stayed unchanged during publication. The existing Services root entry was updated after verification.
