const storageKey = 'luxxy-account-invitation';
let memoryToken = '';

export function clearInvitationToken() {
  memoryToken = '';
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
}

// Run before the authentication provider mounts, keeping capabilities out of SDK URLs.
export function captureInvitationToken() {
  if (window.location.pathname !== '/join') return;
  const fragment = window.location.hash.slice(1);
  if (!fragment) return;
  clearInvitationToken();
  if (/^[a-f0-9]{64}$/.test(fragment)) {
    memoryToken = fragment;
    try { sessionStorage.setItem(storageKey, fragment); } catch { /* Keep it in memory. */ }
  }
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

export function invitationTokenFromBrowser() {
  captureInvitationToken();
  try {
    const saved = sessionStorage.getItem(storageKey) ?? '';
    return /^[a-f0-9]{64}$/.test(saved) ? saved : memoryToken;
  } catch { return memoryToken; }
}
