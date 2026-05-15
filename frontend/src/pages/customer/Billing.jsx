import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { getBilling } from '../../api/usage';

const STATUS_STYLE = {
  paid:    { color: 'var(--sage)',   bg: 'oklch(0.78 0.105 145 / .14)' },
  pending: { color: 'var(--butter)', bg: 'oklch(0.85 0.135 90 / .14)' },
  overdue: { color: 'var(--coral)',  bg: 'oklch(0.72 0.145 25 / .14)' },
  draft:   { color: 'var(--fg-2)',   bg: 'var(--bg-3)' },
};

function cents(v) {
  return `$${(v / 100).toFixed(2)}`;
}

export default function Billing() {
  const { token } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { if (token) load(); }, [token]);

  async function load() {
    try {
      const data = await getBilling(token);
      setInvoices(data.invoices || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <Layout title="Billing">
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 600 }}>Billing</h1>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-2)' }}>Invoices are generated monthly and reflect actual usage.</p>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>
      ) : invoices.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--fg-2)', background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)', marginBottom: '4px' }}>No invoices yet</div>
          <div style={{ fontSize: '12px' }}>Invoices appear here at the end of each billing period.</div>
        </div>
      ) : (
        <div className="files">
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 100px 100px 90px', gap: '10px', padding: '9px 16px', fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line-soft)' }}>
            <span>Period</span><span>Breakdown</span><span style={{ textAlign: 'right' }}>Storage</span><span style={{ textAlign: 'right' }}>Transfer</span><span style={{ textAlign: 'right' }}>Total</span><span style={{ textAlign: 'right' }}>Status</span>
          </div>

          {invoices.map(inv => {
            const s = STATUS_STYLE[inv.status] || STATUS_STYLE.draft;
            return (
              <div key={inv.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 100px 100px 90px', gap: '10px', padding: '14px 16px', borderBottom: '1px solid var(--line-soft)', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '12px', color: 'var(--fg-1)' }}>{inv.month}</div>
                <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>
                  Base {cents(inv.base_fee_usd)} · Requests {cents(inv.request_charge_usd)}
                </div>
                <div className="mono" style={{ textAlign: 'right', fontSize: '12px' }}>{cents(inv.storage_charge_usd)}</div>
                <div className="mono" style={{ textAlign: 'right', fontSize: '12px' }}>{cents(inv.transfer_charge_usd)}</div>
                <div className="mono" style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>{cents(inv.total_usd)}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 500, color: s.color, background: s.bg }}>
                    {inv.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
