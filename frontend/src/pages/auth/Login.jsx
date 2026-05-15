import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg)' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: '380px',
          padding: '24px',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-2)',
        }}
      >
        <h1 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 600 }}>Login</h1>

        {error && (
          <div style={{ padding: '12px', marginBottom: '16px', background: 'var(--coral)', borderRadius: '6px', color: 'white', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--fg-2)' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--line-soft)',
              borderRadius: '8px',
              background: 'var(--bg)',
              color: 'var(--fg)',
              fontFamily: 'inherit',
              fontSize: '13px',
            }}
            required
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: 'var(--fg-2)' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--line-soft)',
              borderRadius: '8px',
              background: 'var(--bg)',
              color: 'var(--fg)',
              fontFamily: 'inherit',
              fontSize: '13px',
            }}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            height: '36px',
            border: 'none',
            borderRadius: '8px',
            background: 'var(--butter)',
            color: 'oklch(0.22 0.04 75)',
            fontWeight: 600,
            fontSize: '13px',
            cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>

        <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: 'var(--fg-2)' }}>
          Don't have an account? <Link to="/signup" style={{ color: 'var(--butter)', textDecoration: 'none' }}>Sign up</Link>
        </p>
      </form>
    </div>
  );
}
