import { requireAdmin } from '../../middleware/adminAuth.js';
import { QuotaModel, FIELD_PATHS } from '../../db/models/Quota.js';
import { UserModel } from '../../db/models/User.js';
import { BucketModel } from '../../db/models/Bucket.js';

// All monetary values are cents. Per-unit overage rates may be fractional cents
// (e.g. 0.7 = $0.007/GB = $7/TB) — billing rounds the final line item, not the rate.
const nonNegNumber = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const positiveNumber = v => nonNegNumber(v) && v > 0;
const nonNegInt = v => Number.isInteger(v) && v >= 0;

const VALIDATORS = {
  storage_gb: [positiveNumber, 'a positive number'],
  monthly_transfer_gb: [nonNegNumber, 'a non-negative number'],
  monthly_requests: [nonNegInt, 'a non-negative integer'],
  max_object_size_gb: [positiveNumber, 'a positive number'],
  max_buckets: [v => Number.isInteger(v) && v >= 1, 'an integer ≥ 1'],
  base_monthly_usd: [nonNegInt, 'a non-negative integer (cents)'],
  storage_overage_per_gb_usd: [nonNegNumber, 'a non-negative number (cents)'],
  transfer_overage_per_gb_usd: [nonNegNumber, 'a non-negative number (cents)'],
  request_overage_per_1m_usd: [nonNegNumber, 'a non-negative number (cents)'],
  supports_replication: [v => typeof v === 'boolean', 'a boolean'],
  supports_lifecycle_policies: [v => typeof v === 'boolean', 'a boolean'],
  api_support: [v => typeof v === 'boolean', 'a boolean'],
};

function getPath(doc, path) {
  return path.split('.').reduce((o, k) => o?.[k], doc);
}

function serializePlan(q, userCount = 0) {
  return {
    plan: q.plan,
    active: q.active,
    limits: q.limits,
    pricing: q.pricing,
    features: q.features,
    user_count: userCount,
    updated_at: q.updated_at || null,
    change_history: (q.change_history || []).slice(-20).reverse(),
  };
}

export async function registerAdminPlanRoutes(fastify) {
  // GET /api/v1/admin/plans — every active plan with its limits, rates, how many
  // users are on it, and its recent change log (newest first).
  fastify.get('/api/v1/admin/plans', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const [plans, counts] = await Promise.all([QuotaModel.listActive(), UserModel.countByPlan()]);
      plans.sort((a, b) => a.pricing.base_monthly_usd - b.pricing.base_monthly_usd);

      return reply.code(200).send({ plans: plans.map(q => serializePlan(q, counts[q.plan] || 0)) });
    } catch (error) {
      return reply.code(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // PATCH /api/v1/admin/plans/:plan — partial edit of a plan's limits, rates or
  // features. Takes effect immediately: the next invoice generated for any user
  // on this plan uses the new rates, including for a month already in progress.
  fastify.patch('/api/v1/admin/plans/:plan', async (request, reply) => {
    try {
      if (!(await requireAdmin(request, reply))) return;

      const { plan } = request.params;
      const body = request.body || {};

      const unknown = Object.keys(body).filter(k => !(k in VALIDATORS));
      if (unknown.length) {
        return reply.code(400).send({ error: 'unknown_fields', message: `Unknown field(s): ${unknown.join(', ')}` });
      }
      if (Object.keys(body).length === 0) {
        return reply.code(400).send({ error: 'empty_update', message: 'No fields to update' });
      }
      for (const [key, value] of Object.entries(body)) {
        const [isValid, expected] = VALIDATORS[key];
        if (!isValid(value)) {
          return reply.code(400).send({ error: 'invalid_value', message: `${key} must be ${expected}` });
        }
      }

      const existing = await QuotaModel.findByPlan(plan);
      if (!existing) {
        return reply.code(404).send({ error: 'not_found', message: `No quota plan found for "${plan}"` });
      }

      const changes = {};
      for (const [key, value] of Object.entries(body)) {
        const from = getPath(existing, FIELD_PATHS[key]);
        if (from !== value) changes[key] = { from: from ?? null, to: value };
      }

      if (Object.keys(changes).length === 0) {
        const count = (await UserModel.countByPlan())[plan] || 0;
        return reply.code(200).send({ ...serializePlan(existing, count), buckets_updated: 0 });
      }

      const admin = await UserModel.findById(request.user.id);
      await QuotaModel.update(plan, body, { updatedBy: request.user.id });
      await QuotaModel.recordChange(plan, {
        at: new Date(),
        by_user_id: request.user.id,
        by_email: admin?.email || null,
        changes,
      });

      let bucketsUpdated = 0;
      if (changes.storage_gb) {
        const userIds = await UserModel.idsByPlan(plan);
        bucketsUpdated = await BucketModel.setQuotaForUsers(userIds, Math.floor(body.storage_gb * 1024 ** 3));
      }

      const [updated, counts] = await Promise.all([QuotaModel.findByPlan(plan), UserModel.countByPlan()]);
      return reply.code(200).send({ ...serializePlan(updated, counts[plan] || 0), buckets_updated: bucketsUpdated });
    } catch (error) {
      return reply.code(500).send({ error: 'update_failed', message: error.message });
    }
  });
}
