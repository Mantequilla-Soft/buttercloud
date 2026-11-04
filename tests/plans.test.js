import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { UserModel } from '../src/db/models/User.js';
import { BucketModel } from '../src/db/models/Bucket.js';
import { QuotaModel } from '../src/db/models/Quota.js';
import { createToken } from '../src/services/auth.js';
import { getDB } from '../src/db/index.js';
import { ObjectId } from 'mongodb';

let app;

beforeAll(async () => {
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(async () => {
  const db = getDB();
  const colls = await db.listCollections().toArray();
  await Promise.all(colls.map(c => db.collection(c.name).deleteMany({})));
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function createUser({ email, plan = 'free', is_admin = false }) {
  const user = await UserModel.create({ email, password_hash: 'x', plan, is_admin, email_verified: true });
  const token = createToken(user._id.toString(), user.email, user.plan);
  return { user, auth: { Authorization: `Bearer ${token}` } };
}

function seedStarter() {
  return QuotaModel.create({
    plan: 'starter',
    storage_gb: 100,
    monthly_transfer_gb: 1000,
    monthly_requests: 100000,
    max_object_size_gb: 5,
    max_buckets: 1,
    base_monthly_usd: 625,
    storage_overage_per_gb_usd: 38,
    transfer_overage_per_gb_usd: 10,
    supports_lifecycle_policies: true,
    api_support: true,
  });
}

function patchPlan(plan, payload, headers) {
  return app.inject({ method: 'PATCH', url: `/api/v1/admin/plans/${plan}`, payload, headers });
}

// ─── GET /api/v1/admin/plans ─────────────────────────────────────────────────

describe('GET /api/v1/admin/plans', () => {
  it('lists plans with pricing, limits and user counts', async () => {
    await seedStarter();
    await QuotaModel.create({ plan: 'free', storage_gb: 0.5, monthly_transfer_gb: 5 });
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });
    await createUser({ email: 'a@example.com', plan: 'starter' });
    await createUser({ email: 'b@example.com', plan: 'starter' });

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/plans', headers: auth });
    expect(res.statusCode).toBe(200);
    const { plans } = res.json();
    expect(plans.map(p => p.plan)).toEqual(['free', 'starter']); // sorted by base fee
    const starter = plans.find(p => p.plan === 'starter');
    expect(starter.pricing.base_monthly_usd).toBe(625);
    expect(starter.limits.storage_gb).toBe(100);
    expect(starter.user_count).toBe(2);
  });

  it('returns 403 for a non-admin', async () => {
    const { auth } = await createUser({ email: 'user@example.com' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/plans', headers: auth });
    expect(res.statusCode).toBe(403);
  });
});

// ─── PATCH /api/v1/admin/plans/:plan ─────────────────────────────────────────

describe('PATCH /api/v1/admin/plans/:plan', () => {
  it('updates only the fields sent, leaving the rest intact', async () => {
    await seedStarter();
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });

    const res = await patchPlan('starter', { storage_overage_per_gb_usd: 0.7, base_monthly_usd: 500 }, auth);
    expect(res.statusCode).toBe(200);

    const q = await QuotaModel.findByPlan('starter');
    expect(q.pricing.storage_overage_per_gb_usd).toBe(0.7); // fractional cents allowed
    expect(q.pricing.base_monthly_usd).toBe(500);
    expect(q.pricing.transfer_overage_per_gb_usd).toBe(10);
    expect(q.limits.storage_gb).toBe(100);
    expect(q.features.supports_lifecycle_policies).toBe(true);
  });

  it('records who changed what in the change history', async () => {
    await seedStarter();
    const { user, auth } = await createUser({ email: 'admin@example.com', is_admin: true });

    await patchPlan('starter', { transfer_overage_per_gb_usd: 1 }, auth);
    const res = await patchPlan('starter', { transfer_overage_per_gb_usd: 0.5 }, auth);

    const { change_history } = res.json();
    expect(change_history).toHaveLength(2);
    expect(change_history[0].changes).toEqual({ transfer_overage_per_gb_usd: { from: 1, to: 0.5 } }); // newest first
    expect(change_history[0].by_email).toBe('admin@example.com');
    expect(change_history[0].by_user_id).toBe(user._id.toString());
  });

  it('does not log a change when values are unchanged', async () => {
    await seedStarter();
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });

    const res = await patchPlan('starter', { base_monthly_usd: 625 }, auth);
    expect(res.statusCode).toBe(200);
    expect(res.json().change_history).toHaveLength(0);
  });

  it("propagates a storage limit change to existing buckets on that plan only", async () => {
    await seedStarter();
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });
    const { user: onPlan } = await createUser({ email: 'a@example.com', plan: 'starter' });
    const { user: offPlan } = await createUser({ email: 'b@example.com', plan: 'free' });
    const nodeId = new ObjectId().toString();
    const b1 = await BucketModel.create({ user_id: onPlan._id.toString(), bucket_name: 'b1', node_id: nodeId, quota_bytes: 100 * 1024 ** 3 });
    const b2 = await BucketModel.create({ user_id: offPlan._id.toString(), bucket_name: 'b2', node_id: nodeId, quota_bytes: 1024 ** 3 });

    const res = await patchPlan('starter', { storage_gb: 250 }, auth);
    expect(res.statusCode).toBe(200);
    expect(res.json().buckets_updated).toBe(1);

    expect((await BucketModel.findById(b1._id.toString())).quota_bytes).toBe(250 * 1024 ** 3);
    expect((await BucketModel.findById(b2._id.toString())).quota_bytes).toBe(1024 ** 3);
  });

  it.each([
    [{ base_monthly_usd: 6.25 }, 'base_monthly_usd'],   // base fee must be whole cents
    [{ storage_overage_per_gb_usd: -1 }, 'storage_overage_per_gb_usd'],
    [{ storage_gb: 0 }, 'storage_gb'],
    [{ max_buckets: 0 }, 'max_buckets'],
    [{ api_support: 'yes' }, 'api_support'],
    [{ transfer_overage_per_gb_usd: '10' }, 'transfer_overage_per_gb_usd'],
  ])('rejects invalid value %j', async (payload, field) => {
    await seedStarter();
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });

    const res = await patchPlan('starter', payload, auth);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain(field);
    expect((await QuotaModel.findByPlan('starter')).pricing.base_monthly_usd).toBe(625);
  });

  it('rejects unknown fields and empty bodies', async () => {
    await seedStarter();
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });

    const typo = await patchPlan('starter', { storage_overage_per_gb: 5 }, auth);
    expect(typo.statusCode).toBe(400);
    expect(typo.json().error).toBe('unknown_fields');

    const empty = await patchPlan('starter', {}, auth);
    expect(empty.statusCode).toBe(400);
  });

  it('returns 404 for an unknown plan', async () => {
    const { auth } = await createUser({ email: 'admin@example.com', is_admin: true });
    const res = await patchPlan('platinum', { base_monthly_usd: 100 }, auth);
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a non-admin', async () => {
    await seedStarter();
    const { auth } = await createUser({ email: 'user@example.com', plan: 'starter' });
    const res = await patchPlan('starter', { base_monthly_usd: 0 }, auth);
    expect(res.statusCode).toBe(403);
    expect((await QuotaModel.findByPlan('starter')).pricing.base_monthly_usd).toBe(625);
  });
});

// ─── QuotaModel ──────────────────────────────────────────────────────────────

describe('QuotaModel.deactivate', () => {
  it('deactivates the plan without touching its limits or pricing', async () => {
    await seedStarter();
    await QuotaModel.deactivate('starter');
    const raw = await getDB().collection('quotas').findOne({ plan: 'starter' });
    expect(raw.active).toBe(false);
    expect(raw.limits.storage_gb).toBe(100);
    expect(raw.pricing.base_monthly_usd).toBe(625);
  });
});
