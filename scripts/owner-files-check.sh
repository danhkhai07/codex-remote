#!/bin/sh
# Run only through codex-heavy. No production environment or endpoints.
set -eu
# Fixtures must not inherit the live native home .local TMPDIR (restricted-mode canaries intentionally deny it).
export TMPDIR=/tmp
export VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=1024
npm run check
node scripts/owner-files-maintenance-fixture.mjs
node scripts/owner-files-browser.mjs
node scripts/owner-files-hours-browser.mjs

node --test scripts/owner-files-release/core.node-test.mjs
