import { ObjectId } from 'mongodb';
import { quotas } from '../index.js';

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

  static async update(plan, data) {
    const result = await quotas().findOneAndUpdate(
      { plan },
      {
        $set: {
          'limits.storage_gb': data.storage_gb,
          'limits.monthly_transfer_gb': data.monthly_transfer_gb,
          'limits.monthly_requests': data.monthly_requests,
          'limits.max_object_size_gb': data.max_object_size_gb,
          'limits.max_buckets': data.max_buckets,
          'pricing.base_monthly_usd': data.base_monthly_usd,
          'pricing.storage_overage_per_gb_usd': data.storage_overage_per_gb_usd,
          'pricing.transfer_overage_per_gb_usd': data.transfer_overage_per_gb_usd,
          'pricing.request_overage_per_1m_usd': data.request_overage_per_1m_usd,
          'features.supports_replication': data.supports_replication,
          'features.supports_lifecycle_policies': data.supports_lifecycle_policies,
          'features.api_support': data.api_support,
        },
      },
      { returnDocument: 'after' }
    );
    return result;
  }

  static async deactivate(plan) {
    return QuotaModel.update(plan, { active: false });
  }
}
