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
    // Chunked uploads: a tiny in-memory stand-in for the storage node's view of
    // in-progress uploads, so listMultipartParts reflects what was actually PUT.
    startMultipartUpload: vi.fn(async () => {
      const uploadId = `up-${++fakeUploadSeq}`;
      fakeParts.set(uploadId, new Map());
      return uploadId;
    }),
    uploadMultipartPart: vi.fn(async (bucketName, key, uploadId, partNumber, data) => {
      fakeParts.get(uploadId).set(partNumber, data.length);
      return `etag-${partNumber}`;
    }),
    listMultipartParts: vi.fn(async (bucketName, key, uploadId) =>
      [...(fakeParts.get(uploadId) || new Map())].map(([part, size]) => ({ part, size, etag: `etag-${part}` }))
    ),
    completeMultipartUpload: vi.fn(async () => {}),
    abortMultipartUpload: vi.fn(async (bucketName, key, uploadId) => { fakeParts.delete(uploadId); }),
  };
});

let fakeUploadSeq = 0;
const fakeParts = new Map();

const {
  uploadFile: mockUploadFile,
  startMultipartUpload: mockStart,
  uploadMultipartPart: mockUploadPart,
  completeMultipartUpload: mockComplete,
  abortMultipartUpload: mockAbort,
} = await import('../src/services/files.js');
const { MULTIPART_PART_SIZE } = await import('../src/api/files.js');
const { MultipartUploadModel } = await import('../src/db/models/MultipartUpload.js');

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

// ─── /api/v1/files/multipart (chunked uploads) ─────────────────────────────────

function initRequest(token, size, filename = 'big.bin', prefix = '') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/files/multipart',
    headers: { Authorization: `Bearer ${token}` },
    payload: { filename, prefix, size, contentType: 'video/mp4' },
  });
}

function partRequest(token, uploadId, partNumber, size) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/files/multipart/${encodeURIComponent(uploadId)}/parts/${partNumber}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    payload: Buffer.alloc(size),
  });
}

function completeRequest(token, uploadId) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/files/multipart/${encodeURIComponent(uploadId)}/complete`,
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Two parts: one full-size, one 10-byte tail.
const TWO_PART_SIZE = MULTIPART_PART_SIZE + 10;

describe('/api/v1/files/multipart', () => {
  it('uploads a file in parts and credits its size on completion', async () => {
    const { token, id } = await setupUserWithQuota(1);

    const init = await initRequest(token, TWO_PART_SIZE, 'big.bin', 'videos/');
    expect(init.statusCode).toBe(200);
    const { uploadId, key, partSize, partCount } = init.json();
    expect(key).toBe('videos/big.bin');
    expect(partSize).toBe(MULTIPART_PART_SIZE);
    expect(partCount).toBe(2);

    // Out of order on purpose — the browser sends parts concurrently.
    expect((await partRequest(token, uploadId, 2, 10)).statusCode).toBe(200);
    expect((await partRequest(token, uploadId, 1, MULTIPART_PART_SIZE)).statusCode).toBe(200);

    const done = await completeRequest(token, uploadId);
    expect(done.statusCode).toBe(200);
    expect(done.json().uploaded[0]).toEqual({ filename: 'videos/big.bin', size: TWO_PART_SIZE });

    const storageUploadId = await mockStart.mock.results[0].value;
    expect(mockComplete).toHaveBeenCalledWith(expect.any(String), 'videos/big.bin', storageUploadId, [
      { part: 1, etag: 'etag-1' },
      { part: 2, etag: 'etag-2' },
    ]);
    const bucket = await BucketModel.findByUserId(id);
    expect(bucket.current_usage_bytes).toBe(TWO_PART_SIZE);
    expect(await MultipartUploadModel.findForUser(uploadId, id)).toBeNull();
  });

  it('rejects at init when the declared size exceeds remaining quota', async () => {
    const { token, id } = await setupUserWithQuota(1);
    const bucket = await BucketModel.findByUserId(id);
    await BucketModel.update(bucket._id.toString(), { quota_bytes: 100, current_usage_bytes: 0 });

    const res = await initRequest(token, 101);
    expect(res.statusCode).toBe(403);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('rejects a part whose size does not match its slot', async () => {
    const { token } = await setupUserWithQuota(1);
    const { uploadId } = (await initRequest(token, TWO_PART_SIZE)).json();

    // The tail part must be exactly 10 bytes — anything else would let the
    // assembled object drift from the size quota was checked against.
    const res = await partRequest(token, uploadId, 2, 11);
    expect(res.statusCode).toBe(400);
    expect(mockUploadPart).not.toHaveBeenCalled();

    expect((await partRequest(token, uploadId, 3, 10)).statusCode).toBe(400);
  });

  it("does not let another user touch someone else's upload", async () => {
    const { token } = await setupUserWithQuota(1);
    const { uploadId } = (await initRequest(token, TWO_PART_SIZE)).json();

    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'other@example.com', password: PASSWORD },
    });
    const { token: otherToken, id: otherId } = other.json();
    await UserModel.update(otherId, { email_verified: true });

    expect((await partRequest(otherToken, uploadId, 2, 10)).statusCode).toBe(404);
    expect((await completeRequest(otherToken, uploadId)).statusCode).toBe(404);
    expect(mockUploadPart).not.toHaveBeenCalled();
  });

  it('refuses to complete while parts are missing', async () => {
    const { token, id } = await setupUserWithQuota(1);
    const { uploadId } = (await initRequest(token, TWO_PART_SIZE)).json();
    await partRequest(token, uploadId, 2, 10);

    const res = await completeRequest(token, uploadId);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('incomplete_upload');
    expect(mockComplete).not.toHaveBeenCalled();
    // Still in progress — the client can send the missing part and retry.
    expect(await MultipartUploadModel.findForUser(uploadId, id)).not.toBeNull();
  });

  it('re-checks quota at completion and aborts if usage grew since init', async () => {
    const { token, id } = await setupUserWithQuota(1);
    const { uploadId } = (await initRequest(token, 15)).json(); // single 15-byte part
    await partRequest(token, uploadId, 1, 15);

    const bucket = await BucketModel.findByUserId(id);
    await BucketModel.update(bucket._id.toString(), { quota_bytes: 20, current_usage_bytes: 10 });

    const res = await completeRequest(token, uploadId);
    expect(res.statusCode).toBe(403);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockAbort).toHaveBeenCalledWith(expect.any(String), 'big.bin', await mockStart.mock.results[0].value);
    expect((await BucketModel.findByUserId(id)).current_usage_bytes).toBe(10);
  });

  it('cancels an upload, after which its parts are rejected', async () => {
    const { token } = await setupUserWithQuota(1);
    const { uploadId } = (await initRequest(token, TWO_PART_SIZE)).json();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/files/multipart/${encodeURIComponent(uploadId)}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(mockAbort).toHaveBeenCalledTimes(1);
    expect((await partRequest(token, uploadId, 2, 10)).statusCode).toBe(404);
  });
});
