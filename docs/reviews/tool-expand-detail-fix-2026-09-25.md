# Tool detail disclosure fix

Task `29023f0f-740d-4cdc-b5a2-01adb55d868d`, based on exact LIVE source
`be0dcbc4093ad516b10df4452f2ab86d06f1f700`. This is an implementation
candidate for root integration and review, not a deployment or live claim.

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
