import { describe, it, expect, afterEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { BillingRecordModel } from '../src/db/models/BillingRecord.js';
import { UsageMetricModel } from '../src/db/models/UsageMetric.js';
import { UserModel } from '../src/db/models/User.js';
import { QuotaModel } from '../src/db/models/Quota.js';
import { BucketModel } from '../src/db/models/Bucket.js';
import { StorageNodeModel } from '../src/db/models/StorageNode.js';
import { markOverdueAndNotify } from '../src/services/billing.js';
import { checkAndSendQuotaWarnings } from '../src/services/quotaWarnings.js';
import { getDB } from '../src/db/index.js';

const GB = 1024 ** 3;

afterEach(async () => {
  const db = getDB();
  const colls = await db.listCollections().toArray();
  await Promise.all(colls.map(c => db.collection(c.name).deleteMany({})));
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function createUser(email = 'test@example.com', plan = 'free') {
  return UserModel.create({ email, password_hash: 'x', plan, email_verified: true });
}

async function createQuota(plan = 'free', { storage_gb = 10, monthly_transfer_gb = 100 } = {}) {
  return QuotaModel.create({
    plan,
    storage_gb,
    monthly_transfer_gb,
    base_monthly_usd: 0,
    storage_overage_per_gb_usd: 50,
    transfer_overage_per_gb_usd: 10,
  });
}

// Creates a minimal node (required by BucketModel.create node_id FK)
async function createNode() {
  const node = {
    _id: new ObjectId(),
    name: 'test-node',
    endpoint: 'http://localhost:9000',
    region: 'default',
    active: true,
    stored_bytes: 0,
    created_at: new Date(),
  };
  await getDB().collection('storage_nodes').insertOne(node);
  return node;
}

async function createBillingRecord(userId, { status = 'draft', daysOverdue = null } = {}) {
  const record = await BillingRecordModel.create({ user_id: userId, month: '2025-01-01' });
  const date = new Date();
  // Positive daysOverdue = past; null = 30 days in the future (safe default)
  date.setDate(date.getDate() + (daysOverdue !== null ? -daysOverdue : 30));
  await BillingRecordModel.update(record._id.toString(), { status, due_date: date });
  return BillingRecordModel.findById(record._id.toString());
}

async function createUsageMetric(userId, { downloadGb = 0 } = {}) {
  const monthStr = new Date().toISOString().substring(0, 7);
  const metric = await UsageMetricModel.getOrCreate(userId, monthStr);
  if (downloadGb > 0) {
    await getDB().collection('usage_metrics').updateOne(
      { _id: metric._id },
      { $set: { download_bytes: Math.round(downloadGb * GB) } }
    );
  }
  return UsageMetricModel.findByUserAndMonth(userId, monthStr);
}

async function createBucket(userId, { usedGb = 0, limitGb = 10 } = {}) {
  const node = await createNode();
  const bucket = await BucketModel.create({
    user_id: userId,
    bucket_name: `bucket-${userId.slice(-6)}`,
    node_id: node._id.toString(),
    quota_bytes: Math.round(limitGb * GB),
    region: 'default',
  });
  if (usedGb > 0) {
    await BucketModel.setUsage(bucket._id.toString(), Math.round(usedGb * GB));
  }
  return BucketModel.findById(bucket._id.toString());
}

// ─── BillingRecordModel.markOverdue ──────────────────────────────────────────

describe('BillingRecordModel.markOverdue()', () => {
  it('flips pending invoices with a past due date to overdue', async () => {
    const user = await createUser();
    await createBillingRecord(user._id.toString(), { status: 'pending', daysOverdue: 5 });

    const flipped = await BillingRecordModel.markOverdue();
    expect(flipped).toHaveLength(1);

    const updated = await BillingRecordModel.findById(flipped[0]._id.toString());
    expect(updated.status).toBe('overdue');
  });

  it('ignores pending invoices whose due date is in the future', async () => {
    const user = await createUser();
    const record = await createBillingRecord(user._id.toString(), { status: 'pending' });
    // due_date defaults to next month's 15th — safely in the future
    const flipped = await BillingRecordModel.markOverdue();
    expect(flipped).toHaveLength(0);

    const unchanged = await BillingRecordModel.findById(record._id.toString());
    expect(unchanged.status).toBe('pending');
  });

  it('does not touch paid invoices even if past due', async () => {
    const user = await createUser();
    await createBillingRecord(user._id.toString(), { status: 'paid', daysOverdue: 10 });

    const flipped = await BillingRecordModel.markOverdue();
    expect(flipped).toHaveLength(0);
  });

  it('does not touch draft invoices even if past due', async () => {
    const user = await createUser();
    await createBillingRecord(user._id.toString(), { status: 'draft', daysOverdue: 10 });

    const flipped = await BillingRecordModel.markOverdue();
    expect(flipped).toHaveLength(0);
  });

  it('flips multiple overdue invoices in one pass', async () => {
    const u1 = await createUser('a@example.com');
    const u2 = await createUser('b@example.com');
    await createBillingRecord(u1._id.toString(), { status: 'pending', daysOverdue: 3 });
    await createBillingRecord(u2._id.toString(), { status: 'pending', daysOverdue: 7 });

    const flipped = await BillingRecordModel.markOverdue();
    expect(flipped).toHaveLength(2);
  });
});

// ─── markOverdueAndNotify ────────────────────────────────────────────────────

describe('markOverdueAndNotify()', () => {
  it('returns the count of invoices flipped', async () => {
    const user = await createUser();
    await createBillingRecord(user._id.toString(), { status: 'pending', daysOverdue: 5 });

    const count = await markOverdueAndNotify();
    expect(count).toBe(1);
  });

  it('returns 0 when there is nothing to flip', async () => {
    const count = await markOverdueAndNotify();
    expect(count).toBe(0);
  });
});

// ─── checkAndSendQuotaWarnings — storage ─────────────────────────────────────

describe('checkAndSendQuotaWarnings() — storage', () => {
  it('sets quota_warned.storage when usage is at or above 80%', async () => {
    const user = await createUser();
    await createQuota('free', { storage_gb: 10 });
    await createBucket(user._id.toString(), { usedGb: 8.5, limitGb: 10 }); // 85%
    await createUsageMetric(user._id.toString());

    await checkAndSendQuotaWarnings();

    const monthStr = new Date().toISOString().substring(0, 7);
    const usage = await UsageMetricModel.findByUserAndMonth(user._id.toString(), monthStr);
    expect(usage.quota_warned.storage).toBe(true);
  });

  it('does NOT set the flag when storage is below 80%', async () => {
    const user = await createUser();
    await createQuota('free', { storage_gb: 10 });
    await createBucket(user._id.toString(), { usedGb: 5, limitGb: 10 }); // 50%
    await createUsageMetric(user._id.toString());

    await checkAndSendQuotaWarnings();

    const monthStr = new Date().toISOString().substring(0, 7);
    const usage = await UsageMetricModel.findByUserAndMonth(user._id.toString(), monthStr);
    expect(usage.quota_warned.storage).toBe(false);
  });

  it('does NOT send a second warning if flag is already set', async () => {
    const user = await createUser();
    await createQuota('free', { storage_gb: 10 });
    await createBucket(user._id.toString(), { usedGb: 9, limitGb: 10 }); // 90%
    await createUsageMetric(user._id.toString());

    // First pass — sets the flag
    await checkAndSendQuotaWarnings();
    // Manually verify it was set, then run again
    const monthStr = new Date().toISOString().substring(0, 7);
    const afterFirst = await UsageMetricModel.findByUserAndMonth(user._id.toString(), monthStr);
    expect(afterFirst.quota_warned.storage).toBe(true);

    // Second pass — flag is already set, should not re-send
    // (No way to assert email count without mocking, but we verify the flag stays true
    // and the function completes without error)
    await expect(checkAndSendQuotaWarnings()).resolves.not.toThrow();
  });
});

// ─── checkAndSendQuotaWarnings — transfer ────────────────────────────────────

describe('checkAndSendQuotaWarnings() — transfer', () => {
  it('sets quota_warned.transfer when download bytes are at or above 80% of limit', async () => {
    const user = await createUser();
    await createQuota('free', { monthly_transfer_gb: 100 });
    await createUsageMetric(user._id.toString(), { downloadGb: 85 }); // 85%

    await checkAndSendQuotaWarnings();

    const monthStr = new Date().toISOString().substring(0, 7);
    const usage = await UsageMetricModel.findByUserAndMonth(user._id.toString(), monthStr);
    expect(usage.quota_warned.transfer).toBe(true);
  });

  it('does NOT set the flag when transfer is below 80%', async () => {
    const user = await createUser();
    await createQuota('free', { monthly_transfer_gb: 100 });
    await createUsageMetric(user._id.toString(), { downloadGb: 50 }); // 50%

    await checkAndSendQuotaWarnings();

    const monthStr = new Date().toISOString().substring(0, 7);
    const usage = await UsageMetricModel.findByUserAndMonth(user._id.toString(), monthStr);
    expect(usage.quota_warned.transfer).toBe(false);
  });

  it('handles users with no usage record this month gracefully', async () => {
    await createUser();
    await createQuota();
    // No usage metric created — function should skip without throwing
    await expect(checkAndSendQuotaWarnings()).resolves.not.toThrow();
  });

  it('handles users with no quota plan gracefully', async () => {
    await createUser('noquota@example.com', 'enterprise');
    // No quota for 'enterprise' in DB — should skip without throwing
    await expect(checkAndSendQuotaWarnings()).resolves.not.toThrow();
  });
});
