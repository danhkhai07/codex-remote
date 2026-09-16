import { describe, expect, it } from 'vitest'
import { parseConversationSettings, settingsForModel } from './useConversationSettings'
import type { ModelOption } from './types'

const model: ModelOption = { id: 'B', model: 'B', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }
describe('conversation model and effort settings', () => {
  it('restores independent pairs and ignores malformed entries', () => {
    expect(parseConversationSettings(JSON.stringify({
      first: { model: 'A', effort: 'high' }, second: { model: 'B', effort: 'medium' },
      bad: { model: null, effort: {} }, absent: null,
    }))).toEqual({ first: { model: 'A', effort: 'high' }, second: { model: 'B', effort: 'medium' } })
    expect(parseConversationSettings('{broken')).toEqual({})
    expect(parseConversationSettings('[]')).toEqual({})
  })
  it('keeps a compatible effort when explicitly changing model', () => {
    expect(settingsForModel(model, 'high')).toEqual({ model: 'B', effort: 'high' })
    expect(settingsForModel(model, 'xhigh')).toEqual({ model: 'B', effort: 'medium' })
    expect(settingsForModel({ id: 'C', model: 'C' }, 'high')).toEqual({ model: 'C', effort: null })
  })
})
