import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { UserModel } from '../src/db/models/User.js';
import { BucketModel } from '../src/db/models/Bucket.js';
import { QuotaModel } from '../src/db/models/Quota.js';
import { StorageNodeModel } from '../src/db/models/StorageNode.js';
import { BillingRecordModel } from '../src/db/models/BillingRecord.js';
import { CreditModel } from '../src/db/models/Credit.js';
import { createToken } from '../src/services/auth.js';
import { generateInvoiceForUser } from '../src/services/billing.js';
import { getDB } from '../src/db/index.js';

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

async function createAdminUser() {
  const user = await UserModel.create({
    email: 'admin@example.com',
    password_hash: 'x',
    plan: 'free', // admin status is independent of billing plan
    is_admin: true,
    email_verified: true,
  });
  const token = createToken(user._id.toString(), user.email, user.plan);
  return { user, token };
}

async function createRegularUser(email = 'user@example.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email, password: 'ValidPass1' },
  });
  return res.json(); // { id, token, email, plan }
}

function get(url, headers = {}) {
  return app.inject({ method: 'GET', url, headers });
}
function patch(url, payload, headers = {}) {
  return app.inject({ method: 'PATCH', url, payload, headers });
}
function post(url, payload, headers = {}) {
  return app.inject({ method: 'POST', url, payload, headers });
}

// ─── GET /api/v1/admin/users ─────────────────────────────────────────────────

describe('GET /api/v1/admin/users', () => {
  it('returns a list of users for an admin', async () => {
    const { token } = await createAdminUser();
    await createRegularUser();

    const res = await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createRegularUser();
    const res = await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for a plan: enterprise user that is not an admin', async () => {
    // Enterprise used to be treated as an admin plan — that conflation is removed.
    // Billing plan and admin role are now fully independent.
    const user = await UserModel.create({
      email: 'enterprise@example.com',
      password_hash: 'x',
      plan: 'enterprise',
      email_verified: true,
    });
    const token = createToken(user._id.toString(), user.email, 'enterprise');

    const res = await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await get('/api/v1/admin/users');
    expect(res.statusCode).toBe(401);
  });

  it('each user entry includes id, email, plan, is_admin, and active fields', async () => {
    const { token } = await createAdminUser();
    await createRegularUser();

    const { users } = (await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` })).json();
    const regular = users.find(u => u.email === 'user@example.com');
    expect(regular).toBeDefined();
    expect(regular.id).toBeTruthy();
    expect(regular.email).toBeTruthy();
    expect(regular.active).toBe(true);
    expect(regular.is_admin).toBe(false);
  });
});

// ─── PATCH /api/v1/admin/users/:userId ───────────────────────────────────────

async function seedPlan(plan, storageGb) {
  await QuotaModel.create({ plan, storage_gb: storageGb, monthly_transfer_gb: storageGb * 10 });
}

describe('PATCH /api/v1/admin/users/:userId', () => {
  it('updates a user\'s plan', async () => {
    await seedPlan('starter', 100);
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await patch(
      `/api/v1/admin/users/${id}`,
      { plan: 'starter' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toBe('starter');

    // Verify the change persisted in DB
    const updated = await UserModel.findById(id);
    expect(updated.plan).toBe('starter');
  });

  it('rejects a plan with no matching quota', async () => {
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await patch(
      `/api/v1/admin/users/${id}`,
      { plan: 'not-a-real-plan' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(400);

    // Plan is unchanged
    const unchanged = await UserModel.findById(id);
    expect(unchanged.plan).toBe('free');
  });

  it('resizes the user\'s bucket quota to match the new plan', async () => {
    await StorageNodeModel.create({ name: 'test-node', endpoint: 'http://minio.test:9000', capacity_total_bytes: 1024 ** 4 });
    await seedPlan('free', 0.5); // signup provisions a bucket against whatever the free plan's quota is
    await seedPlan('house', 50000); // 50TB, e.g. an unbilled internal account
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const before = await BucketModel.findByUserId(id);
    expect(before).toBeTruthy(); // signup auto-provisions a bucket

    await patch(
      `/api/v1/admin/users/${id}`,
      { plan: 'house' },
      { Authorization: `Bearer ${token}` },
    );

    const after = await BucketModel.findByUserId(id);
    expect(after.quota_bytes).toBe(50000 * 1024 ** 3);
  });

  it('can deactivate a user', async () => {
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await patch(
      `/api/v1/admin/users/${id}`,
      { active: false },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);
  });

  it('returns 404 for an unknown user id', async () => {
    const { token } = await createAdminUser();
    const res = await patch(
      '/api/v1/admin/users/000000000000000000000000',
      { active: false },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a regular user', async () => {
    const { token } = await createRegularUser('a@example.com');
    const { id } = await createRegularUser('b@example.com');

    const res = await patch(
      `/api/v1/admin/users/${id}`,
      { plan: 'starter' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const { id } = await createRegularUser();
    const res = await patch(`/api/v1/admin/users/${id}`, { plan: 'starter' });
    expect(res.statusCode).toBe(401);
  });

  it('can promote a regular user to admin via is_admin', async () => {
    const { token: adminToken } = await createAdminUser();
    const { id, token: userToken } = await createRegularUser();

    const res = await patch(
      `/api/v1/admin/users/${id}`,
      { is_admin: true },
      { Authorization: `Bearer ${adminToken}` },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().is_admin).toBe(true);

    // Takes effect immediately on their existing token — no new login required,
    // because admin status is checked against the database, not the JWT's plan claim.
    const promoted = await get('/api/v1/admin/users', { Authorization: `Bearer ${userToken}` });
    expect(promoted.statusCode).toBe(200);
  });

  it('revokes admin access immediately, without waiting for the token to expire', async () => {
    const { user, token } = await createAdminUser();

    const before = await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` });
    expect(before.statusCode).toBe(200);

    await UserModel.update(user._id.toString(), { is_admin: false });

    // Same still-valid token, but the database now says they're not an admin.
    const after = await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` });
    expect(after.statusCode).toBe(403);
  });

  it('rejects an invalid suspension_override value', async () => {
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await patch(
      `/api/v1/admin/users/${id}`,
      { suspension_override: 'banned' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(400);
  });

  it('can force-suspend a user via suspension_override, reflected in the user list', async () => {
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const patchRes = await patch(
      `/api/v1/admin/users/${id}`,
      { suspension_override: 'suspended' },
      { Authorization: `Bearer ${token}` },
    );
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().suspension_override).toBe('suspended');

    const { users } = (await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` })).json();
    const forced = users.find(u => u.id === id);
    expect(forced.is_suspended).toBe(true);
  });
});

// ─── GET /api/v1/admin/users/:userId — consolidated client profile ────────────

describe('GET /api/v1/admin/users/:userId', () => {
  it('returns identity, bucket, usage history, and billing in one response', async () => {
    await StorageNodeModel.create({ name: 'test-node', endpoint: 'http://minio.test:9000', capacity_total_bytes: 1024 ** 4 });
    await QuotaModel.create({ plan: 'free', storage_gb: 0.5, monthly_transfer_gb: 5 });

    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await get(`/api/v1/admin/users/${id}`, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.user.email).toBe('user@example.com');
    expect(body.user.plan).toBe('free');
    expect(body.user.is_suspended).toBe(false);
    expect(body.bucket).toBeTruthy();
    expect(body.bucket.quota_bytes).toBe(Math.floor(0.5 * 1024 ** 3));
    expect(body.usage_history).toHaveLength(6);
    expect(body.invoices).toEqual([]);
  });

  it('returns 404 for an unknown user id', async () => {
    const { token } = await createAdminUser();
    const res = await get('/api/v1/admin/users/000000000000000000000000', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a non-admin', async () => {
    const { token } = await createRegularUser();
    const res = await get('/api/v1/admin/users/000000000000000000000000', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /api/v1/admin/users/:userId/credits ──────────────────────────────────

describe('POST /api/v1/admin/users/:userId/credits', () => {
  it('issues a credit, attributed to the issuing admin', async () => {
    const { user: admin, token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await post(
      `/api/v1/admin/users/${id}/credits`,
      { amount_cents: 500, reason: 'goodwill' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().amount_cents).toBe(500);

    const { items } = await CreditModel.listByUser(id);
    expect(items).toHaveLength(1);
    expect(items[0].created_by.toString()).toBe(admin._id.toString());
    expect(items[0].applied_to_invoice_id).toBeNull();
  });

  it('rejects a non-positive amount', async () => {
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();

    const res = await post(
      `/api/v1/admin/users/${id}/credits`,
      { amount_cents: 0 },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for a non-admin', async () => {
    const { token } = await createRegularUser('a@example.com');
    const { id } = await createRegularUser('b@example.com');

    const res = await post(
      `/api/v1/admin/users/${id}/credits`,
      { amount_cents: 500 },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /api/v1/admin/billing/:invoiceId/comp ────────────────────────────────

describe('POST /api/v1/admin/billing/:invoiceId/comp', () => {
  it('comps an invoice and returns the waived amount', async () => {
    const { token } = await createAdminUser();
    const { id } = await createRegularUser();
    await QuotaModel.create({ plan: 'free', storage_gb: 0.5, monthly_transfer_gb: 5, base_monthly_usd: 999 });

    const { record: invoice } = await generateInvoiceForUser(id, '2025-01');

    const res = await post(`/api/v1/admin/billing/${invoice._id.toString()}/comp`, { reason: 'test' }, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().comped_amount_cents).toBe(999);

    const updated = await BillingRecordModel.findById(invoice._id.toString());
    expect(updated.status).toBe('comped');
    expect(updated.total).toBe(0);
  });

  it('returns 404 for an unknown invoice', async () => {
    const { token } = await createAdminUser();
    const res = await post('/api/v1/admin/billing/000000000000000000000000/comp', {}, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a non-admin', async () => {
    const { token } = await createRegularUser();
    const res = await post('/api/v1/admin/billing/000000000000000000000000/comp', {}, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
  });
});
