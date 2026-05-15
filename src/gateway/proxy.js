import axios from 'axios';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { config } from '../config.js';

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

  // Re-sign the request with MinIO admin credentials
  const minioUrl = `${node.endpoint}${request.url}`;

  try {
    // Forward the request to MinIO
    const response = await axios({
      method: request.method,
      url: minioUrl,
      headers: buildProxyHeaders(request),
      data: request.body,
      auth: {
        username: config.minio.rootUser,
        password: config.minio.rootPassword,
      },
      validateStatus: () => true, // Don't throw on any status code
      maxRedirects: 0,
      timeout: 30000,
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
    'content-length', // Will be recalculated
  ];

  hopHeaders.forEach(header => {
    delete headers[header];
  });

  // Remove the original Authorization header
  delete headers.authorization;

  // Keep x-amz-* headers (except x-amz-date and x-amz-security-token for re-signing)
  // Actually, MinIO doesn't need these for now, but we could implement re-signing

  // Set content-length if there's a body
  if (request.body) {
    if (typeof request.body === 'string') {
      headers['content-length'] = Buffer.byteLength(request.body);
    } else {
      headers['content-length'] = request.body.length;
    }
  }

  return headers;
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
