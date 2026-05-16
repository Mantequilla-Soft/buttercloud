import { BucketModel } from '../db/models/Bucket.js';
import { UserModel } from '../db/models/User.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { trackUsageAsync } from '../services/usage.js';
import { listFiles, downloadFile, uploadFile, deleteFile, statFile } from '../services/files.js';

async function assertVerified(user, reply) {
  if (user.plan === 'admin' || user.plan === 'enterprise') return true;
  const dbUser = await UserModel.findById(user.id);
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

        const { filename, mimetype } = part;
        const buffer = await part.toBuffer();
        const key = prefix ? prefix + filename : filename;

        await uploadFile(bucket.bucket_name, key, buffer, mimetype);
        await BucketModel.incrementUsage(bucket._id.toString(), buffer.length);

        trackUsageAsync(() => UsageMetricModel.incrementUpload(user.id, new Date(), buffer.length));

        uploads.push({ filename: key, size: buffer.length });
      }

      return reply.code(200).send({ uploaded: uploads });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'upload_failed', message: error.message });
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
