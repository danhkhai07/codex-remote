#!/bin/sh
# Run only through codex-heavy. No production environment or endpoints.
set -eu
export VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=1024
npm run check
node scripts/owner-files-maintenance-fixture.mjs
node scripts/owner-files-browser.mjs
