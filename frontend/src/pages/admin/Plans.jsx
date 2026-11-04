import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getPlans, updatePlan } from '../../api/admin';
import { formatDate } from '../../utils/format';

// The API stores money as cents; per-GB rates may be fractional cents. The form
// works in dollars, so convert at the edges and round off float noise
// (0.007 * 100 = 0.7000000000000001).
const toCents = dollars => Math.round(dollars * 100 * 10000) / 10000;
const toDollars = cents => Math.round(cents * 10000) / 1000000;

function usd(cents, digits = 2) {
  return `$${(cents / 100).toFixed(digits)}`;
}
// Trims trailing zeros so $0.0070 reads as $0.007, but always keeps cents
function usdRate(cents) {
  const s = (cents / 100).toFixed(4).replace(/0+$/, '');
  return `$${s.split('.')[1]?.length >= 2 ? s : (cents / 100).toFixed(2)}`;
}
function perTb(centsPerGb) {
  return `${usd(centsPerGb * 1000)}/TB`;
}

// field → how it's edited. `money` fields are entered in dollars, stored in cents.
const FIELDS = [
  { key: 'base_monthly_usd',            group: 'pricing', label: 'Base fee',          unit: '$ / month', money: true, int: true },
  { key: 'storage_overage_per_gb_usd',  group: 'pricing', label: 'Storage overage',   unit: '$ / GB-month', money: true },
  { key: 'transfer_overage_per_gb_usd', group: 'pricing', label: 'Transfer overage',  unit: '$ / GB', money: true },
  { key: 'storage_gb',                  group: 'limits',  label: 'Included storage',  unit: 'GB' },
  { key: 'monthly_transfer_gb',         group: 'limits',  label: 'Included transfer', unit: 'GB / month' },
  { key: 'max_object_size_gb',          group: 'limits',  label: 'Max object size',   unit: 'GB' },
  { key: 'monthly_requests',            group: 'limits',  label: 'Requests',          unit: '/ month', int: true },
];

const LABELS = Object.fromEntries(FIELDS.map(f => [f.key, f.label]));

function currentValue(plan, f) {
  const raw = plan[f.group][f.key];
  return f.money ? toDollars(raw) : raw;
}

function formatChange(key, v) {
  if (v === null || v === undefined) return '—';
  if (key === 'base_monthly_usd') return usd(v);
  if (key.endsWith('_usd')) return usdRate(v);
  return String(v);
}

const inputStyle = {
  width: '100%', padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--line-soft)',
  borderRadius: '6px', color: 'var(--fg)', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px', boxSizing: 'border-box',
};
const labelStyle = { fontSize: '10.5px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' };

function PlanCard({ plan, onSave }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  function startEdit() {
    setForm(Object.fromEntries(FIELDS.map(f => [f.key, String(currentValue(plan, f))])));
    setError('');
    setEditing(true);
  }

  // Only send fields that actually changed
  function buildPatch() {
    const patch = {};
    for (const f of FIELDS) {
      const text = form[f.key].trim();
      const n = Number(text);
      if (text === '' || !Number.isFinite(n) || n < 0) throw new Error(`${f.label} must be a non-negative number`);
      const value = f.money ? toCents(n) : n;
      if (f.int && !Number.isInteger(value)) {
        throw new Error(f.money ? `${f.label} must be whole cents` : `${f.label} must be a whole number`);
      }
      if (value !== plan[f.group][f.key]) patch[f.key] = value;
    }
    return patch;
  }

  async function handleSave() {
    let patch;
    try { patch = buildPatch(); } catch (e) { setError(e.message); return; }
    if (Object.keys(patch).length === 0) { setEditing(false); return; }

    const lines = Object.entries(patch).map(([k, v]) => {
      const f = FIELDS.find(x => x.key === k);
      return `  ${f.label}: ${formatChange(k, plan[f.group][k])} → ${formatChange(k, v)}`;
    });
    const warn = patch.storage_gb !== undefined
      ? `\n\nThe storage cap on every existing bucket on this plan will change too.`
      : '';
    const msg = `Update "${plan.plan}" (${plan.user_count} user${plan.user_count === 1 ? '' : 's'})?\n\n${lines.join('\n')}\n\nApplies to the next invoice generated, including the month in progress.${warn}`;
    if (!window.confirm(msg)) return;

    setSaving(true);
    try {
      await onSave(plan.plan, patch);
      setEditing(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const p = plan.pricing;
  const l = plan.limits;
  const includedPerTb = l.storage_gb > 0 ? (p.base_monthly_usd / l.storage_gb) * 1000 : 0;

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '20px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '16px', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, textTransform: 'capitalize' }}>{plan.plan}</div>
          <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', marginTop: '2px' }}>
            {plan.user_count} user{plan.user_count === 1 ? '' : 's'}
            {plan.updated_at && <> · last edited {formatDate(plan.updated_at)}</>}
          </div>
        </div>
        {!editing && <button className="btn ghost" onClick={startEdit} style={{ height: '28px', fontSize: '12px' }}>Edit</button>}
      </div>

      {!editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px' }}>
          <div>
            <div style={labelStyle}>Base fee</div>
            <div className="mono" style={{ fontSize: '16px', color: 'var(--butter)' }}>{usd(p.base_monthly_usd)}<span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>/mo</span></div>
            {p.base_monthly_usd > 0 && <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px' }}>≈ {usd(includedPerTb)}/TB included</div>}
          </div>
          <div>
            <div style={labelStyle}>Storage overage</div>
            <div className="mono" style={{ fontSize: '14px' }}>{usdRate(p.storage_overage_per_gb_usd)}/GB</div>
            <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px' }}>{perTb(p.storage_overage_per_gb_usd)}</div>
          </div>
          <div>
            <div style={labelStyle}>Transfer overage</div>
            <div className="mono" style={{ fontSize: '14px' }}>{usdRate(p.transfer_overage_per_gb_usd)}/GB</div>
            <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px' }}>{perTb(p.transfer_overage_per_gb_usd)}</div>
          </div>
          <div>
            <div style={labelStyle}>Included</div>
            <div className="mono" style={{ fontSize: '13px' }}>{l.storage_gb} GB storage</div>
            <div className="mono" style={{ fontSize: '13px' }}>{l.monthly_transfer_gb} GB transfer</div>
          </div>
          <div>
            <div style={labelStyle}>Limits</div>
            <div className="mono" style={{ fontSize: '13px' }}>{l.max_object_size_gb} GB / object</div>
            <div className="mono" style={{ fontSize: '13px' }}>{l.monthly_requests.toLocaleString()} req/mo</div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '14px' }}>
            {FIELDS.map(f => {
              const n = Number(form[f.key]);
              const hint = f.money && f.key !== 'base_monthly_usd' && Number.isFinite(n)
                ? `= ${perTb(toCents(n))}` : null;
              return (
                <div key={f.key}>
                  <div style={labelStyle}>{f.label} <span style={{ textTransform: 'none', letterSpacing: 0 }}>({f.unit})</span></div>
                  <input
                    type="number" min="0" step="any"
                    value={form[f.key]}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    style={inputStyle}
                  />
                  {hint && <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '3px' }}>{hint}</div>}
                </div>
              );
            })}
          </div>
          {error && <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--coral)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </>
      )}

      {plan.change_history.length > 0 && (
        <div style={{ marginTop: '16px', borderTop: '1px solid var(--line-soft)', paddingTop: '10px' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{ background: 'transparent', border: 'none', color: 'var(--fg-2)', cursor: 'pointer', fontSize: '12px', padding: 0 }}
          >
            {showHistory ? '▾' : '▸'} Change history ({plan.change_history.length})
          </button>
          {showHistory && (
            <div style={{ marginTop: '8px', display: 'grid', gap: '8px' }}>
              {plan.change_history.map((h, i) => (
                <div key={i} style={{ fontSize: '12px', color: 'var(--fg-2)' }}>
                  <span className="mono" style={{ color: 'var(--fg-3)' }}>{formatDate(h.at)}</span>
                  {' · '}{h.by_email || 'unknown'}
                  {Object.entries(h.changes).map(([k, c]) => (
                    <div key={k} className="mono" style={{ paddingLeft: '12px', fontSize: '11.5px' }}>
                      {LABELS[k] || k}: {formatChange(k, c.from)} → <span style={{ color: 'var(--fg)' }}>{formatChange(k, c.to)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminPlans() {
  const { token } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    getPlans(token)
      .then(data => setPlans(data.plans || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSave(planName, patch) {
    const updated = await updatePlan(token, planName, patch);
    setPlans(plans.map(p => (p.plan === planName ? updated : p)));
  }

  return (
    <AdminLayout title="Plans">
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Plans & Pricing</h1>
        <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Changes take effect immediately and apply to the next invoice generated for each plan, including the month in progress.
        </p>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}
      {loading && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>}

      {!loading && plans.map(plan => <PlanCard key={plan.plan} plan={plan} onSave={handleSave} />)}
    </AdminLayout>
  );
}
