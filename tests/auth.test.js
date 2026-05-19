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
  // Wipe all collections between tests for full isolation
  const db = getDB();
  const colls = await db.listCollections().toArray();
  await Promise.all(colls.map(c => db.collection(c.name).deleteMany({})));
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const EMAIL = 'user@example.com';
const PASSWORD = 'ValidPass1';

function post(url, payload, headers = {}) {
  return app.inject({ method: 'POST', url, payload, headers });
}

async function createAndLoginUser(email = EMAIL, password = PASSWORD) {
  const res = await post('/api/v1/auth/signup', { email, password });
  return res.json(); // { token, id, email, ... }
}

async function getForgotToken(email = EMAIL) {
  await createAndLoginUser(email);
  await post('/api/v1/auth/forgot-password', { email });
  const user = await UserModel.findByEmail(email);
  return user.reset_token;
}

// ─── signup ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/signup', () => {
  it('creates a user and returns a JWT', async () => {
    const res = await post('/api/v1/auth/signup', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.email).toBe(EMAIL);
  });

  it('rejects a duplicate email', async () => {
    await post('/api/v1/auth/signup', { email: EMAIL, password: PASSWORD });
    const res = await post('/api/v1/auth/signup', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a weak password (no uppercase)', async () => {
    const res = await post('/api/v1/auth/signup', { email: EMAIL, password: 'weakpass1' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await post('/api/v1/auth/signup', { email: EMAIL, password: 'Ab1' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing email field', async () => {
    const res = await post('/api/v1/auth/signup', { password: PASSWORD });
    expect(res.statusCode).toBe(400);
  });
});

// ─── login ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('returns a token on valid credentials', async () => {
    await createAndLoginUser();
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('returns 401 for the wrong password', async () => {
    await createAndLoginUser();
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: 'WrongPass1' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an unknown email', async () => {
    const res = await post('/api/v1/auth/login', { email: 'nobody@example.com', password: PASSWORD });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when email is missing', async () => {
    const res = await post('/api/v1/auth/login', { password: PASSWORD });
    expect(res.statusCode).toBe(400);
  });
});

// ─── forgot password ─────────────────────────────────────────────────────────

describe('POST /api/v1/auth/forgot-password', () => {
  it('returns 200 for a non-existent email (no enumeration leak)', async () => {
    const res = await post('/api/v1/auth/forgot-password', { email: 'nobody@example.com' });
    expect(res.statusCode).toBe(200);
  });

  it('sets a reset_token and expiry on the user when email exists', async () => {
    await createAndLoginUser();
    await post('/api/v1/auth/forgot-password', { email: EMAIL });
    const user = await UserModel.findByEmail(EMAIL);
    expect(user.reset_token).toBeTruthy();
    expect(user.reset_token_expires).toBeInstanceOf(Date);
    expect(user.reset_token_expires.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns 400 when email field is missing', async () => {
    const res = await post('/api/v1/auth/forgot-password', {});
    expect(res.statusCode).toBe(400);
  });
});

// ─── reset password ───────────────────────────────────────────────────────────

describe('POST /api/v1/auth/reset-password', () => {
  it('returns 200 and clears the token on success', async () => {
    const token = await getForgotToken();
    const res = await post('/api/v1/auth/reset-password', { token, new_password: 'NewPass123' });
    expect(res.statusCode).toBe(200);
    const user = await UserModel.findByEmail(EMAIL);
    expect(user.reset_token).toBeNull();
    expect(user.reset_token_expires).toBeNull();
  });

  it('allows login with the new password after a reset', async () => {
    const token = await getForgotToken();
    await post('/api/v1/auth/reset-password', { token, new_password: 'NewPass123' });
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: 'NewPass123' });
    expect(res.statusCode).toBe(200);
  });

  it('the old password no longer works after reset', async () => {
    const token = await getForgotToken();
    await post('/api/v1/auth/reset-password', { token, new_password: 'NewPass123' });
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for an invalid token', async () => {
    const res = await post('/api/v1/auth/reset-password', { token: 'not-a-real-token', new_password: 'NewPass123' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_token');
  });

  it('returns 400 for an expired token', async () => {
    const token = await getForgotToken();
    await UserModel.update((await UserModel.findByEmail(EMAIL))._id.toString(), {
      reset_token_expires: new Date(Date.now() - 1000),
    });
    const res = await post('/api/v1/auth/reset-password', { token, new_password: 'NewPass123' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('token_expired');
  });

  it('cannot reuse a token that was already consumed', async () => {
    const token = await getForgotToken();
    await post('/api/v1/auth/reset-password', { token, new_password: 'NewPass123' });
    const res = await post('/api/v1/auth/reset-password', { token, new_password: 'AnotherPass456' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a weak new password', async () => {
    const token = await getForgotToken();
    const res = await post('/api/v1/auth/reset-password', { token, new_password: 'weak' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('weak_password');
  });
});

// ─── change password ──────────────────────────────────────────────────────────

describe('POST /api/v1/auth/change-password', () => {
  it('returns 200 when current password is correct', async () => {
    const { token } = await createAndLoginUser();
    const res = await post(
      '/api/v1/auth/change-password',
      { current_password: PASSWORD, new_password: 'UpdatedPass1' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(200);
  });

  it('allows login with the new password after change', async () => {
    const { token } = await createAndLoginUser();
    await post(
      '/api/v1/auth/change-password',
      { current_password: PASSWORD, new_password: 'UpdatedPass1' },
      { Authorization: `Bearer ${token}` },
    );
    const res = await post('/api/v1/auth/login', { email: EMAIL, password: 'UpdatedPass1' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when the current password is wrong', async () => {
    const { token } = await createAndLoginUser();
    const res = await post(
      '/api/v1/auth/change-password',
      { current_password: 'WrongPass1', new_password: 'UpdatedPass1' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('wrong_password');
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await post('/api/v1/auth/change-password', {
      current_password: PASSWORD,
      new_password: 'UpdatedPass1',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a weak new password', async () => {
    const { token } = await createAndLoginUser();
    const res = await post(
      '/api/v1/auth/change-password',
      { current_password: PASSWORD, new_password: 'weak' },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('weak_password');
  });
});
