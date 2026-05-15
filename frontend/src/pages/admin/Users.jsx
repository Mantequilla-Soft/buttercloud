import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getUsers, updateUser } from '../../api/admin';
import { I } from '../../components/Icons';

const PLANS = ['free', 'starter', 'professional', 'enterprise', 'admin'];

const PLAN_COLOR = {
  free:         { color: 'var(--fg-2)',   bg: 'var(--bg-3)' },
  starter:      { color: 'var(--sky)',    bg: 'oklch(0.78 0.085 230 / .14)' },
  professional: { color: 'var(--butter)', bg: 'oklch(0.85 0.135 90 / .14)' },
  enterprise:   { color: 'var(--plum)',   bg: 'oklch(0.74 0.115 320 / .14)' },
  admin:        { color: 'var(--coral)',  bg: 'oklch(0.72 0.145 25 / .14)' },
};

function EditModal({ user, onSave, onCancel }) {
  const [plan, setPlan] = useState(user.plan);
  const [active, setActive] = useState(user.active);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(user.id, { plan, active });
    setSaving(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '28px', width: '380px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>Edit User</h3>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--fg-2)' }}>{user.email}</p>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '6px' }}>Plan</label>
          <select
            value={plan}
            onChange={e => setPlan(e.target.value)}
            style={{ width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px' }}
          >
            {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setActive(v => !v)}
            style={{
              width: 36, height: 20, borderRadius: '10px', border: 'none', cursor: 'pointer',
              background: active ? 'var(--sage)' : 'var(--bg-3)',
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: active ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: 'white', transition: 'left 0.2s',
            }} />
          </button>
          <span style={{ fontSize: '13px', color: 'var(--fg-1)' }}>{active ? 'Active' : 'Deactivated'}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

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

  async function handleSave(id, changes) {
    try {
      await updateUser(token, id, changes);
      setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
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
                <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--fg)', marginBottom: '2px' }}>{user.email}</div>
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
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setEditing(user)} className="btn ghost" style={{ height: '28px', padding: '0 10px', fontSize: '12px' }}>
                  Edit
                </button>
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>No users found</div>
        )}
      </div>

      {editing && <EditModal user={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
    </AdminLayout>
  );
}
