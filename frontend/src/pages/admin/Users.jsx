import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getUsers } from '../../api/admin';
import { I } from '../../components/Icons';

const PLAN_COLOR = {
  free:         { color: 'var(--fg-2)',   bg: 'var(--bg-3)' },
  starter:      { color: 'var(--sky)',    bg: 'oklch(0.78 0.085 230 / .14)' },
  professional: { color: 'var(--butter)', bg: 'oklch(0.85 0.135 90 / .14)' },
  enterprise:   { color: 'var(--plum)',   bg: 'oklch(0.74 0.115 320 / .14)' },
  house:        { color: 'var(--sage)',   bg: 'oklch(0.76 0.1 150 / .14)' },
};

export default function Users() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { if (token) load(); }, [token]);

  async function load() {
    setLoading(true);
    try {
      const data = await getUsers(token);
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const filtered = search
    ? users.filter(u => u.email.toLowerCase().includes(search.toLowerCase()) || u.company_name?.toLowerCase().includes(search.toLowerCase()))
    : users;

  return (
    <AdminLayout title="Users">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Users <span style={{ color: 'var(--fg-3)', fontSize: '14px', fontWeight: 400 }}>({total})</span></h1>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)' }}>{I.search({ size: 14 })}</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users…"
            style={{ padding: '8px 12px 8px 32px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', width: '220px' }}
          />
        </div>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      <div className="files">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 80px 80px', gap: '10px', padding: '9px 16px', fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line-soft)' }}>
          <span>User</span><span>Plan</span><span>Bucket</span><span>Status</span><span></span>
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>}

        {!loading && filtered.map(user => {
          const ps = PLAN_COLOR[user.plan] || PLAN_COLOR.free;
          return (
            <div key={user.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 80px 80px', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--fg)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {user.email}
                  {user.is_admin && (
                    <span style={{ padding: '1px 7px', borderRadius: '999px', fontSize: '10px', fontWeight: 500, color: 'var(--coral)', background: 'oklch(0.72 0.145 25 / .14)' }}>
                      Admin
                    </span>
                  )}
                </div>
                {user.company_name && <div style={{ fontSize: '11.5px', color: 'var(--fg-2)' }}>{user.company_name}</div>}
                <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px' }}>
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </div>
              </div>
              <div>
                <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 500, color: ps.color, background: ps.bg }}>{user.plan}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>
                {user.bucket_count ? '✓ Active' : '—'}
              </div>
              <div>
                <span style={{ fontSize: '11px', color: user.active ? 'var(--sage)' : 'var(--fg-3)' }}>
                  {user.active ? '● Active' : '○ Off'}
                </span>
                {user.is_suspended && (
                  <div style={{ fontSize: '10px', color: 'var(--coral)', marginTop: '2px' }}>
                    Suspended
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Link to={`/admin/users/${user.id}`} className="btn ghost" style={{ height: '28px', padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                  View
                </Link>
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>No users found</div>
        )}
      </div>
    </AdminLayout>
  );
}
