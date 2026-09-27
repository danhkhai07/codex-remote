# Context and orchestration prompt rollout

Status: integration candidate. The release is backend-only and publishes exactly
the JavaScript and source maps for `context-vault`, `controller`,
`knowledge-context`, `knowledge-repository`, `knowledge-store`,
`knowledge-vault`, and `orchestration` (14 files). It preserves the complete
client, configuration, owner key identity, preview-share state, Services state,
Working Hours template/generator/backend, dependencies, native history and the
disabled OLD service.

The integrated behavior selects current-task and indexed relevant knowledge
before broad global notes, excludes superseded descendants outside historical
queries, and caps the complete injected developer message—including the actual
orchestration role and separators—at 24,000 bytes. Orchestration guidance now
defaults routine work to one Sol/medium worker, retains Astra xhigh/max for
security or high-risk data where the live catalog supports it, requires concise
reports, and only recommends native compaction at safe task boundaries. Explicit
user/model settings remain authoritative; there is no silent fallback.

`scripts/context-prompt-release` derives from the established NEW rollout
workflow. It binds a fresh runtime baseline and immutable seal, checks encrypted
ALL-idle twice with no thread exemptions, acquires the shared publication lock,
backs up only the 14 code files, publishes only those files, waits for ALL-idle
again, and restarts `codex-remote-secure.service` exactly once. Durable attempt
and restart-intent files prevent replay. Verification requires a fresh PID,
health, encrypted Knowledge access, unchanged protected identities, OLD disabled,
and a temporary installed-module retrieval probe that never reads or writes the
real Vault.

Commands use a new private release directory:

```sh
node scripts/context-prompt-release/deploy.mjs prepare "$release" "$evidence"
node "$release/deploy.mjs" baseline "$release"
node "$release/deploy.mjs" check "$release"
node "$release/deploy.mjs" arm "$release" "$(sha256sum "$release/seal.json" | cut -d' ' -f1)"
systemd-run --unit=codex-remote-context-prompt-fb369acf --collect \
  /usr/local/bin/node "$release/deploy.mjs" apply "$release"
```

After arming, end coordinating turns; do not poll the watcher. `LIVE.json` and
`verified.json` are the publication evidence. If application or verification is
ambiguous, never rerun `apply`; inspect the attempt, PID and hashes, then use only:

```sh
node "$release/deploy.mjs" verify "$release"
```

Old native snapshots remain until supported native compaction is explicitly and
safely invoked. Byte reductions are fixture measurements, not billing claims.
