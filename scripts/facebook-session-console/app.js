const $ = id => document.getElementById(id)
let accessCode = ''
let timer = null

async function api(path, method = 'GET', data = undefined) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: { 'X-Session-Console-Key': accessCode, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
    cache: 'no-store',
  })
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
}

async function refresh() {
  try { paint(await api('status')) }
  catch (error) {
    clearInterval(timer)
    timer = null
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
    try { paint(await api(action, 'POST', {})) }
    catch (error) { alert(error.message) }
  })
}
