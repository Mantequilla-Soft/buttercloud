import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getClientProfile, updateUser } from '../../api/admin';
import { I } from '../../components/Icons';

const PLANS = ['free', 'starter', 'professional', 'enterprise', 'house'];

const PLAN_COLOR = {
  free:         { color: 'var(--fg-2)',   bg: 'var(--bg-3)' },
  starter:      { color: 'var(--sky)',    bg: 'oklch(0.78 0.085 230 / .14)' },
  professional: { color: 'var(--butter)', bg: 'oklch(0.85 0.135 90 / .14)' },
  enterprise:   { color: 'var(--plum)',   bg: 'oklch(0.74 0.115 320 / .14)' },
  house:        { color: 'var(--sage)',   bg: 'oklch(0.76 0.1 150 / .14)' },
};

const INVOICE_STATUS_STYLE = {
  paid:    { color: 'var(--sage)',   bg: 'oklch(0.78 0.105 145 / .14)' },
  pending: { color: 'var(--butter)', bg: 'oklch(0.85 0.135 90 / .14)' },
  overdue: { color: 'var(--coral)',  bg: 'oklch(0.72 0.145 25 / .14)' },
  draft:   { color: 'var(--fg-2)',   bg: 'var(--bg-3)' },
};

function cents(v) { return `$${(v / 100).toFixed(2)}`; }
function gb(bytes) { return (bytes / 1024 ** 3).toFixed(2); }

function formatMonthLabel(str) {
  const [y, m] = str.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e1a14', border: '1px solid #2a2418', borderRadius: '8px', padding: '10px 14px', fontSize: '12px' }}>
      <div style={{ color: '#7a6e5a', marginBottom: '6px' }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: '3px' }}>
          {p.name}: <span style={{ color: '#e8dcc8', fontVariantNumeric: 'tabular-nums' }}>{p.value.toFixed(2)} GB</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)' }}>
      <div style={{ fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: '6px' }}>{label}</div>
      <div className="mono" style={{ fontSize: '20px', fontWeight: 500, color: 'var(--fg)' }}>{value}</div>
      {sub && <div style={{ marginTop: '4px', fontSize: '11.5px', color: 'var(--fg-2)' }}>{sub}</div>}
    </div>
  );
}

function Toggle({ on, onClick, color = 'var(--sage)' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 36, height: 20, borderRadius: '10px', border: 'none', cursor: 'pointer',
        background: on ? color : 'var(--bg-3)', position: 'relative', transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: 'white', transition: 'left 0.2s',
      }} />
    </button>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const { token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Editable fields, seeded from the loaded profile
  const [plan, setPlan] = useState('');
  const [active, setActive] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [suspensionOverride, setSuspensionOverride] = useState(null);

  useEffect(() => { if (token) load(); }, [token, id]);

  async function load() {
    setLoading(true);
    try {
      const data = await getClientProfile(token, id);
      setProfile(data);
      setPlan(data.user.plan);
      setActive(data.user.active);
      setIsAdmin(data.user.is_admin);
      setSuspensionOverride(data.user.suspension_override);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateUser(token, id, { plan, active, is_admin: isAdmin, suspension_override: suspensionOverride });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (loading) {
    return <AdminLayout title="Client"><div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div></AdminLayout>;
  }
  if (!profile) {
    return <AdminLayout title="Client"><div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>{error || 'Not found'}</div></AdminLayout>;
  }

  const { user, bucket, usage_history, invoices } = profile;
  const ps = PLAN_COLOR[user.plan] || PLAN_COLOR.free;
  const latestUsage = usage_history[usage_history.length - 1] || { storage_avg_gb: 0, upload_gb: 0, download_gb: 0 };
  const quotaPct = bucket && bucket.quota_bytes > 0 ? (bucket.current_usage_bytes / bucket.quota_bytes) * 100 : 0;

  return (
    <AdminLayout title="Client">
      <Link to="/admin/users" style={{ fontSize: '12px', color: 'var(--fg-2)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '16px' }}>
        ← Back to Users
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{user.email}</h1>
        <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 500, color: ps.color, background: ps.bg }}>{user.plan}</span>
        {user.is_admin && <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 500, color: 'var(--coral)', background: 'oklch(0.72 0.145 25 / .14)' }}>Admin</span>}
        {user.is_suspended && <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 500, color: 'var(--coral)', background: 'oklch(0.72 0.145 25 / .14)' }}>Suspended</span>}
      </div>
      <p style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--fg-2)' }}>
        {user.company_name ? `${user.company_name} · ` : ''}Joined {new Date(user.created_at).toLocaleDateString()}
      </p>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '28px' }}>
        <StatCard label="This month storage" value={`${latestUsage.storage_avg_gb} GB`} />
        <StatCard label="This month upload" value={`${latestUsage.upload_gb} GB`} />
        <StatCard label="This month download" value={`${latestUsage.download_gb} GB`} />
        <StatCard
          label="Bucket usage"
          value={bucket ? `${quotaPct.toFixed(1)}%` : '—'}
          sub={bucket ? `${gb(bucket.current_usage_bytes)} / ${gb(bucket.quota_bytes)} GB on ${bucket.node_name}` : 'No bucket provisioned'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px', alignItems: 'start' }}>
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Usage — last 6 months</h3>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '16px', marginBottom: '28px', height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usage_history.map(h => ({ ...h, label: formatMonthLabel(h.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--fg-3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--fg-3)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="storage_avg_gb" name="Storage" fill="var(--butter)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="upload_gb" name="Upload" fill="var(--sky)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="download_gb" name="Download" fill="var(--plum)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Billing history</h3>
          {invoices.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-2)', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', fontSize: '13px' }}>
              No invoices yet
            </div>
          ) : (
            <div className="files">
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px', gap: '10px', padding: '9px 16px', fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line-soft)' }}>
                <span>Period</span><span>Due</span><span style={{ textAlign: 'right' }}>Total</span><span style={{ textAlign: 'right' }}>Status</span>
              </div>
              {invoices.map(inv => {
                const s = INVOICE_STATUS_STYLE[inv.status] || INVOICE_STATUS_STYLE.draft;
                return (
                  <div key={inv.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', alignItems: 'center' }}>
                    <div className="mono" style={{ fontSize: '12px', color: 'var(--fg-1)' }}>{inv.month}</div>
                    <div className="mono" style={{ fontSize: '12px', color: 'var(--fg-2)' }}>{new Date(inv.due_date).toLocaleDateString()}</div>
                    <div className="mono" style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>{cents(inv.total_usd)}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 500, color: s.color, background: s.bg }}>{inv.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Account</h3>

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

          <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Toggle on={active} onClick={() => setActive(v => !v)} />
            <span style={{ fontSize: '13px', color: 'var(--fg-1)' }}>{active ? 'Active' : 'Deactivated'}</span>
          </div>

          <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Toggle on={isAdmin} onClick={() => setIsAdmin(v => !v)} color="var(--coral)" />
            <span style={{ fontSize: '13px', color: 'var(--fg-1)' }}>{isAdmin ? 'Admin' : 'Not an admin'}</span>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '6px' }}>Upload suspension</label>
            <select
              value={suspensionOverride ?? 'null'}
              onChange={e => setSuspensionOverride(e.target.value === 'null' ? null : e.target.value)}
              style={{ width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px' }}
            >
              <option value="null">Normal (based on billing)</option>
              <option value="suspended">Force suspended</option>
              <option value="exempt">Exempt from suspension</option>
            </select>
          </div>

          <button className="btn primary" onClick={handleSave} disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
