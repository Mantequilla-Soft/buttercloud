import { validateJWT } from '../../middleware/jwt.js';
import { StorageNodeModel } from '../../db/models/StorageNode.js';
import { BucketModel } from '../../db/models/Bucket.js';
import { reconcileNodeUsage } from '../../services/reconcile.js';
import { encryptCredential } from '../../services/nodeCredentials.js';

/**
 * Check if user is admin
 */
function isAdmin(userPlan) {
  return userPlan === 'admin' || userPlan === 'enterprise';
}

export async function registerAdminNodeRoutes(fastify) {
  // GET /api/v1/admin/nodes
  fastify.get('/api/v1/admin/nodes', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      if (!isAdmin(request.user.plan)) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Admin access required',
        });
      }

      const nodes = await StorageNodeModel.findAll();

      const enriched = await Promise.all(
        nodes.map(async node => {
          const { items: buckets } = await BucketModel.findByNodeId(node._id.toString());

          // Derive used bytes from bucket totals — more accurate than the incremental counter
          const usedBytes = buckets.reduce((sum, b) => sum + (b.current_usage_bytes || 0), 0);
          const totalBytes = node.capacity_total_bytes;

          return {
            id: node._id.toString(),
            name: node.name,
            endpoint: node.endpoint,
            capacity_total_gb: Math.round((totalBytes / (1024 ** 3)) * 100) / 100,
            capacity_used_gb: Math.round((usedBytes / (1024 ** 3)) * 1000) / 1000,
            capacity_available_gb: Math.round(((totalBytes - usedBytes) / (1024 ** 3)) * 100) / 100,
            status: node.status,
            region: node.metadata?.region || 'default',
            created_at: node.created_at,
            last_health_check: node.last_health_check,
            bucket_count: buckets.length,
          };
        })
      );

      return reply.code(200).send({
        nodes: enriched,
        total: enriched.length,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message,
      });
    }
  });

  // POST /api/v1/admin/nodes
  fastify.post('/api/v1/admin/nodes', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      if (!isAdmin(request.user.plan)) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Admin access required',
        });
      }

      const { name, endpoint, capacity_total_gb, region, access_key, secret_key } = request.body;

      if (!name || !endpoint || !capacity_total_gb) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'name, endpoint, and capacity_total_gb are required',
        });
      }

      if ((access_key && !secret_key) || (!access_key && secret_key)) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'access_key and secret_key must be provided together',
        });
      }

      // Check if node already exists
      const existing = await StorageNodeModel.findByName(name);
      if (existing) {
        return reply.code(409).send({
          error: 'conflict',
          message: 'Node name already exists',
        });
      }

      // Create node. access_key/secret_key are optional — omit them to have this
      // node share the global MINIO_ROOT_USER/PASSWORD (e.g. the default backend).
      // Provide both for a genuinely separate backend (different software,
      // different admin account) that needs its own credentials.
      const node = await StorageNodeModel.create({
        name,
        endpoint,
        capacity_total_bytes: capacity_total_gb * 1024 * 1024 * 1024,
        region,
        access_key_encrypted: access_key ? encryptCredential(access_key) : null,
        secret_key_encrypted: secret_key ? encryptCredential(secret_key) : null,
      });

      return reply.code(201).send({
        id: node._id.toString(),
        name: node.name,
        endpoint: node.endpoint,
        capacity_total_gb,
        capacity_used_gb: 0,
        capacity_available_gb: capacity_total_gb,
        status: node.status,
        region: node.metadata.region,
        created_at: node.created_at,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'creation_failed',
        message: error.message,
      });
    }
  });

  // PATCH /api/v1/admin/nodes/:nodeId
  fastify.patch('/api/v1/admin/nodes/:nodeId', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return;
      if (!isAdmin(request.user.plan)) return reply.code(403).send({ error: 'forbidden' });

      const { nodeId } = request.params;
      const { name, endpoint, capacity_total_gb, region, status, access_key, secret_key } = request.body;

      if ((access_key && !secret_key) || (!access_key && secret_key)) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: 'access_key and secret_key must be provided together',
        });
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (endpoint !== undefined) updates.endpoint = endpoint;
      if (region !== undefined) updates['metadata.region'] = region;
      if (status !== undefined) updates.status = status;
      if (capacity_total_gb !== undefined) {
        updates.capacity_total_bytes = capacity_total_gb * 1024 * 1024 * 1024;
      }
      if (access_key && secret_key) {
        updates.access_key_encrypted = encryptCredential(access_key);
        updates.secret_key_encrypted = encryptCredential(secret_key);
      }

      // Verify node exists before updating
      const existing = await StorageNodeModel.findById(nodeId);
      if (!existing) return reply.code(404).send({ error: 'not_found', message: 'Node not found' });

      await StorageNodeModel.update(nodeId, updates);

      // Never echo credential blobs back, even encrypted.
      const { access_key_encrypted, secret_key_encrypted, ...safeUpdates } = updates;
      return reply.code(200).send({
        id: nodeId,
        ...safeUpdates,
        capacity_total_gb,
        credentials_updated: Boolean(access_key_encrypted && secret_key_encrypted),
      });
    } catch (error) {
      return reply.code(500).send({ error: 'update_failed', message: error.message });
    }
  });

  // POST /api/v1/admin/nodes/reconcile — sync capacity_used_bytes from bucket totals
  fastify.post('/api/v1/admin/nodes/reconcile', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return;
      if (!isAdmin(request.user.plan)) return reply.code(403).send({ error: 'forbidden' });

      const results = await reconcileNodeUsage();
      return reply.code(200).send({ reconciled: true, nodes: results });
    } catch (error) {
      return reply.code(500).send({ error: 'reconcile_failed', message: error.message });
    }
  });

  // GET /api/v1/admin/node-health
  fastify.get('/api/v1/admin/node-health', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      if (!isAdmin(request.user.plan)) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Admin access required',
        });
      }

      // Check health of all nodes
      const nodes = await StorageNodeModel.findAll();

      const health = nodes.map(node => ({
        id: node._id.toString(),
        name: node.name,
        status: node.status,
        last_health_check: node.last_health_check,
        health_check_interval_seconds: node.health_check_interval_seconds,
      }));

      return reply.code(200).send({
        nodes: health,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message,
      });
    }
  });
}
