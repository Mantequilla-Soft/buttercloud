import { config } from '../config.js';
import { BillingRecordModel } from '../db/models/BillingRecord.js';

const HIVE_API = config.hive.apiUrl;

async function hiveRpc(method, params) {
  const res = await fetch(HIVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`HIVE RPC: ${data.error.message}`);
  return data.result;
}

// Returns USD value of 1 HIVE (via the on-chain price feed)
async function getHivePrice() {
  const feed = await hiveRpc('condenser_api.get_current_median_history_price', []);
  const hbd = parseFloat(feed.base.split(' ')[0]);
  const hive = parseFloat(feed.quote.split(' ')[0]);
  return hbd / hive; // HBD per HIVE ≈ USD per HIVE
}

async function getRecentTransfers(account) {
  const history = await hiveRpc('condenser_api.get_account_history', [account, -1, 100]);
  const transfers = [];
  for (const [, entry] of history) {
    const [type, data] = entry.op;
    if (type === 'transfer' && data.to === account) {
      transfers.push({
        trx_id: entry.trx_id,
        timestamp: entry.timestamp,
        from: data.from,
        amount: data.amount,  // e.g. "10.000 HBD"
        memo: data.memo || '',
      });
    }
  }
  return transfers;
}

// Memo format: BC-{24-char hex invoiceId}
function parseInvoiceId(memo) {
  const m = memo.trim().match(/^BC-([a-f0-9]{24})$/i);
  return m ? m[1] : null;
}

function parseAmount(amountStr) {
  const [raw, currency] = amountStr.split(' ');
  return { amount: parseFloat(raw), currency };
}

export async function pollHivePayments() {
  const account = config.hive.account;
  if (!account) return;

  const [transfers, hivePrice] = await Promise.all([
    getRecentTransfers(account),
    getHivePrice(),
  ]);

  for (const transfer of transfers) {
    const invoiceId = parseInvoiceId(transfer.memo);
    if (!invoiceId) continue;

    let invoice;
    try { invoice = await BillingRecordModel.findById(invoiceId); } catch { continue; }
    if (!invoice) continue;
    if (invoice.status === 'paid') continue;
    if (invoice.payment_txid === transfer.trx_id) continue;

    const { amount, currency } = parseAmount(transfer.amount);
    let paidCents;
    if (currency === 'HBD') {
      paidCents = Math.round(amount * 100);
    } else if (currency === 'HIVE') {
      paidCents = Math.round(amount * hivePrice * 100);
    } else {
      continue;
    }

    // Require full payment (within 1 cent rounding tolerance)
    if (paidCents < invoice.total - 1) {
      console.log(`Underpayment invoice ${invoiceId}: paid ${paidCents}¢, owe ${invoice.total}¢`);
      continue;
    }

    await BillingRecordModel.update(invoiceId, {
      status: 'paid',
      payment_received_at: new Date(transfer.timestamp + 'Z'),
      payment_txid: transfer.trx_id,
      payment_currency: currency,
      payment_amount_raw: transfer.amount,
    });

    console.log(`Invoice ${invoiceId} paid — ${transfer.amount} from @${transfer.from} (${transfer.trx_id})`);
  }
}
