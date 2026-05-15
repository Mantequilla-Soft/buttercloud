import { validateJWT } from '../../middleware/jwt.js';
import { UserModel } from '../../db/models/User.js';
import { BucketModel } from '../../db/models/Bucket.js';

/**
 * Check if user is admin (currently: anyone with 'admin' plan)
 */
function isAdmin(userPlan) {
  return userPlan === 'admin' || userPlan === 'enterprise';
}

export async function registerAdminUserRoutes(fastify) {
  // GET /api/v1/admin/users
  fastify.get('/api/v1/admin/users', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      if (!isAdmin(request.user.plan)) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Admin access required',
        });
      }

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
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      if (!isAdmin(request.user.plan)) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Admin access required',
        });
      }

      const { userId } = request.params;
      const { plan, active, company_name } = request.body;

      const updateData = {};
      if (plan !== undefined) updateData.plan = plan;
      if (active !== undefined) updateData.active = active;
      if (company_name !== undefined) updateData.company_name = company_name;

      const existing = await UserModel.findById(userId);
      if (!existing) {
        return reply.code(404).send({ error: 'not_found', message: 'User not found' });
      }

      await UserModel.update(userId, updateData);

      return reply.code(200).send({
        id: existing._id.toString(),
        email: existing.email,
        plan: updateData.plan ?? existing.plan,
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
