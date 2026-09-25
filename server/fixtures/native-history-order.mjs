// Synthetic text/IDs only. Structural ordering from root's bounded inspection.
// Dedicated events are LEGACY controls, not evidence for paginated native
// logs. paginatedBootstrapRecords below uses canonical completed items only.
export const record = (type, payload) => ({ timestamp: '2026-09-25T00:00:00.000Z', type, payload })
export const nativeEvent = (type, payload = {}) => record('event_msg', { type, ...payload })
export const nativeUser = message => nativeEvent('user_message', { message, images: [], local_images: [], text_elements: [] })
export const nativeAnswer = message => nativeEvent('agent_message', { message, phase: 'final_answer' })
export const nativeStart = turn_id => nativeEvent('task_started', { turn_id, model_context_window: 100000, collaboration_mode_kind: 'default' })
export const nativeComplete = turn_id => nativeEvent('task_complete', { turn_id, last_agent_message: null })
export const rawUser = text => record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] })
export const rawAssistant = (text, channel = 'final') => record('response_item', { type: 'message', role: 'assistant', channel, content: [{ type: 'output_text', text }] })
export const serializeRecords = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n'
export function bootstrapRecords(id, cwd) {
  return [
    record('session_meta', { id, session_id: id, cwd, timestamp: '2026-09-25T00:00:00.000Z', originator: 'codex_cli_rs', cli_version: '0.155.0', source: 'cli', model_provider: 'openai' }),
    record('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Fixture instruction' }] }),
    record('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Fixture instruction two' }] }),
    record('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Fixture instruction three' }] }),
    rawUser('Bootstrap context, not a user-message event'), // physical line 5
    record('world_state', { full: true, state: {} }),
    record('turn_context', { turn_id: 'first', cwd, approval_policy: 'never', sandbox_policy: { type: 'read-only' }, model: 'fixture-offline', summary: 'auto' }), // physical line 7; NOT a UI boundary
    record('response_item', { type: 'reasoning', summary: [] }),
    nativeEvent('token_count', { info: null, rate_limits: null }),
    nativeStart('first'), // physical line 10
    nativeEvent('token_count', { info: null, rate_limits: null }),
    rawUser('First visible input'),
    nativeEvent('item_completed', { thread_id: id, turn_id: 'first', item: { type: 'UserMessage', id: 'copy-user', content: [{ type: 'text', text: 'First visible input', text_elements: [] }] } }),
    nativeUser('First visible input'),
    rawAssistant('First visible answer'),
    nativeEvent('item_completed', { thread_id: id, turn_id: 'first', item: { type: 'AgentMessage', id: 'copy-answer', content: [{ type: 'Text', text: 'First visible answer' }], phase: 'final_answer' } }),
    nativeAnswer('First visible answer'), nativeComplete('first'),
  ]
}

// Actual target format: canonical items only, no dedicated legacy messages.
export const materialized = (thread_id, turn_id, item) => nativeEvent('item_completed', {
  thread_id, turn_id, item, started_at_ms: 1790294400000, completed_at_ms: 1790294400001,
})
export const materializedUser = (thread, turn, id, text) => materialized(thread, turn, { type: 'UserMessage', id, content: [{ type: 'text', text, text_elements: [] }] })
export const materializedAnswer = (thread, turn, id, text, phase = 'final_answer') => materialized(thread, turn, { type: 'AgentMessage', id, content: [{ type: 'Text', text }], phase })
export const withOrdinals = (rows, start = 0) => rows.map((row, index) => ({ ...row, ordinal: start + index }))
export function paginatedBootstrapRecords(id, cwd) {
  // Same physical lines 5/7/10/13 as structural inspection; text is synthetic.
  const prefix = bootstrapRecords(id, cwd).slice(0, 12)
  prefix[0].payload = { ...prefix[0].payload, history_mode: 'paginated', history_base: null, subagent_history_start_ordinal: null }
  return withOrdinals([
    ...prefix,
    materializedUser(id, 'first', 'native-user-1', 'First visible input'),
    rawAssistant('Model output duplicate, not a display input'),
    materializedAnswer(id, 'first', 'native-agent-1', 'First visible answer'),
    nativeComplete('first'),
  ])
}
