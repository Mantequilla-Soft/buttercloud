import { validateS3Auth } from '../middleware/s3auth.js';
import { checkUploadQuota, checkBucketCreationQuota, getUserQuotaInfo } from './quota.js';
import { proxyToMinIO, validateBucketOwnership } from './proxy.js';
import { trackUsageAsync, trackUpload, trackDownload, trackDelete, trackList, trackBucketCreate, trackBucketDelete } from '../services/usage.js';
import { createBucketInMinIO } from '../services/files.js';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { UserModel } from '../db/models/User.js';

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
    try {
      const userId = request.s3auth.userId;

      // Find user's bucket
      const bucket = await BucketModel.findByUserId(userId);

      if (!bucket) {
        return buildListBucketsResponse(reply, []);
      }

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

  // Get content length
  const contentLength = parseInt(request.headers['content-length'] || '0');

  // Check quota
  if (contentLength > 0) {
    await checkUploadQuota(bucket._id, contentLength);
  }

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  if (response.status >= 200 && response.status < 300) {
    // Track upload (async, after response sent)
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

  // Proxy to MinIO
  const response = await proxyToMinIO(request, bucketName);

  if (response.status >= 200 && response.status < 300) {
    // Track multipart completion (async)
    // We'd need to parse the response to get the final object size
    trackUsageAsync(() => trackUpload(userId, bucket._id, bucketName, 0));
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
