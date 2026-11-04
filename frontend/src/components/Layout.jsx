import { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { NavBackdrop } from './MobileNav';
import { useAuth } from '../hooks/useAuth';

export default function Layout({ title, children }) {
  const { user, token } = useAuth();
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const unverified = user && user.email_verified === false;

  async function resend() {
    setResending(true);
    try {
      await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="app">
      <Sidebar />
      <NavBackdrop />
      <TopBar title={title} />
      {unverified && (
        <div className="verify-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--butter)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ color: 'var(--fg-1)' }}>
            Please verify your email address to unlock uploads and API access.
          </span>
          {resent ? (
            <span style={{ color: 'var(--sage)', marginLeft: 'auto' }}>Email sent ✓</span>
          ) : (
            <button
              onClick={resend}
              disabled={resending}
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid oklch(0.85 0.135 90 / .4)', color: 'var(--butter)', borderRadius: '6px', padding: '3px 10px', fontSize: '11.5px', cursor: 'pointer' }}
            >
              {resending ? 'Sending…' : 'Resend email'}
            </button>
          )}
        </div>
      )}
      <main className={`main${unverified ? ' has-banner' : ''}`}>
        {children}
      </main>
    </div>
  );
}
