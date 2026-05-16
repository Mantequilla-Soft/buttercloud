import { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useAuth } from '../../hooks/useAuth';
import { getAdminBilling, generateInvoices, updateInvoice } from '../../api/admin';
import { I } from '../../components/Icons';

async function fetchPaymentConfig() {
  const r = await fetch('/api/v1/payment-config');
  return r.ok ? r.json() : { hive_account: null, currencies: [], memo_prefix: 'BC-' };
}

const STATUS_TABS = ['draft', 'pending', 'paid', 'overdue'];

const STATUS_STYLE = {
  draft:   { color: 'var(--fg-2)',   bg: 'var(--bg-3)' },
  pending: { color: 'var(--butter)', bg: 'oklch(0.85 0.135 90 / .14)' },
  paid:    { color: 'var(--sage)',   bg: 'oklch(0.78 0.105 145 / .14)' },
  overdue: { color: 'var(--coral)',  bg: 'oklch(0.72 0.145 25 / .14)' },
};

function cents(v) { return `$${(v / 100).toFixed(2)}`; }

function GenerateModal({ onConfirm, onCancel }) {
  const now = new Date();
  const prev = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const defaultMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  async function handleRun() {
    setRunning(true);
    try {
      const r = await onConfirm(month);
      setResult(r);
    } finally { setRunning(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '28px', width: '420px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600 }}>Generate Invoices</h3>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Creates invoices for all active users based on their usage and plan pricing. Safe to run multiple times — existing invoices are skipped.
        </p>

        {!result ? (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--fg-2)', marginBottom: '6px' }}>Billing Month</label>
              <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={onCancel}>Cancel</button>
              <button className="btn primary" onClick={handleRun} disabled={running}>
                {running ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: '14px 16px', background: 'oklch(0.78 0.105 145 / .1)', border: '1px solid oklch(0.78 0.105 145 / .25)', borderRadius: '8px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 500, color: 'var(--sage)', marginBottom: '8px' }}>Done — {result.month}</div>
              <div style={{ fontSize: '12px', color: 'var(--fg-2)', display: 'flex', gap: '16px' }}>
                <span>{result.created} created</span>
                <span>{result.skipped} skipped</span>
                {result.errors > 0 && <span style={{ color: 'var(--coral)' }}>{result.errors} errors</span>}
              </div>
            </div>
            <button className="btn primary" style={{ width: '100%' }} onClick={onCancel}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminBilling() {
  const { token } = useAuth();
  const [tab, setTab] = useState('draft');
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState(null);

  useEffect(() => { fetchPaymentConfig().then(setPaymentConfig); }, []);
  useEffect(() => { if (token) load(); }, [token, tab]);

  async function load() {
    setLoading(true);
    try {
      const data = await getAdminBilling(token, tab);
      setInvoices(data.invoices || []);
      setTotal(data.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleGenerate(month) {
    const result = await generateInvoices(token, month);
    await load();
    return result;
  }

  async function handleStatus(id, status) {
    try {
      await updateInvoice(token, id, status);
      await load();
    } catch (e) { setError(e.message); }
  }

  const totalRevenue = invoices.reduce((s, i) => s + i.total_usd, 0);

  return (
    <AdminLayout title="Billing">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Billing</h1>
        <button className="btn primary" onClick={() => setShowGenerate(true)}>
          {I.zap({ size: 14 })} Generate Invoices
        </button>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '20px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px', padding: '3px' }}>
        {STATUS_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, height: '30px', border: 'none', borderRadius: '6px', cursor: 'pointer',
              background: tab === t ? 'var(--bg-3)' : 'transparent',
              color: tab === t ? 'var(--fg)' : 'var(--fg-2)',
              fontSize: '12px', fontWeight: tab === t ? 500 : 400,
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      {invoices.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ padding: '12px 16px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px', flex: 1 }}>
            <div style={{ fontSize: '10.5px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{tab} invoices</div>
            <div className="mono" style={{ fontSize: '20px', fontWeight: 500 }}>{total}</div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px', flex: 1 }}>
            <div style={{ fontSize: '10.5px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Total on page</div>
            <div className="mono" style={{ fontSize: '20px', fontWeight: 500, color: 'var(--butter)' }}>{cents(totalRevenue)}</div>
          </div>
        </div>
      )}

      <div className="files">
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 80px 90px 90px', gap: '10px', padding: '9px 16px', fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line-soft)' }}>
          <span>Month</span><span>User</span><span style={{ textAlign: 'right' }}>Base</span><span style={{ textAlign: 'right' }}>Extra</span><span style={{ textAlign: 'right' }}>Total</span><span></span>
        </div>

        {loading && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>}

        {!loading && invoices.length === 0 && (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--fg-2)' }}>
            <div style={{ fontWeight: 500, color: 'var(--fg-1)', marginBottom: '4px' }}>No {tab} invoices</div>
            {tab === 'draft' && <div style={{ fontSize: '12px' }}>Click "Generate Invoices" to create invoices for the previous month.</div>}
          </div>
        )}

        {invoices.map(inv => {
          const s = STATUS_STYLE[inv.status] || STATUS_STYLE.draft;
          const overage = inv.storage_charge_usd + inv.transfer_charge_usd;
          const memo = `BC-${inv.id}`;
          const hbdAmount = (inv.total_usd / 100).toFixed(3);
          const showPaymentHint = inv.status === 'pending' && paymentConfig?.hive_account;
          return (
            <div key={inv.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 80px 90px 90px', gap: '10px', padding: '12px 16px', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '12px', color: 'var(--fg-1)' }}>{inv.month}</div>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--fg)' }}>{inv.user_email}</div>
                  <div style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px' }}>{inv.user_plan}</div>
                </div>
                <div className="mono" style={{ textAlign: 'right', fontSize: '12px', color: 'var(--fg-2)' }}>{cents(inv.base_fee_usd)}</div>
                <div className="mono" style={{ textAlign: 'right', fontSize: '12px', color: overage > 0 ? 'var(--coral)' : 'var(--fg-2)' }}>{cents(overage)}</div>
                <div className="mono" style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>{cents(inv.total_usd)}</div>
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                  {inv.status !== 'paid' && (
                    <button onClick={() => handleStatus(inv.id, 'paid')} className="btn ghost" style={{ height: '26px', padding: '0 8px', fontSize: '11px' }}>
                      Mark paid
                    </button>
                  )}
                  {inv.status === 'draft' && (
                    <button onClick={() => handleStatus(inv.id, 'pending')} className="btn" style={{ height: '26px', padding: '0 8px', fontSize: '11px' }}>
                      Send
                    </button>
                  )}
                </div>
              </div>
              {showPaymentHint && (
                <div style={{ margin: '0 16px 12px', padding: '10px 12px', background: 'oklch(0.85 0.135 90 / .06)', border: '1px solid oklch(0.85 0.135 90 / .2)', borderRadius: '8px', fontSize: '11.5px', color: 'var(--fg-2)' }}>
                  <span style={{ color: 'var(--butter)', fontWeight: 500 }}>Payment: </span>
                  send <span className="mono" style={{ color: 'var(--fg)' }}>{hbdAmount} HBD</span> to{' '}
                  <span className="mono" style={{ color: 'var(--fg)' }}>@{paymentConfig.hive_account}</span> with memo{' '}
                  <span className="mono" style={{ color: 'var(--fg)', userSelect: 'all' }}>{memo}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showGenerate && <GenerateModal onConfirm={handleGenerate} onCancel={() => setShowGenerate(false)} />}
    </AdminLayout>
  );
}
