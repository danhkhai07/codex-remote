import { describe, expect, it } from 'vitest'
import { matchingSlashCommands, parseSlashCommand } from './slashCommands'

describe('slash commands', () => {
  it('parses commands without treating regular prompts or multiline text as commands', () => {
    expect(parseSlashCommand('/MODEL gpt-5.6-sol')).toEqual({ name: 'model', argument: 'gpt-5.6-sol' })
    expect(parseSlashCommand('review /status handling')).toBeNull()
    expect(parseSlashCommand('/status\nthen continue')).toBeNull()
  })

  it('filters command suggestions from a leading slash', () => {
    expect(matchingSlashCommands('/mo').map(({ name }) => name)).toEqual(['model'])
    expect(matchingSlashCommands('/').length).toBeGreaterThan(5)
    expect(matchingSlashCommands('/model ')).toEqual([])
    expect(matchingSlashCommands('/yo').map(({ name }) => name)).toEqual(['yolo'])
  })

  it('sends file paths and unknown slash-prefixed text as regular prompts', () => {
    for (const prompt of [
      '/root/RUNNING-SERVICES/codex-remote/src/App.tsx',
      '/root/company deck/report.html',
      '/root',
      '/status/report.html',
      '/report.html xem file này',
      '/unknown',
    ]) expect(parseSlashCommand(prompt)).toBeNull()
    expect(parseSlashCommand('/skills')).toEqual({ name: 'skills', argument: '' })
    expect(matchingSlashCommands('/ski').map(({ name }) => name)).toEqual(['skills'])
    expect(parseSlashCommand('/status')).toEqual({ name: 'status', argument: '' })
  })
})
