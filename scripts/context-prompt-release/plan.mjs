import assert from 'node:assert/strict'

export const LIVE_SOURCE = '37d63118520fb96280f089af4dab49a6061a88bc'
export const BACKEND = ['context-vault', 'controller', 'knowledge-context', 'knowledge-repository', 'knowledge-store', 'knowledge-vault', 'orchestration']
  .flatMap(name => [`dist-server/${name}.js`, `dist-server/${name}.js.map`])

export const PRESERVED_BUILD_DIFFERENCES = {
  'event-hub.js.map': { baseline: 'a9f820a365e6cca09a1cbce123381795f1eba328b6f5572b70a6503c64f08c33', candidate: 'ad743999f176f42d0277b3122bcc17ad0f1d51f60831468c1fed9bf024747fa2' },
  'secure-client.js': { baseline: '9deb8e06b9d7523d53c297823fd2e7d54698b4888da3e597e56324dfd948cde1', candidate: '4c20744edbdb33f72f7fbfc2753270706463c6a8c506f2605665c3aedc57f3d9' },
  'secure-client.js.map': { baseline: '7fb6c7f4436bd04df2d20e112bb2987112ddaf60cad7fa5d118938d96c581d58', candidate: '931485842b7652db27be0193b95167a4f5ee2332c58ce2568aed451742f2af46' },
}

export function assertDelta(baseline, candidate) {
  const allowed = new Set(BACKEND.map(path => path.slice(12)))
  for (const path of Object.keys(baseline)) assert(candidate[path], 'Missing backend module ' + path)
  for (const [path, hash] of Object.entries(candidate)) if (baseline[path] !== hash && !allowed.has(path)) {
    const known = PRESERVED_BUILD_DIFFERENCES[path]
    assert(known && baseline[path] === known.baseline && hash === known.candidate, 'Unexpected backend delta ' + path)
  }
  assert.equal(candidate['work-hours.js'], 'b763a0f7b74c0341684e196855e85b3f5e3b123915a373b27463c17916702e93')
  assert.equal(candidate['work-hours.js.map'], '6a76da381331d7a802da5d844d341da742f0bfc3809f0cfe3b74370d55c42fb8')
}
