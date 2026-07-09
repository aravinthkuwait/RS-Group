let token = localStorage.getItem('rsg_token') || null;
let onUnauthorized = () => {};

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('rsg_token', t);
  else localStorage.removeItem('rsg_token');
}
export function getToken() { return token; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, params } = {}) {
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
    : '';
  const res = await fetch(`/api${path}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { onUnauthorized(); throw new Error('Session expired. Please login again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    if (data.approval_required) err.approval_required = true;
    throw err;
  }
  return data;
}

export function fileUrl(path, params = {}) {
  const qs = new URLSearchParams({ ...params, token }).toString();
  return `/api${path}?${qs}`;
}

// Open a PDF in a new tab and trigger the print dialog once it's actually
// loaded — calling window.print() right after window.open() usually fires
// before the PDF has rendered, so it just opens the tab silently.
export function openAndPrint(url) {
  const w = window.open(url, '_blank');
  if (!w) return;
  const tryPrint = () => { try { w.focus(); w.print(); } catch { /* tab closed or blocked */ } };
  w.onload = tryPrint;
  setTimeout(tryPrint, 1200); // fallback for viewers that don't fire onload
}

export const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = n => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN');
export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + '01';
