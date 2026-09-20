import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RequestCard } from './App'
import type { PendingRequest } from './types'

const render = (method: string, params: PendingRequest['params']) => renderToStaticMarkup(
  <RequestCard request={{ key: 'test', method, params, createdAt: '' }} csrf="fixture" onResolved={() => {}} />,
)

it('initially presents only the first question with unselected numbered choices', () => {
  const html = render('item/tool/requestUserInput', { questions: [
    { id: 'first', question: 'Which approach?', options: [{ label: 'Small', description: 'One part at a time' }, { label: 'All', description: 'Everything' }] },
    { id: 'second', question: 'Hidden second question', options: [] },
  ] })
  expect(html).toContain('1/2')
  expect(html).toContain('role="radio"')
  expect(html).toContain('Other answer…')
  for (const text of ['Hidden second question', 'One part at a time', 'Everything', 'aria-checked="true"', '<input', '<select', 'Action needed', 'Codex has a question', 'Request details', 'request-card']) {
    expect(html).not.toContain(text)
  }
})

it('shows free text directly and honors secret questions', () => {
  const html = render('item/tool/requestUserInput', { questions: [{ id: 'secret', question: 'Private answer', isSecret: true, options: null }] })
  expect(html).toContain('type="password"')
  expect(html).toContain('aria-label="Private answer"')
  expect(html).not.toContain('role="radio"')
})

it.each([
  ['item/commandExecution/requestApproval', 'Approve command?', 'Allow session'],
  ['item/fileChange/requestApproval', 'Approve file changes?', 'Allow once'],
  ['item/permissions/requestApproval', 'Grant additional permissions?', 'Allow this turn'],
])('preserves %s approval cards', (method, heading, action) => {
  const html = render(method, { reason: 'Approval reason' })
  for (const text of ['request-card', 'Action needed', heading, 'Approval reason', 'Decline', action, 'Request details']) expect(html).toContain(text)
  expect(html).not.toContain('plan-question')
})
