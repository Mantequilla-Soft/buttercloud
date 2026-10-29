import { validateS3Auth } from '../middleware/s3auth.js';
import { checkUploadQuota, checkBucketCreationQuota, getUserQuotaInfo } from './quota.js';
import { proxyToMinIO, validateBucketOwnership, headObjectInMinIO } from './proxy.js';
import { trackUsageAsync, trackUpload, trackDownload, trackDelete, trackList, trackPresign, trackBucketCreate, trackBucketDelete } from '../services/usage.js';
import { createBucketInMinIO, getMinioClient } from '../services/files.js';
import { isUploadSuspended } from '../services/suspension.js';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { UserModel } from '../db/models/User.js';
import { findPublicBucket, handlePublicRead } from './publicRead.js';

/**
 * Register S3 gateway routes
 *
 * This catches all requests and routes them through S3 validation,
 * quota checking, and MinIO proxying.
 */
export async function registerS3Gateway(fastify) {
  // Register S3 auth middleware for all routes
  fastify.addHook('onRequest', validateS3Auth);

  // List buckets: GET /
  fastify.get('/', async (request, reply) => {
    // Browser navigation — serve the SPA
    if (!request.s3auth) {
      return reply.sendFile('index.html');
    }

    try {
      const userId = request.s3auth.userId;
      const bucket = await BucketModel.findByUserId(userId);
      if (!bucket) return buildListBucketsResponse(reply, []);
      return buildListBucketsResponse(reply, [bucket]);
    } catch (error) {
      return handleS3Error(reply, error);
    }
  });

  // All other S3 operations: /{bucket}, /{bucket}/{key}
  fastify.route({
    method: ['PUT', 'GET', 'DELETE', 'HEAD', 'POST'],
    url: '/*',
    async handler(request, reply) {
      // No AWS auth: an object in a public_read bucket (#22), or browser
      // navigation — serve the SPA or reject non-GET
      if (!request.s3auth) {
        const pathParts = request.params['*'].split('/').filter(Boolean);
        try {
          const publicBucket = await findPublicBucket(pathParts[0]);
          if (publicBucket) {
            return await handlePublicRead(request, reply, publicBucket, pathParts.slice(1).join('/') || null);
          }
        } catch (error) {
          return handleS3Error(reply, error);
        }
        if (request.method === 'GET' || request.method === 'HEAD') {
          return reply.sendFile('index.html');
        }
        return reply.code(403).send({
          Code: 'AccessDenied',
          Message: 'Missing Authorization header',
        });
      }

      try {
        const userId = request.s3auth.userId;
        const user = request.s3auth.user;
        const pathParts = request.params['*'].split('/').filter(Boolean);

        // Minimum: bucket name
        if (pathParts.length === 0) {
          // Root was already handled above
          return reply.code(400).send({
            Code: 'InvalidRequest',
            Message: 'No bucket specified',
          });
        }

        const bucketName = pathParts[0];
        const objectKey = pathParts.slice(1).join('/') || null;
        const method = request.method;

        // Suspension blocks new writes only — never reads or deletes, so a
        // suspended customer can always still retrieve or clean up their own data.
        // Covers bucket creation (PUT, no objectKey) and object upload/multipart
        // (PUT/POST, with objectKey) in one place.
        if ((method === 'PUT' || method === 'POST') && await isUploadSuspended(userId)) {
          return reply.code(403).send({
            Code: 'AccountSuspended',
            Message: 'This account is suspended for non-payment. Uploads are blocked until the overdue invoice is paid.',
          });
        }

        // ============================================
        // BUCKET OPERATIONS
        // ============================================

        if (!objectKey) {
          // Bucket-level operation
          switch (method) {
            case 'PUT':
              // Create bucket
              return handleCreateBucket(request, reply, userId, user, bucketName);
            case 'DELETE':
              // Delete bucket
              return handleDeleteBucket(request, reply, userId, bucketName);
            case 'HEAD':
              // Check bucket exists
              return handleHeadBucket(request, reply, userId, bucketName);
            case 'GET':
              // List objects
              return handleListObjects(request, reply, userId, bucketName);
            default:
              return reply.code(405).send({
                Code: 'MethodNotAllowed',
                Message: `Method ${method} not allowed`,
              });
          }
        }

        // ============================================
        // OBJECT OPERATIONS
        // ============================================

        // Validate bucket ownership first
        await validateBucketOwnership(bucketName, userId);

        switch (method) {
          case 'PUT':
            // Upload or multipart
            return handlePutObject(request, reply, userId, bucketName, objectKey);
          case 'GET':
            // ?presign mints a presigned URL instead of proxying the object itself —
            // see handlePresignObject.
            if (request.query.presign !== undefined) {
              return handlePresignObject(request, reply, userId, bucketName, objectKey);
            }
            // Download
            return handleGetObject(request, reply, userId, bucketName, objectKey);
          case 'DELETE':
            // Delete object
            return handleDeleteObject(request, reply, userId, bucketName, objectKey);
          case 'HEAD':
            // Get object metadata
            return handleHeadObject(request, reply, userId, bucketName, objectKey);
          case 'POST':
            // Multipart upload completion
            return handlePostObject(request, reply, userId, bucketName, objectKey);
          default:
            return reply.code(405).send({
              Code: 'MethodNotAllowed',
              Message: `Method ${method} not allowed`,
            });
        }
      } catch (error) {
        return handleS3Error(reply, error);
      }
    },
  });
}

// ============================================
// BUCKET OPERATION HANDLERS
// ============================================

async function handleCreateBucket(request, reply, userId, user, bucketName) {
  // Check quota
  await checkBucketCreationQuota(userId, user.plan);

  // Validate bucket name
  if (!isValidBucketName(bucketName)) {
    return reply.code(400).send({
      Code: 'InvalidBucketName',
      Message: 'Bucket name must be lowercase alphanumeric with hyphens',
    });
  }

  // Check if bucket already exists
  const existing = await BucketModel.findByName(bucketName);
  if (existing) {
    return reply.code(409).send({
      Code: 'BucketAlreadyExists',
      Message: 'Bucket already exists',
    });
  }

  // Get quota for user's plan
  const quotaInfo = await getUserQuotaInfo(userId, user.plan);
  const quotaBytes = quotaInfo.limits.storage_gb * 1024 * 1024 * 1024;

  // Get least-used node
  const node = await StorageNodeModel.getLeastUsedNode();
  if (!node) {
    return reply.code(503).send({
      Code: 'ServiceUnavailable',
      Message: 'No storage nodes available',
    });
  }

  // Create bucket in database
  const bucket = await BucketModel.create({
    user_id: userId,
    bucket_name: bucketName,
    node_id: node._id,
    quota_bytes: quotaBytes,
  });

  // Create bucket in MinIO
  await createBucketInMinIO(bucketName, node);

  // Track in audit log (async)
  trackUsageAsync(() => trackBucketCreate(userId, bucketName, quotaBytes));

  return reply.code(200).header('Location', `/${bucketName}`).send();
}

async function handleDeleteBucket(request, reply, userId, bucketName) {
  const bucket = await validateBucketOwnership(bucketName, userId);

  // Proxy to MinIO to check if empty and delete
  const minioResponse = await proxyToMinIO(request, bucketName);

  if (minioResponse.status === 204 || minioResponse.status === 200) {
    // Soft delete bucket from database
    await BucketModel.softDelete(bucket._id);

    // Track in audit log (async)
    trackUsageAsync(() => trackBucketDelete(userId, bucketName));

    return reply.code(204).send();
  }

  // Return MinIO error
  return reply.code(minioResponse.status).send(minioResponse.body);
}

async function handleHeadBucket(request, reply, userId, bucketName) {
  await validateBucketOwnership(bucketName, userId);

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);
  return reply.code(response.status).headers(response.headers).send(response.body);
}

async function handleListObjects(request, reply, userId, bucketName) {
  const bucket = await validateBucketOwnership(bucketName, userId);

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  // Track list operation (async)
  trackUsageAsync(() => trackList(userId, bucketName));

  return reply.code(response.status).headers(response.headers).send(response.body);
}

// ============================================
// OBJECT OPERATION HANDLERS
// ============================================

async function handlePutObject(request, reply, userId, bucketName, objectKey) {
  const bucket = await validateBucketOwnership(bucketName, userId);
  const isPartUpload = !!request.query.partNumber;

  const contentLength = parseInt(request.headers['content-length'] || '0');

  // Check quota for every PUT — parts consume real space on MinIO during assembly
  if (contentLength > 0) {
    await checkUploadQuota(bucket._id, contentLength);
  }

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  if (response.status >= 200 && response.status < 300 && !isPartUpload) {
    // Only track single-PUT uploads. Multipart parts are tracked once on CompleteMultipartUpload
    // so current_usage_bytes stays accurate for quota checks between parts.
    trackUsageAsync(() => trackUpload(userId, bucket._id, bucketName, contentLength));
  }

  return reply.code(response.status).headers(response.headers).send(response.body);
}

async function handleGetObject(request, reply, userId, bucketName, objectKey) {
  await validateBucketOwnership(bucketName, userId);

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  if (response.status === 200) {
    // Track download (async)
    const contentLength = parseInt(response.headers['content-length'] || '0');
    trackUsageAsync(() => trackDownload(userId, null, bucketName, contentLength));
  }

  return reply.code(response.status).headers(response.headers).send(response.body);
}

const MAX_PRESIGN_EXPIRY_SECONDS = 24 * 60 * 60; // 1 day
const DEFAULT_PRESIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour

/**
 * GET /{bucket}/{key}?presign[&expires=<seconds>]
 *
 * Mints a presigned URL pointing directly at the storage node instead of proxying
 * the object through this process. Lets a CDN (or any client) fetch the object
 * directly from the backend after one authenticated call here, instead of every
 * cache-fill request transiting proxyToMinIO. Auth/ownership is checked once, here —
 * the URL itself carries its own time-boxed authorization after that.
 *
 * Note: the minted URL uses the node's own `endpoint`. For a managed backend
 * (R2, B2, Wasabi, S3) that's already publicly reachable and this just works. For a
 * self-hosted node kept behind a firewall (as the default MinIO deployment is, per
 * docs/storage-backends.md's Nginx guide), the endpoint needs its own public
 * exposure for these URLs to be reachable — otherwise keep using the regular proxied
 * GET for that node.
 */
async function handlePresignObject(request, reply, userId, bucketName, objectKey) {
  const bucket = await validateBucketOwnership(bucketName, userId);

  const requested = parseInt(request.query.expires, 10);
  const expiresIn = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_PRESIGN_EXPIRY_SECONDS)
    : DEFAULT_PRESIGN_EXPIRY_SECONDS;

  const node = await StorageNodeModel.findById(bucket.node_id.toString());
  if (!node) {
    return reply.code(500).send({ Code: 'InternalError', Message: 'Storage node not found' });
  }

  const client = getMinioClient(node);
  const url = await client.presignedGetObject(bucketName, objectKey, expiresIn);

  trackUsageAsync(() => trackPresign(userId, bucketName, objectKey));

  return reply.code(200).send({
    url,
    bucket: bucketName,
    key: objectKey,
    expires_in: expiresIn,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });
}

async function handleDeleteObject(request, reply, userId, bucketName, objectKey) {
  const bucket = await validateBucketOwnership(bucketName, userId);

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  if (response.status >= 200 && response.status < 300) {
    // Track delete (we don't know file size, so pass 0)
    trackUsageAsync(() => trackDelete(userId, bucket._id, bucketName, 0));
  }

  return reply.code(response.status).headers(response.headers).send(response.body);
}

async function handleHeadObject(request, reply, userId, bucketName, objectKey) {
  await validateBucketOwnership(bucketName, userId);

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);
  return reply.code(response.status).headers(response.headers).send(response.body);
}

async function handlePostObject(request, reply, userId, bucketName, objectKey) {
  const bucket = await validateBucketOwnership(bucketName, userId);
  // ?uploads  → CreateMultipartUpload (initiate, no tracking needed)
  // ?uploadId → CompleteMultipartUpload (finalize, track actual size)
  const isComplete = !!request.query.uploadId;

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  if (response.status >= 200 && response.status < 300 && isComplete) {
    // HEAD the assembled object to get its true size — CompleteMultipartUpload
    // response XML doesn't include content-length.
    trackUsageAsync(async () => {
      const finalSize = await headObjectInMinIO(bucketName, objectKey);
      await trackUpload(userId, bucket._id, bucketName, finalSize);
    });
  }

  return reply.code(response.status).headers(response.headers).send(response.body);
}

// ============================================
// HELPERS
// ============================================

function isValidBucketName(name) {
  // S3 bucket naming rules:
  // - 3-63 characters
  // - lowercase alphanumeric and hyphens only
  // - must start and end with alphanumeric
  return /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(name);
}

function buildListBucketsResponse(reply, buckets) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>owner</ID>
  </Owner>
  <Buckets>
    ${buckets.map(bucket => `<Bucket><Name>${bucket.bucket_name}</Name><CreationDate>${bucket.created_at.toISOString()}</CreationDate></Bucket>`).join('')}
  </Buckets>
</ListAllMyBucketsResult>`;

  return reply
    .code(200)
    .header('Content-Type', 'application/xml')
    .send(xml);
}

function handleS3Error(reply, error) {
  const statusCode = error.statusCode || 500;
  const code = error.code || 'InternalError';
  const message = error.message || 'An error occurred';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${code}</Code>
  <Message>${message}</Message>
  <RequestId>${Date.now()}</RequestId>
</Error>`;

  return reply
    .code(statusCode)
    .header('Content-Type', 'application/xml')
    .send(xml);
}
