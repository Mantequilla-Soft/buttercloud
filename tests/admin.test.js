import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { UserModel } from '../src/db/models/User.js';
import { createToken } from '../src/services/auth.js';
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
    plan: 'admin',
    email_verified: true,
  });
  const token = createToken(user._id.toString(), user.email, 'admin');
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

  it('returns 401 without a token', async () => {
    const res = await get('/api/v1/admin/users');
    expect(res.statusCode).toBe(401);
  });

  it('each user entry includes id, email, plan, and active fields', async () => {
    const { token } = await createAdminUser();
    await createRegularUser();

    const { users } = (await get('/api/v1/admin/users', { Authorization: `Bearer ${token}` })).json();
    const regular = users.find(u => u.plan === 'free');
    expect(regular).toBeDefined();
    expect(regular.id).toBeTruthy();
    expect(regular.email).toBeTruthy();
    expect(regular.active).toBe(true);
  });
});

// ─── PATCH /api/v1/admin/users/:userId ───────────────────────────────────────

describe('PATCH /api/v1/admin/users/:userId', () => {
  it('updates a user\'s plan', async () => {
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
      { plan: 'starter' },
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
});
