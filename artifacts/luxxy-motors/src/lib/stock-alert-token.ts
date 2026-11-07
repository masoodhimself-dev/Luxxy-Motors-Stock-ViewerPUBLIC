let captured: { path: string; token: string } | undefined;

export function captureStockAlertToken() {
  const { pathname, search, hash } = window.location;
  if (!/\/stock-alerts\/(?:confirm|stop|renew)\/?$/.test(pathname) || !hash) return;
  captured = { path: pathname, token: new URLSearchParams(hash.slice(1)).get('token') ?? '' };
  window.history.replaceState(window.history.state, '', pathname + search);
}

export function stockAlertTokenFromBrowser() {
  const { pathname, hash } = window.location;
  if (hash) return new URLSearchParams(hash.slice(1)).get('token') ?? '';
  return captured?.path === pathname ? captured.token : '';
}

export function clearStockAlertToken() {
  captured = undefined;
}
