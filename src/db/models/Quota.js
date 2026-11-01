import { ObjectId } from 'mongodb';
import { quotas } from '../index.js';

// Flat input field → document path. Shared by update() and the admin plans API
// so the set of editable fields is defined in one place.
export const FIELD_PATHS = {
  storage_gb: 'limits.storage_gb',
  monthly_transfer_gb: 'limits.monthly_transfer_gb',
  monthly_requests: 'limits.monthly_requests',
  max_object_size_gb: 'limits.max_object_size_gb',
  max_buckets: 'limits.max_buckets',
  base_monthly_usd: 'pricing.base_monthly_usd',
  storage_overage_per_gb_usd: 'pricing.storage_overage_per_gb_usd',
  transfer_overage_per_gb_usd: 'pricing.transfer_overage_per_gb_usd',
  request_overage_per_1m_usd: 'pricing.request_overage_per_1m_usd',
  supports_replication: 'features.supports_replication',
  supports_lifecycle_policies: 'features.supports_lifecycle_policies',
  api_support: 'features.api_support',
};

export class QuotaModel {
  static async create(data) {
    const quota = {
      _id: new ObjectId(),
      plan: data.plan,
      limits: {
        storage_gb: data.storage_gb || 100,
        monthly_transfer_gb: data.monthly_transfer_gb || 1000,
        monthly_requests: data.monthly_requests || 1000000,
        max_object_size_gb: data.max_object_size_gb || 5,
        max_buckets: data.max_buckets || 1,
      },
      pricing: {
        base_monthly_usd: data.base_monthly_usd || 0,
        storage_overage_per_gb_usd: data.storage_overage_per_gb_usd || 0,
        transfer_overage_per_gb_usd: data.transfer_overage_per_gb_usd || 0,
        request_overage_per_1m_usd: data.request_overage_per_1m_usd || 0,
      },
      features: {
        supports_replication: data.supports_replication || false,
        supports_lifecycle_policies: data.supports_lifecycle_policies || false,
        api_support: data.api_support || false,
      },
      created_at: new Date(),
      active: true,
    };

    await quotas().insertOne(quota);
    return quota;
  }

  static async findByPlan(plan) {
    return quotas().findOne({ plan, active: true });
  }

  static async listActive() {
    return quotas().find({ active: true }).toArray();
  }

  // Partial update — only fields present in `data` are written. Writing every
  // field unconditionally would null out anything the caller left undefined
  // (e.g. a pricing-only edit wiping the plan's limits).
  static async update(plan, data, { updatedBy = null } = {}) {
    const $set = {};
    for (const [key, path] of Object.entries(FIELD_PATHS)) {
      if (data[key] !== undefined) $set[path] = data[key];
    }
    if (Object.keys($set).length === 0) return QuotaModel.findByPlan(plan);

    $set.updated_at = new Date();
    if (updatedBy) $set.updated_by = updatedBy;

    return quotas().findOneAndUpdate({ plan }, { $set }, { returnDocument: 'after' });
  }

  // Appends to the plan's change log (most recent last, capped so the document
  // can't grow without bound).
  static async recordChange(plan, entry) {
    return quotas().updateOne(
      { plan },
      { $push: { change_history: { $each: [entry], $slice: -100 } } }
    );
  }

  static async deactivate(plan) {
    return quotas().findOneAndUpdate(
      { plan },
      { $set: { active: false, updated_at: new Date() } },
      { returnDocument: 'after' }
    );
  }
}
