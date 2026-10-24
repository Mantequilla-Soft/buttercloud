import { UserModel } from '../db/models/User.js';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { BillingRecordModel } from '../db/models/BillingRecord.js';
import { QuotaModel } from '../db/models/Quota.js';
import { CreditModel } from '../db/models/Credit.js';
import { isUploadSuspended } from './suspension.js';

function gb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}

/**
 * Last `months` months of usage, oldest first, zero-filled for months with no
 * recorded metric. Shared between the customer-facing GET /api/v1/usage/history
 * and the admin per-client profile, so both show the same numbers the same way.
 */
export async function getUsageHistory(userId, months = 6) {
  const metrics = await UsageMetricModel.findLastNMonths(userId, months);
  const metricsMap = Object.fromEntries(
    metrics.map(m => [m.month.toISOString().substring(0, 7), m])
  );

  const history = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMonth(d.getUTCMonth() - i);
    const monthStr = d.toISOString().substring(0, 7);
    const m = metricsMap[monthStr];
    history.push({
      month: monthStr,
      storage_avg_gb: m ? gb(m.storage_avg_bytes) : 0,
      upload_gb: m ? gb(m.upload_bytes) : 0,
      download_gb: m ? gb(m.download_bytes) : 0,
      request_count: m ? m.request_count : 0,
    });
  }
  return history;
}

/** Shared invoice shape between the customer-facing and admin billing views. */
export function serializeInvoice(invoice) {
  return {
    id: invoice._id.toString(),
    month: invoice.month.toISOString().substring(0, 7),
    period_start: invoice.period_start.toISOString(),
    period_end: invoice.period_end.toISOString(),
    storage_charge_usd: invoice.storage_charge,
    transfer_charge_usd: invoice.transfer_charge,
    request_charge_usd: invoice.request_charge,
    base_fee_usd: invoice.base_fee,
    subtotal_usd: invoice.subtotal,
    tax_usd: invoice.tax,
    credit_usd: invoice.credit_cents || 0,
    total_usd: invoice.total,
    status: invoice.status,
    due_date: invoice.due_date.toISOString(),
    payment_received_at: invoice.payment_received_at?.toISOString() || null,
    created_at: invoice.created_at.toISOString(),
  };
}

/**
 * Everything the admin per-client dashboard page needs about one user, in a
 * single consolidated read: identity, bucket/storage, quota, recent usage
 * trend, and billing history. Returns null if the user doesn't exist.
 */
export async function getClientProfile(userId) {
  const user = await UserModel.findById(userId);
  if (!user) return null;

  const [bucket, usageHistory, billingResult, quota, suspended, creditsResult] = await Promise.all([
    BucketModel.findByUserId(userId),
    getUsageHistory(userId, 6),
    BillingRecordModel.listByUser(userId, 12, 0),
    QuotaModel.findByPlan(user.plan),
    isUploadSuspended(userId),
    CreditModel.listByUser(userId, 20, 0),
  ]);

  const node = bucket ? await StorageNodeModel.findById(bucket.node_id.toString()) : null;

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      plan: user.plan,
      is_admin: user.is_admin || false,
      suspension_override: user.suspension_override || null,
      is_suspended: suspended,
      company_name: user.company_name,
      created_at: user.created_at,
      active: user.active,
      email_verified: user.email_verified,
    },
    bucket: bucket
      ? {
          bucket_name: bucket.bucket_name,
          quota_bytes: bucket.quota_bytes,
          current_usage_bytes: bucket.current_usage_bytes,
          node_name: node?.name || 'unknown',
        }
      : null,
    quota: quota
      ? { storage_gb: quota.limits.storage_gb, base_monthly_usd: quota.pricing.base_monthly_usd }
      : null,
    usage_history: usageHistory,
    invoices: billingResult.items.map(serializeInvoice),
    invoice_total: billingResult.total,
    credits: creditsResult.items.map(c => ({
      id: c._id.toString(),
      amount_usd: c.amount_cents,
      reason: c.reason,
      created_at: c.created_at,
      applied_to_invoice_id: c.applied_to_invoice_id?.toString() || null,
      applied_at: c.applied_at,
    })),
  };
}
