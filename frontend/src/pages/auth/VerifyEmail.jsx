import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in this link.');
      return;
    }
    verify(token);
  }, []);

  async function verify(token) {
    try {
      const r = await fetch(`/api/v1/auth/verify-email?token=${token}`);
      const data = await r.json();
      if (r.ok) {
        setStatus('success');
        setTimeout(() => navigate('/'), 2500);
      } else {
        setStatus('error');
        setMessage(data.message || 'Verification failed.');
      }
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'grid', placeItems: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '400px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '36px', textAlign: 'center' }}>

        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px' }}>
          <span style={{ color: 'var(--fg)' }}>Butter</span>
          <span style={{ color: 'var(--butter)' }}>Cloud</span>
        </div>

        {status === 'verifying' && (
          <>
            <div style={{ fontSize: '14px', color: 'var(--fg-2)', marginBottom: '8px' }}>Verifying your email…</div>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'oklch(0.78 0.105 145 / .15)', border: '1px solid oklch(0.78 0.105 145 / .3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg)', marginBottom: '8px' }}>Email verified!</div>
            <div style={{ fontSize: '13px', color: 'var(--fg-2)' }}>Redirecting you to the dashboard…</div>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg)', marginBottom: '8px' }}>Verification failed</div>
            <div style={{ fontSize: '13px', color: 'var(--fg-2)', marginBottom: '20px' }}>{message}</div>
            <button className="btn primary" style={{ width: '100%' }} onClick={() => navigate('/login')}>
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
