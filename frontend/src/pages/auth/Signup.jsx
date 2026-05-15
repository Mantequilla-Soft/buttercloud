import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--line-soft)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontFamily: 'inherit',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--fg-2)',
};

function PasswordField({ label, value, onChange, hint }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          style={{ ...inputStyle, paddingRight: '40px' }}
          required
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            color: 'var(--fg-3)',
            cursor: 'pointer',
            padding: '2px',
            fontSize: '13px',
            lineHeight: 1,
          }}
          tabIndex={-1}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
      {hint && <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--fg-3)' }}>{hint}</p>}
    </div>
  );
}

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [company_name, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await signup(email, password, company_name);
      navigate('/files');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const passwordsMatch = confirm === '' || password === confirm;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: '400px',
          padding: '28px',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-2)',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '7px',
              background: 'linear-gradient(160deg, oklch(0.92 0.14 95) 0%, oklch(0.78 0.155 75) 100%)',
            }} />
            <span style={{ fontWeight: 600, fontSize: '15px' }}>Butter Cloud</span>
          </div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Create your account</h1>
        </div>

        {error && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '16px',
            background: 'oklch(0.72 0.145 25 / .15)',
            border: '1px solid oklch(0.72 0.145 25 / .4)',
            borderRadius: '6px',
            color: 'var(--coral)',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label style={labelStyle}>Company Name</label>
            <input
              type="text"
              value={company_name}
              onChange={(e) => setCompanyName(e.target.value)}
              style={inputStyle}
              placeholder="Acme Inc."
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@company.com"
              required
            />
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Min 8 characters, 1 uppercase, 1 number"
          />

          <div>
            <PasswordField
              label="Confirm Password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {!passwordsMatch && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--coral)' }}>
                Passwords don't match
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !passwordsMatch}
          style={{
            width: '100%',
            height: '38px',
            border: 'none',
            borderRadius: '8px',
            background: loading || !passwordsMatch ? 'var(--bg-3)' : 'var(--butter)',
            color: loading || !passwordsMatch ? 'var(--fg-2)' : 'oklch(0.22 0.04 75)',
            fontWeight: 600,
            fontSize: '13px',
            cursor: loading || !passwordsMatch ? 'not-allowed' : 'pointer',
            marginBottom: '16px',
            transition: 'background 0.15s',
          }}
        >
          {loading ? 'Creating account…' : 'Create Account'}
        </button>

        <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: 'var(--fg-2)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--butter)', textDecoration: 'none' }}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
