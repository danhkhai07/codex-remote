# Browser preview blank-screen investigation

Task `62ab2457-811e-4a70-8b6c-a5326623ecce`, exact live source
`d6990d30b98ec4100e26752213017a90c0559853`. Dedicated worktree
`/root/WORKTREES/cr-browser-preview-blank`, branch
`investigate/browser-preview-blank`.

**The user's failing URL is still unknown. No production root cause is claimed,
and no product fix or rollout is prepared on speculation.** The fixture separates
a reproducible empty blocked frame from a readable authentication error and
working ordinary navigation. Leader is collecting the target URL and live
infrastructure evidence separately.

## Source and shipped-artifact review

- `src/LocalhostPreview.tsx` requests a new launch ticket on localhost open and
  Reload. Reopen/reload persistence stores the original address, not the ticket.
  `src/App.tsx` keys Browser state by conversation; `src/ServicesPage.tsx` uses a
  separate Services scope and the same preview component.
- The iframe uses the launch URL, not the final view URL. The proxy consumes
  the one-use ticket, sets its existing strict host-only cookie and redirects.
  `server/localhost-preview.ts` preserves upstream CSP and X-Frame-Options.
  No isolation, cookie, origin or authentication policy was changed.
- The parent CSP allows HTTP/HTTPS frames. The tested iframe occupies the full
  available area: 1280×747 or 390×791 below the 53px toolbar. No collapsed-frame
  layout failure was found in these controls.
- Existing `onLoad` unconditionally hides the loading status. A frame load event
  is not evidence that the embedded application rendered successfully: the
  blocked-frame fixture below fires it while leaving an empty body.

The source worktree's built index, service worker, localhost-preview, preview-cache
and http-app modules were byte-compared to NEW before the fixture. Final artifact
verification matched all 25 client files and four backend modules plus maps
(localhost-preview, preview-cache, http-app, controller) against both the source
worktree and NEW. Matching built output was copied only into this task worktree.
No production source or build directory was used as an edit/build target.

## Reproduction and controls

`scripts/preview-blank-browser.mjs` runs the actual built encrypted app and proxy,
fake credentials and native RPCs, temporary canonical histories and Services
registry, a disposable HTTPS ingress, and an upstream fixture. It prints no
ticket or cookie values. All execution is sequential through `codex-heavy`.

Chromium desktop/mobile ordinary preview opens, Reload obtains a fresh ticket,
and reopening the cached Services address works. A same-origin internal route
shows its own unlock UI, rather than a blank iframe. App reload/unlock restores
the conversation's original address with a fresh ticket; another conversation
does not inherit it, and the original draft survives.

**Confirmed white-frame reproduction, both engines:** upstream fixture route
`/frame-denied` returns `Content-Security-Policy: frame-ancestors 'none'`. The frame
body is empty, loading status is gone and no app error is shown. Screenshots show
the toolbar above a white area. This demonstrates one possible failing path; it
does not establish that the user's URL sends that header. It does not justify
stripping security headers or claiming that arbitrary sites can be embedded.

**Separate WebKit fixture observation:** in fresh Linux Playwright WebKit contexts,
the launch request gets 303 but its redirected document gets 401, with no preview
cookie stored. The iframe visibly says to open from Codex Remote; this is not the
empty blocked frame above. The existing external-tab action establishes the cookie
through a top-level visit; a fresh iframe reload then works. Security attributes
and policy remain unchanged, and cookies are never manually seeded. This is not
an iOS/Safari or live-site diagnosis. The proxy used for this engine only maps
fixture hosts to the local TLS ingress; it does not contact production.

WebKit's documented first-party boundary includes a registrable domain's
subdomains, so the Linux fixture result must not be generalized into a claim that
Safari normally rejects same-site subdomains:
https://webkit.org/tracking-prevention/ .

WebKit also emits one access-control page error for the fixture
`/api/secure/request` during the added App navigation/reload controls. Those
visible-state assertions complete; the earlier Services-only controls have no
page error. Its exact request/lifecycle cause is not isolated, so this is not a
clean WebKit-console pass and is not attributed to the user's blank preview.

## Evidence, limits and next step

Private logs, screenshots, result JSON and artifact verification are archived at
`/root/.local/state/codex-remote-secure/reviews/preview-blank-62ab2457`.
Fixture lint passes with zero warnings/errors. Earlier harness attempts exposed
an incorrect title selector, blocked service-worker inspection when using request
routing, and an initial conversation auto-selection race; those are recorded as
fixture limitations/fixes, not product findings. The final harness uses a bounded
CONNECT proxy for WebKit and waits for initial history before choosing threads.
Chromium desktop results are in `final-controls.log`; mobile and both WebKit
sizes are in `remaining-controls.log`. `webkit-error.log` records the subsequent
one-viewport error classification. No full app suite or build was repeated for
this diagnostic-only change.

The next required input is the actual failing URL/service and device/browser.
Compare that target's document/asset status, frame policy and cookie/navigation
outcome with these controls before selecting a fix. A readable 401, a blocked
frame, an upstream empty document, and a page script failure require different
actions. Root's bounded live infrastructure audit remains separate.

Product/artifact delta: **none**. Only the diagnostic fixture and report are
committed. No model turn, production conversation mutation, real push, runtime
change, Nginx/Hours/key/state edit, arm, restart or deploy. No security-policy
workaround and no physical Safari claim. Existing sealed worktrees are untouched.
