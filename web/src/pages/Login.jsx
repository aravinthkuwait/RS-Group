import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Field } from '../ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login'); // login | forgot | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [code, setCode] = useState('');
  const [newPass, setNewPass] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      if (mode === 'login') {
        const data = await api('/auth/login', { method: 'POST', body: { email, password, branch_code: branchCode || undefined } });
        login(data);
      } else if (mode === 'forgot') {
        const d = await api('/auth/forgot-password', { method: 'POST', body: { email } });
        setMsg(d.demo_reset_code ? `${d.message} Code: ${d.demo_reset_code}` : d.message);
        setMode('reset');
      } else {
        await api('/auth/reset-password', { method: 'POST', body: { email, code, new_password: newPass } });
        setMsg('Password updated! Login with your new password.');
        setMode('login'); setPassword('');
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="logo" src="/rs-group-logo.jpg" alt="RS Group" />
        <h1>RS Group Medicals</h1>
        <div className="sub">Medical Shop Management System<br />Health Care · Multi-Branch · Billing · Inventory</div>
        {err && <div className="err-msg">{err}</div>}
        {msg && <div className="ok-msg">{msg}</div>}

        {mode !== 'reset' && (
          <Field label="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@rsgroup.in" />
        )}
        {mode === 'login' && (
          <>
            <Field label="Password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            <Field label="Branch Code (optional — for branch portal login)" value={branchCode} onChange={e => setBranchCode(e.target.value)} placeholder="e.g. RSG-CHN" />
            <button className="btn lg" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <a href="#" onClick={e => { e.preventDefault(); setMode('forgot'); setErr(''); }}>Forgot password?</a>
            </div>
          </>
        )}
        {mode === 'forgot' && (
          <>
            <button className="btn lg" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>Send Reset Code</button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <a href="#" onClick={e => { e.preventDefault(); setMode('login'); }}>Back to login</a>
            </div>
          </>
        )}
        {mode === 'reset' && (
          <>
            <Field label="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            <Field label="Reset Code" required value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" />
            <Field label="New Password" type="password" required value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="min 6 characters" />
            <button className="btn lg" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>Set New Password</button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <a href="#" onClick={e => { e.preventDefault(); setMode('login'); }}>Back to login</a>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
