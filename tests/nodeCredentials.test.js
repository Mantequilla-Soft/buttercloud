import { describe, it, expect } from 'vitest';
import { encryptCredential, decryptCredential, resolveNodeCredentials } from '../src/services/nodeCredentials.js';
import { getMinioClient } from '../src/services/files.js';
import { config } from '../src/config.js';
import { UsageMetricModel } from '../src/db/models/UsageMetric.js';
import { AuditLogModel } from '../src/db/models/AuditLog.js';
import { trackPresign } from '../src/services/usage.js';
import { ObjectId } from 'mongodb';

describe('encryptCredential / decryptCredential', () => {
  it('round-trips a plaintext value', () => {
    const encrypted = encryptCredential('super-secret-key');
    expect(encrypted).not.toContain('super-secret-key');
    expect(decryptCredential(encrypted)).toBe('super-secret-key');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptCredential('same-input');
    const b = encryptCredential('same-input');
    expect(a).not.toBe(b);
    expect(decryptCredential(a)).toBe('same-input');
    expect(decryptCredential(b)).toBe('same-input');
  });
});

describe('resolveNodeCredentials', () => {
  it('falls back to the global MinIO root credentials when a node has none of its own', () => {
    const node = { access_key_encrypted: null, secret_key_encrypted: null };
    expect(resolveNodeCredentials(node)).toEqual({
      accessKey: config.minio.rootUser,
      secretKey: config.minio.rootPassword,
    });
  });

  it('decrypts and returns a node\'s own credentials when present', () => {
    const node = {
      access_key_encrypted: encryptCredential('node-access'),
      secret_key_encrypted: encryptCredential('node-secret'),
    };
    expect(resolveNodeCredentials(node)).toEqual({
      accessKey: 'node-access',
      secretKey: 'node-secret',
    });
  });

  it('gives two differently-configured nodes distinct credentials', () => {
    const nodeA = {
      access_key_encrypted: encryptCredential('access-a'),
      secret_key_encrypted: encryptCredential('secret-a'),
    };
    const nodeB = { access_key_encrypted: null, secret_key_encrypted: null };
    const credsA = resolveNodeCredentials(nodeA);
    const credsB = resolveNodeCredentials(nodeB);
    expect(credsA.accessKey).not.toBe(credsB.accessKey);
  });
});

describe('getMinioClient + presignedGetObject (issue #3 plumbing)', () => {
  it('signs a presigned URL using a node\'s own credentials, not the global ones', async () => {
    const node = {
      endpoint: 'http://minio-node-a.internal:9000',
      access_key_encrypted: encryptCredential('node-a-access'),
      secret_key_encrypted: encryptCredential('node-a-secret'),
    };
    const client = getMinioClient(node);
    const url = await client.presignedGetObject('some-bucket', 'videos/clip.ts', 3600);

    expect(url).toContain('minio-node-a.internal');
    expect(url).toContain('/some-bucket/videos/clip.ts');
    expect(url).toContain('X-Amz-Credential=node-a-access');
  });

  it('produces a different signature for a node with different credentials', async () => {
    const nodeA = {
      endpoint: 'http://minio.internal:9000',
      access_key_encrypted: encryptCredential('access-a'),
      secret_key_encrypted: encryptCredential('secret-a'),
    };
    const nodeB = {
      endpoint: 'http://minio.internal:9000',
      access_key_encrypted: encryptCredential('access-b'),
      secret_key_encrypted: encryptCredential('secret-b'),
    };
    const urlA = await getMinioClient(nodeA).presignedGetObject('bucket', 'key', 3600);
    const urlB = await getMinioClient(nodeB).presignedGetObject('bucket', 'key', 3600);

    const sigA = new URL(urlA).searchParams.get('X-Amz-Signature');
    const sigB = new URL(urlB).searchParams.get('X-Amz-Signature');
    expect(sigA).not.toBe(sigB);
  });

  it('falls back to the global root credentials for a node with none configured', async () => {
    const node = { endpoint: 'http://minio.internal:9000', access_key_encrypted: null, secret_key_encrypted: null };
    const url = await getMinioClient(node).presignedGetObject('bucket', 'key', 3600);
    expect(url).toContain(`X-Amz-Credential=${config.minio.rootUser}`);
  });
});

describe('trackPresign', () => {
  it('increments the request counter and logs a correctly-labeled audit entry', async () => {
    const userId = new ObjectId().toString();
    const now = new Date();
    const month = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

    await trackPresign(userId, 'my-bucket', 'videos/clip.ts');

    const metric = await UsageMetricModel.findByUserAndMonth(userId, month);
    expect(metric.request_count).toBe(1);

    const logs = await AuditLogModel.listByUser(userId, 10, 0);
    expect(logs.items[0]).toMatchObject({
      action: 'presign',
      resource_type: 'object',
      resource_name: 'my-bucket/videos/clip.ts',
      result: 'success',
    });
  });
});
