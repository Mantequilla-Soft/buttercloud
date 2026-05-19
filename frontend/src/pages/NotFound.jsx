import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function NotFound() {
  const { user } = useAuth();

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '32px' }}>
          <span style={{ color: 'var(--fg)' }}>Butter</span>
          <span style={{ color: 'var(--butter)' }}>Cloud</span>
        </div>

        <div className="mono" style={{ fontSize: '72px', fontWeight: 600, color: 'var(--line)', lineHeight: 1, marginBottom: '16px', letterSpacing: '-0.04em' }}>
          404
        </div>

        <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, color: 'var(--fg)' }}>
          Page not found
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: '13px', color: 'var(--fg-2)' }}>
          This page doesn't exist or may have been moved.
        </p>

        <Link
          to={user ? '/' : '/login'}
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            background: 'var(--butter)',
            color: 'oklch(0.22 0.04 75)',
            fontWeight: 600,
            fontSize: '13px',
            borderRadius: '8px',
            textDecoration: 'none',
          }}
        >
          {user ? 'Go to dashboard' : 'Go to login'}
        </Link>
      </div>
    </div>
  );
}
