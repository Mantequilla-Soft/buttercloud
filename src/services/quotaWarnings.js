import { UserModel } from '../db/models/User.js';
import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { BucketModel } from '../db/models/Bucket.js';
import { QuotaModel } from '../db/models/Quota.js';
import { sendQuotaWarningEmail } from './email.js';
import { currentMonth } from './billing.js';

const GB = 1024 ** 3;
const WARN_THRESHOLD = 0.80;

export async function checkAndSendQuotaWarnings() {
  const monthStr = currentMonth();
  const { items: users } = await UserModel.list({ active: true }, 1000, 0);

  for (const user of users) {
    try {
      const quota = await QuotaModel.findByPlan(user.plan);
      if (!quota) continue;

      const usage = await UsageMetricModel.findByUserAndMonth(user._id.toString(), monthStr);
      if (!usage) continue;

      // Storage: compare bucket's current_usage_bytes against its quota_bytes
      const bucket = await BucketModel.findByUserId(user._id.toString());
      if (bucket && bucket.quota_bytes > 0 && !usage.quota_warned?.storage) {
        const pct = bucket.current_usage_bytes / bucket.quota_bytes;
        if (pct >= WARN_THRESHOLD) {
          try {
            await sendQuotaWarningEmail({
              to: user.email,
              usedGb: bucket.current_usage_bytes / GB,
              limitGb: bucket.quota_bytes / GB,
              type: 'storage',
            });
          } catch (e) {
            console.warn(`Storage quota email failed for ${user.email}:`, e.message);
          }
          await UsageMetricModel.setQuotaWarned(user._id.toString(), monthStr, 'storage');
        }
      }

      // Transfer: compare download_bytes against monthly_transfer_gb quota
      const transferLimitBytes = quota.limits.monthly_transfer_gb * GB;
      if (transferLimitBytes > 0 && !usage.quota_warned?.transfer) {
        const pct = usage.download_bytes / transferLimitBytes;
        if (pct >= WARN_THRESHOLD) {
          try {
            await sendQuotaWarningEmail({
              to: user.email,
              usedGb: usage.download_bytes / GB,
              limitGb: quota.limits.monthly_transfer_gb,
              type: 'transfer',
            });
          } catch (e) {
            console.warn(`Transfer quota email failed for ${user.email}:`, e.message);
          }
          await UsageMetricModel.setQuotaWarned(user._id.toString(), monthStr, 'transfer');
        }
      }
    } catch (e) {
      console.warn(`Quota warning check failed for ${user.email}:`, e.message);
    }
  }
}
