// Synthetic text/IDs only. Structural ordering from root's bounded inspection;
// event semantics from OpenAI codex rust-v0.155.0 ThreadHistoryBuilder.
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
