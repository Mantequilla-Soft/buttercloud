import { requireAdmin } from '../../middleware/adminAuth.js';
import { BucketModel } from '../../db/models/Bucket.js';
import { UserModel } from '../../db/models/User.js';
import { StorageNodeModel } from '../../db/models/StorageNode.js';
import { migrateBucket, cleanupSourceBucket } from '../../services/migration.js';
import { RESERVED_PUBLIC_NAMES } from '../../gateway/publicRead.js';

export async function registerAdminBucketRoutes(fastify) {
  // GET /api/v1/admin/buckets — list all buckets with owner + node info
  fastify.get('/api/v1/admin/buckets', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      // Get all nodes for lookup
      const nodes = await StorageNodeModel.findAll();
      const nodeMap = Object.fromEntries(nodes.map(n => [n._id.toString(), n]));

      // Get all buckets (no filter — pull them all)
      const allBuckets = [];
      for (const node of nodes) {
        const { items } = await BucketModel.findByNodeId(node._id.toString(), 200, 0);
        allBuckets.push(...items);
      }

      // Enrich with user info
      const enriched = await Promise.all(allBuckets.map(async b => {
        const user = await UserModel.findById(b.user_id.toString());
        const node = nodeMap[b.node_id.toString()];
        return {
          id: b._id.toString(),
          bucket_name: b.bucket_name,
          user_id: b.user_id.toString(),
          user_email: user?.email || 'unknown',
          user_plan: user?.plan || 'unknown',
          node_id: b.node_id.toString(),
          node_name: node?.name || 'unknown',
          node_endpoint: node?.endpoint || '',
          quota_gb: Math.round((b.quota_bytes / (1024 ** 3)) * 100) / 100,
          used_gb: Math.round((b.current_usage_bytes / (1024 ** 3)) * 100) / 100,
          public_read: b.public_read === true,
          created_at: b.created_at,
        };
      }));

      return reply.code(200).send({ buckets: enriched, total: enriched.length });
    } catch (error) {
      return reply.code(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // PATCH /api/v1/admin/buckets/:bucketId — set public_read (unsigned GET/HEAD on objects)
  fastify.patch('/api/v1/admin/buckets/:bucketId', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { public_read } = request.body || {};
      if (typeof public_read !== 'boolean') {
        return reply.code(400).send({ error: 'invalid_request', message: 'public_read must be true or false' });
      }

      const bucket = await BucketModel.findById(request.params.bucketId);
      if (!bucket) return reply.code(404).send({ error: 'not_found', message: 'Bucket not found' });

      // A public bucket named like a dashboard page would take over that URL
      if (public_read && RESERVED_PUBLIC_NAMES.has(bucket.bucket_name)) {
        return reply.code(409).send({
          error: 'reserved_name',
          message: `"${bucket.bucket_name}" is also a dashboard path, so it can't be made public`,
        });
      }

      const updated = await BucketModel.update(bucket._id.toString(), { public_read });
      return reply.code(200).send({
        id: updated._id.toString(),
        bucket_name: updated.bucket_name,
        public_read: updated.public_read === true,
      });
    } catch (error) {
      return reply.code(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // POST /api/v1/admin/buckets/:bucketId/migrate — migrate bucket to another node
  fastify.post('/api/v1/admin/buckets/:bucketId/migrate', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { bucketId } = request.params;
      const { destination_node_id, cleanup_source = false } = request.body;

      if (!destination_node_id) {
        return reply.code(400).send({ error: 'invalid_request', message: 'destination_node_id is required' });
      }

      // Load bucket, source node, destination node
      const bucket = await BucketModel.findById(bucketId);
      if (!bucket) return reply.code(404).send({ error: 'not_found', message: 'Bucket not found' });

      if (bucket.node_id.toString() === destination_node_id) {
        return reply.code(400).send({ error: 'same_node', message: 'Destination is the same as source' });
      }

      const sourceNode = await StorageNodeModel.findById(bucket.node_id.toString());
      const destNode   = await StorageNodeModel.findById(destination_node_id);

      if (!sourceNode) return reply.code(404).send({ error: 'not_found', message: 'Source node not found' });
      if (!destNode)   return reply.code(404).send({ error: 'not_found', message: 'Destination node not found' });

      // Run the migration (synchronous — fine for small buckets)
      const result = await migrateBucket(bucket.bucket_name, sourceNode, destNode);

      // Update MongoDB to point bucket at new node
      await BucketModel.update(bucket._id.toString(), { node_id: destNode._id });

      // Optionally delete objects from old node
      if (cleanup_source) {
        await cleanupSourceBucket(bucket.bucket_name, sourceNode);
      }

      return reply.code(200).send({
        migrated: true,
        bucket_name: bucket.bucket_name,
        from_node: sourceNode.name,
        to_node: destNode.name,
        objects_copied: result.objects_copied,
        bytes_copied: result.bytes_copied,
        source_cleaned: cleanup_source,
      });
    } catch (error) {
      return reply.code(500).send({ error: 'migration_failed', message: error.message });
    }
  });
}
