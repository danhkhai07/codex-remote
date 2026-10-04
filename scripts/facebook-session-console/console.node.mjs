import test from 'node:test'
import assert from 'node:assert/strict'
import { masked, safeManualAction, currentTotp } from './server.mjs'
import { safeAccount, safeSecret } from './account-store.mjs'
import { totp, selectCodeInputs } from './worker.mjs'

test('validates account secrets without exposing them', () => {
  assert.equal(safeAccount('1234567890'), '1234567890')
  assert.equal(masked('1234567890'), '123•••90')
  assert.throws(() => safeAccount('bad account'))
  assert.throws(() => safeSecret('not-base32', 'totpSecret'))
  assert.equal(safeSecret(undefined, 'totpSecret', true), null)
})

test('manual browser commands are bounded and exclude arbitrary operations', () => {
  assert.deepEqual(safeManualAction({ type: 'click', x: 100, y: 200, extra: 'ignored' }), { type: 'click', x: 100, y: 200 })
  assert.deepEqual(safeManualAction({ type: 'drag', x: 1, y: 2, toX: 3, toY: 4 }), { type: 'drag', x: 1, y: 2, toX: 3, toY: 4 })
  assert.deepEqual(safeManualAction({ type: 'scroll', deltaY: -500 }), { type: 'scroll', deltaY: -500 })
  assert.throws(() => safeManualAction({ type: 'click', x: 1280, y: 2 }))
  assert.throws(() => safeManualAction({ type: 'scroll', deltaY: 100000 }))
  assert.throws(() => safeManualAction({ type: 'text', text: 'a\nother command' }))
  assert.throws(() => safeManualAction({ type: 'key', key: 'F12' }))
})

test('TOTP matches the RFC 6238 SHA1 vector', () => {
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082')
  assert.deepEqual(currentTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), { code: '287082', expiresAt: 60000 })
})

test('2FA selection ignores login/search fields and supports six code boxes', () => {
  const field = (overrides = {}) => ({ type: 'text', name: '', id: '', placeholder: '', ariaLabel: '', autocomplete: '', inputMode: '', maxLength: -1, disabled: false, readOnly: false, ...overrides })
  assert.deepEqual(selectCodeInputs([field({ name: 'email' }), field()]), { kind: 'single', indexes: [1] })
  assert.deepEqual(selectCodeInputs([field({ type: 'search' }), field({ name: 'approvals_code', maxLength: 6 }), field()]), { kind: 'single', indexes: [1] })
  assert.deepEqual(selectCodeInputs(Array.from({ length: 6 }, () => field({ maxLength: 1 }))), { kind: 'segmented', indexes: [0, 1, 2, 3, 4, 5] })
  assert.equal(selectCodeInputs([field(), field()]), null)
})
