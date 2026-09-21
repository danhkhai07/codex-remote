// Run only after dependency staging and focused checks. Immutable NEW seal; no arm.
import { resolve } from 'node:path'
import { symlinkSync, existsSync } from 'node:fs'
import { APP, assert, json, fileHash, tree, writeJson } from './common.mjs'
const release = resolve(process.argv[2])
const status = json(release + '/metadata.json').activationEligible ? 'activation-candidate-not-armed' : 'review-only-not-armed'
assert(json(release + '/metadata.json').app === APP, 'wrong-candidate')
assert(!existsSync(release + '/seal.json'), 'immutable-seal-already-exists')
assert(json(release + '/dependencies/node_modules/jose/package.json').version === '6.2.12', 'jose-not-staged')
if (!existsSync(release + '/operator/node_modules')) symlinkSync('../dependencies/node_modules', release + '/operator/node_modules')
writeJson(release + '/seal.json', { version: 1, app: APP, status, at: new Date().toISOString(), files: tree(release) })
console.log(JSON.stringify({ release, app: APP, status, sealSha256: fileHash(release + '/seal.json') }))
