const host = process.env.CODEX_REMOTE_HOST || '127.0.0.1'
const port = process.env.CODEX_REMOTE_PORT || '5173'
const localOrigin = `http://${host}:${port}`
const browserOrigin = process.env.CODEX_REMOTE_PUBLIC_ORIGIN
const targetOrigin = process.env.CODEX_REMOTE_SMOKE_ORIGIN || localOrigin
const password = process.env.CODEX_REMOTE_PASSWORD

if (!browserOrigin || !password) {
  throw new Error('CODEX_REMOTE_PUBLIC_ORIGIN and CODEX_REMOTE_PASSWORD are required')
}

function cookieFrom(response) {
  const value = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie')
  if (!value) throw new Error('Login did not return a session cookie')
  return value.split(';', 1)[0]
}

async function jsonRequest(path, { method = 'GET', body, cookie, csrf } = {}) {
  const headers = { Origin: browserOrigin }
  if (cookie) headers.Cookie = cookie
  if (csrf) headers['X-CSRF-Token'] = csrf
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(30_000),
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const response = await fetch(`${targetOrigin}${path}`, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${payload.error ?? 'unknown error'}`)
  return { response, payload }
}

const login = await jsonRequest('/api/session/login', {
  method: 'POST',
  body: { password },
})
const cookie = cookieFrom(login.response)
const csrf = login.payload.csrf
if (typeof csrf !== 'string') throw new Error('Login did not return a CSRF token')
console.log('✓ Authenticated session')

let threadId
try {
  const created = await jsonRequest('/api/threads', {
    method: 'POST',
    body: { workspaceId: '0' },
    cookie,
    csrf,
  })
  threadId = created.payload.thread?.id
  if (typeof threadId !== 'string') throw new Error('Thread creation returned no id')
  console.log('✓ Created a real Codex thread')

  const abort = new AbortController()
  const eventResponse = await fetch(`${targetOrigin}/api/events`, {
    headers: { Cookie: cookie },
    signal: abort.signal,
  })
  if (!eventResponse.ok || !eventResponse.body) throw new Error(`Event stream returned ${eventResponse.status}`)

  let finalText = ''
  let buffer = ''
  let completed = false
  const completion = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of eventResponse.body) {
      buffer += decoder.decode(chunk, { stream: true }).replaceAll('\r\n', '\n')
      let separator
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const data = frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
        if (!data) continue
        const event = JSON.parse(data)
        const message = event.payload ?? {}
        const params = message.params ?? {}
        if (params.threadId !== threadId) continue
        if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') finalText += params.delta
        if (message.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') finalText = params.item.text
        if (message.method === 'turn/completed') {
          if (params.turn?.status !== 'completed') throw new Error(`Smoke turn ended as ${params.turn?.status ?? 'unknown'}`)
          completed = true
          return
        }
      }
    }
  })()

  const turn = await jsonRequest(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
    method: 'POST',
    body: { text: 'This is a read-only transport smoke test. Do not use any tools. Reply with exactly CODEX_REMOTE_READY.' },
    cookie,
    csrf,
  })
  if (typeof turn.payload.turn?.id !== 'string') throw new Error('Turn creation returned no id')
  console.log('✓ Started a real Codex turn and subscribed to output')

  let timeout
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out waiting for turn/completed')), 180_000)
    timeout.unref()
  })
  try {
    await Promise.race([completion, deadline])
  } finally {
    clearTimeout(timeout)
  }
  abort.abort()
  if (!completed || !finalText.includes('CODEX_REMOTE_READY')) {
    throw new Error('Completed turn did not stream the expected agent output')
  }
  console.log('✓ Received agent output and turn/completed over SSE')
} finally {
  if (threadId) {
    await jsonRequest(`/api/threads/${encodeURIComponent(threadId)}/archive`, {
      method: 'POST',
      body: {},
      cookie,
      csrf,
    }).catch(() => undefined)
    console.log('✓ Archived the disposable smoke thread')
  }
  await jsonRequest('/api/session/logout', {
    method: 'POST',
    body: {},
    cookie,
    csrf,
  }).catch(() => undefined)
}

console.log('Codex Remote live smoke: PASS')
