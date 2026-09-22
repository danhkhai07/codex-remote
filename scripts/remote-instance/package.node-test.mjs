import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { safeLocal, copyVerified } from './package.mjs'
test('package paths cannot escape', () => {
  for (const name of ['', '/etc/shadow', '../file', 'a/../../file']) assert.throws(() => safeLocal('/fixture', name))
  assert.equal(safeLocal('/fixture', 'dist/index.html'), '/fixture/dist/index.html')
})
test('copies verified bytes to independent inodes and rejects drift, links and overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-package-'))
  try {
    const source = path.join(root, 'source'), dest = path.join(root, 'dest')
    fs.writeFileSync(source, 'FAKE fixture')
    const sha = createHash('sha256').update('FAKE fixture').digest('hex')
    assert.throws(() => copyVerified(source, dest, 'bad'))
    assert.equal(fs.existsSync(dest), false)
    copyVerified(source, dest, sha)
    assert.equal(fs.readFileSync(dest, 'utf8'), 'FAKE fixture')
    assert.notEqual(fs.statSync(source).ino, fs.statSync(dest).ino)
    assert.throws(() => copyVerified(source, dest, sha))
    fs.symlinkSync(source, path.join(root, 'link'))
    assert.throws(() => copyVerified(path.join(root, 'link'), path.join(root, 'other'), sha))
  } finally { fs.rmSync(root, { recursive: true }) }
})
