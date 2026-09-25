import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND, assertDelta, publicationStages } from './plan.mjs'
import { workflow } from './core.mjs'
test('complete matching backend plus assets precede restart; new entry and SW wait for backend health', async () => {
  const payload = Object.fromEntries([...BACKEND, 'dist/assets/new.js', 'dist/sw.js', 'dist/index.html'].map(p => [p, 'hash']))
  const stages = publicationStages(payload), actions = []
  assert(!stages.beforeRestart.includes('dist/index.html')); assert(!stages.beforeRestart.includes('dist/sw.js'))
  const ready = { ready: true, pending: 0, busy: 0, incomplete: false }
  await workflow({ preflight() {}, readiness: async () => ready, state() {}, sleep: async () => {}, assertBaseline() {}, assertPublished() {}, backup() {},
    publish: () => actions.push(...stages.beforeRestart), restart: () => actions.push('restart'),
    verify: () => { actions.push('health', ...stages.afterHealthy); return {} }, finalize() {} })
  assert(actions.indexOf('dist-server/history-pages.js') < actions.indexOf('restart'))
  assert(actions.indexOf('dist/assets/new.js') < actions.indexOf('restart'))
  assert(actions.indexOf('health') < actions.indexOf('dist/sw.js'))
  assert.equal(actions.at(-1), 'dist/index.html')
})
test('missing/extra modules and traversal cannot become a release', () => {
  const good = Object.fromEntries([...BACKEND, 'dist/sw.js', 'dist/index.html'].map(p => [p, 'x']))
  for (const payload of [{ ...good, 'dist-server/work-hours.js': 'x' }, { ...good, 'dist/../escape': 'x' }]) assert.throws(() => publicationStages(payload))
  delete good[BACKEND[0]]; assert.throws(() => publicationStages(good))
})
test('actual emitted delta may not drop or change excluded backend/Hours bytes', () => {
  const baseline = { 'index.js': 'same', 'work-hours.js': 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93', 'work-hours.js.map': '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8' }
  assertDelta(baseline, { ...baseline, 'history-pages.js': 'new' })
  assert.throws(() => assertDelta(baseline, { ...baseline, 'index.js': 'changed' }))
  assert.throws(() => assertDelta(baseline, { ...baseline, 'work-hours.js': 'changed' }))
  const missing = { ...baseline }; delete missing['index.js']; assert.throws(() => assertDelta(baseline, missing))
})
