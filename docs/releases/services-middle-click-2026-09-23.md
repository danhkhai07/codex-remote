# Services middle-click tab candidate — 2026-09-23

## Scope

- Source base: `9ca8c1855633135d095ddec0c8c8c90b3b5f5e5b`, the verified live frontend lineage.
- Branch: `fix/services-middle-click-tab`.
- This is a review candidate only. It has not been merged into a rollout, published, or used to restart either service.

`Mở trong Browser` keeps its existing left-click behavior. A middle click now reserves a browser tab synchronously while user activation is present, then opens the requested service there. Internal paths navigate directly in the reserved tab. Localhost services exchange a new single-use preview ticket through the existing encrypted owner API and navigate to the isolated preview origin only after the response passes the existing lifetime and origin checks.

The shared helper also replaces the equivalent external-tab code in `LocalhostPreview`; embedded navigation remains unchanged. A blocked popup, rejected preview, lock/revocation, closed tab, or invalid response closes the reserved tab and surfaces an error. Stopped services remain disabled. Right click is ignored.

## Verification

All commands ran sequentially through `codex-heavy`, with one Vitest worker and a 1024 MiB Node heap:

```text
npm run lint
npm run typecheck
npx vitest run src/browserAddress.test.ts --maxWorkers=1
npm run build:client
npm run check:pwa
PLAYWRIGHT_MODULE=/tmp/working-hours-browser/node_modules/playwright/index.mjs \
  SERVICES_MIDDLE_SCREENSHOTS=/tmp/services-middle-click-browser \
  node scripts/services-middle-click-browser.mjs
```

The browser fixture uses disposable fake credentials, an isolated required-encrypted gateway, a TLS test ingress, and a disposable localhost service. At 1280×800 and 390×844 it verifies left-click embedding, middle-click new-tab navigation, a fresh one-use localhost ticket, removal of the ticket from the visible URL, internal paths without a preview ticket, popup blocking, server rejection, disabled stopped services, ignored right click, and absence of the owner key from request bodies. It creates no model turn and does not use production state.

Screenshots:

- `/tmp/services-middle-click-browser/services-middle-1280.png`
- `/tmp/services-middle-click-browser/services-middle-390.png`

## Rollout boundary

Integrate this commit with the other pending frontend candidate, rebuild the combined client, and publish it in the coordinated frontend rollout. No backend artifact, service configuration, Working Hours artifact, owner key, or persisted application state belongs in this delta.

Popup policy remains browser-controlled. Browsers that block the synchronously reserved tab show the existing Services alert and require the owner to allow popups before retrying. The automated coverage uses Chromium; Safari-specific middle-click behavior is not covered.
