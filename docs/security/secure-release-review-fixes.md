# Runner review fixes — candidate disposition

App payload remains 80843c0. Source transition target is 00f9e197 (its only
changes after 80843c0 are the accepted independent report and two test controls).
Preparation/tooling branches never become production source.

R1: keep local/remote main at BASE throughout waiting. After dual ALL-idle,
ingress gate, third ALL-idle and refreshed readiness, perform guarded local
fast-forward then ordinary non-force remote push. Journal local and remote
outcomes separately; network ambiguity aborts without rollback or retry.

R2: bind receipt bytes/metadata, evidence files and nonsecret owner-key identity
at preflight. One-hour readiness authorization expires at execution, including
waiting; evidence expires after 24 hours. Recheck binding, ages, key, remote,
DNS/TLS/public canary before first production write and after the final readiness
await. Withdrawal/change requires abort, not invented refresh. Existing user
authorization is recorded, not requested again. Infrastructure checking/provision
is independent of app-key availability.

R3: shared cooperative deployment lock, exact destination preimages including
metadata/absence and parent identity, guarded writes/swaps, owned-version tracking
and checks before reload. This is not atomic CAS against a privileged adversary.

R4: write independent immutable fsynced postverify receipt before bookkeeping;
every subsequent marker references it. Services and Vault each record pending,
dispatching/outcome-unknown, and confirmed status separately. SIGKILL/power loss
cannot turn an unknown mutation into permission to retry or erase publication
proof. No downgrade or DB restore.

Delivery is a NEW review-only seal; final baseline/seal follow real infra readiness.

## Dispositions and evidence

These are implementation/fixture results, pending the leader's independent review
of the new exact runner/seal. They do not change bounded app acceptance or prove a
live deployment.

| Finding | Change | Focused acceptance |
| --- | --- | --- |
| R1 P1 | BASE kept until explicit guarded source phase; SOURCE preserves the two independent controls; partial Git outcomes journaled without retry | Actual old Knowledge read/checked-write and Services CLI during fake busy wait; no premature source switch; final busy/dirty/branch/remote drift reject; source transition/push failure evidence; actual new CLI works after fake required gateway cutover and old adapter fails |
| R2 P2 | Bound receipt/report bytes, nonsecret key identity and execution age; refresh after final await and before first mutation | Expiry/withdrawal/changed report/key rotation/removal/DNS/TLS failure abort; fresh controls pass; missing key does not prevent 14 infrastructure TLS checks; review-only release cannot apply |
| R3 P2 | One shared cooperative lock; destination and parent preimages, owned installed versions, full config inventories; guards before reload/restart | Real filesystem byte/mode/inode/absence/parent/pointer drift rejects; dependency tree and pointer changes reject; intervening config is retained; injections between Nginx writes/test and Workboard source/drop-in/daemon-reload stop subsequent effects |
| R4 P2 | Immutable fsynced postverify receipt plus separate Services/Vault outcome records | Owned child SIGKILL during bookkeeping, fresh child reader retains PID/hash/time/seal and unfinished status; SIGTERM, caught failure and success controls retain proof; complete appears only after success |

Focused runner acceptance is **59/59** with one worker. Lifecycle, three restricted
nonroot Nginx staged-config scenarios, lint and exact sealed artifact checks are
recorded separately in the new release's `validation/` directory and delivery
reference. No full app rebuild/suite is needed because app source and payload are
unchanged. Dependency copies must match the previously verified immutable tree;
there is no live npm install.

`postverify.json` is independent of `attempt.json`. A killed process can leave the
marker at running/bookkeeping and a `dispatching-outcome-unknown` service record;
that is evidence to investigate, never authority to repeat the mutation. Vault
success consumes the complete authenticated response and checks path/revision;
a 409 is consumed before recording conflict-not-applied.

## Remaining operational gates

DNS/TLS/public canaries, effective Full (strict), Workboard staged/live identity,
real operator fresh-profile provenance and private key readiness must be accepted
before a **new final baseline/seal**. The current artifact is explicitly
non-activatable review-only. Its receipts cannot convert it into a final release.
The user authorization already exists; these are technical readiness gates.

The shared lock requires cooperative operators; there is no atomic CAS against
root or a distributed Git/filesystem transaction. Any partial cutover or ambiguous
push requires phase-specific inspection and a new reviewed attempt, not rollback,
DB restore, plaintext recovery or automatic retry. No production process, source,
config, owner key or active job is changed by these checks.
