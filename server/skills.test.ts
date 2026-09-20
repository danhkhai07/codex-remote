import { expect, it, vi } from 'vitest'
import { normalizeSkills, validateSkills } from './skills.js'
import { RemoteController } from './controller.js'
import { CodexAppServer } from './codex-app-server.js'
const skill = { name: 'review', path: '/skills/review/SKILL.md', description: 'Review code', scope: 'user', enabled: true }
it('lists only the selected workspace and reports disabled skills and load errors', () => {
  const result = normalizeSkills({ data: [{ cwd: '/repo', skills: [skill, { ...skill, name: 'off', path: '/off', enabled: false }], errors: [{ message: 'Broken skill' }] }, { cwd: '/other', skills: [{ ...skill, path: '/other' }] }] }, '/repo')
  expect(result.skills).toHaveLength(2)
  expect(result.errors).toEqual(['Broken skill'])
  expect(validateSkills([skill, skill], result.skills)).toEqual([{ name: skill.name, path: skill.path }])
  expect(() => validateSkills([{ ...skill, path: '/etc/passwd' }], result.skills)).toThrow('unavailable')
  expect(() => validateSkills([result.skills[1]], result.skills)).toThrow('disabled')
})
it('uses the conversation cwd, refreshes selection and sends native skill inputs', async () => {
  const app = new CodexAppServer('unused')
  const request = vi.spyOn(app, 'request').mockImplementation(async method => {
    if (method === 'skills/list') return { data: [{ cwd: '/repo', skills: [skill], errors: [] }] }
    return { thread: { id: 'a', cwd: '/repo', turns: [] }, turn: { id: 'turn' } }
  })
  const controller = new RemoteController({ workspaceRoots: ['/repo'] } as never, app)
  await controller.startTurn('a', 'Review this', undefined, undefined, false, [], [], [skill])
  expect(request).toHaveBeenCalledWith('skills/list', { cwds: ['/repo'], forceReload: true })
  expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ input: [
    { type: 'text', text: 'Review this', text_elements: [] }, { type: 'skill', name: skill.name, path: skill.path },
  ] }))
  app.emit('notification', { method: 'turn/completed', params: { threadId: 'a', turn: { id: 'turn', status: 'completed' } } })
  request.mockClear()
  await expect(controller.startTurn('a', 'Review', undefined, undefined, false, [], [], [{ ...skill, path: '/fake' }])).rejects.toThrow('unavailable')
  expect(request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
})
