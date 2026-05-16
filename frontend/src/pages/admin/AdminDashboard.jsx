import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getUsers, getNodes } from '../../api/admin';
import { I } from '../../components/Icons';

function fmtStorage(gb) {
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = gb * 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
}

function StatCard({ label, value, sub, icon, accent = 'var(--butter)' }) {
  return (
    <div style={{ padding: '20px 22px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: '8px', background: `oklch(from ${accent} l c h / .15)`, display: 'grid', placeItems: 'center', color: accent, flexShrink: 0 }}>
        {icon({ size: 18 })}
      </div>
      <div>
        <div style={{ fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: '4px' }}>{label}</div>
        <div className="mono" style={{ fontSize: '26px', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ marginTop: '4px', fontSize: '11.5px', color: 'var(--fg-2)' }}>{sub}</div>}
      </div>
    </div>
  );
}

function NodeHealth({ node }) {
  const pct = node.capacity_total_gb > 0
    ? Math.min((node.capacity_used_gb / node.capacity_total_gb) * 100, 100)
    : 0;
  const barColor = pct >= 90 ? 'var(--coral)' : pct >= 75 ? 'var(--butter-2)' : 'var(--sage)';
  const statusColor = ['active','healthy'].includes(node.status) ? 'var(--sage)' : 'var(--coral)';

  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div>
          <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--fg)' }}>{node.name}</span>
          <span className="mono" style={{ marginLeft: '10px', fontSize: '11.5px', color: 'var(--fg-2)' }}>{node.endpoint}</span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: statusColor }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          {node.status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div style={{ flex: 1, height: '5px', borderRadius: '999px', background: 'var(--bg-3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '999px' }} />
        </div>
        <span className="mono" style={{ fontSize: '11px', color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
          {fmtStorage(node.capacity_used_gb)} / {node.capacity_total_gb.toFixed(0)} GB
        </span>
        <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>{node.bucket_count} buckets</span>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { token } = useAuth();
  const [users, setUsers] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    Promise.all([getUsers(token), getNodes(token)])
      .then(([u, n]) => { setUsers(u); setNodes(n.nodes || []); })
      .finally(() => setLoading(false));
  }, [token]);

  const totalCapacityGb  = nodes.reduce((s, n) => s + n.capacity_total_gb, 0);
  const usedCapacityGb   = nodes.reduce((s, n) => s + n.capacity_used_gb, 0);
  const activeNodes      = nodes.filter(n => ['active','healthy'].includes(n.status)).length;

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '28px' }}>
            <StatCard label="Total Users"    value={users?.total ?? '—'}   icon={I.key}      accent="var(--sky)" />
            <StatCard label="Storage Nodes"  value={`${activeNodes} / ${nodes.length}`} icon={I.bucket}   accent="var(--butter)" sub={`${fmtStorage(usedCapacityGb)} used`} />
            <StatCard label="Total Capacity" value={`${totalCapacityGb.toFixed(0)} GB`} icon={I.gauge}    accent="var(--sage)" sub={`${(usedCapacityGb / (totalCapacityGb || 1) * 100).toFixed(2)}% used`} />
            <StatCard label="Total Buckets"  value={nodes.reduce((s, n) => s + n.bucket_count, 0)} icon={I.folder} accent="var(--plum)" />
          </div>

          <h3 style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Storage Nodes</h3>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {nodes.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-2)', fontSize: '13px' }}>No nodes registered</div>
            ) : (
              nodes.map(n => <NodeHealth key={n.id} node={n} />)
            )}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
