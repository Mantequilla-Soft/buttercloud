import { PassThrough } from 'node:stream';
import { BucketModel } from '../db/models/Bucket.js';
import { UserModel } from '../db/models/User.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { trackUsageAsync } from '../services/usage.js';
import { MultipartUploadModel } from '../db/models/MultipartUpload.js';
import {
  listFiles, downloadFile, uploadFile, deleteFile, statFile,
  startMultipartUpload, uploadMultipartPart, listMultipartParts,
  completeMultipartUpload, abortMultipartUpload,
} from '../services/files.js';

// Chunked uploads: Cloudflare in front of the API caps a single request body at
// 100 MB, so the dashboard sends anything bigger than one part as a series of
// part-sized PUTs. Each part is held in memory while it's forwarded (see
// uploadMultipartPart), which is what keeps this well under the cap rather than
// near it. 50 GB / 16 MiB = 3200 parts, inside S3's 10,000-part limit.
export const MULTIPART_PART_SIZE = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024; // matches the @fastify/multipart cap

function httpError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function partCountFor(size, partSize) {
  return Math.ceil(size / partSize);
}

// Every part but the last is exactly part_size; the last is whatever remains.
// Holding parts to that exactly is what makes the size checked against quota at
// initiation the size that actually lands.
function expectedPartSize(upload, partNumber) {
  const count = partCountFor(upload.size, upload.part_size);
  return partNumber < count ? upload.part_size : upload.size - upload.part_size * (count - 1);
}

async function readPartBody(stream, expected) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > expected) throw httpError(400, 'invalid_part_size', `Part is larger than the expected ${expected} bytes`);
    chunks.push(chunk);
  }
  if (total !== expected) throw httpError(400, 'invalid_part_size', `Part is ${total} bytes, expected ${expected}`);
  return Buffer.concat(chunks, total);
}

async function assertVerified(user, reply) {
  const dbUser = await UserModel.findById(user.id);
  if (dbUser?.is_admin) return true;
  if (!dbUser?.email_verified) {
    reply.code(403).send({ error: 'email_not_verified', message: 'Please verify your email address before uploading files.' });
    return false;
  }
  return true;
}

export async function registerFileRoutes(fastify) {
  // GET /api/v1/files?prefix=folder/ - list files in bucket
  fastify.get('/api/v1/files', async (request, reply) => {
    try {
      const user = request.user;
      const { prefix = '' } = request.query;

      const bucket = await BucketModel.findByUserId(user.id);
      if (!bucket) {
        return reply.code(404).send({ error: 'bucket_not_found', message: 'No storage bucket found for this account' });
      }

      const result = await listFiles(bucket.bucket_name, prefix);

      trackUsageAsync(() => UsageMetricModel.incrementRequest(user.id, new Date(), 'get'));

      return reply.code(200).send(result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'list_failed', message: error.message });
    }
  });

  // GET /api/v1/files/download/:key - stream file to browser
  fastify.get('/api/v1/files/download/:key', async (request, reply) => {
    try {
      const user = request.user;
      const key = decodeURIComponent(request.params.key);

      const bucket = await BucketModel.findByUserId(user.id);
      if (!bucket) {
        return reply.code(404).send({ error: 'bucket_not_found' });
      }

      const result = await downloadFile(bucket.bucket_name, key);

      reply.header('Content-Type', result.contentType);
      reply.header('Content-Length', result.size);
      reply.header('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);

      trackUsageAsync(() => UsageMetricModel.incrementDownload(user.id, new Date(), result.size));

      return reply.code(200).send(result.stream);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'download_failed', message: error.message });
    }
  });

  // POST /api/v1/files/upload - multipart file upload
  fastify.post('/api/v1/files/upload', async (request, reply) => {
    try {
      const user = request.user;
      if (!await assertVerified(user, reply)) return;

      const bucket = await BucketModel.findByUserId(user.id);
      if (!bucket) {
        return reply.code(404).send({ error: 'bucket_not_found' });
      }

      const parts = request.parts();
      const uploads = [];
      let prefix = '';

      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'prefix') {
          prefix = part.value || '';
          continue;
        }
        if (part.type !== 'file') continue;

        // Re-fetch so usage from a prior file in this same multi-file request counts
        // toward this check too — the `bucket` fetched at the top of the handler goes
        // stale after the first file.
        const currentBucket = await BucketModel.findById(bucket._id.toString());
        const available = currentBucket.quota_bytes - currentBucket.current_usage_bytes;
        if (available <= 0) {
          part.file.resume(); // drain so the multipart parser isn't left hanging
          const quotaErr = new Error('Storage quota exceeded');
          quotaErr.statusCode = 403;
          quotaErr.code = 'QuotaExceeded';
          throw quotaErr;
        }

        const { filename, mimetype } = part;
        const key = prefix ? prefix + filename : filename;

        // Stream straight through to the storage backend instead of buffering the
        // whole file in this process first — the same OOM risk #1 fixed for the S3
        // gateway applied here too, just via @fastify/multipart's part.toBuffer()
        // instead of axios. The PassThrough also doubles as a running byte counter,
        // both for usage tracking (the stream's final size isn't known upfront) and
        // to abort mid-upload if it would blow past the remaining quota — a single
        // large file easily could, unlike the old pre-sized S3 gateway PUT path.
        let bytesSeen = 0;
        let quotaExceededMidUpload = false;
        const counted = new PassThrough();
        part.file.on('data', chunk => {
          bytesSeen += chunk.length;
          if (!quotaExceededMidUpload && bytesSeen > available) {
            quotaExceededMidUpload = true;
            counted.destroy(new Error('quota exceeded mid-upload'));
          }
        });
        part.file.pipe(counted);

        try {
          await uploadFile(bucket.bucket_name, key, counted, mimetype);
        } catch (err) {
          if (quotaExceededMidUpload) {
            const quotaErr = new Error('Storage quota exceeded');
            quotaErr.statusCode = 403;
            quotaErr.code = 'QuotaExceeded';
            throw quotaErr;
          }
          throw err;
        }

        await BucketModel.incrementUsage(bucket._id.toString(), bytesSeen);
        trackUsageAsync(() => UsageMetricModel.incrementUpload(user.id, new Date(), bytesSeen));
        uploads.push({ filename: key, size: bytesSeen });
      }

      return reply.code(200).send({ uploaded: uploads });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'upload_failed', message: error.message });
    }
  });

  // POST /api/v1/files/multipart - start a chunked upload
  // body: { filename, prefix?, size, contentType? } → { uploadId, key, partSize, partCount }
  fastify.post('/api/v1/files/multipart', async (request, reply) => {
    try {
      const user = request.user;
      if (!await assertVerified(user, reply)) return;

      const { filename, prefix = '', size, contentType } = request.body || {};
      if (typeof filename !== 'string' || !filename || filename.includes('/')) {
        return reply.code(400).send({ error: 'invalid_filename', message: 'filename is required' });
      }
      if (typeof prefix !== 'string') {
        return reply.code(400).send({ error: 'invalid_prefix', message: 'prefix must be a string' });
      }
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
        return reply.code(400).send({ error: 'invalid_size', message: 'size must be a positive byte count up to 50 GB' });
      }
      const key = prefix + filename;
      if (Buffer.byteLength(key) > 1024) {
        return reply.code(400).send({ error: 'invalid_filename', message: 'Path is too long' });
      }

      const bucket = await BucketModel.findByUserId(user.id);
      if (!bucket) {
        return reply.code(404).send({ error: 'bucket_not_found' });
      }
      if (size > bucket.quota_bytes - bucket.current_usage_bytes) {
        throw httpError(403, 'QuotaExceeded', 'Storage quota exceeded');
      }

      const storageUploadId = await startMultipartUpload(bucket.bucket_name, key, contentType);
      const upload = await MultipartUploadModel.create({
        upload_id: storageUploadId,
        user_id: user.id,
        bucket_id: bucket._id.toString(),
        bucket_name: bucket.bucket_name,
        key,
        size,
        part_size: MULTIPART_PART_SIZE,
        content_type: contentType,
      });

      return reply.code(200).send({
        uploadId: upload._id.toString(),
        key,
        partSize: MULTIPART_PART_SIZE,
        partCount: partCountFor(size, MULTIPART_PART_SIZE),
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'upload_failed', message: error.message });
    }
  });

  // PUT /api/v1/files/multipart/:uploadId/parts/:partNumber - raw part body
  fastify.put('/api/v1/files/multipart/:uploadId/parts/:partNumber', async (request, reply) => {
    try {
      const upload = await MultipartUploadModel.findForUser(request.params.uploadId, request.user.id);
      if (!upload) {
        return reply.code(404).send({ error: 'upload_not_found', message: 'No such upload in progress' });
      }

      const partNumber = Number(request.params.partNumber);
      const partCount = partCountFor(upload.size, upload.part_size);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
        return reply.code(400).send({ error: 'invalid_part_number', message: `partNumber must be 1–${partCount}` });
      }

      const expected = expectedPartSize(upload, partNumber);
      const declared = request.headers['content-length'];
      if (declared !== undefined && Number(declared) !== expected) {
        throw httpError(400, 'invalid_part_size', `Part is ${declared} bytes, expected ${expected}`);
      }
      if (!request.body || typeof request.body[Symbol.asyncIterator] !== 'function') {
        throw httpError(400, 'invalid_part_size', 'Part body is required (Content-Type: application/octet-stream)');
      }

      const data = await readPartBody(request.body, expected);
      const etag = await uploadMultipartPart(upload.bucket_name, upload.key, upload.upload_id, partNumber, data);

      return reply.code(200).send({ partNumber, etag });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'upload_failed', message: error.message });
    }
  });

  // POST /api/v1/files/multipart/:uploadId/complete - assemble the parts
  // The part list comes from the storage node rather than the client, so a client
  // can't complete with parts missing or claim a size it didn't upload.
  fastify.post('/api/v1/files/multipart/:uploadId/complete', async (request, reply) => {
    try {
      const user = request.user;
      const upload = await MultipartUploadModel.findForUser(request.params.uploadId, user.id);
      if (!upload) {
        return reply.code(404).send({ error: 'upload_not_found', message: 'No such upload in progress' });
      }

      const partCount = partCountFor(upload.size, upload.part_size);
      const parts = (await listMultipartParts(upload.bucket_name, upload.key, upload.upload_id))
        .sort((a, b) => a.part - b.part);
      const allPresent = parts.length === partCount
        && parts.every((p, i) => p.part === i + 1 && p.size === expectedPartSize(upload, p.part));
      if (!allPresent) {
        return reply.code(400).send({
          error: 'incomplete_upload',
          message: `${parts.length} of ${partCount} parts uploaded`,
        });
      }

      // Re-checked against fresh usage: other uploads may have landed since init.
      const bucket = await BucketModel.findById(upload.bucket_id.toString());
      if (upload.size > bucket.quota_bytes - bucket.current_usage_bytes) {
        await abortMultipartUpload(upload.bucket_name, upload.key, upload.upload_id).catch(() => {});
        await MultipartUploadModel.delete(upload._id.toString());
        throw httpError(403, 'QuotaExceeded', 'Storage quota exceeded');
      }

      await completeMultipartUpload(
        upload.bucket_name, upload.key, upload.upload_id,
        parts.map(p => ({ part: p.part, etag: p.etag }))
      );
      await MultipartUploadModel.delete(upload._id.toString());

      await BucketModel.incrementUsage(upload.bucket_id.toString(), upload.size);
      trackUsageAsync(() => UsageMetricModel.incrementUpload(user.id, new Date(), upload.size));

      return reply.code(200).send({ uploaded: [{ filename: upload.key, size: upload.size }] });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'upload_failed', message: error.message });
    }
  });

  // DELETE /api/v1/files/multipart/:uploadId - cancel, freeing any uploaded parts
  fastify.delete('/api/v1/files/multipart/:uploadId', async (request, reply) => {
    try {
      const upload = await MultipartUploadModel.findForUser(request.params.uploadId, request.user.id);
      if (!upload) {
        return reply.code(404).send({ error: 'upload_not_found', message: 'No such upload in progress' });
      }
      try {
        await abortMultipartUpload(upload.bucket_name, upload.key, upload.upload_id);
      } catch (err) {
        if (err.code !== 'NoSuchUpload') throw err;
      }
      await MultipartUploadModel.delete(upload._id.toString());
      return reply.code(200).send({ aborted: true });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'abort_failed', message: error.message });
    }
  });

  // POST /api/v1/files/mkdir - create a folder (zero-byte key ending in /)
  fastify.post('/api/v1/files/mkdir', async (request, reply) => {
    try {
      const user = request.user;
      const { path } = request.body;
      if (!path) return reply.code(400).send({ error: 'path_required', message: 'path is required' });

      const bucket = await BucketModel.findByUserId(user.id);
      if (!bucket) return reply.code(404).send({ error: 'bucket_not_found' });

      const folderKey = path.endsWith('/') ? path : path + '/';
      await uploadFile(bucket.bucket_name, folderKey, Buffer.alloc(0), 'application/x-directory');

      return reply.code(200).send({ created: true, path: folderKey });
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'mkdir_failed', message: error.message });
    }
  });

  // DELETE /api/v1/files/:key - delete a file
  fastify.delete('/api/v1/files/:key', async (request, reply) => {
    try {
      const user = request.user;
      const key = decodeURIComponent(request.params.key);

      const bucket = await BucketModel.findByUserId(user.id);
      if (!bucket) {
        return reply.code(404).send({ error: 'bucket_not_found' });
      }

      const fileStat = await statFile(bucket.bucket_name, key);
      await deleteFile(bucket.bucket_name, key);

      if (fileStat?.size) {
        await BucketModel.incrementUsage(bucket._id.toString(), -fileStat.size);
      }

      trackUsageAsync(() => UsageMetricModel.incrementRequest(user.id, new Date(), 'delete'));

      return reply.code(200).send({ deleted: true, key });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'delete_failed', message: error.message });
    }
  });
}
