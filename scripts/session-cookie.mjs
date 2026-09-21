// Loopback maintenance only: both names bridge the old/new gateway during an
// idle rollout. Browser responses always set only the current cookie name.
export function maintenanceCookie(token, secure) {
  return `${secure ? '__Host-codex_remote_session=' + token + '; ' : ''}codex_remote_session=${token}`
}
