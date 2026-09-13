# Gateway memory and reconnects

Repeated full-history RPC responses previously entered the SSE replay ring before
the display history cap was applied. Keeping 1,000 such responses could exhaust
the Node heap, restart the gateway, and show `Syncing` in connected browsers.

The gateway now routes RPC results only to their requesting callers. SSE keeps
notifications and requests, with replay bounded by both 1,000 events and 16 MiB
of serialized UTF-8 JSON. Events larger than the replay budget are delivered to
live subscribers without being retained. A cursor older than the retained range
receives `reset: true`; the browser reconciles persisted history on reconnect.
These byte budgets bound payloads, not total process RSS or JavaScript heap size.

Each SSE subscriber waits for socket `drain`, has a 32 MiB queue/socket budget,
and is disconnected after 30 seconds without draining. This prevents a stalled
device from retaining an unlimited backlog or blocking other devices. Large
events still use ordered fragments; the cursor advances only on the final frame.

The routing cache stores metadata for up to 256 threads, without transcripts.
Concurrent full-history requests for the same thread share one RPC; completed
and failed requests leave no history response cache behind.

Visible clients reconcile history when connecting or returning to the app, then
every five minutes while SSE is live. The thread list still refreshes every 15
seconds. Without SSE, full-history recovery runs every 15 seconds. Existing
persisted histories are unchanged.

## Verification

Run the normal tests and build, then the bounded-heap regression:

```sh
npm run build
node --max-old-space-size=128 --expose-gc scripts/check-memory.mjs
```

The probe uses a fake Codex process and reads 60 separate 10 MB histories under
a 128 MiB heap limit. It then exercises replay eviction with large notifications.
No real conversations or credentials are used. For deployment, also verify an
authenticated public SSE connection across at least two 15-second heartbeats
while reading a large persisted history, and monitor the same Node PID afterward.
