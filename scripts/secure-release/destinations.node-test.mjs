import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, renameSync, rmSync, symlinkSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Destinations, destinationSnapshot } from './destinations.mjs'
import { DeploymentLock } from './lock.mjs'
import { same, tree } from './common.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-destination-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'config'); writeFileSync(path, 'baseline')
  const guard = paths => { const snapshot = destinationSnapshot(paths); return new Destinations(snapshot.entries, snapshot.parents) }
  return { root, path, guard }
}
test('R3: shared filesystem guard rejects bytes/metadata/inode/absence drift; owns subsequent writes', t => {
  const { root, path, guard } = fixture(t)
  for (const change of ['bytes', 'metadata', 'inode', 'absence']) {
    writeFileSync(path, 'baseline'); chmodSync(path, 0o644)
    const destinations = guard([path])
    if (change === 'bytes') writeFileSync(path, 'intervening')
    if (change === 'metadata') chmodSync(path, 0o600)
    if (change === 'inode') { writeFileSync(join(root, 'new'), 'baseline'); renameSync(join(root, 'new'), path) }
    if (change === 'absence') rmSync(path)
    assert.throws(() => destinations.write(path, 'replacement'), /preimage-drift/)
    if (change === 'bytes') assert.equal(readFileSync(path, 'utf8'), 'intervening')
  }
  const destinations = guard([path]); destinations.write(path, 'owned-first'); destinations.write(path, 'owned-second')
  assert.equal(readFileSync(path, 'utf8'), 'owned-second')
  writeFileSync(path, 'operator'); assert.throws(() => destinations.write(path, 'owned-third'), /preimage-drift/)
})
test('R3: formerly absent destination and parent replacement reject; new owned parent succeeds', t => {
  const { root, guard } = fixture(t), path = join(root, 'nested', 'new.conf')
  let destinations = guard([path]); mkdirSync(join(root, 'nested')); writeFileSync(path, 'operator')
  assert.throws(() => destinations.write(path, 'replacement'), /parent-drift/)
  destinations = guard([path]); renameSync(join(root, 'nested'), join(root, 'previous')); symlinkSync(join(root, 'previous'), join(root, 'nested'))
  assert.throws(() => destinations.write(path, 'replacement'), /parent-not-directory/)
  const absent = join(root, 'owned', 'child.conf'); destinations = guard([absent]); destinations.write(absent, 'created'); destinations.all()
  assert.equal(readFileSync(absent, 'utf8'), 'created')
})
test('R3: dependency tree and pointer guarded at swap; normal swap retains exact backup', t => {
  const { root, guard } = fixture(t), live = join(root, 'node_modules'), staged = join(root, 'staged'), backup = join(root, 'backup')
  mkdirSync(live); mkdirSync(staged); writeFileSync(join(live, 'module'), 'old'); writeFileSync(join(staged, 'module'), 'new')
  let destinations = guard([live]); const original = tree(live)
  writeFileSync(join(live, 'module'), 'concurrent')
  assert.throws(() => destinations.dependencySwap(live, backup, staged, () => same(tree(live), original, 'tree-drift')), /tree-drift/)
  assert.equal(readFileSync(join(live, 'module'), 'utf8'), 'concurrent')
  destinations = guard([live]); const current = tree(live)
  destinations.dependencySwap(live, backup, staged, () => same(tree(live), current, 'tree-drift')); destinations.all()
  assert.equal(readlinkSync(live), staged); assert.equal(readFileSync(join(backup, 'module'), 'utf8'), 'concurrent')
  rmSync(live); symlinkSync(backup, live); assert.throws(() => destinations.all(), /preimage-drift/)
})
test('R3: releases share one cooperative lock; never steal stale owner or delete foreign lock', t => {
  const { root } = fixture(t), path = join(root, 'deployment.lock')
  const first = new DeploymentLock(path, { release: 'one', pid: 1 }), second = new DeploymentLock(path, { release: 'two', pid: 2 })
  first.acquire(); assert.throws(() => second.acquire(), /EEXIST/)
  first.release(); second.acquire(); second.release()
  first.acquire(); writeFileSync(join(path, 'owner.json'), 'foreign')
  assert.throws(() => first.release(), /lock-owner-drift/); assert.throws(() => second.acquire(), /EEXIST/)
  assert.equal(readFileSync(join(path, 'owner.json'), 'utf8'), 'foreign')
})
test('R3: pointer changed during dependency inspection is caught immediately before rename', t => {
  const { root, guard } = fixture(t), live = join(root, 'node_modules'), moved = join(root, 'moved')
  mkdirSync(live); const destinations = guard([live])
  assert.throws(() => destinations.dependencySwap(live, join(root, 'backup'), root, () => { renameSync(live, moved); symlinkSync(moved, live) }), /preimage-drift/)
  assert.equal(readlinkSync(live), moved)
})
