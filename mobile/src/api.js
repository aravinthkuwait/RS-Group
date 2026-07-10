import AsyncStorage from '@react-native-async-storage/async-storage';

// Live RS Group server on Railway (change to a LAN IP for local development).
export const BASE_URL = 'https://rs-group-production.up.railway.app';

let token = null;
export async function loadToken() {
  token = await AsyncStorage.getItem('rsg_token');
  return token;
}
export function getAuthToken() { return token || ''; }
export async function setToken(t) {
  token = t;
  if (t) await AsyncStorage.setItem('rsg_token', t);
  else await AsyncStorage.removeItem('rsg_token');
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const qs = params
    ? '?' + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : '';
  const res = await fetch(`${BASE_URL}/api${path}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'RSGroupStaffApp/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    if (data.approval_required) err.approval_required = true;
    throw err;
  }
  return data;
}

export const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
