import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { I } from './Icons';

export default function AdminLayout({ title, children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const nav = [
    { label: 'Dashboard',  path: '/admin',          icon: I.gauge },
    { label: 'Users',      path: '/admin/users',    icon: I.key },
    { label: 'Nodes',      path: '/admin/nodes',    icon: I.bucket },
    { label: 'Buckets',    path: '/admin/buckets',  icon: I.folder },
  ];

  return (
    <div className="app rail-closed">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-name">
            Butter <b>Cloud</b>
            <em>admin</em>
          </div>
        </div>

        <div className="workspace">
          <div className="ws-avatar" style={{ background: 'oklch(0.72 0.145 25)' }}>
            {user?.email?.[0].toUpperCase()}
          </div>
          <div className="ws-meta">
            <div className="ws-name">{user?.email}</div>
            <div className="ws-plan" style={{ color: 'var(--coral)' }}>Administrator</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-section">Admin</div>
          {nav.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              style={{ textDecoration: 'none' }}
            >
              {item.icon({ size: 16 })}
              {item.label}
            </Link>
          ))}

          <div className="nav-section" style={{ marginTop: '8px' }}>Customer</div>
          <Link to="/files" className="nav-item" style={{ textDecoration: 'none' }}>
            {I.folder({ size: 16 })} Files
          </Link>
        </nav>

        <div className="side-footer">
          <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>v1.0.0</span>
          <button onClick={logout} style={{ background: 'transparent', border: 'none', color: 'var(--fg-2)', cursor: 'pointer', fontSize: '12px', padding: 0 }}>
            Logout
          </button>
        </div>
      </aside>

      <header className="topbar">
        <div className="crumbs">
          <span className="crumb" style={{ color: 'var(--coral)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Admin</span>
          <span className="sep">/</span>
          <span className="crumb current">{title}</span>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
