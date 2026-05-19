import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { UserModel } from '../src/db/models/User.js';
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

const EMAIL = 'creds@example.com';
const PASSWORD = 'ValidPass1';

function post(url, payload, headers = {}) {
  return app.inject({ method: 'POST', url, payload, headers });
}
function get(url, headers = {}) {
  return app.inject({ method: 'GET', url, headers });
}
function del(url, headers = {}) {
  return app.inject({ method: 'DELETE', url, headers });
}

async function signupAndVerify(email = EMAIL) {
  const res = await post('/api/v1/auth/signup', { email, password: PASSWORD });
  const { token, id } = res.json();
  // Mark email as verified so credential creation is allowed
  await UserModel.update(id, { email_verified: true });
  return { token, id };
}

async function createCred(token, name = 'my-key') {
  return post('/api/v1/credentials', { name }, { Authorization: `Bearer ${token}` });
}

// ─── list credentials ─────────────────────────────────────────────────────────

describe('GET /api/v1/credentials', () => {
  it('returns an empty list for a new user', async () => {
    const { token } = await signupAndVerify();
    const res = await get('/api/v1/credentials', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().credentials).toHaveLength(0);
  });

  it('lists credentials after creation', async () => {
    const { token } = await signupAndVerify();
    await createCred(token, 'key-one');
    await createCred(token, 'key-two');
    const res = await get('/api/v1/credentials', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().credentials).toHaveLength(2);
  });

  it('does not include secret_key in the list', async () => {
    const { token } = await signupAndVerify();
    await createCred(token);
    const res = await get('/api/v1/credentials', { Authorization: `Bearer ${token}` });
    const cred = res.json().credentials[0];
    expect(cred.secret_key).toBeUndefined();
    expect(cred.access_key).toBeTruthy();
  });

  it('returns 401 without a token', async () => {
    const res = await get('/api/v1/credentials');
    expect(res.statusCode).toBe(401);
  });
});

// ─── create credential ────────────────────────────────────────────────────────

describe('POST /api/v1/credentials', () => {
  it('creates a credential and returns access_key + secret_key', async () => {
    const { token } = await signupAndVerify();
    const res = await createCred(token);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.access_key).toMatch(/^AKIA/);
    expect(body.secret_key).toBeTruthy();
    expect(body.name).toBe('my-key');
  });

  it('returns 400 when name is missing', async () => {
    const { token } = await signupAndVerify();
    const res = await post('/api/v1/credentials', {}, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for an unverified user', async () => {
    // Sign up but do NOT verify email
    const signupRes = await post('/api/v1/auth/signup', { email: 'unverified@example.com', password: PASSWORD });
    const { token } = signupRes.json();
    const res = await post('/api/v1/credentials', { name: 'key' }, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('email_not_verified');
  });

  it('returns 401 without a token', async () => {
    const res = await post('/api/v1/credentials', { name: 'key' });
    expect(res.statusCode).toBe(401);
  });

  it('enforces the 10-credential limit', async () => {
    const { token } = await signupAndVerify();
    // Create 10 credentials
    for (let i = 0; i < 10; i++) {
      const r = await createCred(token, `key-${i}`);
      expect(r.statusCode).toBe(201);
    }
    // 11th should be rejected
    const res = await createCred(token, 'key-11');
    expect(res.statusCode).toBe(400);
  });
});

// ─── delete credential ────────────────────────────────────────────────────────

describe('DELETE /api/v1/credentials/:id', () => {
  it('revokes a credential and returns 204', async () => {
    const { token } = await signupAndVerify();
    const created = await createCred(token);
    const { id } = created.json();

    const res = await del(`/api/v1/credentials/${id}`, { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(204);

    // Credential still appears in the list (audit trail) but is now inactive
    const list = await get('/api/v1/credentials', { Authorization: `Bearer ${token}` });
    const revoked = list.json().credentials.find(c => c.id === id);
    expect(revoked).toBeDefined();
    expect(revoked.active).toBe(false);
  });

  it('returns 403 when trying to delete another user\'s credential', async () => {
    const { token: tokenA } = await signupAndVerify('a@example.com');
    const { token: tokenB } = await signupAndVerify('b@example.com');

    const created = await createCred(tokenA);
    const { id } = created.json();

    // User B tries to delete user A's credential
    const res = await del(`/api/v1/credentials/${id}`, { Authorization: `Bearer ${tokenB}` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown credential id', async () => {
    const { token } = await signupAndVerify();
    const res = await del('/api/v1/credentials/000000000000000000000000', { Authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await del('/api/v1/credentials/000000000000000000000000');
    expect(res.statusCode).toBe(401);
  });
});
