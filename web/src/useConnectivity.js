import { useEffect, useRef, useState } from 'react';

// Monitors whether the app can reach the RS Group server, tracks how long the
// current state has lasted, and keeps a rolling history of online/offline
// periods in localStorage (survives reloads). Each browser logs its own.
const KEY = 'rsg_conn_state';
const POLL_MS = 15000;      // check every 15s
const TIMEOUT_MS = 6000;    // a ping slower than this counts as offline
const MAX_HISTORY = 60;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.current && Array.isArray(s.history)) return s;
  } catch { /* corrupt / first run */ }
  return { current: null, history: [] };
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
}

async function ping() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch('/api/ping', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

export function useConnectivity() {
  const [online, setOnline] = useState(null); // null until first check
  const [since, setSince] = useState(Date.now());
  const [history, setHistory] = useState(() => load().history);
  const [, tick] = useState(0); // re-render each second so the duration ticks
  const stateRef = useRef(load());

  // Record a status change: close the open period, open a new one
  const record = (isOnline, at) => {
    const st = stateRef.current;
    if (st.current) st.current.end = at;
    if (st.current) st.history = [st.current, ...st.history].slice(0, MAX_HISTORY);
    st.current = { status: isOnline ? 'online' : 'offline', start: at, end: null };
    save(st);
    setHistory(st.history);
    setSince(at);
    setOnline(isOnline);
  };

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const isOnline = navigator.onLine === false ? false : await ping();
      if (!alive) return;
      const st = stateRef.current;
      if (!st.current) { record(isOnline, Date.now()); return; }
      if ((st.current.status === 'online') !== isOnline) record(isOnline, Date.now());
      else { setOnline(isOnline); setSince(st.current.start); }
    };
    check();
    const poll = setInterval(check, POLL_MS);
    const sec = setInterval(() => tick(n => n + 1), 1000);
    const onNet = () => check();
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    return () => {
      alive = false;
      clearInterval(poll); clearInterval(sec);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  return { online, since, history };
}

// "3h 12m", "5m 20s", "now"
export function humanDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
