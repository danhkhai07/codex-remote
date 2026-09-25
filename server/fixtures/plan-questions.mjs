import { persistedFixtureThread } from './history-store.mjs'
// Deterministic native protocol fixture. Never starts a model or reads real threads.
import { createInterface } from 'node:readline'

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const replies = []
let active = false
const thread = (id = 'plan-fixture') => persistedFixtureThread({
  id, name: id === 'plan-fixture' ? 'Plan question fixture' : 'Worker fixture', cwd: '/tmp', createdAt: 1, updatedAt: 1,
  status: { type: active && id === 'plan-fixture' ? 'active' : 'idle' },
  turns: [{ id: 'history', status: 'completed', items: Array.from({ length: 45 }, (_, i) => ({
    id: `history-${i}`, type: 'agentMessage', text: `History ${i}\n\n${'Long conversation context. '.repeat(30)}`,
  })) }, ...(active && id === 'plan-fixture' ? [{ id: 'plan-turn', status: 'inProgress', items: [] }] : [])],
})

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  const result = value => send({ id: message.id, result: value })
  if (!message.method) {
    replies.push(message)
    send({ method: 'serverRequest/resolved', params: { threadId: 'plan-fixture', requestId: message.id } })
    return
  }
  switch (message.method) {
    case 'initialized': return
    case 'initialize': return result({ userAgent: 'plan-fixture' })
    case 'thread/list': return result({ data: [{ ...thread(), turns: [] }] })
    case 'thread/read': { const value = thread(message.params?.threadId); return result({ thread: message.params?.includeTurns === false ? { ...value, turns: [] } : value }) }
    case 'thread/resume': { const value = thread(message.params?.threadId); return result({ thread: message.params?.excludeTurns ? { ...value, turns: [] } : value }) }
    case 'thread/turns/list': {
      const latest = thread(message.params?.threadId).turns.at(-1)
      return result({ data: latest ? [{ id: latest.id, status: latest.status, items: [] }] : [], nextCursor: null })
    }
    case 'model/list': return result({ data: [{ id: 'fixture', model: 'fixture', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }] })
    case 'fixture/replies': return result(replies)
    case 'fixture/question':
      active = true
      send({ method: 'turn/started', params: { threadId: 'plan-fixture', turn: { id: 'plan-turn', status: 'inProgress' } } })
      send({ id: message.params.id, method: 'item/tool/requestUserInput', params: {
        threadId: 'plan-fixture', turnId: 'plan-turn', itemId: 'question-item',
        questions: message.params.questions ?? [{ id: 'question_display_test', header: 'Hỏi thử', question: 'Bạn thích câu hỏi lựa chọn hiển thị theo kiểu nào?',
          options: [{ label: 'Các nút chọn (Recommended)', description: 'Hiện sẵn từng phương án để bấm trực tiếp.' },
            { label: 'Dropdown', description: 'Mở danh sách thả xuống rồi chọn một phương án.' },
            { label: 'Danh sách giống CLI', description: 'Hiện các phương án đánh số theo từng dòng.' }] }],
      } })
      return result({})
    case 'turn/interrupt':
      active = false
      // Intentionally omit serverRequest/resolved: turn completion must clean up.
      send({ method: 'turn/completed', params: { threadId: 'plan-fixture', turn: { id: 'plan-turn', status: 'interrupted', items: [] } } })
      return result({})
    case 'turn/start': return send({ id: message.id, error: { code: -32601, message: 'Model turns are forbidden in this fixture' } })
    default: return result({})
  }
})
