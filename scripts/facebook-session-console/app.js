const $ = id => document.getElementById(id)
const state = {
  key: '', authVersion: 0, selectionVersion: 0, requestVersion: 0,
  accounts: [], selectedId: null, activeAccountId: null, capacity: 1,
  listTimer: null, frameTimer: null, totpTimer: null, frameUrl: null,
  framePending: false, totpPending: false, frameController: null, totpController: null,
  pendingAction: false, pendingDialog: 0, dialogVersion: 0,
  dialogMode: null, dialogAccountId: null, pointerStart: null,
}

async function api(path, method = 'GET', data, signal) {
  const response = await fetch('/api/' + path, {
    method, cache: 'no-store', signal,
    headers: { 'X-Session-Console-Key': state.key, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  let result
  try { result = await response.json() } catch { result = {} }
  if (!response.ok) {
    const error = new Error(result.error || 'Request failed (HTTP ' + response.status + ')')
    error.status = response.status
    throw error
  }
  return result
}

function selectedAccount() {
  return state.accounts.find(account => account.id === state.selectedId) || null
}

function displayPhase(account) {
  if (account.running) return account.phase || 'Running'
  return account.phase || (account.sessionSaved ? 'Session saved' : 'Ready')
}

function statusTone(account) {
  if (account.running) return 'running'
  if (account.sessionSaved) return 'saved'
  return 'idle'
}

function dateLabel(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString()
}

function element(tag, className, value) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (value !== undefined) node.textContent = value
  return node
}

function clearManual() {
  clearInterval(state.frameTimer)
  clearInterval(state.totpTimer)
  state.frameController?.abort()
  state.totpController?.abort()
  state.frameController = null
  state.totpController = null
  state.framePending = false
  state.totpPending = false
  state.frameTimer = null
  state.totpTimer = null
  state.pointerStart = null
  if (state.frameUrl) URL.revokeObjectURL(state.frameUrl)
  state.frameUrl = null
  $('browser-frame').removeAttribute('src')
  $('browser-frame').hidden = true
  $('frame-placeholder').hidden = false
  $('totp-code').textContent = ''
  $('totp-code').classList.remove('fallback')
  $('totp-expiry').textContent = ''
  $('manual-text').value = ''
  $('manual-result').textContent = ''
  $('manual-panel').hidden = true
}

function chooseAccount(id) {
  if (id === state.selectedId) return
  state.selectionVersion++
  state.selectedId = id
  clearManual()
  $('action-error').textContent = ''
  render()
}

function renderAccounts() {
  const list = $('account-list')
  const focused = document.activeElement
  const focusedId = focused?.dataset?.accountId
  const focusedRole = focused?.dataset?.accountRole
  list.replaceChildren()
  $('account-count').textContent = state.accounts.length + (state.accounts.length === 1 ? ' account' : ' accounts')
  $('empty-accounts').hidden = state.accounts.length > 0
  for (const account of state.accounts) {
    const row = element('div', 'account-row' + (account.id === state.selectedId ? ' selected' : ''))
    const select = element('button', 'account-select')
    select.type = 'button'
    select.dataset.accountId = account.id
    select.dataset.accountRole = 'select'
    select.setAttribute('aria-current', account.id === state.selectedId ? 'true' : 'false')
    select.addEventListener('click', () => chooseAccount(account.id))
    const avatar = element('span', 'account-avatar', (account.label || account.account || '?').trim().charAt(0).toUpperCase())
    avatar.setAttribute('aria-hidden', 'true')
    const identity = element('span', 'account-identity')
    identity.append(element('strong', '', account.label || 'Unnamed account'), element('span', '', account.account || 'Account ID unavailable'))
    select.append(avatar, identity)
    const details = element('div', 'account-details')
    const phase = element('span', 'badge ' + statusTone(account), displayPhase(account))
    const session = element('span', 'session-state', account.sessionSaved ? 'Saved session' : 'No saved session')
    details.append(phase, session)
    const view = element('button', 'button secondary row-view', account.id === state.selectedId ? 'Selected' : 'View')
    view.type = 'button'
    view.dataset.accountId = account.id
    view.dataset.accountRole = 'view'
    view.disabled = account.id === state.selectedId
    view.addEventListener('click', () => chooseAccount(account.id))
    row.append(select, details, view)
    list.append(row)
  }
  if (focusedId && focusedRole) {
    const replacement = [...list.querySelectorAll('button')].find(button =>
      button.dataset.accountId === focusedId && button.dataset.accountRole === focusedRole)
    const focusTarget = replacement?.disabled
      ? [...list.querySelectorAll('button')].find(button => button.dataset.accountId === focusedId && button.dataset.accountRole === 'select')
      : replacement
    focusTarget?.focus({ preventScroll: true })
  }
}

function renderSelected() {
  const account = selectedAccount()
  $('selected-panel').hidden = !account
  if (!account) { clearManual(); return }
  $('selected-heading').textContent = account.label || 'Unnamed account'
  $('selected-identifier').textContent = account.account || 'Account ID unavailable'
  $('selected-status').textContent = displayPhase(account)
  $('selected-status').className = 'badge ' + statusTone(account)
  $('selected-session').textContent = account.sessionSaved ? 'Saved' : 'Not saved'
  $('selected-updated').textContent = dateLabel(account.updatedAt)
  $('selected-result').textContent = account.lastResult || ''
  const occupiedByOther = Boolean(state.activeAccountId && state.activeAccountId !== account.id)
  const busy = state.pendingAction || occupiedByOther
  $('start-login').disabled = busy || !account.configured || account.running
  $('check-session').disabled = busy || !account.sessionSaved || account.running
  $('stop-browser').disabled = state.pendingAction || !account.running
  $('edit-account').disabled = state.pendingAction
  const manual = Boolean(account.manualAvailable && account.running)
  if (!manual) {
    if (!$('manual-panel').hidden) clearManual()
    return
  }
  $('manual-panel').hidden = false
  const twoFactor = account.manualStage === 'two-factor'
  $('totp-panel').hidden = !twoFactor
  if (twoFactor && !state.totpTimer) {
    refreshTotp()
    state.totpTimer = setInterval(refreshTotp, 1000)
  } else if (!twoFactor && state.totpTimer) {
    clearInterval(state.totpTimer)
    state.totpTimer = null
    $('totp-code').textContent = ''
    $('totp-code').classList.remove('fallback')
    $('totp-expiry').textContent = ''
  }
  if (!state.frameTimer) {
    refreshFrame()
    state.frameTimer = setInterval(refreshFrame, 1200)
  }
}

function render() {
  const running = state.accounts.find(account => account.running)
  $('capacity-note').textContent = running
    ? 'One browser at a time · ' + (running.label || 'An account') + ' is active. Stop it before starting another account.'
    : 'One browser at a time · Select an account to start or check its session.'
  renderAccounts()
  renderSelected()
}

function applyList(result, requestVersion) {
  if (requestVersion !== state.requestVersion || !state.key) return
  if (!result || !Array.isArray(result.accounts)) throw new Error('Invalid account list response')
  state.accounts = result.accounts
  state.activeAccountId = result.activeAccountId || null
  state.capacity = result.capacity || 1
  if (!state.accounts.some(account => account.id === state.selectedId)) {
    const nextId = state.activeAccountId || state.accounts[0]?.id || null
    if (nextId !== state.selectedId) {
      state.selectionVersion++
      clearManual()
    }
    state.selectedId = nextId
  }
  render()
}

async function refresh() {
  if (!state.key || state.pendingAction || state.pendingDialog) return
  const authVersion = state.authVersion
  const requestVersion = ++state.requestVersion
  try {
    const result = await api('accounts')
    if (authVersion !== state.authVersion) return
    applyList(result, requestVersion)
    $('page-error').textContent = ''
  } catch (error) {
    if (authVersion !== state.authVersion) return
    if (error.status === 401 || error.status === 403) lock(error.message)
    else $('page-error').textContent = error.message
  }
}

function lock(message = '') {
  state.authVersion++
  state.selectionVersion++
  state.requestVersion++
  state.key = ''
  state.accounts = []
  state.selectedId = null
  state.activeAccountId = null
  state.pendingAction = false
  state.pendingDialog = 0
  clearInterval(state.listTimer)
  state.listTimer = null
  clearManual()
  if ($('account-dialog').open) $('account-dialog').close()
  $('manager').hidden = true
  $('lock').hidden = true
  $('access-panel').hidden = false
  $('access-code').value = ''
  $('access-error').textContent = message
  $('access-code').focus()
}

async function mutate(path, data = {}) {
  const authVersion = state.authVersion
  const selectionVersion = state.selectionVersion
  state.pendingAction = true
  state.requestVersion++
  renderSelected()
  $('action-error').textContent = ''
  try {
    const result = await api(path, 'POST', data)
    if (authVersion !== state.authVersion) return false
    state.pendingAction = false
    applyList(result, state.requestVersion)
    if (selectionVersion === state.selectionVersion) $('action-error').textContent = ''
    return true
  } catch (error) {
    if (authVersion !== state.authVersion) return false
    state.pendingAction = false
    if (error.status === 401 || error.status === 403) lock(error.message)
    else if (selectionVersion === state.selectionVersion) $('action-error').textContent = error.message
    renderSelected()
    return false
  }
}

async function refreshFrame() {
  const account = selectedAccount()
  if (!account?.manualAvailable || !state.key || state.framePending) return
  const authVersion = state.authVersion
  const selectionVersion = state.selectionVersion
  const id = account.id
  const controller = new AbortController()
  state.frameController = controller
  state.framePending = true
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch('/api/accounts/' + encodeURIComponent(id) + '/frame', {
      headers: { 'X-Session-Console-Key': state.key }, cache: 'no-store', signal: controller.signal,
    })
    if (!response.ok) return
    const blob = await response.blob()
    if (authVersion !== state.authVersion || selectionVersion !== state.selectionVersion || !selectedAccount()?.manualAvailable) return
    const url = URL.createObjectURL(blob)
    const previous = state.frameUrl
    state.frameUrl = url
    $('browser-frame').src = url
    $('browser-frame').hidden = false
    $('frame-placeholder').hidden = true
    if (previous) URL.revokeObjectURL(previous)
  } catch { /* A later poll can reconnect. */ }
  finally {
    clearTimeout(timeout)
    if (state.frameController === controller) {
      state.frameController = null
      state.framePending = false
    }
  }
}

async function refreshTotp() {
  const account = selectedAccount()
  if (account?.manualStage !== 'two-factor' || !state.key || state.totpPending) return
  const authVersion = state.authVersion
  const selectionVersion = state.selectionVersion
  const controller = new AbortController()
  state.totpController = controller
  state.totpPending = true
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const result = await api('accounts/' + encodeURIComponent(account.id) + '/totp', 'GET', undefined, controller.signal)
    if (authVersion !== state.authVersion || selectionVersion !== state.selectionVersion || selectedAccount()?.manualStage !== 'two-factor') return
    $('totp-code').textContent = result.code || 'Enter the code from your authenticator app'
    $('totp-code').classList.toggle('fallback', !result.code)
    $('totp-expiry').textContent = result.expiresAt && result.serverNow
      ? Math.max(0, Math.ceil((result.expiresAt - result.serverNow) / 1000)) + 's left' : ''
  } catch {
    if (authVersion === state.authVersion && selectionVersion === state.selectionVersion && selectedAccount()?.manualStage === 'two-factor') {
      $('totp-code').textContent = 'Enter the code from your authenticator app'
      $('totp-code').classList.add('fallback')
      $('totp-expiry').textContent = ''
    }
  } finally {
    clearTimeout(timeout)
    if (state.totpController === controller) {
      state.totpController = null
      state.totpPending = false
    }
  }
}

function openDialog(mode) {
  const account = selectedAccount()
  if (mode === 'edit' && !account) return
  state.dialogMode = mode
  state.dialogVersion++
  state.dialogAccountId = mode === 'edit' ? account.id : null
  $('account-form').reset()
  $('dialog-error').textContent = ''
  $('dialog-title').textContent = mode === 'edit' ? 'Edit account' : 'Add account'
  $('dialog-help').textContent = mode === 'edit'
    ? 'Leave password and authenticator secret blank to keep the saved values.'
    : 'Credentials are saved on this server. You will complete sign-in steps in the browser.'
  $('field-label').value = mode === 'edit' ? account.label || '' : ''
  $('field-account').value = mode === 'edit' ? account.account || '' : ''
  $('field-account').disabled = mode === 'edit'
  $('field-password').required = mode === 'add'
  $('save-account').textContent = mode === 'edit' ? 'Save changes' : 'Add account'
  $('save-account').disabled = false
  $('account-dialog').showModal()
  $('field-label').focus()
}

function closeDialog() {
  state.dialogVersion++
  $('account-dialog').close()
  $('account-form').reset()
  state.dialogMode = null
  state.dialogAccountId = null
}

$('access-form').addEventListener('submit', async event => {
  event.preventDefault()
  const key = $('access-code').value.trim()
  $('access-code').value = ''
  $('access-error').textContent = ''
  if (!key) return
  state.key = key
  const authVersion = ++state.authVersion
  const requestVersion = ++state.requestVersion
  try {
    const result = await api('accounts')
    if (authVersion !== state.authVersion) return
    $('access-panel').hidden = true
    $('manager').hidden = false
    $('lock').hidden = false
    applyList(result, requestVersion)
    state.listTimer = setInterval(refresh, 3000)
  } catch (error) {
    if (authVersion !== state.authVersion) return
    state.key = ''
    $('access-error').textContent = error.message
  }
})
$('lock').addEventListener('click', () => lock())
$('add-account').addEventListener('click', () => openDialog('add'))
$('edit-account').addEventListener('click', () => openDialog('edit'))
$('close-dialog').addEventListener('click', closeDialog)
$('cancel-dialog').addEventListener('click', closeDialog)
$('account-dialog').addEventListener('close', () => {
  if ($('account-dialog').open) return
  state.dialogVersion++
  $('account-form').reset()
  state.dialogMode = null
  state.dialogAccountId = null
})
$('account-form').addEventListener('submit', async event => {
  event.preventDefault()
  const mode = state.dialogMode
  const id = state.dialogAccountId
  const values = Object.fromEntries(new FormData($('account-form')))
  values.label = values.label.trim()
  if (!values.label) return
  if (mode === 'edit') {
    delete values.account
    if (!values.password) delete values.password
    if (!values.totpSecret) delete values.totpSecret
  }
  $('save-account').disabled = true
  const authVersion = state.authVersion
  const dialogVersion = state.dialogVersion
  state.pendingDialog++
  state.requestVersion++
  try {
    const result = await api(mode === 'edit' ? 'accounts/' + encodeURIComponent(id) + '/config' : 'accounts', 'POST', values)
    if (authVersion !== state.authVersion) return
    if (dialogVersion === state.dialogVersion) {
      const requestVersion = ++state.requestVersion
      applyList(result, requestVersion)
      if (mode === 'add' && result.accounts?.length) chooseAccount(result.accounts.at(-1).id)
      closeDialog()
    } else refresh()
  } catch (error) {
    if (authVersion !== state.authVersion) return
    if (error.status === 401 || error.status === 403) lock(error.message)
    else if (dialogVersion === state.dialogVersion) $('dialog-error').textContent = error.message
  } finally {
    if (authVersion === state.authVersion) {
      state.pendingDialog = Math.max(0, state.pendingDialog - 1)
      if (dialogVersion === state.dialogVersion) $('save-account').disabled = false
      else if (!state.pendingDialog) refresh()
    }
  }
})

for (const [button, action] of [['start-login', 'login'], ['check-session', 'check'], ['stop-browser', 'stop']]) {
  $(button).addEventListener('click', () => {
    const account = selectedAccount()
    if (account) mutate('accounts/' + encodeURIComponent(account.id) + '/' + action)
  })
}

function setZoom(mode) {
  $('browser-viewport').classList.toggle('fit', mode === 'fit')
  $('browser-viewport').classList.toggle('actual', mode === 'actual')
  $('zoom-fit').setAttribute('aria-pressed', mode === 'fit' ? 'true' : 'false')
  $('zoom-actual').setAttribute('aria-pressed', mode === 'actual' ? 'true' : 'false')
}
$('zoom-fit').addEventListener('click', () => setZoom('fit'))
$('zoom-actual').addEventListener('click', () => setZoom('actual'))
$('pan-mode').addEventListener('click', () => {
  const pan = $('pan-mode').getAttribute('aria-pressed') !== 'true'
  $('pan-mode').setAttribute('aria-pressed', pan ? 'true' : 'false')
  $('browser-viewport').classList.toggle('pan', pan)
  $('pan-mode').textContent = pan ? 'Interact' : 'Pan view'
})

function imagePoint(event) {
  const image = $('browser-frame')
  const bounds = image.getBoundingClientRect()
  const width = image.naturalWidth || 1280
  const height = image.naturalHeight || 800
  return {
    x: Math.max(0, Math.min(width - 1, Math.round((event.clientX - bounds.left) * width / bounds.width))),
    y: Math.max(0, Math.min(height - 1, Math.round((event.clientY - bounds.top) * height / bounds.height))),
  }
}

async function sendManual(command) {
  const account = selectedAccount()
  if (!account?.manualAvailable) return
  const authVersion = state.authVersion
  const selectionVersion = state.selectionVersion
  $('manual-result').textContent = 'Sending…'
  try {
    await api('accounts/' + encodeURIComponent(account.id) + '/manual', 'POST', command)
    if (authVersion === state.authVersion && selectionVersion === state.selectionVersion) $('manual-result').textContent = 'Sent to browser'
  } catch (error) {
    if (authVersion === state.authVersion && selectionVersion === state.selectionVersion) $('manual-result').textContent = error.message
  }
}

$('browser-frame').addEventListener('pointerdown', event => {
  if (event.button !== 0 || $('browser-viewport').classList.contains('pan')) return
  state.pointerStart = imagePoint(event)
  event.currentTarget.setPointerCapture(event.pointerId)
  event.preventDefault()
})
$('browser-frame').addEventListener('pointerup', event => {
  if (!state.pointerStart) return
  const end = imagePoint(event)
  const start = state.pointerStart
  state.pointerStart = null
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  sendManual(distance >= 8 ? { type: 'drag', ...start, toX: end.x, toY: end.y } : { type: 'click', ...start })
  event.preventDefault()
})
$('browser-frame').addEventListener('pointercancel', () => { state.pointerStart = null })
$('send-text').addEventListener('click', () => {
  const value = $('manual-text').value
  $('manual-text').value = ''
  if (value) sendManual({ type: 'text', text: value })
})
$('manual-text').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); $('send-text').click() }
})
for (const [button, key] of [['send-enter', 'Enter'], ['send-backspace', 'Backspace'], ['send-tab', 'Tab']]) {
  $(button).addEventListener('click', () => sendManual({ type: 'key', key }))
}
for (const [button, deltaY] of [['scroll-up', -500], ['scroll-down', 500]]) {
  $(button).addEventListener('click', () => sendManual({ type: 'scroll', deltaY }))
}

$('browser-frame').hidden = true
