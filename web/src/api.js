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
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function fileUrl(path, params = {}) {
  const qs = new URLSearchParams({ ...params, token }).toString();
  return `/api${path}?${qs}`;
}

export const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = n => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN');
export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + '01';
