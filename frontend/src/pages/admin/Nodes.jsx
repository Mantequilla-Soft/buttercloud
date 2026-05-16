import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getNodes, addNode, updateNode, reconcileNodes } from '../../api/admin';

function fmtStorage(gb) {
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = gb * 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(mb * 1024).toFixed(0)} KB`;
}
import { I } from '../../components/Icons';

function AddNodeModal({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: '', endpoint: '', capacity_total_gb: '', region: 'default' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({ ...form, capacity_total_gb: parseFloat(form.capacity_total_gb) });
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const inputStyle = { width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '28px', width: '420px' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: 600 }}>Add Storage Node</h3>

        {error && <div style={{ padding: '10px 12px', marginBottom: '14px', background: 'oklch(0.72 0.145 25 / .15)', color: 'var(--coral)', borderRadius: '6px', fontSize: '12px' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
          {[
            { label: 'Node Name', key: 'name', placeholder: 'vps-us-east-1' },
            { label: 'MinIO Endpoint', key: 'endpoint', placeholder: 'http://147.135.x.x:9000' },
            { label: 'Capacity (GB)', key: 'capacity_total_gb', placeholder: '500', type: 'number' },
            { label: 'Region', key: 'region', placeholder: 'default' },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>{label}</label>
              <input type={type || 'text'} style={inputStyle} placeholder={placeholder} value={form[key]} onChange={set(key)} required />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Adding…' : 'Add Node'}</button>
        </div>
      </form>
    </div>
  );
}

function EditNodeModal({ node, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: node.name,
    endpoint: node.endpoint,
    capacity_total_gb: node.capacity_total_gb,
    region: node.region,
    status: node.status,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave(node.id, { ...form, capacity_total_gb: parseFloat(form.capacity_total_gb) });
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const inputStyle = { width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '28px', width: '420px' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: 600 }}>Edit Node — {node.name}</h3>

        {error && <div style={{ padding: '10px 12px', marginBottom: '14px', background: 'oklch(0.72 0.145 25 / .15)', color: 'var(--coral)', borderRadius: '6px', fontSize: '12px' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>Node Name</label>
            <input style={inputStyle} value={form.name} onChange={set('name')} required />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>MinIO Endpoint</label>
            <input style={inputStyle} value={form.endpoint} onChange={set('endpoint')} required />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>Capacity (GB)</label>
            <input type="number" style={inputStyle} value={form.capacity_total_gb} onChange={set('capacity_total_gb')} required min="1" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>Region</label>
            <input style={inputStyle} value={form.region} onChange={set('region')} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '5px' }}>Status</label>
            <select value={form.status} onChange={set('status')} style={{ ...inputStyle }}>
              <option value="healthy">healthy (online)</option>
              <option value="inactive">inactive (disabled)</option>
              <option value="maintenance">maintenance</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </form>
    </div>
  );
}

function CapacityBar({ used, total }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = pct >= 90 ? 'var(--coral)' : pct >= 75 ? 'var(--butter-2)' : 'var(--sage)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'var(--bg-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '999px' }} />
      </div>
      <span className="mono" style={{ fontSize: '11.5px', color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
        {fmtStorage(used)} / {total.toFixed(0)} GB
      </span>
    </div>
  );
}

export default function Nodes() {
  const { token } = useAuth();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { if (token) load(); }, [token]);

  async function load() {
    setLoading(true);
    try {
      const data = await getNodes(token);
      setNodes(data.nodes || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await reconcileNodes(token);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSyncing(false); }
  }

  async function handleAdd(body) {
    await addNode(token, body);
    setShowAdd(false);
    await load();
  }

  async function handleEdit(id, body) {
    await updateNode(token, id, body);
    setEditing(null);
    await load();
  }

  return (
    <AdminLayout title="Storage Nodes">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Storage Nodes</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn ghost" onClick={handleSync} disabled={syncing}>
            {I.refresh({ size: 14 })} {syncing ? 'Syncing…' : 'Sync Usage'}
          </button>
          <button className="btn primary" onClick={() => setShowAdd(true)}>
            {I.plus({ size: 14 })} Add Node
          </button>
        </div>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {loading && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>}

        {!loading && nodes.length === 0 && (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--fg-2)', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)' }}>
            <div style={{ marginBottom: '8px' }}>{I.bucket({ size: 28 })}</div>
            <div style={{ fontWeight: 500, color: 'var(--fg-1)', marginBottom: '4px' }}>No storage nodes</div>
            <div style={{ fontSize: '12px' }}>Add a MinIO node to start accepting uploads</div>
          </div>
        )}

        {nodes.map(node => (
          <div key={node.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--fg)' }}>{node.name}</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '1px 8px', borderRadius: '999px', fontSize: '10.5px',
                    color: ['active','healthy'].includes(node.status) ? 'var(--sage)' : 'var(--coral)',
                    background: ['active','healthy'].includes(node.status) ? 'oklch(0.78 0.105 145 / .14)' : 'oklch(0.72 0.145 25 / .14)',
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                    {node.status}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: '12px', color: 'var(--fg-2)' }}>{node.endpoint}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--fg-2)' }}>
                <div>{node.region}</div>
                <div style={{ marginTop: '2px' }}>{node.bucket_count} bucket{node.bucket_count !== 1 ? 's' : ''}</div>
              </div>
            </div>

            <CapacityBar used={node.capacity_used_gb} total={node.capacity_total_gb} />

            <div style={{ display: 'flex', gap: '20px', marginTop: '10px', fontSize: '11.5px', color: 'var(--fg-2)', alignItems: 'center' }}>
              <span>Available: <span className="mono" style={{ color: 'var(--fg-1)' }}>{fmtStorage(node.capacity_available_gb)}</span></span>
              <span>Added: <span style={{ color: 'var(--fg-1)' }}>{new Date(node.created_at).toLocaleDateString()}</span></span>
              <button onClick={() => setEditing(node)} className="btn ghost" style={{ marginLeft: 'auto', height: '28px', padding: '0 12px', fontSize: '12px' }}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddNodeModal onSave={handleAdd} onCancel={() => setShowAdd(false)} />}
      {editing && <EditNodeModal node={editing} onSave={handleEdit} onCancel={() => setEditing(null)} />}
    </AdminLayout>
  );
}
