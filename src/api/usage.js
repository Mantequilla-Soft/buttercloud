import { validateJWT } from '../middleware/jwt.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { BillingRecordModel } from '../db/models/BillingRecord.js';
import { BucketModel } from '../db/models/Bucket.js';
import { getUserQuotaInfo } from '../gateway/quota.js';

export async function registerUsageRoutes(fastify) {
  // GET /api/v1/usage
  fastify.get('/api/v1/usage', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      const month = request.query.month || getMonthString(new Date());
      const usage = await UsageMetricModel.findByUserAndMonth(request.user.id, month);

      if (!usage) {
        // Return empty usage for current month
        return reply.code(200).send({
          month,
          period_start: new Date(month).toISOString(),
          period_end: new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 0).toISOString(),
          storage_avg_bytes: 0,
          storage_avg_gb: 0,
          upload_bytes: 0,
          upload_gb: 0,
          download_bytes: 0,
          download_gb: 0,
          request_count: 0,
          put_requests: 0,
          get_requests: 0,
          delete_requests: 0,
          finalized: false,
        });
      }

      // Get quota info
      const quotaInfo = await getUserQuotaInfo(request.user.id, request.user.plan);

      return reply.code(200).send({
        month: usage.month.toISOString().substring(0, 7),
        period_start: usage.month.toISOString(),
        period_end: new Date(usage.month.getUTCFullYear(), usage.month.getUTCMonth() + 1, 0).toISOString(),
        storage_avg_bytes: usage.storage_avg_bytes,
        storage_avg_gb: Math.round((usage.storage_avg_bytes / (1024 * 1024 * 1024)) * 100) / 100,
        upload_bytes: usage.upload_bytes,
        upload_gb: Math.round((usage.upload_bytes / (1024 * 1024 * 1024)) * 100) / 100,
        download_bytes: usage.download_bytes,
        download_gb: Math.round((usage.download_bytes / (1024 * 1024 * 1024)) * 100) / 100,
        request_count: usage.request_count,
        put_requests: usage.put_requests,
        get_requests: usage.get_requests,
        delete_requests: usage.delete_requests,
        quota_bytes: quotaInfo.limits.storage_gb * 1024 * 1024 * 1024,
        quota_gb: quotaInfo.limits.storage_gb,
        usage_percent: quotaInfo.currentUsage
          ? Math.round((quotaInfo.currentUsage.storage_bytes / (quotaInfo.limits.storage_gb * 1024 * 1024 * 1024)) * 10000) / 100
          : 0,
        finalized: usage.finalized,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'usage_query_failed',
        message: error.message,
      });
    }
  });

  // GET /api/v1/bucket — current user's bucket info for SDK quick-start
  fastify.get('/api/v1/bucket', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return;

      const bucket = await BucketModel.findByUserId(request.user.id);
      if (!bucket) return reply.code(404).send({ error: 'no_bucket', message: 'No bucket provisioned yet.' });

      return reply.code(200).send({
        bucket_name: bucket.bucket_name,
        region: bucket.metadata?.region || 'default',
        quota_bytes: bucket.quota_bytes,
        current_usage_bytes: bucket.current_usage_bytes,
      });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error', message: error.message });
    }
  });

  // GET /api/v1/usage/history — last 6 months, oldest first, zeros for missing months
  fastify.get('/api/v1/usage/history', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return;

      const metrics = await UsageMetricModel.findLastNMonths(request.user.id, 6);
      const metricsMap = Object.fromEntries(
        metrics.map(m => [m.month.toISOString().substring(0, 7), m])
      );

      const history = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setUTCDate(1);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCMonth(d.getUTCMonth() - i);
        const monthStr = d.toISOString().substring(0, 7);
        const m = metricsMap[monthStr];
        const gb = v => Math.round((v / 1024 ** 3) * 100) / 100;
        history.push({
          month: monthStr,
          storage_avg_gb: m ? gb(m.storage_avg_bytes) : 0,
          upload_gb:      m ? gb(m.upload_bytes)      : 0,
          download_gb:    m ? gb(m.download_bytes)     : 0,
          request_count:  m ? m.request_count          : 0,
        });
      }

      return reply.code(200).send({ history });
    } catch (error) {
      return reply.code(500).send({ error: 'history_query_failed', message: error.message });
    }
  });

  // GET /api/v1/quota
  fastify.get('/api/v1/quota', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      const quotaInfo = await getUserQuotaInfo(request.user.id, request.user.plan);

      return reply.code(200).send({
        plan: request.user.plan,
        limits: {
          storage_gb: quotaInfo.limits.storage_gb,
          monthly_transfer_gb: quotaInfo.limits.monthly_transfer_gb,
          monthly_requests: quotaInfo.limits.monthly_requests,
          max_object_size_gb: quotaInfo.limits.max_object_size_gb,
          max_buckets: quotaInfo.limits.max_buckets,
        },
        pricing: quotaInfo.pricing,
        current_usage: quotaInfo.currentUsage
          ? {
              storage_gb: Math.round((quotaInfo.currentUsage.storage_bytes / (1024 * 1024 * 1024)) * 100) / 100,
            }
          : null,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'quota_query_failed',
        message: error.message,
      });
    }
  });

  // GET /api/v1/billing
  fastify.get('/api/v1/billing', async (request, reply) => {
    try {
      await validateJWT(request, reply);
      if (!request.user) return; // Auth failed

      const limit = Math.min(parseInt(request.query.limit || '20'), 100);
      const offset = parseInt(request.query.offset || '0');
      const status = request.query.status || null;

      const result = await BillingRecordModel.listByUser(request.user.id, limit, offset, status);

      return reply.code(200).send({
        invoices: result.items.map(invoice => ({
          id: invoice._id.toString(),
          month: invoice.month.toISOString().substring(0, 7),
          period_start: invoice.period_start.toISOString(),
          period_end: invoice.period_end.toISOString(),
          storage_charge_usd: invoice.storage_charge,
          transfer_charge_usd: invoice.transfer_charge,
          request_charge_usd: invoice.request_charge,
          base_fee_usd: invoice.base_fee,
          subtotal_usd: invoice.subtotal,
          tax_usd: invoice.tax,
          total_usd: invoice.total,
          status: invoice.status,
          due_date: invoice.due_date.toISOString(),
          payment_received_at: invoice.payment_received_at?.toISOString() || null,
          created_at: invoice.created_at.toISOString(),
        })),
        total: result.total,
        limit,
        offset,
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'billing_query_failed',
        message: error.message,
      });
    }
  });
}

/**
 * Get current month as YYYY-MM string
 */
function getMonthString(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
