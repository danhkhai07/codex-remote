// Build the server first, then run with --env-file-if-exists=.env.
// Reads existing threads only; it never resumes a thread or starts a model turn.
import { createReadStream } from 'node:fs'
import { realpath, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const textParts = content => Array.isArray(content)
  ? content.filter(part => ['text', 'Text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string')
    .map(part => part.text).join('\n')
  : ''

export function parseOptions(args) {
  const options = { limit: Infinity, vault: null, help: false }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help') options.help = true
    else if (arg === '--limit') {
      options.limit = Number(args[++index])
      if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('--limit requires a positive integer')
    } else if (arg === '--vault') {
      options.vault = args[++index]
      if (!options.vault || !isAbsolute(options.vault)) throw new Error('--vault requires an absolute path')
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

// Only paths returned by Codex metadata are accepted, and only inside its session
// directories. Content, Markdown links, and paths inside messages are never read.
export async function readRollout(thread, codexHome) {
  if (typeof thread.path !== 'string' || !isAbsolute(thread.path)) throw new Error('rollout-path-unavailable')
  const path = await realpath(thread.path)
  const roots = (await Promise.all(['sessions', 'archived_sessions'].map(async name => {
    try { return await realpath(resolve(codexHome, name)) } catch { return null }
  }))).filter(Boolean)
  if (!roots.some(root => {
    const suffix = relative(root, path)
    return suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  }) || !path.endsWith('.jsonl') || !(await stat(path)).isFile()) throw new Error('rollout-path-outside-session-storage')

  const turns = new Map()
  let currentTurnId = null
  let verified = false
  let unsupportedMessages = 0
  let malformedLines = 0
  const turnFor = id => {
    if (!turns.has(id)) turns.set(id, { id, status: 'inProgress', canonical: [], fallback: [] })
    return turns.get(id)
  }
  let lineNumber = 0
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    lineNumber++
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { malformedLines++; continue }
    const payload = object(row.payload)
    if (row.type === 'session_meta') {
      if (payload.id !== thread.id || payload.cwd !== thread.cwd) throw new Error('rollout-session-mismatch')
      verified = true
      continue
    }
    if (!verified) continue
    if (row.type === 'turn_context' && typeof payload.turn_id === 'string') currentTurnId = payload.turn_id
    if (row.type === 'event_msg') {
      if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
        currentTurnId = payload.turn_id
        turnFor(currentTurnId)
      }
      if (['task_complete', 'turn_aborted'].includes(payload.type) && typeof payload.turn_id === 'string') {
        turnFor(payload.turn_id).status = payload.type === 'task_complete' ? 'completed' : 'interrupted'
      }
      const item = object(payload.item)
      if (payload.type === 'item_completed' && ['UserMessage', 'AgentMessage'].includes(item.type)) {
        if (typeof payload.turn_id !== 'string') { unsupportedMessages++; continue }
        const text = textParts(item.content)
        if (!text) continue
        const normalized = item.type === 'UserMessage'
          ? { id: typeof item.id === 'string' ? item.id : undefined, type: 'userMessage', content: [{ type: 'text', text }] }
          : { id: typeof item.id === 'string' ? item.id : undefined, type: 'agentMessage', text, phase: item.phase }
        turnFor(payload.turn_id).canonical.push({ ...normalized, lineNumber })
      }
    }
    // Older rollouts may lack item_completed. Only known message records are
    // eligible; tool output, reasoning, system/developer text and compactions
    // are deliberately excluded. Canonical items take precedence per role.
    if (row.type === 'response_item' && payload.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
      const text = textParts(payload.content)
      if (!text) continue
      if (!currentTurnId) { unsupportedMessages++; continue }
      turnFor(currentTurnId).fallback.push({ lineNumber, ...(payload.role === 'user'
        ? { id: typeof payload.id === 'string' ? payload.id : undefined, type: 'userMessage', content: [{ type: 'text', text }] }
        : { id: typeof payload.id === 'string' ? payload.id : undefined, type: 'agentMessage', text, phase: payload.phase }) })
    }
  }
  if (!verified) throw new Error('rollout-session-metadata-missing')
  const result = [...turns.values()].map(turn => {
    const canonicalTypes = new Set(turn.canonical.map(item => item.type))
    const items = [...turn.canonical, ...turn.fallback.filter(item => !canonicalTypes.has(item.type))]
      .sort((left, right) => left.lineNumber - right.lineNumber).map(({ lineNumber: _line, ...item }) => item)
    return { id: turn.id, status: turn.status, items }
  }).filter(turn => turn.items.length)
  return { turns: result, unsupportedMessages, malformedLines }
}

export async function importThreads({ app, vault, workspaceRoots, codexHome, limit = Infinity, saveStatus = async () => {} }) {
  const status = {
    startedAt: new Date().toISOString(), finishedAt: null, state: 'running',
    listed: 0, imported: 0, fromRpc: 0, fromRollout: 0, metadataOnly: 0,
    skippedDisallowed: 0, limited: false, failedThreads: [], listFailures: [], fatalError: null,
  }
  const seen = new Set()
  await saveStatus(status)
  try {
    for (const archived of [false, true]) {
      let cursor = null
      const cursors = new Set()
      do {
        let page
        try {
          page = object(await app.request('thread/list', {
            limit: Math.min(100, limit - seen.size), sortKey: 'updated_at', sortDirection: 'desc',
            archived, cwd: workspaceRoots, ...(cursor ? { cursor } : {}),
          }))
          if (!Array.isArray(page.data)) throw new Error('invalid-page')
        } catch {
          status.listFailures.push({ archived, code: 'thread-list-failed' })
          break
        }
        for (const rawThread of page.data) {
          const thread = object(rawThread)
          if (typeof thread.id !== 'string' || !workspaceRoots.includes(thread.cwd)) { status.skippedDisallowed++; continue }
          if (seen.has(thread.id)) continue
          seen.add(thread.id)
          status.listed++
          let fullThread = null
          let partial = false
          try {
            const result = object(await app.request('thread/read', { threadId: thread.id, includeTurns: true }))
            const candidate = object(result.thread)
            if (candidate.id !== thread.id || !workspaceRoots.includes(candidate.cwd)) throw new Error('thread-mismatch')
            if (Array.isArray(candidate.turns) && candidate.turns.length && candidate.historyUnavailable !== true) {
              fullThread = candidate
              status.fromRpc++
            }
          } catch { /* Try the original local rollout when persisted RPC history is unavailable. */ }
          if (!fullThread) {
            try {
              const history = await readRollout(thread, codexHome)
              partial = history.unsupportedMessages > 0 || history.malformedLines > 0
              fullThread = { ...thread, turns: history.turns, historyUnavailable: partial, historyCacheTruncated: partial }
              status.fromRollout++
            } catch {
              fullThread = { ...thread, turns: [], historyUnavailable: true }
              status.metadataOnly++
              status.failedThreads.push({ id: thread.id, code: 'history-unavailable' })
            }
          }
          try {
            await vault.recordThread({ ...fullThread, archived })
            status.imported++
            if (partial) status.failedThreads.push({ id: thread.id, code: 'history-partial' })
          } catch {
            status.failedThreads.push({ id: thread.id, code: 'vault-write-failed' })
          }
          await saveStatus(status)
          if (seen.size >= limit) {
            status.limited = true
            break
          }
        }
        if (status.limited) break
        cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null
        if (cursor && cursors.has(cursor)) {
          status.listFailures.push({ archived, code: 'repeated-pagination-cursor' })
          break
        }
        if (cursor) cursors.add(cursor)
      } while (cursor)
      if (status.limited) break
    }
  } catch (error) {
    status.fatalError = 'import-failed'
    throw error
  } finally {
    status.finishedAt = new Date().toISOString()
    status.state = status.fatalError || status.failedThreads.length || status.listFailures.length ? 'partial' : status.limited ? 'limited' : 'complete'
    await saveStatus(status)
  }
  return status
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node --env-file-if-exists=.env scripts/import-context-vault.mjs [--limit N] [--vault /absolute/path]')
    return
  }
  const [{ CodexAppServer }, { loadConfig }, { ContextVault }] = await Promise.all([
    import('../dist-server/codex-app-server.js'), import('../dist-server/config.js'), import('../dist-server/context-vault.js'),
  ])
  const config = loadConfig()
  const root = resolve(options.vault ?? config.contextVaultPath ?? '/root/VAULTS/Codex-Context')
  const stateDirectory = resolve(root, '.state')
  const vault = new ContextVault(root)
  const app = new CodexAppServer(config.codexBin)
  const saveStatus = async status => {
    const temporary = resolve(stateDirectory, `import-status.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, resolve(stateDirectory, 'import-status.json'))
  }
  try {
    const status = await importThreads({
      app, vault, workspaceRoots: config.workspaceRoots,
      codexHome: process.env.CODEX_HOME || resolve(homedir(), '.codex'), limit: options.limit, saveStatus,
    })
    console.log(JSON.stringify(status, null, 2))
    if (status.state === 'partial') process.exitCode = 1
  } finally { app.stop() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Do not echo RPC errors, session content or environment values to logs.
    console.error(error instanceof Error && error.message.startsWith('--') ? error.message : 'Context import failed; inspect .state/import-status.json for completed counts.')
    process.exitCode = 1
  })
}
