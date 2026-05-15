import { BucketModel } from '../db/models/Bucket.js';
import { QuotaModel } from '../db/models/Quota.js';

/**
 * Check if upload is allowed based on bucket quota
 */
export async function checkUploadQuota(bucketId, fileSizeBytes) {
  const bucket = await BucketModel.findById(bucketId);
  if (!bucket) {
    throw new Error('Bucket not found');
  }

  const available = bucket.quota_bytes - bucket.current_usage_bytes;

  if (available < fileSizeBytes) {
    const error = new Error('Quota exceeded');
    error.code = 'QuotaExceeded';
    error.statusCode = 403;
    error.details = {
      quota_bytes: bucket.quota_bytes,
      current_usage_bytes: bucket.current_usage_bytes,
      requested_bytes: fileSizeBytes,
      available_bytes: available,
    };
    throw error;
  }

  return true;
}

/**
 * Check if user can create a bucket (based on plan limits)
 */
export async function checkBucketCreationQuota(userId, userPlan) {
  const quota = await QuotaModel.findByPlan(userPlan);
  if (!quota) {
    throw new Error('Invalid plan');
  }

  // Check max buckets limit (currently 1 per user, but plan could change)
  if (quota.limits.max_buckets === 1) {
    const existingBucket = await BucketModel.findByUserId(userId);
    if (existingBucket) {
      const error = new Error('User already has a bucket');
      error.code = 'BucketAlreadyOwnedByYou';
      error.statusCode = 409;
      throw error;
    }
  }

  return true;
}

/**
 * Get quota info for a user
 */
export async function getUserQuotaInfo(userId, userPlan) {
  const quota = await QuotaModel.findByPlan(userPlan);
  if (!quota) {
    throw new Error('Invalid plan');
  }

  const bucket = await BucketModel.findByUserId(userId);

  return {
    plan: userPlan,
    limits: quota.limits,
    pricing: quota.pricing,
    currentUsage: bucket
      ? {
          storage_bytes: bucket.current_usage_bytes,
          storage_gb: bucket.current_usage_bytes / (1024 * 1024 * 1024),
        }
      : null,
  };
}
