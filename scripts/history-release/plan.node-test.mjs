import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND, assertDelta, publicationStages, PRESERVED_BUILD_DIFFERENCES } from './plan.mjs'
import { workflow } from './core.mjs'
test('complete matching backend plus assets precede restart; new entry and SW wait for backend health', async () => {
  const payload = Object.fromEntries([...BACKEND, 'dist/assets/new.js', 'dist/sw.js', 'dist/index.html'].map(p => [p, 'hash']))
  const stages = publicationStages(payload), actions = []
  assert(!stages.beforeRestart.includes('dist/index.html')); assert(!stages.beforeRestart.includes('dist/sw.js'))
  const ready = { ready: true, pending: 0, busy: 0, incomplete: false }
  await workflow({ preflight() {}, readiness: async () => ready, state() {}, sleep: async () => {}, assertBaseline() {}, assertPublished() {}, backup() {},
    publish: () => actions.push(...stages.beforeRestart), restart: () => actions.push('restart'),
    verify: () => { actions.push('health', ...stages.afterHealthy); return {} }, finalize() {} })
  assert(actions.indexOf('dist-server/rollout-history.js') < actions.indexOf('restart'))
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
  assertDelta(baseline, { ...baseline, 'rollout-history.js': 'new' })
  assert.throws(() => assertDelta(baseline, { ...baseline, 'index.js': 'changed' }))
  assert.throws(() => assertDelta(baseline, { ...baseline, 'work-hours.js': 'changed' }))
  const missing = { ...baseline }; delete missing['index.js']; assert.throws(() => assertDelta(baseline, missing))
})

test('known historical build divergence stays excluded and any further drift is rejected', () => {
  const hours = { 'work-hours.js': 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93', 'work-hours.js.map': '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8' }
  const baseline = { ...hours }, candidate = { ...hours }
  for (const [p, known] of Object.entries(PRESERVED_BUILD_DIFFERENCES)) {
    baseline[p] = known.baseline; candidate[p] = known.candidate
    assert(!BACKEND.includes('dist-server/' + p))
  }
  assertDelta(baseline, candidate)
  for (const p of Object.keys(PRESERVED_BUILD_DIFFERENCES)) {
    assert.throws(() => assertDelta(baseline, { ...candidate, [p]: 'unreviewed' }))
    assert.throws(() => assertDelta({ ...baseline, [p]: 'runtime-drift' }, candidate))
  }
})

test('post-live package contains exactly the accepted four files, preserving previous history and controller modules', () => {
  assert.deepEqual(BACKEND, ['dist-server/history-json.js', 'dist-server/history-json.js.map', 'dist-server/rollout-history.js', 'dist-server/rollout-history.js.map'])
  const hours = { 'work-hours.js': 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93', 'work-hours.js.map': '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8' }
  for (const name of ['controller.js', 'http-app.js', 'history-pages.js', 'history-paginated.js', 'config.js', 'read-state.js']) {
    const baseline = { ...hours, [name]: 'live' }
    assert.throws(() => assertDelta(baseline, { ...baseline, [name]: 'unexpected' }), /Unexpected backend delta/)
  }
})
