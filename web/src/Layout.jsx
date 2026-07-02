import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, useBranch, can } from './App.jsx';
import { api } from './api.js';
import { useToast } from './ui.jsx';

const NAV = [
  { section: 'Overview' },
  { to: '/', icon: '📊', label: 'Dashboard', perm: ['dashboard.view'] },
  { to: '/alerts', icon: '⚠️', label: 'Stock Alerts', perm: ['inventory.view'] },
  { section: 'Operations' },
  { to: '/pos', icon: '🧾', label: 'Billing (POS)', perm: ['billing.create'] },
  { to: '/sales', icon: '💳', label: 'Sales & Bills', perm: ['billing.view', 'billing.create'] },
  { to: '/inventory', icon: '💊', label: 'Inventory', perm: ['inventory.view'] },
  { to: '/purchases', icon: '📦', label: 'Purchases', perm: ['purchases.view'] },
  { to: '/transfers', icon: '🔁', label: 'Stock Transfers', perm: ['inventory.transfer'] },
  { to: '/customers', icon: '👥', label: 'Customers', perm: ['customers.view'] },
  { section: 'Finance' },
  { to: '/accounts', icon: '💰', label: 'Accounts & Expenses', perm: ['expenses.view', 'accounts.manage'] },
  { to: '/reports', icon: '📑', label: 'Reports', perm: ['reports.view'] },
  { section: 'Team' },
  { to: '/staff', icon: '🧑‍⚕️', label: 'Staff & Tasks', perm: ['staff.manage', 'tasks.view', 'delivery.view', 'attendance.self'] },
  { to: '/settings', icon: '⚙️', label: 'Settings', perm: [] },
];

const TITLES = {
  '/': 'Dashboard', '/pos': 'Billing (POS)', '/sales': 'Sales & Bills', '/inventory': 'Inventory',
  '/alerts': 'Stock & Expiry Alerts', '/purchases': 'Purchases & Suppliers', '/transfers': 'Stock Transfers',
  '/customers': 'Customers', '/accounts': 'Accounts & Expenses', '/reports': 'Reports',
  '/staff': 'Staff, Tasks & Deliveries', '/settings': 'Settings',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const { branches, branchId, setBranchId, canSwitch, branchName } = useBranch();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const esRef = useRef(null);

  const loadNotifs = () => api('/staff/notifications').then(d => {
    setNotifs(d.notifications); setUnread(d.unread);
  }).catch(() => {});

  useEffect(() => {
    loadNotifs();
    // Real-time notifications via SSE
    const token = localStorage.getItem('rsg_token');
    const es = new EventSource(`/api/staff/stream?token=${token}`);
    es.addEventListener('notification', e => {
      const n = JSON.parse(e.data);
      toast(`${n.title}: ${n.message}`.slice(0, 140));
      loadNotifs();
    });
    esRef.current = es;
    return () => es.close();
  }, []);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  const openNotifs = async () => {
    setShowNotifs(s => !s);
    if (!showNotifs && unread > 0) {
      await api('/staff/notifications/read', { method: 'POST', body: { ids: notifs.filter(n => !n.read).map(n => n.id) } }).catch(() => {});
      setUnread(0);
    }
  };

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="logo-row">
          <img src="/rs-group-logo.jpg" alt="RS Group" />
          <div>
            <div className="t1">RS GROUP</div>
            <div className="t2">Medical Shop Management</div>
          </div>
        </div>
        <nav>
          {NAV.map((item, i) => {
            if (item.section) {
              const next = NAV.slice(i + 1, NAV.findIndex((x, j) => j > i && x.section) === -1 ? undefined : NAV.findIndex((x, j) => j > i && x.section));
              if (!next.some(n => !n.section && (n.perm.length === 0 || can(user, ...n.perm)))) return null;
              return <div className="section" key={item.section}>{item.section}</div>;
            }
            if (item.perm.length > 0 && !can(user, ...item.perm)) return null;
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                <span className="icon">{item.icon}</span> {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div style={{ padding: '12px 16px', fontSize: '.72rem', color: '#9fb6d6', borderTop: '1px solid rgba(255,255,255,.12)' }}>
          Empowering Health · Enriching Education · Excelling in Sports
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(o => !o)}>☰</button>
          <h1>{TITLES[location.pathname] || 'RS Group'}</h1>
          {canSwitch ? (
            <select className="input" style={{ width: 190 }} value={branchId} onChange={e => setBranchId(e.target.value)}>
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <span className="badge blue">{branchName || 'Head Office'}</span>
          )}
          <button className="bell" onClick={openNotifs}>
            🔔{unread > 0 && <span className="dot">{unread}</span>}
          </button>
          <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
            <div style={{ fontWeight: 650, fontSize: '.88rem' }}>{user.name}</div>
            <div className="muted" style={{ fontSize: '.72rem' }}>{user.role.replace(/_/g, ' ')}</div>
          </div>
          <button className="btn ghost sm" onClick={logout}>Logout</button>
          {showNotifs && (
            <div className="notif-pop">
              {notifs.length === 0 && <div className="n">No notifications yet</div>}
              {notifs.map(n => (
                <div key={n.id} className={`n ${n.read ? '' : 'unread'}`}>
                  <b>{n.title}</b>
                  <div className="muted">{n.message}</div>
                  <div className="muted" style={{ fontSize: '.7rem', marginTop: 2 }}>{n.created_at}</div>
                </div>
              ))}
            </div>
          )}
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
