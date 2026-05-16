import { UserModel } from '../db/models/User.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { BillingRecordModel } from '../db/models/BillingRecord.js';
import { QuotaModel } from '../db/models/Quota.js';
import { BucketModel } from '../db/models/Bucket.js';

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
  const total = subtotal + tax;

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
    total,
  });

  return { record, skipped: false };
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
