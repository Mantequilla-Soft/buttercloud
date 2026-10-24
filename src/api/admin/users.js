import { requireAdmin } from '../../middleware/adminAuth.js';
import { UserModel } from '../../db/models/User.js';
import { BucketModel } from '../../db/models/Bucket.js';
import { QuotaModel } from '../../db/models/Quota.js';

export async function registerAdminUserRoutes(fastify) {
  // GET /api/v1/admin/users
  fastify.get('/api/v1/admin/users', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const limit = Math.min(parseInt(request.query.limit || '50'), 100);
      const offset = parseInt(request.query.offset || '0');
      const status = request.query.status === 'inactive' ? 'inactive' : 'active';

      const filter = status === 'active' ? { active: true } : { active: false };
      const result = await UserModel.list(filter, limit, offset);

      // Enrich with bucket info
      const enriched = await Promise.all(
        result.items.map(async user => ({
          id: user._id.toString(),
          email: user.email,
          plan: user.plan,
          is_admin: user.is_admin || false,
          company_name: user.company_name,
          created_at: user.created_at,
          active: user.active,
          bucket_count: (await BucketModel.findByUserId(user._id.toString())) ? 1 : 0,
          current_storage_gb: 0, // Would need to aggregate from bucket
        }))
      );

      return reply.code(200).send({
        users: enriched,
        total: result.total,
        limit,
        offset,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message,
      });
    }
  });

  // PATCH /api/v1/admin/users/:userId
  fastify.patch('/api/v1/admin/users/:userId', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { userId } = request.params;
      const { plan, active, company_name, is_admin } = request.body;

      let newQuota = null;
      if (plan !== undefined) {
        newQuota = await QuotaModel.findByPlan(plan);
        if (!newQuota) {
          return reply.code(400).send({ error: 'invalid_plan', message: `No quota plan found for "${plan}"` });
        }
      }

      const updateData = {};
      if (plan !== undefined) updateData.plan = plan;
      if (active !== undefined) updateData.active = active;
      if (company_name !== undefined) updateData.company_name = company_name;
      if (is_admin !== undefined) updateData.is_admin = Boolean(is_admin);

      const existing = await UserModel.findById(userId);
      if (!existing) {
        return reply.code(404).send({ error: 'not_found', message: 'User not found' });
      }

      await UserModel.update(userId, updateData);

      // quota_bytes is only ever set at bucket-creation time — without this, changing
      // a user's plan silently leaves their existing bucket capped at whatever it
      // started with, regardless of what the new plan promises.
      if (newQuota) {
        const bucket = await BucketModel.findByUserId(userId);
        if (bucket) {
          await BucketModel.update(bucket._id.toString(), {
            quota_bytes: Math.floor(newQuota.limits.storage_gb * 1024 ** 3),
          });
        }
      }

      return reply.code(200).send({
        id: existing._id.toString(),
        email: existing.email,
        plan: updateData.plan ?? existing.plan,
        is_admin: updateData.is_admin ?? (existing.is_admin || false),
        company_name: updateData.company_name ?? existing.company_name,
        active: updateData.active ?? existing.active,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'update_failed',
        message: error.message,
      });
    }
  });
}
