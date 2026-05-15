import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { trackUsageAsync } from '../services/usage.js';
import { listFiles, downloadFile, uploadFile, deleteFile, statFile } from '../services/files.js';

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

      trackUsageAsync(async () => {
        const metric = await UsageMetricModel.getOrCreate(user.id, new Date());
        await metric.incrementList();
      });

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

      trackUsageAsync(async () => {
        const metric = await UsageMetricModel.getOrCreate(user.id, new Date());
        await metric.incrementDownload(result.size);
      });

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

        // Keep node-level used bytes in sync so getLeastUsedNode distributes correctly
        trackUsageAsync(() =>
          StorageNodeModel.incrementUsed(bucket.node_id.toString(), buffer.length).catch(() => {})
        );

        trackUsageAsync(async () => {
          const metric = await UsageMetricModel.getOrCreate(user.id, new Date());
          await metric.incrementUpload(buffer.length);
        });

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

      // Stat before delete so we can decrement usage counters
      const fileStat = await statFile(bucket.bucket_name, key);
      await deleteFile(bucket.bucket_name, key);

      if (fileStat?.size) {
        await BucketModel.incrementUsage(bucket._id.toString(), -fileStat.size);
        trackUsageAsync(() =>
          StorageNodeModel.incrementUsed(bucket.node_id.toString(), -fileStat.size).catch(() => {})
        );
      }

      trackUsageAsync(async () => {
        const metric = await UsageMetricModel.getOrCreate(user.id, new Date());
        await metric.incrementRequest();
      });

      return reply.code(200).send({ deleted: true, key });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return reply.code(statusCode).send({ error: 'delete_failed', message: error.message });
    }
  });
}
