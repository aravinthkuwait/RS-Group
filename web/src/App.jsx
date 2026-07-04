import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api, setToken, getToken, setUnauthorizedHandler } from './api.js';
import { ToastProvider } from './ui.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import Sales from './pages/Sales.jsx';
import Inventory from './pages/Inventory.jsx';
import Alerts from './pages/Alerts.jsx';
import Purchases from './pages/Purchases.jsx';
import Transfers from './pages/Transfers.jsx';
import Customers from './pages/Customers.jsx';
import Accounts from './pages/Accounts.jsx';
import Reports from './pages/Reports.jsx';
import Staff from './pages/Staff.jsx';
import Settings from './pages/Settings.jsx';
import Offers from './pages/Offers.jsx';
import StockUpdates from './pages/StockUpdates.jsx';
import Usage from './pages/Usage.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function can(user, ...perms) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return perms.some(p => (user.perms || []).includes(p));
}

// Branch filter context: super admin / auditor can switch branches; others locked
const BranchCtx = createContext(null);
export const useBranch = () => useContext(BranchCtx);

function Protected({ user, perm, role, children }) {
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  if (perm && !can(user, ...[].concat(perm))) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUser(null); });
    if (getToken()) {
      api('/auth/me')
        .then(d => setUser(d.user))
        .catch(() => setToken(null))
        .finally(() => setLoading(false));
    }
  }, []);

  useEffect(() => {
    if (user) api('/admin/branches').then(d => setBranches(d.branches)).catch(() => {});
  }, [user]);

  const login = (data) => { setToken(data.token); setUser(data.user); };
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* best effort */ }
    setToken(null); setUser(null);
  };

  const branchCtx = useMemo(() => {
    const isGlobal = user && ['super_admin', 'auditor'].includes(user.role);
    const assigned = user?.branches || [];
    const multi = !isGlobal && assigned.length > 1;
    const options = isGlobal ? branches : assigned;
    const effective = isGlobal
      ? branchId
      : (multi && branchId && assigned.some(b => b.id === Number(branchId)) ? branchId : (user?.branch_id || ''));
    return {
      branches,
      options,
      branchId: effective,
      setBranchId,
      canSwitch: !!isGlobal || multi,
      allBranchesOption: !!isGlobal,
      branchName: isGlobal
        ? (branchId ? branches.find(b => b.id === Number(branchId))?.name : 'All Branches')
        : (options.find(b => b.id === Number(effective))?.name || user?.branch?.name),
    };
  }, [user, branches, branchId]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#8494a4' }}>Loading RS Group…</div>;

  return (
    <ToastProvider>
      <AuthCtx.Provider value={{ user, setUser, login, logout }}>
        <BranchCtx.Provider value={branchCtx}>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
              <Route element={<Protected user={user}><Layout /></Protected>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/pos" element={<Protected user={user} perm="billing.create"><POS /></Protected>} />
                <Route path="/sales" element={<Protected user={user} perm={['billing.view', 'billing.create']}><Sales /></Protected>} />
                <Route path="/inventory" element={<Protected user={user} perm="inventory.view"><Inventory /></Protected>} />
                <Route path="/alerts" element={<Protected user={user} perm={['inventory.view', 'dashboard.view']}><Alerts /></Protected>} />
                <Route path="/purchases" element={<Protected user={user} perm="purchases.view"><Purchases /></Protected>} />
                <Route path="/transfers" element={<Protected user={user} perm={['inventory.transfer', 'inventory.view']}><Transfers /></Protected>} />
                <Route path="/customers" element={<Protected user={user} perm="customers.view"><Customers /></Protected>} />
                <Route path="/offers" element={<Protected user={user} perm="discounts.manage"><Offers /></Protected>} />
                <Route path="/stock-updates" element={<Protected user={user} perm={['inventory.view', 'billing.create']}><StockUpdates /></Protected>} />
                <Route path="/accounts" element={<Protected user={user} perm={['expenses.view', 'accounts.manage']}><Accounts /></Protected>} />
                <Route path="/reports" element={<Protected user={user} perm="reports.view"><Reports /></Protected>} />
                <Route path="/staff" element={<Protected user={user} perm={['staff.manage', 'tasks.view', 'delivery.view', 'attendance.self']}><Staff /></Protected>} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/usage" element={<Protected user={user} role="super_admin"><Usage /></Protected>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
              <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
            </Routes>
          </BrowserRouter>
        </BranchCtx.Provider>
      </AuthCtx.Provider>
    </ToastProvider>
  );
}
