import * as Minio from 'minio';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { config } from '../config.js';
import { resolveNodeCredentials } from './nodeCredentials.js';

export function getMinioClient(node) {
  const endpoint = node ? node.endpoint : config.minio.internalEndpoint;
  const url = new URL(endpoint);
  const { accessKey, secretKey } = resolveNodeCredentials(node);
  return new Minio.Client({
    endPoint: url.hostname,
    port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
    accessKey,
    secretKey,
    // Every bucket here is created with 'us-east-1' (see createBucketInMinIO /
    // migration.js) — setting it explicitly skips the SDK's own getBucketRegion()
    // network round-trip on every call, including presignedGetObject.
    region: 'us-east-1',
  });
}

async function getBucketAndNode(bucketName) {
  const bucket = await BucketModel.findByName(bucketName);
  if (!bucket) {
    const err = new Error('Bucket not found');
    err.statusCode = 404;
    throw err;
  }
  const node = await StorageNodeModel.findById(bucket.node_id.toString());
  if (!node) {
    const err = new Error('Storage node not found');
    err.statusCode = 500;
    throw err;
  }
  return { bucket, node, client: getMinioClient(node) };
}

export async function createBucketInMinIO(bucketName, node) {
  const client = getMinioClient(node);
  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    await client.makeBucket(bucketName, 'us-east-1');
  }
}

export async function listFiles(bucketName, prefix = '') {
  const { client } = await getBucketAndNode(bucketName);

  return new Promise((resolve, reject) => {
    const files = [];
    const folders = new Set();

    const stream = client.listObjectsV2(bucketName, prefix, false);

    stream.on('data', (obj) => {
      if (obj.prefix) {
        folders.add(obj.prefix);
      } else if (obj.name && !obj.name.endsWith('/')) {
        // Skip zero-byte folder marker objects (key ends with /)
        files.push({
          kind: 'file',
          key: obj.name,
          name: obj.name.split('/').pop(),
          size: obj.size,
          modified: obj.lastModified,
        });
      }
    });

    stream.on('error', (err) => {
      err.statusCode = 500;
      reject(err);
    });

    stream.on('end', () => {
      resolve({
        files,
        folders: [...folders].map((p) => ({
          kind: 'folder',
          key: p,
          name: p.replace(prefix, '').replace(/\/$/, ''),
        })),
      });
    });
  });
}

export async function downloadFile(bucketName, key) {
  const { client } = await getBucketAndNode(bucketName);

  const stat = await client.statObject(bucketName, key);
  const stream = await client.getObject(bucketName, key);

  return {
    stream,
    size: stat.size,
    contentType: stat.metaData?.['content-type'] || 'application/octet-stream',
  };
}

// `data` is a Buffer or a Readable stream — the minio SDK handles either, and for
// a stream with no known size (the dashboard's multipart upload path) it transparently
// does a chunked multipart upload instead of requiring the whole thing in memory first.
export async function uploadFile(bucketName, key, data, contentType) {
  const { client } = await getBucketAndNode(bucketName);

  await client.putObject(bucketName, key, data, {
    'Content-Type': contentType || 'application/octet-stream',
  });

  // Only meaningful when `data` is a Buffer — a stream's size isn't known here;
  // callers streaming a file track the actual byte count themselves as it flows.
  return { key, size: Buffer.isBuffer(data) ? data.length : undefined };
}

export async function statFile(bucketName, key) {
  const { client } = await getBucketAndNode(bucketName);
  try {
    const stat = await client.statObject(bucketName, key);
    return { size: stat.size, contentType: stat.metaData?.['content-type'] };
  } catch {
    return null;
  }
}

export async function deleteFile(bucketName, key) {
  const { client } = await getBucketAndNode(bucketName);
  await client.removeObject(bucketName, key);
  return { deleted: true };
}
