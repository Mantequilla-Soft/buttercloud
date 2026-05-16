import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { getBilling } from '../../api/usage';

async function fetchPaymentConfig() {
  const r = await fetch('/api/v1/payment-config');
  return r.ok ? r.json() : { hive_account: null, currencies: [], memo_prefix: 'BC-' };
}

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
  const [paymentConfig, setPaymentConfig] = useState(null);

  useEffect(() => { fetchPaymentConfig().then(setPaymentConfig); }, []);
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
            const memo = `BC-${inv.id}`;
            const hbdAmount = (inv.total_usd / 100).toFixed(3);
            const showPayment = inv.status === 'pending' && paymentConfig?.hive_account;
            return (
              <div key={inv.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 100px 100px 90px', gap: '10px', padding: '14px 16px', alignItems: 'center' }}>
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
                {showPayment && (
                  <div style={{ margin: '0 16px 14px', padding: '12px 14px', background: 'oklch(0.85 0.135 90 / .06)', border: '1px solid oklch(0.85 0.135 90 / .2)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--butter)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                      Payment due
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-2)', lineHeight: 1.8 }}>
                      Send <span className="mono" style={{ color: 'var(--fg)', fontWeight: 600 }}>{hbdAmount} HBD</span> (or equivalent HIVE) to:
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--fg-3)', width: '60px', display: 'inline-block' }}>Account</span>
                        <span className="mono" style={{ color: 'var(--fg)', userSelect: 'all' }}>@{paymentConfig.hive_account}</span>
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--fg-3)', width: '60px', display: 'inline-block' }}>Memo</span>
                        <span className="mono" style={{ color: 'var(--butter)', userSelect: 'all' }}>{memo}</span>
                      </div>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--fg-3)' }}>
                      Include the exact memo — it identifies your payment automatically.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
