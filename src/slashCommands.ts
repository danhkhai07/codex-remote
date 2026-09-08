export type SlashCommand = {
  name: string
  usage: string
  description: string
  takesArgument?: boolean
}

export const slashCommands: SlashCommand[] = [
  { name: 'status', usage: '/status', description: 'Show connection, model, turn, and queue status' },
  { name: 'model', usage: '/model <model>', description: 'Choose the model for future turns', takesArgument: true },
  { name: 'effort', usage: '/effort <level>', description: 'Choose reasoning effort for the selected model', takesArgument: true },
  { name: 'yolo', usage: '/yolo <on|off>', description: 'Toggle full VPS host access for future turns', takesArgument: true },
  { name: 'new', usage: '/new', description: 'Start a new conversation' },
  { name: 'threads', usage: '/threads', description: 'Open the conversation drawer' },
  { name: 'archive', usage: '/archive', description: 'Archive the current conversation' },
  { name: 'stop', usage: '/stop', description: 'Stop the active Codex turn' },
  { name: 'lock', usage: '/lock', description: 'Lock this Remote Control session' },
  { name: 'help', usage: '/help', description: 'Show every available slash command' },
]

export function parseSlashCommand(value: string): { name: string; argument: string } | null {
  const input = value.trim()
  if (!input.startsWith('/') || input.includes('\n')) return null
  const match = input.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { name: match[1].toLocaleLowerCase(), argument: (match[2] ?? '').trim() }
}

export function matchingSlashCommands(value: string): SlashCommand[] {
  const input = value.trimStart()
  if (!input.startsWith('/') || input.includes('\n') || input.includes(' ')) return []
  const query = input.slice(1).toLocaleLowerCase()
  return slashCommands.filter((command) => command.name.startsWith(query))
}
