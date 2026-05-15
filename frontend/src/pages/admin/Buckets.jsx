import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getBuckets, getNodes, migrateBucket } from '../../api/admin';
import { I } from '../../components/Icons';

function MigrateModal({ bucket, nodes, onConfirm, onCancel }) {
  const [destNodeId, setDestNodeId] = useState('');
  const [cleanup, setCleanup] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState('');

  const availableNodes = nodes.filter(n => n.id !== bucket.node_id);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!destNodeId) return;
    setError('');
    setMigrating(true);
    try {
      await onConfirm(bucket.id, destNodeId, cleanup);
    } catch (err) {
      setError(err.message);
      setMigrating(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '28px', width: '440px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600 }}>Migrate Bucket</h3>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--fg-2)' }}>
          Moving <strong style={{ color: 'var(--fg)' }}>{bucket.bucket_name}</strong> owned by <strong style={{ color: 'var(--fg)' }}>{bucket.user_email}</strong>.
          All objects will be copied to the destination node. The client's endpoint stays the same.
        </p>

        <div style={{ padding: '12px 14px', marginBottom: '16px', background: 'oklch(0.85 0.135 90 / .08)', border: '1px solid oklch(0.85 0.135 90 / .2)', borderRadius: '8px', fontSize: '12px', color: 'var(--fg-2)' }}>
          <div style={{ marginBottom: '4px' }}><strong style={{ color: 'var(--fg-1)' }}>Current:</strong> {bucket.node_name} — {bucket.used_gb.toFixed(2)} GB used</div>
          <div>{bucket.objects_count !== undefined ? `${bucket.objects_count} objects` : ''}</div>
        </div>

        {error && <div style={{ padding: '10px 12px', marginBottom: '14px', background: 'oklch(0.72 0.145 25 / .15)', color: 'var(--coral)', borderRadius: '6px', fontSize: '12px' }}>{error}</div>}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '6px' }}>Destination Node</label>
          {availableNodes.length === 0 ? (
            <div style={{ padding: '14px 16px', background: 'oklch(0.85 0.135 90 / .08)', border: '1px solid oklch(0.85 0.135 90 / .2)', borderRadius: '8px', fontSize: '13px', color: 'var(--fg-1)', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>No destination available</div>
              <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>
                You only have one storage node. Go to <strong>Admin → Nodes → Add Node</strong> to register a second MinIO instance, then come back here to migrate.
              </div>
            </div>
          ) : (
            <select
              value={destNodeId}
              onChange={e => setDestNodeId(e.target.value)}
              required
              style={{ width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px' }}
            >
              <option value="">Select destination…</option>
              {availableNodes.map(n => (
                <option key={n.id} value={n.id}>
                  {n.name} — {n.capacity_available_gb.toFixed(1)} GB available
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setCleanup(v => !v)}
            style={{
              width: 36, height: 20, borderRadius: '10px', border: 'none', cursor: 'pointer',
              background: cleanup ? 'var(--sage)' : 'var(--bg-3)', position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{ position: 'absolute', top: 2, left: cleanup ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
          </button>
          <div>
            <div style={{ fontSize: '13px', color: 'var(--fg-1)' }}>Delete from source after migration</div>
            <div style={{ fontSize: '11px', color: 'var(--fg-3)' }}>{cleanup ? 'Frees space on old node' : 'Objects remain on both nodes until manually removed'}</div>
          </div>
        </div>

        {migrating && (
          <div style={{ padding: '12px 14px', marginBottom: '14px', background: 'var(--bg-3)', borderRadius: '8px', fontSize: '12px', color: 'var(--fg-2)', textAlign: 'center' }}>
            Migrating… this may take a while for large buckets. Do not close this window.
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={migrating}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!destNodeId || migrating || availableNodes.length === 0}>
            {migrating ? 'Migrating…' : 'Start Migration'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ResultBanner({ result, onClose }) {
  return (
    <div style={{ padding: '14px 18px', marginBottom: '20px', background: 'oklch(0.78 0.105 145 / .12)', border: '1px solid oklch(0.78 0.105 145 / .3)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontWeight: 500, color: 'var(--sage)', marginBottom: '2px' }}>Migration complete</div>
        <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>
          {result.bucket_name}: {result.objects_copied} object{result.objects_copied !== 1 ? 's' : ''} copied from <strong>{result.from_node}</strong> → <strong>{result.to_node}</strong>
          {result.source_cleaned ? ' · Source cleaned up' : ' · Source not deleted'}
        </div>
      </div>
      <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--fg-2)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
    </div>
  );
}

const PLAN_COLOR = {
  free: 'var(--fg-3)', starter: 'var(--sky)', professional: 'var(--butter)', enterprise: 'var(--plum)', admin: 'var(--coral)',
};

export default function Buckets() {
  const { token } = useAuth();
  const [buckets, setBuckets] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [migrating, setMigrating] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { if (token) load(); }, [token]);

  async function load() {
    setLoading(true);
    try {
      const [b, n] = await Promise.all([getBuckets(token), getNodes(token)]);
      setBuckets(b.buckets || []);
      setNodes(n.nodes || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleMigrate(bucketId, destNodeId, cleanup) {
    const result = await migrateBucket(token, bucketId, {
      destination_node_id: destNodeId,
      cleanup_source: cleanup,
    });
    setMigrating(null);
    setLastResult(result);
    await load();
  }

  const filtered = search
    ? buckets.filter(b => b.bucket_name.includes(search) || b.user_email.includes(search) || b.node_name.includes(search))
    : buckets;

  return (
    <AdminLayout title="Buckets">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
          Buckets <span style={{ color: 'var(--fg-3)', fontSize: '14px', fontWeight: 400 }}>({buckets.length})</span>
        </h1>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)' }}>{I.search({ size: 14 })}</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search buckets, users, nodes…"
            style={{ padding: '8px 12px 8px 32px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', width: '240px' }}
          />
        </div>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}
      {lastResult && <ResultBanner result={lastResult} onClose={() => setLastResult(null)} />}

      <div className="files">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 100px 90px', gap: '10px', padding: '9px 16px', fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line-soft)' }}>
          <span>Bucket / Owner</span><span>Node</span><span>Usage</span><span>Plan</span><span></span>
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>No buckets found</div>
        )}

        {filtered.map(b => (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 100px 90px', gap: '10px', padding: '13px 16px', borderBottom: '1px solid var(--line-soft)', alignItems: 'center' }}>
            <div>
              <div className="mono" style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--fg)', marginBottom: '3px' }}>{b.bucket_name}</div>
              <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>{b.user_email}</div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--fg-1)' }}>
              <div>{b.node_name}</div>
              <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px' }}>{b.node_endpoint.replace('http://', '').split(':')[0]}</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: '12px', color: 'var(--fg-1)' }}>{b.used_gb.toFixed(3)} / {b.quota_gb.toFixed(1)} GB</div>
              <div style={{ marginTop: '5px', height: '4px', borderRadius: '2px', background: 'var(--bg-3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min((b.used_gb / b.quota_gb) * 100, 100)}%`, background: 'var(--butter)', borderRadius: '2px' }} />
              </div>
            </div>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 500, color: PLAN_COLOR[b.user_plan] || 'var(--fg-2)' }}>{b.user_plan}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setMigrating(b)}
                className="btn ghost"
                style={{ height: '28px', padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                {I.arrowL({ size: 13 })} Migrate
              </button>
            </div>
          </div>
        ))}
      </div>

      {migrating && (
        <MigrateModal
          bucket={migrating}
          nodes={nodes}
          onConfirm={handleMigrate}
          onCancel={() => setMigrating(null)}
        />
      )}
    </AdminLayout>
  );
}
