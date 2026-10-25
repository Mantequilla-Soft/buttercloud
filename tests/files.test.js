import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import FormData from 'form-data';
import { createServer } from '../src/server.js';
import { UserModel } from '../src/db/models/User.js';
import { BucketModel } from '../src/db/models/Bucket.js';
import { QuotaModel } from '../src/db/models/Quota.js';
import { StorageNodeModel } from '../src/db/models/StorageNode.js';
import { getDB } from '../src/db/index.js';

// uploadFile talks to a real storage backend over the network — there's no
// MinIO/Garage running in the test environment (same gap noted elsewhere this
// session: no real S3-backend test harness yet). Mocked here so these tests
// exercise the route handler's own logic (quota enforcement, streaming) rather
// than needing a live backend. The mock drains whatever stream it's given,
// same as a real upload would, so stream errors (e.g. the quota-abort below)
// propagate the same way they would against a real backend.
vi.mock('../src/services/files.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    uploadFile: vi.fn((bucketName, key, data) => {
      return new Promise((resolve, reject) => {
        if (!data || typeof data.on !== 'function') {
          resolve({ key, size: 0 });
          return;
        }
        data.on('data', () => {});
        data.on('end', () => resolve({ key, size: 0 }));
        data.on('error', reject);
      });
    }),
  };
});

const { uploadFile: mockUploadFile } = await import('../src/services/files.js');

let app;

beforeAll(async () => {
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(async () => {
  vi.clearAllMocks();
  const db = getDB();
  const colls = await db.listCollections().toArray();
  await Promise.all(colls.map(c => db.collection(c.name).deleteMany({})));
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const PASSWORD = 'ValidPass1';

async function setupUserWithQuota(storageGb, email = 'files@example.com') {
  await StorageNodeModel.create({ name: 'test-node', endpoint: 'http://minio.test:9000', capacity_total_bytes: 1024 ** 4 });
  await QuotaModel.create({ plan: 'free', storage_gb: storageGb, monthly_transfer_gb: storageGb * 10 });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email, password: PASSWORD },
  });
  const { token, id } = res.json();
  await UserModel.update(id, { email_verified: true });
  return { token, id };
}

function uploadRequest(token, fileContent, filename = 'test.bin') {
  const form = new FormData();
  form.append('file', Buffer.from(fileContent), { filename, contentType: 'application/octet-stream' });
  return app.inject({
    method: 'POST',
    url: '/api/v1/files/upload',
    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
    payload: form.getBuffer(),
  });
}

// ─── POST /api/v1/files/upload ─────────────────────────────────────────────────

describe('POST /api/v1/files/upload', () => {
  it('uploads successfully and records the actual streamed byte count', async () => {
    const { token, id } = await setupUserWithQuota(1); // 1 GB — plenty of room
    const content = 'hello world';

    const res = await uploadRequest(token, content);
    expect(res.statusCode).toBe(200);
    expect(res.json().uploaded[0].size).toBe(Buffer.byteLength(content));

    const bucket = await BucketModel.findByUserId(id);
    expect(bucket.current_usage_bytes).toBe(Buffer.byteLength(content));
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
  });

  it('rejects outright when the bucket is already at or over quota', async () => {
    const { token, id } = await setupUserWithQuota(1);
    const bucket = await BucketModel.findByUserId(id);
    // Precise, not derived from a tiny fractional GB — exactly "full".
    await BucketModel.update(bucket._id.toString(), { quota_bytes: 10, current_usage_bytes: 10 });

    const res = await uploadRequest(token, 'anything');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('upload_failed');
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('aborts mid-upload if the file would exceed remaining quota, without crediting partial usage', async () => {
    const { token, id } = await setupUserWithQuota(1);
    const bucket = await BucketModel.findByUserId(id);
    // 50 bytes of room, 0 used — the 5000-byte file below blows well past it.
    await BucketModel.update(bucket._id.toString(), { quota_bytes: 50, current_usage_bytes: 0 });
    const bigContent = 'x'.repeat(5000);

    const res = await uploadRequest(token, bigContent);
    expect(res.statusCode).toBe(403);

    const after = await BucketModel.findByUserId(id);
    expect(after.current_usage_bytes).toBe(0); // nothing credited for the aborted upload
  });

  it('does not buffer the file into a single in-memory value — streams it', async () => {
    const { token } = await setupUserWithQuota(1);
    await uploadRequest(token, 'streamed-not-buffered');

    // The mock receives a stream, not a pre-materialized Buffer — asserting the
    // route handler is passing a stream through confirms it didn't call
    // part.toBuffer() (the old, fixed behavior) before handing data off.
    const [, , dataArg] = mockUploadFile.mock.calls[0];
    expect(Buffer.isBuffer(dataArg)).toBe(false);
    expect(typeof dataArg.pipe).toBe('function');
  });
});
