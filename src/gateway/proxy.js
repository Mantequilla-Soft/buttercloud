import axios from 'axios';
import aws4 from 'aws4';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { resolveNodeCredentials } from '../services/nodeCredentials.js';

// Buckets are created on the storage node with this region (see
// services/files.js's getMinioClient) — node.region is a separate,
// Buttercloud-internal routing label ("default", etc.), not a SigV4 region,
// and must never be used here.
const STORAGE_NODE_SIGNING_REGION = 'us-east-1';

/**
 * Proxy S3 request to the appropriate MinIO node
 */
export async function proxyToMinIO(request, bucketName) {
  // Find the MinIO node that owns this bucket
  const bucket = await BucketModel.findByName(bucketName);
  if (!bucket) {
    const error = new Error('Bucket not found');
    error.code = 'NoSuchBucket';
    error.statusCode = 404;
    throw error;
  }

  // Get the storage node
  const node = await StorageNodeModel.findById(bucket.node_id.toString());
  if (!node) {
    const error = new Error('Storage node not found');
    error.code = 'InternalError';
    error.statusCode = 500;
    throw error;
  }

  // Re-sign the request with this node's own admin credentials (falls back to the
  // global MinIO root credentials for nodes that don't have their own — see
  // services/nodeCredentials.js).
  //
  // The node is a plain S3-compatible backend (MinIO/Garage/Ceph) and only
  // understands AWS SigV4 — it has no notion of Buttercloud's per-account API
  // keys, so the client's own Authorization header is meaningless to it and
  // must be replaced, not forwarded. This used to pass accessKey/secretKey as
  // `auth: { username, password }`, which makes axios send HTTP Basic auth —
  // not a SigV4 signature — hence every proxied request bouncing off the node
  // with "the authorization mechanism you have provided is not supported."
  const { accessKey, secretKey } = resolveNodeCredentials(node);
  const signed = signForNode(node, accessKey, secretKey, request.method, request.url, buildProxyHeaders(request));
  const minioUrl = `${new URL(node.endpoint).origin}${signed.path}`;

  try {
    // Forward the request to MinIO. responseType: 'stream' is the key piece here —
    // without it axios buffers the entire object body into memory (response.data)
    // before we see any of it, which is unworkable for multi-GB video objects under
    // concurrent requests. With it, response.data is a Node Readable we pipe straight
    // through to the client via reply.send(), so memory use stays flat regardless of
    // object size.
    //
    // `timeout` here only bounds the time to receive response headers (axios clears
    // it via handleResponse once headers arrive). After that, Node's underlying
    // socket timeout takes over, which is activity-based — it resets on every chunk
    // received, so a large object that's actively streaming (even slowly) is never
    // killed by it. Only a backend that never responds, or a transfer that stalls
    // completely for the full duration, trips it.
    const response = await axios({
      method: request.method,
      url: minioUrl,
      headers: signed.headers,
      data: request.body,
      validateStatus: () => true, // Don't throw on any status code
      maxRedirects: 0,
      timeout: 30000,
      responseType: 'stream',
    });

    return {
      status: response.status,
      headers: response.headers,
      body: response.data,
    };
  } catch (error) {
    console.error('MinIO proxy error:', error.message);
    throw {
      code: 'InternalError',
      message: 'Failed to proxy request to storage',
      statusCode: 500,
    };
  }
}

/**
 * Build headers for proxying to MinIO
 * Remove hop-by-hop headers and auth headers, keep everything else
 */
function buildProxyHeaders(request) {
  const headers = { ...request.headers };

  // Remove hop-by-hop headers
  const hopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
  ];

  hopHeaders.forEach(header => {
    delete headers[header];
  });

  // Remove the original Authorization header
  delete headers.authorization;

  // content-length is left as-is from the original request: request.body is the same
  // bytes the client sent (now a raw stream for most content-types — see the
  // catch-all content-type parser in server.js), so its length hasn't changed. It
  // can't be recomputed from request.body itself once that's a stream.

  return headers;
}

/**
 * Re-sign a request for a storage node with that node's own SigV4 credentials.
 *
 * The node is a plain S3-compatible backend — it only understands AWS SigV4, not
 * Buttercloud's per-account API keys, so whatever Authorization header the caller
 * had (if any) must be replaced here, not forwarded.
 */
function signForNode(node, accessKey, secretKey, method, pathWithQuery, headers = {}) {
  const nodeOrigin = new URL(node.endpoint);

  headers.host = nodeOrigin.host; // must match the node, not the gateway's public hostname — signature and wire request both depend on it
  headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD'; // body may be streamed through unbuffered, so it can't be hashed
  delete headers.authorization;
  delete headers['x-amz-date']; // this signature gets its own fresh timestamp, independent of any caller-supplied one

  return aws4.sign(
    {
      method,
      host: nodeOrigin.host,
      path: pathWithQuery,
      service: 's3',
      region: STORAGE_NODE_SIGNING_REGION,
      headers,
    },
    { accessKeyId: accessKey, secretAccessKey: secretKey }
  );
}

/**
 * HEAD an object in MinIO to retrieve its content-length.
 * Returns 0 on any error (used for usage tracking — never blocks the caller).
 */
export async function headObjectInMinIO(bucketName, objectKey) {
  try {
    const bucket = await BucketModel.findByName(bucketName);
    if (!bucket) return 0;
    const node = await StorageNodeModel.findById(bucket.node_id.toString());
    if (!node) return 0;

    const { accessKey, secretKey } = resolveNodeCredentials(node);
    const path = `/${bucketName}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
    const signed = signForNode(node, accessKey, secretKey, 'HEAD', path);
    const response = await axios({
      method: 'HEAD',
      url: `${new URL(node.endpoint).origin}${signed.path}`,
      headers: signed.headers,
      validateStatus: () => true,
      timeout: 10000,
    });
    return parseInt(response.headers['content-length'] || '0');
  } catch {
    return 0;
  }
}

/**
 * Get bucket ownership info for routing
 */
export async function getBucketOwner(bucketName) {
  const bucket = await BucketModel.findByName(bucketName);
  return bucket ? bucket.user_id.toString() : null;
}

/**
 * Check if bucket exists and user owns it
 */
export async function validateBucketOwnership(bucketName, userId) {
  const bucket = await BucketModel.findByName(bucketName);

  if (!bucket) {
    const error = new Error('Bucket not found');
    error.code = 'NoSuchBucket';
    error.statusCode = 404;
    throw error;
  }

  if (bucket.user_id.toString() !== userId) {
    const error = new Error('Access denied');
    error.code = 'AccessDenied';
    error.statusCode = 403;
    throw error;
  }

  return bucket;
}
