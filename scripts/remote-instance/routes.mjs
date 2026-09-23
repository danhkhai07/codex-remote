import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
export function previewToNewInstance(accepted) {
  assert.equal(createHash('sha256').update(accepted).digest('hex'), 'c0651e07ee0d90c869872c377ae0c953e4e454f1cff055dbeb07e3b6a0d5076f')
  assert.equal(accepted.split('proxy_pass http://127.0.0.1:5173;').length,2)
  return accepted.replace('proxy_pass http://127.0.0.1:5173;', 'proxy_pass http://127.0.0.1:5174;').replace('# REVIEW CANDIDATE ONLY; not installed.', '# Seven isolated preview hosts, new remote gateway only.')
}
export const workboardDropin = `[Service]
Environment=WORKBOARD_ORIGIN=https://codex.danhkhai.io.vn
Environment=WORKBOARD_FRAME_ANCESTOR=https://remote.danhkhai.io.vn
Environment=WORKBOARD_ISOLATED_PREVIEW=1
Environment=WORKBOARD_SECURE_COOKIE=1
Environment=WORKBOARD_DATA=/root/GITHUB/Workboard/data
`
