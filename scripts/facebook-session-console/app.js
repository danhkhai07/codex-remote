const $ = id => document.getElementById(id)
let accessCode = ''
let timer = null
let frameTimer = null
let frameUrl = null
let pointerStart = null

async function api(path, method = 'GET', data = undefined) {
  const options = {
    method,
    headers: { 'X-Session-Console-Key': accessCode, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  }
  if (data !== undefined) options.body = JSON.stringify(data)
  const response = await fetch(`/api/${path}`, options)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}

function paint(status) {
  $('manager').hidden = false
  $('account').textContent = status.account ?? 'Not configured'
  $('phase').textContent = status.phase
  $('saved').textContent = status.sessionSaved ? 'Yes' : 'No'
  $('updated').textContent = status.updatedAt ? new Date(status.updatedAt).toLocaleString() : '—'
  $('result').textContent = status.lastResult || ''
  $('login').disabled = !status.configured || status.running
  $('check').disabled = !status.sessionSaved || status.running
  $('stop').disabled = !status.running
  $('manual-panel').hidden = !status.manualAvailable
  if (status.manualAvailable && !frameTimer) {
    frameTimer = setInterval(refreshFrame, 1200)
    refreshFrame()
  } else if (!status.manualAvailable && frameTimer) {
    clearInterval(frameTimer)
    frameTimer = null
    if (frameUrl) URL.revokeObjectURL(frameUrl)
    frameUrl = null
    $('browser-frame').removeAttribute('src')
  }
}

async function refreshFrame() {
  if (!accessCode || $('manual-panel').hidden) return
  const code = accessCode
  try {
    const response = await fetch('/api/frame', { headers: { 'X-Session-Console-Key': code }, cache: 'no-store' })
    if (!response.ok) return
    const blob = await response.blob()
    if ($('manual-panel').hidden || accessCode !== code) return
    const url = URL.createObjectURL(blob)
    $('browser-frame').src = url
    if (frameUrl) URL.revokeObjectURL(frameUrl)
    frameUrl = url
  } catch { /* A later poll can reconnect. */ }
}

async function refresh() {
  try { paint(await api('status')) }
  catch (error) {
    clearInterval(timer)
    timer = null
    accessCode = ''
    paint({ account: null, phase: '', sessionSaved: false, running: false, updatedAt: null, lastResult: '', manualAvailable: false })
    $('manager').hidden = true
    $('result').textContent = error.message
    $('access-form').hidden = false
  }
}

$('access-form').addEventListener('submit', async event => {
  event.preventDefault()
  accessCode = $('access-code').value.trim()
  $('access-code').value = ''
  try {
    paint(await api('status'))
    $('access-form').hidden = true
    if (!timer) timer = setInterval(refresh, 3000)
  } catch (error) { alert(error.message) }
})

$('config-form').addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.currentTarget
  const values = Object.fromEntries(new FormData(form))
  try {
    paint(await api('config', 'POST', values))
    form.reset()
    form.closest('details').open = false
  } catch (error) { alert(error.message) }
})

for (const action of ['login', 'check']) {
  $(action).addEventListener('click', async () => {
    try { paint(await api(action, 'POST', action === 'login' ? { manualCaptcha: $('manual-captcha').checked } : {})) }
    catch (error) { alert(error.message) }
  })
}
$('stop').addEventListener('click', async () => {
  try { paint(await api('stop', 'POST', {})) }
  catch (error) { alert(error.message) }
})

function imagePoint(event) {
  const image = $('browser-frame')
  const bounds = image.getBoundingClientRect()
  const width = image.naturalWidth || 1280
  const height = image.naturalHeight || 800
  return {
    x: Math.max(0, Math.min(1279, width - 1, Math.round((event.clientX - bounds.left) * width / bounds.width))),
    y: Math.max(0, Math.min(799, height - 1, Math.round((event.clientY - bounds.top) * height / bounds.height))),
  }
}

async function sendManual(command) {
  try {
    await api('manual', 'POST', command)
    $('manual-result').textContent = 'Sent to browser'
  } catch (error) { $('manual-result').textContent = error.message }
}

$('browser-frame').addEventListener('pointerdown', event => {
  if (event.button !== 0) return
  pointerStart = imagePoint(event)
  event.currentTarget.setPointerCapture(event.pointerId)
  event.preventDefault()
})
$('browser-frame').addEventListener('pointerup', event => {
  if (!pointerStart) return
  const end = imagePoint(event)
  const start = pointerStart
  pointerStart = null
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  sendManual(distance >= 8 ? { type: 'drag', ...start, toX: end.x, toY: end.y } : { type: 'click', ...start })
  event.preventDefault()
})
$('browser-frame').addEventListener('pointercancel', () => { pointerStart = null })
$('send-text').addEventListener('click', () => {
  const text = $('manual-text').value
  if (text) sendManual({ type: 'text', text })
  $('manual-text').value = ''
})
for (const [button, key] of [['send-enter', 'Enter'], ['send-backspace', 'Backspace']]) {
  $(button).addEventListener('click', () => sendManual({ type: 'key', key }))
}
