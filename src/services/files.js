import * as Minio from 'minio';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { MultipartUploadModel } from '../db/models/MultipartUpload.js';
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

// ─── Chunked uploads ──────────────────────────────────────────────────────────
// The dashboard uploads large files part by part (see the /api/v1/files/multipart
// routes) because Cloudflare in front of the API rejects any single request body
// over 100 MB. These wrap the minio SDK's multipart calls. Note the SDK is
// inconsistent about escaping: listParts/completeMultipartUpload escape the
// uploadId themselves, uploadPart/abortMultipartUpload drop it into the query
// string raw — so those two get it pre-escaped here.

export async function startMultipartUpload(bucketName, key, contentType) {
  const { client } = await getBucketAndNode(bucketName);
  return client.initiateNewMultipartUpload(bucketName, key, {
    'Content-Type': contentType || 'application/octet-stream',
  });
}

// `data` must be a Buffer: the SDK needs the full body up front to set
// Content-Length (and, against an http storage node, to sign its sha256).
export async function uploadMultipartPart(bucketName, key, uploadId, partNumber, data) {
  const { client } = await getBucketAndNode(bucketName);
  const { etag } = await client.uploadPart(
    { bucketName, objectName: key, uploadID: encodeURIComponent(uploadId), partNumber, headers: {} },
    data
  );
  return etag;
}

export async function listMultipartParts(bucketName, key, uploadId) {
  const { client } = await getBucketAndNode(bucketName);
  return client.listParts(bucketName, key, uploadId); // [{ part, etag, size }]
}

export async function completeMultipartUpload(bucketName, key, uploadId, parts) {
  const { client } = await getBucketAndNode(bucketName);
  await client.completeMultipartUpload(bucketName, key, uploadId, parts);
}

export async function abortMultipartUpload(bucketName, key, uploadId) {
  const { client } = await getBucketAndNode(bucketName);
  await client.abortMultipartUpload(bucketName, key, encodeURIComponent(uploadId));
}

// Parts of an upload that's never completed or aborted (tab closed, laptop slept)
// sit on the storage node taking space without showing up in the bucket listing
// or anyone's usage. Run periodically from startServer. A record is only dropped
// once the storage node confirms the upload is gone, so an unreachable node just
// means it's retried on the next sweep.
export async function abortStaleMultipartUploads(maxAgeMs = 24 * 60 * 60 * 1000) {
  const stale = await MultipartUploadModel.listOlderThan(new Date(Date.now() - maxAgeMs));
  let aborted = 0;
  for (const upload of stale) {
    try {
      await abortMultipartUpload(upload.bucket_name, upload.key, upload.upload_id);
    } catch (err) {
      if (err.code !== 'NoSuchUpload') {
        console.warn(`Failed to abort stale upload ${upload.upload_id}:`, err.message);
        continue;
      }
    }
    await MultipartUploadModel.delete(upload._id.toString());
    aborted++;
  }
  return aborted;
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
