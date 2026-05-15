import { UsageMetricModel } from '../db/models/UsageMetric.js';
import { BucketModel } from '../db/models/Bucket.js';
import { AuditLogModel } from '../db/models/AuditLog.js';

/**
 * Track usage asynchronously (fire and forget)
 * This is called after successful S3 operations to record bandwidth and requests
 */

export function trackUsageAsync(fn) {
  // Queue the operation to run asynchronously without blocking the response
  setImmediate(() => {
    fn().catch(error => {
      console.error('Usage tracking error:', error);
      // Silently fail - don't let tracking errors break the API
    });
  });
}

/**
 * Track an upload operation
 */
export async function trackUpload(userId, bucketId, bucketName, fileSizeBytes) {
  const now = new Date();
  const month = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

  // Get or create usage metrics for this month
  await UsageMetricModel.getOrCreate(userId, month);

  // Increment usage counters
  await UsageMetricModel.incrementUpload(userId, month, fileSizeBytes);

  // Update bucket's current usage
  await BucketModel.incrementUsage(bucketId, fileSizeBytes);

  // Log to audit
  await AuditLogModel.log({
    user_id: userId,
    action: 'upload',
    resource_type: 'object',
    resource_name: bucketName,
    size_bytes: fileSizeBytes,
    result: 'success',
  });
}

/**
 * Track a download operation
 */
export async function trackDownload(userId, bucketId, bucketName, fileSizeBytes) {
  const now = new Date();
  const month = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

  // Get or create usage metrics for this month
  await UsageMetricModel.getOrCreate(userId, month);

  // Increment download bytes
  await UsageMetricModel.incrementDownload(userId, month, fileSizeBytes);

  // Log to audit
  await AuditLogModel.log({
    user_id: userId,
    action: 'download',
    resource_type: 'object',
    resource_name: bucketName,
    size_bytes: fileSizeBytes,
    result: 'success',
  });
}

/**
 * Track a delete operation
 */
export async function trackDelete(userId, bucketId, bucketName, fileSizeBytes) {
  const now = new Date();
  const month = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

  // Get or create usage metrics for this month
  await UsageMetricModel.getOrCreate(userId, month);

  // Increment delete request count
  await UsageMetricModel.incrementRequest(userId, month, 'delete');

  // Decrement bucket usage
  await BucketModel.incrementUsage(bucketId, -fileSizeBytes);

  // Log to audit
  await AuditLogModel.log({
    user_id: userId,
    action: 'delete',
    resource_type: 'object',
    resource_name: bucketName,
    size_bytes: fileSizeBytes,
    result: 'success',
  });
}

/**
 * Track a list operation
 */
export async function trackList(userId, bucketName) {
  const now = new Date();
  const month = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

  // Get or create usage metrics for this month
  await UsageMetricModel.getOrCreate(userId, month);

  // Increment request count (LIST counts as 1 request)
  await UsageMetricModel.incrementRequest(userId, month, 'list');

  // Log to audit
  await AuditLogModel.log({
    user_id: userId,
    action: 'list',
    resource_type: 'bucket',
    resource_name: bucketName,
    result: 'success',
  });
}

/**
 * Track a bucket creation
 */
export async function trackBucketCreate(userId, bucketName, quotaBytes) {
  await AuditLogModel.log({
    user_id: userId,
    action: 'create_bucket',
    resource_type: 'bucket',
    resource_name: bucketName,
    size_bytes: quotaBytes,
    result: 'success',
  });
}

/**
 * Track a bucket deletion
 */
export async function trackBucketDelete(userId, bucketName) {
  await AuditLogModel.log({
    user_id: userId,
    action: 'delete_bucket',
    resource_type: 'bucket',
    resource_name: bucketName,
    result: 'success',
  });
}
