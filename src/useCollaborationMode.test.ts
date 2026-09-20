import { expect, it } from 'vitest'
import { parseModes } from './useCollaborationMode'

it('restores independent plan/code choices and rejects invalid saved modes', () => {
  expect(parseModes(JSON.stringify({ first: 'plan', second: 'default', bad: true, unknown: 'execute', '': 'plan' })))
    .toEqual({ first: 'plan', second: 'default' })
  for (const raw of ['null', '[]', '{broken', '4']) expect(parseModes(raw)).toEqual({})
})
