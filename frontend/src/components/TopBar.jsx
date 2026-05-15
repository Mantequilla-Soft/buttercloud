import { useAuth } from '../hooks/useAuth';
import { I } from './Icons';

export default function TopBar({ title = 'Dashboard' }) {
  const { user } = useAuth();

  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="crumb current">{title}</span>
      </div>

      <div className="topbar-actions">
        <button className="icon-btn">
          {I.bell({ size: 18 })}
        </button>
        <div className="avatar">{user?.email?.[0].toUpperCase()}</div>
      </div>
    </header>
  );
}
