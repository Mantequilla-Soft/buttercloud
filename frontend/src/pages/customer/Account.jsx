import { useState } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';

const PLAN_STYLE = {
  free:         { color: 'var(--fg-2)',   bg: 'var(--bg-3)',                   label: 'Free' },
  starter:      { color: 'var(--sky)',     bg: 'oklch(0.78 0.085 230 / .14)',   label: 'Starter' },
  professional: { color: 'var(--butter)',  bg: 'oklch(0.85 0.135 90 / .14)',    label: 'Professional' },
  enterprise:   { color: 'var(--plum)',    bg: 'oklch(0.74 0.115 320 / .14)',   label: 'Enterprise' },
  admin:        { color: 'var(--coral)',   bg: 'oklch(0.72 0.145 25 / .14)',    label: 'Admin' },
};

function Field({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px', alignItems: 'start', padding: '14px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <span style={{ fontSize: '13px', color: 'var(--fg-2)', paddingTop: '1px' }}>{label}</span>
      <span style={{ fontSize: '13px', color: 'var(--fg)' }}>{children}</span>
    </div>
  );
}

export default function Account() {
  const { user, token, logout } = useAuth();
  const [changingPw, setChangingPw] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  const plan = user?.plan || 'free';
  const planStyle = PLAN_STYLE[plan] || PLAN_STYLE.free;

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwError('');
    if (pw.next !== pw.confirm) { setPwError('New passwords do not match'); return; }
    try {
      const r = await fetch('/api/v1/auth/change-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pw.current, new_password: pw.next }),
      });
      if (!r.ok) { const d = await r.json(); setPwError(d.message || 'Failed'); return; }
      setPwSuccess(true);
      setChangingPw(false);
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) { setPwError(e.message); }
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)',
    borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box',
  };

  return (
    <Layout title="Account">
      <div style={{ maxWidth: '540px' }}>
        <h1 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 600 }}>Account</h1>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '4px 20px 0', marginBottom: '24px' }}>
          <Field label="Email">{user?.email}</Field>
          <Field label="Plan">
            <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, color: planStyle.color, background: planStyle.bg }}>
              {planStyle.label}
            </span>
          </Field>
          <Field label="Account ID">
            <span className="mono" style={{ fontSize: '12px', color: 'var(--fg-2)' }}>{user?.id}</span>
          </Field>
        </div>

        {/* Change password */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: changingPw ? '16px' : 0 }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Password</span>
            {!changingPw && (
              <button className="btn ghost" style={{ height: '30px', padding: '0 12px', fontSize: '12px' }} onClick={() => setChangingPw(true)}>
                Change password
              </button>
            )}
          </div>

          {pwSuccess && <div style={{ padding: '10px 12px', borderRadius: '6px', background: 'oklch(0.78 0.105 145 / .15)', color: 'var(--sage)', fontSize: '13px', marginBottom: '12px' }}>Password updated successfully.</div>}

          {changingPw && (
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {pwError && <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'oklch(0.72 0.145 25 / .15)', color: 'var(--coral)', fontSize: '12px' }}>{pwError}</div>}
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>Current password</label>
                <input type="password" style={inputStyle} value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>New password</label>
                <input type="password" style={inputStyle} value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>Confirm new password</label>
                <input type="password" style={inputStyle} value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} required />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost" onClick={() => { setChangingPw(false); setPwError(''); }}>Cancel</button>
                <button type="submit" className="btn primary">Update Password</button>
              </div>
            </form>
          )}
        </div>

        <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--line-soft)' }}>
          <button className="btn danger" onClick={() => { if (confirm('Sign out of your account?')) logout(); }}>
            Sign out
          </button>
        </div>
      </div>
    </Layout>
  );
}
