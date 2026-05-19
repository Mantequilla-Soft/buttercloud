import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ maxWidth: '380px', padding: '28px', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: 'var(--coral)', marginBottom: '16px' }}>Invalid or missing reset link.</div>
          <Link to="/forgot-password" style={{ fontSize: '13px', color: 'var(--butter)', textDecoration: 'none' }}>Request a new one</Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || 'Reset failed.'); return; }
      navigate('/login?reset=1');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid var(--line-soft)',
    borderRadius: '8px', background: 'var(--bg)', color: 'var(--fg)',
    fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg)' }}>
      <form
        onSubmit={handleSubmit}
        style={{ width: '100%', maxWidth: '380px', padding: '28px', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}
      >
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px' }}>
          <span style={{ color: 'var(--fg)' }}>Butter</span>
          <span style={{ color: 'var(--butter)' }}>Cloud</span>
        </div>

        <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600 }}>Set new password</h1>
        <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--fg-2)' }}>
          Must be at least 8 characters with uppercase, lowercase, and a number.
        </p>

        {error && (
          <div style={{ padding: '10px 12px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', color: 'var(--coral)', borderRadius: '6px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--fg-2)' }}>New password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} required />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--fg-2)' }}>Confirm new password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} required />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', height: '36px', border: 'none', borderRadius: '8px', background: 'var(--butter)', color: 'oklch(0.22 0.04 75)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', marginBottom: '16px' }}
        >
          {loading ? 'Saving…' : 'Reset password'}
        </button>

        <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: 'var(--fg-2)' }}>
          <Link to="/login" style={{ color: 'var(--butter)', textDecoration: 'none' }}>Back to login</Link>
        </p>
      </form>
    </div>
  );
}
