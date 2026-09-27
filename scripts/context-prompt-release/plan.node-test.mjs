import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND, assertDelta } from './plan.mjs'

test('permits exactly the fourteen context and orchestration artifacts', () => {
  assert.equal(BACKEND.length, 14)
  const baseline = { 'controller.js': 'old', 'work-hours.js': 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93', 'work-hours.js.map': '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8' }
  assert.doesNotThrow(() => assertDelta(baseline, { ...baseline, 'controller.js': 'new' }))
  assert.throws(() => assertDelta(baseline, { ...baseline, 'http-app.js': 'new' }), /Unexpected backend delta/)
})
