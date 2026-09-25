# TECH: General history regression — candidate only

Task `eb41b236-b6cd-4830-b89b-5c30c47940c3`, base/live source
`be0dcbc4093ad516b10df4452f2ab86d06f1f700`. Actual task receipt:
`gpt-6-astra`, `xhigh`, Full Access. This change is not deployed.

## Cause and compatibility boundary

The affected persisted paginated transcript contains one malformed,
newline-terminated JSON envelope at physical line368, byte range
`[1531862,1531905)`:42 bytes before its newline. The valid preceding record has
ordinal366; the next valid record reuses ordinal367. A bounded read found
4149 valid JSON records,4150 complete lines, no ordinal gap and no final partial
tail in the29,527,893-byte snapshot. The production reader fails at that line
with `Incomplete history JSON record`. No fork/reference prefix is involved.

Native0.155's [materializer](https://github.com/openai/codex/blob/rust-v0.155.0/codex-rs/thread-store/src/local/thread_history_materialization.rs)
skips malformed complete JSONL records, advances only the byte checkpoint, and
lets the next valid record resolve its ordinal. The new reader had treated this
recoverable native condition as fatal.

The fix distinguishes JSON syntax errors from parser resource/format limits.
Only after verifying the paginated session identity does the index skip a
malformed record, in bounded blocks through its newline. It neither increments
the native ordinal nor projects a partial record. An unterminated tail waits
for the next append. Source bytes remain unchanged. Index work metrics count
malformed records without storing their contents. This is native-compatible
recovery, not recovery of the damaged record's missing content.

Malformed headers/legacy records, valid unsupported depth/key/scalar sizes,
ordinal gaps, cross-thread items, unsupported referenced lineage, cancellation,
filesystem and database failures remain errors. The recovery catch encloses
only JSON parsing, never identity checks or projection. Existing v3 checkpoints
remain compatible, including a previously committed prefix before the error;
no production cache deletion or schema migration is needed.

## Executed evidence

Private receipts: `/root/.local/state/codex-remote-secure/history-tech-eb41b236/`.
Diagnostics print only counts, byte positions, timings and identity hashes;
no real message content or raw production identifiers. The diagnostic index is
private and removed after the check, separate from the production cache.

- `before.json` and `scan-metadata.json`: old reader failure, malformed record
  metadata and continuous valid ordinals. Native inode/size/mtime unchanged.
- `after.json`: candidate direct reader succeeds on the exact affected source.
  Cold latest20:1916.78ms,76,511 serialized page bytes,60 total message/tool rows;
  warm:7.98ms; older20:6.09ms; restart:7.17ms with zero index bytes/records and
  8192 guard bytes. All16 pages contain309 unique message IDs. Cold scan reads
  the29.5MB source once; process peak RSS79,972KiB. These are local reader
  measurements, not public HTTP/browser latency. No native RPC, resume or model
  turn was used. Source identity/size/mtime stayed unchanged.
- `check-1.log`: lint,38 focused tests, server build, installed native0.155 oracle
  all passed. The oracle adds an owned fake paginated torn-record scenario;
  all52 valid messages on both sides must appear in native results, then exact
  IDs/turns/text/phases compare with the bounded reader. Eight comparisons and
 75 native RPCs total, including the existing legacy control. Only the expected
  malformed-line warning is permitted for that scenario; other schema warnings
  still fail. No production session or model turn is involved.
- `check-final.log`: lint and71 affected controller/HTTP/index/parser tests
  passed, followed sequentially by both browser fixtures at1280×900/390×600.
  Corrupt-source encrypted route/H1 controls and the separate197MB whole-log
  cold/warm/offline/append/Plan/switch/Lock fixture all passed. No client source
  changed, so a full app suite/client rebuild was not repeated.
- `artifacts.json`: compared all98 backend files; exactly four intended
  artifact differences plus the three previously documented excluded build/live
  pairs. All25 reused client files match the LIVE release and runtime. Hours
  JS/map retain the required hashes. NEW PID2887540 remains active; OLD remains
  disabled/inactive.

New regressions cover incomplete envelope recovery, multi-block malformed
records, incomplete-tail append,20-message pages excluding tools, complete ID
coverage, cache/restart/revision/cursor stability, cancellation checkpoint
resume, incremental append, legacy/header refusal and retained format/security
errors. The independent browser fixture now includes a torn record inside its
owned source and exercises the real encrypted history route with the unchanged
LIVE client on desktop and narrow mobile. The existing large-transcript browser
fixture supplies warm/offline/Plan/append/revocation controls.

## Publication boundary

Product source changes only `server/history-json.ts` and
`server/rollout-history.ts`. Expected deployment delta is exactly:

- `dist-server/history-json.js` and its map;
- `dist-server/rollout-history.js` and its map.

No frontend, HTTP route/controller, auth, configuration, native log, key, Hours,
Vault schema, dependency or runner change is needed. Tests use the25 unchanged
client artifacts from the LIVE immutable H1 release. The existing three known
build/live differences in secure-client JS/map and event-hub map are excluded,
not bundled. `artifacts.json` binds the four candidate bytes and runtime
preimages and verifies the full backend/client boundary.

Root should independently review, integrate with the separately owned tool UI,
then capture a fresh NEW-only rollout baseline. Restart only after ALL NEW
turns/queued work/pending requests are idle using the established NEW-instance
procedure. Do not replay the completed H1 runner or restart the disabled OLD
service. Cold indexing cost and unsupported referenced/ordinal-gap formats
remain explicit limits. No production publication was performed by this task.
