import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        const d = await r.json();
        setError(d.message || 'Something went wrong.');
      } else {
        setSent(true);
      }
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
      <div style={{ width: '100%', maxWidth: '380px', padding: '28px', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>

        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px' }}>
          <span style={{ color: 'var(--fg)' }}>Butter</span>
          <span style={{ color: 'var(--butter)' }}>Cloud</span>
        </div>

        {sent ? (
          <>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'oklch(0.78 0.105 145 / .15)', border: '1px solid oklch(0.78 0.105 145 / .3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 0 16px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: 'var(--fg)' }}>Check your inbox</h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6 }}>
              If an account exists for <strong>{email}</strong>, we've sent a password reset link. Check your spam folder if you don't see it.
            </p>
            <Link to="/login" style={{ fontSize: '13px', color: 'var(--butter)', textDecoration: 'none' }}>
              Back to login
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600 }}>Forgot password</h1>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--fg-2)' }}>
              Enter your email and we'll send you a reset link.
            </p>

            {error && (
              <div style={{ padding: '10px 12px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', color: 'var(--coral)', borderRadius: '6px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--fg-2)' }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} required />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', height: '36px', border: 'none', borderRadius: '8px', background: 'var(--butter)', color: 'oklch(0.22 0.04 75)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', marginBottom: '16px' }}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: 'var(--fg-2)' }}>
              <Link to="/login" style={{ color: 'var(--butter)', textDecoration: 'none' }}>Back to login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
