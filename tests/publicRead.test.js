import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import { createServer } from '../src/server.js';
import { UserModel } from '../src/db/models/User.js';
import { BucketModel } from '../src/db/models/Bucket.js';
import { StorageNodeModel } from '../src/db/models/StorageNode.js';
import { createToken } from '../src/services/auth.js';
import { getDB } from '../src/db/index.js';

// A stand-in storage node: records every request it gets and answers like an S3
// backend would for a small HLS playlist and a .ts segment.
const PLAYLIST = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480p/index.m3u8\n';
const SEGMENT = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

let app;
let fakeNode;
let nodeEndpoint;
let received = [];

beforeAll(async () => {
  fakeNode = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url, headers: req.headers });
    const path = req.url.split('?')[0];
    if (path.endsWith('/manifest.m3u8')) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': Buffer.byteLength(PLAYLIST),
        ETag: '"playlist-etag"',
      });
      return res.end(req.method === 'HEAD' ? undefined : PLAYLIST);
    }
    if (path.endsWith('.ts')) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (range) {
        const [start, end] = [Number(range[1]), Number(range[2])];
        const chunk = SEGMENT.subarray(start, end + 1);
        res.writeHead(206, {
          'Content-Type': 'video/mp2t',
          'Content-Length': chunk.length,
          'Content-Range': `bytes ${start}-${end}/${SEGMENT.length}`,
        });
        return res.end(chunk);
      }
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': SEGMENT.length });
      return res.end(req.method === 'HEAD' ? undefined : SEGMENT);
    }
    res.writeHead(404, { 'Content-Type': 'application/xml' });
    res.end('<Error><Code>NoSuchKey</Code></Error>');
  });
  await new Promise(resolve => fakeNode.listen(0, '127.0.0.1', resolve));
  nodeEndpoint = `http://127.0.0.1:${fakeNode.address().port}`;

  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise(resolve => fakeNode.close(resolve));
});

afterEach(async () => {
  received = [];
  const db = getDB();
  const colls = await db.listCollections().toArray();
  await Promise.all(colls.map(c => db.collection(c.name).deleteMany({})));
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function createBucket(name, { publicRead = false, ownerActive = true } = {}) {
  const owner = await UserModel.create({
    email: `${name}@example.com`, password_hash: 'x', plan: 'house', email_verified: true,
  });
  if (!ownerActive) await UserModel.update(owner._id.toString(), { active: false });
  const node = await StorageNodeModel.create({
    name: `node-${name}`, endpoint: nodeEndpoint, capacity_total_bytes: 10 ** 12,
  });
  const bucket = await BucketModel.create({
    user_id: owner._id, bucket_name: name, node_id: node._id, quota_bytes: 10 ** 12,
  });
  if (publicRead) await BucketModel.update(bucket._id.toString(), { public_read: true });
  return bucket;
}

async function adminToken() {
  const admin = await UserModel.create({
    email: 'admin@example.com', password_hash: 'x', plan: 'free', is_admin: true, email_verified: true,
  });
  return createToken(admin._id.toString(), admin.email, admin.plan);
}

// ─── unsigned reads on a public_read bucket ──────────────────────────────────

describe('unsigned GET/HEAD on a public_read bucket', () => {
  it('serves an object with the Content-Type the node returns', async () => {
    await createBucket('videos', { publicRead: true });

    const res = await app.inject({ method: 'GET', url: '/videos/QmCid/manifest.m3u8' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(res.headers.etag).toBe('"playlist-etag"');
    expect(res.body).toBe(PLAYLIST);
  });

  it('passes Range through and returns 206 with Content-Range', async () => {
    await createBucket('videos', { publicRead: true });

    const res = await app.inject({
      method: 'GET', url: '/videos/QmCid/480p/480p_0.ts', headers: { Range: 'bytes=0-99' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-99/${SEGMENT.length}`);
    expect(res.rawPayload.length).toBe(100);
    expect(res.rawPayload.equals(SEGMENT.subarray(0, 100))).toBe(true);
  });

  it('answers HEAD with the object headers', async () => {
    await createBucket('videos', { publicRead: true });

    const res = await app.inject({ method: 'HEAD', url: '/videos/QmCid/480p/480p_0.ts' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(SEGMENT.length));
    expect(received[0].method).toBe('HEAD');
  });

  it('adds CORS headers for a cross-origin player', async () => {
    await createBucket('videos', { publicRead: true });

    const res = await app.inject({
      method: 'GET', url: '/videos/QmCid/manifest.m3u8', headers: { Origin: 'https://3speak.tv' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('signs for the node itself, drops the query string and unlisted headers', async () => {
    await createBucket('videos', { publicRead: true });

    await app.inject({
      method: 'GET',
      url: '/videos/QmCid/manifest.m3u8?acl&response-content-type=text/html',
      headers: { 'x-amz-request-payer': 'requester', cookie: 'session=abc', 'if-none-match': '"x"' },
    });
    expect(received).toHaveLength(1);
    const seen = received[0];
    expect(seen.url).toBe('/videos/QmCid/manifest.m3u8');
    expect(seen.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(seen.headers['x-amz-request-payer']).toBeUndefined();
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.headers['if-none-match']).toBe('"x"');
  });

  it('answers with an S3 error when the storage node is unreachable', async () => {
    const bucket = await createBucket('videos', { publicRead: true });
    const dead = await StorageNodeModel.create({
      name: 'dead-node', endpoint: 'http://127.0.0.1:1', capacity_total_bytes: 10 ** 12,
    });
    await BucketModel.update(bucket._id.toString(), { node_id: dead._id });

    const res = await app.inject({ method: 'GET', url: '/videos/QmCid/manifest.m3u8' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.body).toContain('<Code>InternalError</Code>');
  });

  it('passes a missing object through as the node 404', async () => {
    await createBucket('videos', { publicRead: true });

    const res = await app.inject({ method: 'GET', url: '/videos/QmCid/nope.txt' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── what stays closed ───────────────────────────────────────────────────────

describe('what a public_read bucket still refuses without a signature', () => {
  it('refuses listing the bucket', async () => {
    await createBucket('videos', { publicRead: true });

    for (const url of ['/videos', '/videos/', '/videos?list-type=2']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(403);
    }
    expect(received).toHaveLength(0);
  });

  it('refuses PUT, DELETE and POST on objects', async () => {
    await createBucket('videos', { publicRead: true });

    for (const method of ['PUT', 'DELETE', 'POST']) {
      const res = await app.inject({ method, url: '/videos/QmCid/manifest.m3u8', payload: 'x' });
      expect(res.statusCode).toBe(403);
    }
    expect(received).toHaveLength(0);
  });

  it('refuses reads when the owner account is deactivated', async () => {
    await createBucket('videos', { publicRead: true, ownerActive: false });

    const res = await app.inject({ method: 'GET', url: '/videos/QmCid/manifest.m3u8' });
    expect(res.statusCode).toBe(403);
    expect(received).toHaveLength(0);
  });

  it('never proxies an unsigned read on a bucket without the flag', async () => {
    await createBucket('private-videos');

    const res = await app.inject({ method: 'GET', url: '/private-videos/QmCid/manifest.m3u8' });
    expect(received).toHaveLength(0);
    expect(res.body).not.toBe(PLAYLIST);
  });
});

// ─── admin API ───────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/buckets/:bucketId', () => {
  it('lets an admin turn public_read on and off, and lists it', async () => {
    const token = await adminToken();
    const bucket = await createBucket('videos');
    const auth = { Authorization: `Bearer ${token}` };

    let res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/buckets/${bucket._id}`, payload: { public_read: true }, headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().public_read).toBe(true);

    res = await app.inject({ method: 'GET', url: '/api/v1/admin/buckets', headers: auth });
    expect(res.json().buckets.find(b => b.bucket_name === 'videos').public_read).toBe(true);

    res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/buckets/${bucket._id}`, payload: { public_read: false }, headers: auth,
    });
    expect(res.json().public_read).toBe(false);

    res = await app.inject({ method: 'GET', url: '/videos/QmCid/manifest.m3u8' });
    expect(received).toHaveLength(0);
  });

  it('refuses a non-admin', async () => {
    const bucket = await createBucket('videos');
    const user = await UserModel.create({ email: 'u@example.com', password_hash: 'x', plan: 'free', email_verified: true });
    const token = createToken(user._id.toString(), user.email, user.plan);

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/buckets/${bucket._id}`,
      payload: { public_read: true }, headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect((await BucketModel.findById(bucket._id.toString())).public_read).toBe(false);
  });

  it('refuses a non-boolean value', async () => {
    const token = await adminToken();
    const bucket = await createBucket('videos');

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/buckets/${bucket._id}`,
      payload: { public_read: 'yes' }, headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to make a bucket named like a dashboard page public', async () => {
    const token = await adminToken();
    const bucket = await createBucket('files');

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/buckets/${bucket._id}`,
      payload: { public_read: true }, headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });
});
