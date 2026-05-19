import { Link, useLocation } from 'react-router-dom';
import { I } from './Icons';
import { useAuth } from '../hooks/useAuth';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { label: 'Files', path: '/files', icon: I.bucket },
    { label: 'API Keys', path: '/keys', icon: I.key },
    { label: 'Usage', path: '/usage', icon: I.activity },
    { label: 'Billing', path: '/billing', icon: I.card },
    { label: 'Account', path: '/account', icon: I.settings },
    { label: 'Docs', path: '/docs', icon: I.book },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"></div>
        <div className="brand-name">
          Butter <b>Cloud</b>
        </div>
      </div>

      <div className="workspace">
        <div className="ws-avatar">{user?.email?.[0].toUpperCase()}</div>
        <div className="ws-meta">
          <div className="ws-name">{user?.email}</div>
          <div className="ws-plan">{user?.plan || 'free'}</div>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-section">Workspace</div>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            {item.icon && item.icon({ size: 18 })}
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="usage-card">
        <div className="label">
          Monthly cost
          <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--sage)', fontWeight: 500 }}>●</span>
        </div>
        <div className="amount"><span className="cur">$</span>0.00</div>
        <div className="bar"><i style={{ width: '0%' }}></i></div>
        <div className="legend">
          <span>$0</span>
          <span>plan limit</span>
        </div>
      </div>

      <div className="side-footer">
        <span>v1.0.0</span>
        <button
          onClick={logout}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg-2)',
            cursor: 'pointer',
            fontSize: '12px',
            padding: 0,
          }}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
