import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { QuotaModel } from '../src/db/models/Quota.js';
import { UsageMetricModel } from '../src/db/models/UsageMetric.js';
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

const EMAIL = 'usage@example.com';
const PASSWORD = 'ValidPass1';

function get(url, headers = {}) {
  return app.inject({ method: 'GET', url, headers });
}

async function setupUser() {
  // Create a quota plan so /quota and /usage don't throw "Invalid plan"
  await QuotaModel.create({
    plan: 'free',
    storage_gb: 10,
    monthly_transfer_gb: 100,
    base_monthly_usd: 0,
    storage_overage_per_gb_usd: 50,
    transfer_overage_per_gb_usd: 10,
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email: EMAIL, password: PASSWORD },
  });
  const { token, id } = res.json();
  return { token, id };
}

// ─── GET /api/v1/usage ────────────────────────────────────────────────────────

describe('GET /api/v1/usage', () => {
  it('returns zero values when there is no usage data for the month', async () => {
    const { token } = await setupUser();
    const res = await get('/api/v1/usage', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.upload_gb).toBe(0);
    expect(body.download_gb).toBe(0);
    expect(body.request_count).toBe(0);
  });

  it('accepts a month query param', async () => {
    const { token } = await setupUser();
    const res = await get('/api/v1/usage?month=2025-01', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().month).toBe('2025-01');
  });

  it('returns real usage data when a metric record exists', async () => {
    const { token, id } = await setupUser();
    const monthStr = new Date().toISOString().substring(0, 7);
    const metric = await UsageMetricModel.getOrCreate(id, monthStr);
    await getDB().collection('usage_metrics').updateOne(
      { _id: metric._id },
      { $set: { upload_bytes: 2 * 1024 ** 3, download_bytes: 1024 ** 3 } }
    );

    const res = await get('/api/v1/usage', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().upload_gb).toBe(2);
    expect(res.json().download_gb).toBe(1);
  });

  it('returns 401 without a token', async () => {
    const res = await get('/api/v1/usage');
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /api/v1/usage/history ────────────────────────────────────────────────

describe('GET /api/v1/usage/history', () => {
  it('always returns exactly 6 monthly entries', async () => {
    const { token } = await setupUser();
    const res = await get('/api/v1/usage/history', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().history).toHaveLength(6);
  });

  it('all entries have a valid YYYY-MM month string', async () => {
    const { token } = await setupUser();
    const { history } = (await get('/api/v1/usage/history', { Authorization: `Bearer ${token}` })).json();
    for (const entry of history) {
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('entries are in ascending chronological order (oldest first)', async () => {
    const { token } = await setupUser();
    const { history } = (await get('/api/v1/usage/history', { Authorization: `Bearer ${token}` })).json();
    for (let i = 1; i < history.length; i++) {
      expect(history[i].month >= history[i - 1].month).toBe(true);
    }
  });

  it('uses zeros for months with no activity', async () => {
    const { token } = await setupUser();
    const { history } = (await get('/api/v1/usage/history', { Authorization: `Bearer ${token}` })).json();
    // Brand new user — all months should be zero
    for (const entry of history) {
      expect(entry.storage_avg_gb).toBe(0);
      expect(entry.upload_gb).toBe(0);
      expect(entry.download_gb).toBe(0);
    }
  });

  it('reflects real data for the current month', async () => {
    const { token, id } = await setupUser();
    const monthStr = new Date().toISOString().substring(0, 7);
    const metric = await UsageMetricModel.getOrCreate(id, monthStr);
    await getDB().collection('usage_metrics').updateOne(
      { _id: metric._id },
      { $set: { download_bytes: 5 * 1024 ** 3 } }
    );

    const { history } = (await get('/api/v1/usage/history', { Authorization: `Bearer ${token}` })).json();
    const current = history[history.length - 1]; // last entry is current month
    expect(current.download_gb).toBe(5);
  });

  it('returns 401 without a token', async () => {
    const res = await get('/api/v1/usage/history');
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /api/v1/quota ────────────────────────────────────────────────────────

describe('GET /api/v1/quota', () => {
  it('returns plan limits for the current user', async () => {
    const { token } = await setupUser();
    const res = await get('/api/v1/quota', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBe('free');
    expect(body.limits.storage_gb).toBe(10);
    expect(body.limits.monthly_transfer_gb).toBe(100);
  });

  it('returns 401 without a token', async () => {
    const res = await get('/api/v1/quota');
    expect(res.statusCode).toBe(401);
  });
});
