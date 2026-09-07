import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Conversation } from './App'
import type { Thread } from './types'
import type { TranscriptItem } from './transcript'

const thread: Thread = { id: 'thread', cwd: '/workspace', createdAt: 0, updatedAt: 0, status: {}, turns: [] }
const rows: TranscriptItem[] = [
  { id: 'user', turnId: 'turn', type: 'userMessage', text: 'Fix the conversation' },
  { id: 'commentary', turnId: 'turn', type: 'agentMessage', text: 'Inspecting the layout.', streaming: false },
  { id: 'cmd', turnId: 'turn', type: 'commandExecution', command: 'npm test', status: 'completed' },
  { id: 'reply', turnId: 'turn', type: 'agentMessage', text: 'Found the cause.', streaming: true },
]
it('renders the same ordered conversation during processing and after completion', () => {
  for (const activeTurnId of ['turn', null]) {
    const html = renderToStaticMarkup(<Conversation thread={thread} items={rows} activeTurnId={activeTurnId}
      pendingMessage={{ text: 'Fix the conversation', turnId: 'turn' }} yoloMode={false} onSuggestion={() => {}} />)
    expect(html.match(/Fix the conversation/g)).toHaveLength(1)
    expect(html.indexOf('Fix the conversation')).toBeLessThan(html.indexOf('Inspecting the layout.'))
    expect(html.indexOf('Inspecting the layout.')).toBeLessThan(html.indexOf('npm test'))
    expect(html.indexOf('npm test')).toBeLessThan(html.indexOf('Found the cause.'))
    expect(html.match(/message-agent/g)).toHaveLength(2)
  }
})
it('shows a pending submission immediately even if its text repeats an older prompt', () => {
  const html = renderToStaticMarkup(<Conversation thread={thread} items={rows} activeTurnId={null}
    pendingMessage={{ text: 'Fix the conversation' }} yoloMode={false} onSuggestion={() => {}} />)
  expect(html.match(/Fix the conversation/g)).toHaveLength(2)
  expect(html).toContain('Sending…')
})

it('keeps image previews visible while an attached turn is pending', () => {
  const html = renderToStaticMarkup(<Conversation thread={thread} items={rows} activeTurnId="turn"
    pendingMessage={{ text: 'Fix the conversation', turnId: 'turn', images: [{ name: 'screen.png', previewUrl: 'blob:screen' }] }}
    yoloMode={false} onSuggestion={() => {}} />)
  expect(html.match(/Fix the conversation/g)).toHaveLength(1)
  expect(html).toContain('src="blob:screen"')
  expect(html).toContain('alt="screen.png"')
})
