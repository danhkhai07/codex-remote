const host = process.env.CODEX_REMOTE_HOST || '127.0.0.1'
const port = process.env.CODEX_REMOTE_PORT || '5173'
const url = `http://${host}:${port}/api/healthz`

try {
  const response = await fetch(url, {
    headers: { Host: `${host}:${port}` },
    signal: AbortSignal.timeout(3_000),
  })
  const body = await response.text()
  console.log(`${url}: HTTP ${response.status} ${body}`)
  if (!response.ok) process.exitCode = 1
} catch (error) {
  console.error(`${url}: unavailable (${error instanceof Error ? error.message : error})`)
  process.exitCode = 1
}
