import assert from 'node:assert/strict'
export const BACKEND = ['config', 'controller', 'http-app', 'read-state', 'history-pages', 'history-json', 'history-paginated', 'rollout-history'].flatMap(n => [`dist-server/${n}.js`, `dist-server/${n}.js.map`])
export function assertDelta(baseline, candidate) {
  const allowed = new Set(BACKEND.map(p => p.slice(12)))
  for (const p of Object.keys(baseline)) assert(candidate[p], 'Missing backend module ' + p)
  for (const [p, h] of Object.entries(candidate)) {
    if (baseline[p] !== h) assert(allowed.has(p), 'Unexpected backend delta ' + p)
  }
  assert.equal(candidate['work-hours.js'], 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
  assert.equal(candidate['work-hours.js.map'], '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
}
export function publicationStages(payload) {
  const paths = Object.keys(payload)
  assert.deepEqual(paths.filter(p => !p.startsWith('dist/')).sort(), [...BACKEND].sort())
  assert(payload['dist/index.html'] && payload['dist/sw.js'])
  for (const p of paths) assert(!p.startsWith('/') && !p.split('/').includes('..'))
  return {
    beforeRestart: paths.filter(p => p !== 'dist/index.html' && p !== 'dist/sw.js').sort(),
    afterHealthy: ['dist/sw.js', 'dist/index.html'],
  }
}
