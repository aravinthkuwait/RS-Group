import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from './api';

// Monitors whether the staff app can reach the RS Group server, how long the
// current state has lasted, and a rolling history of online/offline periods
// (persisted in AsyncStorage so it survives app restarts).
const KEY = 'rsg_conn_state';
const POLL_MS = 15000;
const TIMEOUT_MS = 6000;
const MAX_HISTORY = 60;

async function ping() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(`${BASE_URL}/api/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

export function useConnectivity() {
  const [online, setOnline] = useState(null);
  const [since, setSince] = useState(Date.now());
  const [history, setHistory] = useState([]);
  const [, tick] = useState(0);
  const stateRef = useRef({ current: null, history: [] });
  const loaded = useRef(false);

  const persist = () => AsyncStorage.setItem(KEY, JSON.stringify(stateRef.current)).catch(() => {});

  const record = (isOnline, at) => {
    const st = stateRef.current;
    if (st.current) { st.current.end = at; st.history = [st.current, ...st.history].slice(0, MAX_HISTORY); }
    st.current = { status: isOnline ? 'online' : 'offline', start: at, end: null };
    persist();
    setHistory([...st.history]); setSince(at); setOnline(isOnline);
  };

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const isOnline = await ping();
      if (!alive) return;
      const st = stateRef.current;
      if (!st.current) { record(isOnline, Date.now()); return; }
      if ((st.current.status === 'online') !== isOnline) record(isOnline, Date.now());
      else { setOnline(isOnline); setSince(st.current.start); }
    };
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.current && Array.isArray(s.history)) { stateRef.current = s; setHistory(s.history); }
        }
      } catch { /* first run */ }
      loaded.current = true;
      check();
    })();
    const poll = setInterval(() => { if (loaded.current) check(); }, POLL_MS);
    const sec = setInterval(() => tick(n => n + 1), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(sec); };
  }, []);

  return { online, since, history };
}

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
