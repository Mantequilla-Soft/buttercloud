import { UserModel } from '../db/models/User.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { BillingRecordModel } from '../db/models/BillingRecord.js';
import { QuotaModel } from '../db/models/Quota.js';
import { BucketModel } from '../db/models/Bucket.js';
import { CreditModel } from '../db/models/Credit.js';
import { sendOverdueInvoiceEmail } from './email.js';

/**
 * Consumes a user's unapplied credits (oldest first) against an amount owed.
 * Each credit is consumed in full, not split — a credit bigger than what's
 * left owed still gets fully marked applied, with the excess not carried
 * forward. Simple and auditable (every credit maps to exactly one invoice),
 * at the cost of occasionally "wasting" part of an oversized credit. For an
 * exact-amount waiver, use compInvoice() below instead of a general credit.
 *
 * Returns the invoice total after credits, the effective discount (bounded by
 * owedCents, regardless of how much credit was actually consumed), and the
 * credit records that were consumed (caller is responsible for marking them
 * applied once the invoice they're being applied to actually exists).
 */
async function applyCreditsToInvoice(userId, owedCents) {
  const unapplied = await CreditModel.findUnappliedByUser(userId);
  const consumed = [];
  let remaining = owedCents;

  for (const credit of unapplied) {
    if (remaining <= 0) break;
    consumed.push(credit);
    remaining -= credit.amount_cents;
  }

  const total = Math.max(0, remaining);
  const creditCents = owedCents - total;
  return { total, creditCents, consumed };
}

/**
 * Generate an invoice for one user for a given month string (YYYY-MM).
 * Idempotent — skips if a record already exists for that month.
 * Returns the billing record (new or existing).
 */
export async function generateInvoiceForUser(userId, monthStr) {
  // Avoid duplicates
  const existing = await BillingRecordModel.findByUserAndMonth(userId, monthStr + '-01');
  if (existing) return { record: existing, skipped: true };

  const user = await UserModel.findById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const quota = await QuotaModel.findByPlan(user.plan);
  if (!quota) throw new Error(`No quota plan found for plan: ${user.plan}`);

  // Usage for the month
  const usage = await UsageMetricModel.findByUserAndMonth(userId, monthStr);

  const storageGb   = usage ? usage.storage_avg_bytes / (1024 ** 3) : 0;
  const downloadGb  = usage ? usage.download_bytes    / (1024 ** 3) : 0;
  const requests    = usage ? usage.request_count : 0;

  // Pricing (all values in cents)
  const baseFee = quota.pricing.base_monthly_usd;

  const storageLimit = quota.limits.storage_gb;
  const storageOverageGb = Math.max(0, storageGb - storageLimit);
  const storageCharge = Math.round(storageOverageGb * quota.pricing.storage_overage_per_gb_usd);

  const transferLimit = quota.limits.monthly_transfer_gb;
  const transferOverageGb = Math.max(0, downloadGb - transferLimit);
  const transferCharge = Math.round(transferOverageGb * quota.pricing.transfer_overage_per_gb_usd);

  const subtotal = baseFee + storageCharge + transferCharge;
  const tax = 0; // add tax logic here later
  const owed = subtotal + tax;

  const { total, creditCents, consumed } = await applyCreditsToInvoice(userId, owed);

  const record = await BillingRecordModel.create({
    user_id: userId,
    month: monthStr + '-01',
    usage_metrics_id: usage?._id?.toString(),
    base_fee: baseFee,
    storage_charge: storageCharge,
    transfer_charge: transferCharge,
    request_charge: 0,
    subtotal,
    tax,
    credit_cents: creditCents,
    total,
  });

  for (const credit of consumed) {
    await CreditModel.markApplied(credit._id.toString(), record._id.toString());
  }

  return { record, skipped: false };
}

/**
 * Waives an invoice immediately: issues a credit for exactly its remaining
 * total (none needed if it's already $0), applies it right away, and
 * transitions the invoice to 'comped' — distinct from 'paid' so revenue
 * reporting can tell "the customer paid" apart from "we waived it."
 */
export async function compInvoice(invoiceId, adminUserId, reason) {
  const invoice = await BillingRecordModel.findById(invoiceId);
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.statusCode = 404;
    throw err;
  }
  if (invoice.status === 'paid' || invoice.status === 'comped') {
    const err = new Error(`Invoice is already ${invoice.status}`);
    err.statusCode = 400;
    throw err;
  }

  const amountCents = invoice.total;
  if (amountCents > 0) {
    const credit = await CreditModel.create({
      user_id: invoice.user_id.toString(),
      amount_cents: amountCents,
      reason: reason || `Comped invoice for ${invoice.month.toISOString().substring(0, 7)}`,
      created_by: adminUserId,
    });
    await CreditModel.markApplied(credit._id.toString(), invoiceId);
  }

  const record = await BillingRecordModel.update(invoiceId, {
    status: 'comped',
    credit_cents: (invoice.credit_cents || 0) + amountCents,
    total: 0,
  });

  return { record, comped_amount_cents: amountCents };
}

/**
 * Generate invoices for ALL active users for a given month.
 * Safe to run multiple times — skips already-generated invoices.
 */
export async function generateMonthlyInvoices(monthStr) {
  const { items: users } = await UserModel.list({ active: true }, 1000, 0);
  const results = [];

  for (const user of users) {
    try {
      const result = await generateInvoiceForUser(user._id.toString(), monthStr);
      results.push({ userId: user._id.toString(), email: user.email, ...result });
    } catch (err) {
      results.push({ userId: user._id.toString(), email: user.email, error: err.message });
    }
  }

  return results;
}

/**
 * Marks all pending invoices past their due date as overdue and sends reminder emails.
 * Returns the number of invoices flipped.
 */
export async function markOverdueAndNotify() {
  const flipped = await BillingRecordModel.markOverdue();

  for (const inv of flipped) {
    try {
      const user = await UserModel.findById(inv.user_id.toString());
      if (user?.email) {
        await sendOverdueInvoiceEmail({
          to: user.email,
          invoice: {
            id: inv._id.toString(),
            month: inv.month.toISOString().substring(0, 7),
            total_usd: inv.total,
            due_date: inv.due_date.toISOString(),
          },
        });
      }
    } catch (e) {
      console.warn(`Overdue email failed for invoice ${inv._id}:`, e.message);
    }
  }

  return flipped.length;
}

/**
 * Returns YYYY-MM for the previous calendar month.
 */
export function previousMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Returns YYYY-MM for the current calendar month.
 */
export function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
