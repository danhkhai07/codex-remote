# Tool detail disclosure fix

Task `29023f0f-740d-4cdc-b5a2-01adb55d868d`, based on exact LIVE source
`be0dcbc4093ad516b10df4452f2ab86d06f1f700`. This is an implementation
candidate for root integration and review, not a deployment or live claim.

## Follow-up: clipped messages and backward retry

Task `dd2f9030-1537-4003-b43d-c0995872c8e0` addresses two P2 findings from
root source review of `c3ea372`. An inverse encrypted-browser run on that exact
candidate reproduced both findings at 1280x900 and 390x600: clipped user and
assistant messages had no disclosure, and retrying a failed Previous operation
made the next Previous request move forward. Private inverse evidence is under
`/root/.local/state/codex-remote-secure/reviews/tool-detail-followup-dd2f9030`.

Clipped conversational rows now retain a compact `json-details` disclosure inside
the message. It uses the same bounded `HistoryDetail`, performs no request until
opened, and resets with the signed cursor generation. Tool rows keep the header and
chevron behavior described below; the removed standalone button does not return.

Detail retry now stores the complete operation: requested offset, direction,
source offset and whether a page existed. Trail changes occur only after the
current matching request succeeds. A failed Previous and any repeated failed
retries leave the trail untouched; successful retry performs the original backward
transition exactly once.

The acceptance fixture uses oversized user and assistant records and verifies both
remainders are reachable in 32 KiB pages with zero collapsed requests. It also runs
0 → next → next → failed Previous → failed retry → successful retry → Previous and
confirms the final request is offset 0. Existing tool loading/cache/collapse,
thread-switch/Lock and all H1 controls remain in the same desktop/mobile run.

The repeated standalone “Xem nội dung đầy đủ theo từng phần” control is removed.
A historical tool with a signed detail cursor now requests its first bounded page
only when the existing native disclosure header/chevron opens. Loading, errors and
retry stay inside the expanded tool. Collapsing aborts an in-flight client request;
a completed page remains cached in that mounted row across collapse/reopen. Previous
and next remain explicit and each server response retains the existing 32 KiB bound.

The secure intent and request abort checks remain on every page. Switching threads,
Lock, unmounting or collapsing cannot paint a late reply. The native details element
keeps its existing pointer, keyboard and disclosure semantics. Jump to latest and
the frozen-history behavior from H1 are unchanged.

The encrypted fake-native browser acceptance uses the real history page/detail
controller and transport at 1280x900 and 390x600. It verifies zero detail requests
while collapsed, one target request on expand, collapse during a held request,
cached reopen, inline failure and same-offset retry, multiple bounded chunks, held
detail replies across thread switch and Lock, and absence of the old button. The
same run retains the 40-message, paused refresh, deep 240-item eviction, anchor,
draft, SSE, no-auto-drain and Jump-to-latest controls. No real model turn or
production transcript is used.

Product source delta is client-only: `src/App.tsx` and `src/HistoryDetail.tsx`.
The browser fixture is `scripts/history-independent-browser.mjs`. Server source,
API, dependencies, release tooling, Hours, runtime state, keys and existing release
packages are unchanged. Root must produce a fresh matching-client integration only
after review; no prior completed runner should be replayed.
