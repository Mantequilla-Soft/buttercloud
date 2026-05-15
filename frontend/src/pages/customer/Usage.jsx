import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { getUsage, getQuota } from '../../api/usage';

function UsageBar({ label, used, limit, unit, color = 'var(--butter)' }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const barColor = pct >= 95 ? 'var(--coral)' : pct >= 80 ? 'var(--butter-2)' : color;
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
        <span style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{label}</span>
        <span className="mono" style={{ fontSize: '12px', color: 'var(--fg-2)' }}>
          {used.toFixed(2)} / {limit} {unit}
        </span>
      </div>
      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: '999px', background: barColor, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--fg-3)' }}>{pct.toFixed(1)}% used</div>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ padding: '18px 20px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)' }}>
      <div style={{ fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: '8px' }}>{label}</div>
      <div className="mono" style={{ fontSize: '22px', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>{value}</div>
      {sub && <div style={{ marginTop: '4px', fontSize: '11.5px', color: 'var(--fg-2)' }}>{sub}</div>}
    </div>
  );
}

export default function Usage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState(null);
  const [quota, setQuota] = useState(null);
  const [month, setMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { if (token) load(); }, [token, month]);

  async function load() {
    setLoading(true);
    try {
      const [u, q] = await Promise.all([getUsage(token, month), getQuota(token)]);
      setUsage(u);
      setQuota(q);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Build last 6 months for selector
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return d.toISOString().substring(0, 7);
  });

  return (
    <Layout title="Usage">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Usage</h1>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          style={{ padding: '7px 12px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px' }}
        >
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>
      ) : usage && quota && (
        <>
          {/* Quota bars */}
          <div style={{ padding: '20px 24px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', marginBottom: '24px' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)' }}>Quota — {quota.plan} plan</h3>
            <UsageBar label="Storage" used={usage.storage_avg_gb} limit={quota.limits.storage_gb} unit="GB" />
            <UsageBar label="Transfer" used={usage.download_gb} limit={quota.limits.monthly_transfer_gb} unit="GB" color="var(--sky)" />
            <UsageBar label="Requests" used={usage.request_count} limit={quota.limits.monthly_requests} unit="req" color="var(--sage)" />
          </div>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <StatCard label="Uploaded" value={`${usage.upload_gb.toFixed(2)} GB`} sub={`${(usage.upload_bytes / 1024 / 1024).toFixed(0)} MB`} />
            <StatCard label="Downloaded" value={`${usage.download_gb.toFixed(2)} GB`} />
            <StatCard label="API Requests" value={usage.request_count.toLocaleString()} sub={`${usage.put_requests} puts · ${usage.get_requests} gets`} />
            <StatCard label="Avg Storage" value={`${usage.storage_avg_gb.toFixed(3)} GB`} />
          </div>
        </>
      )}
    </Layout>
  );
}
