import { ObjectId } from 'mongodb';
import { usageMetrics } from '../index.js';

export class UsageMetricModel {
  static async getOrCreate(userId, month) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    const existing = await usageMetrics().findOne({
      user_id: new ObjectId(userId),
      month: monthDate,
    });

    if (existing) {
      return existing;
    }

    const metric = {
      _id: new ObjectId(),
      user_id: new ObjectId(userId),
      month: monthDate,
      storage_avg_bytes: 0,
      upload_bytes: 0,
      download_bytes: 0,
      request_count: 0,
      put_requests: 0,
      get_requests: 0,
      delete_requests: 0,
      generated_at: new Date(),
      finalized: false,
      quota_warned: { storage: false, transfer: false },
    };

    await usageMetrics().insertOne(metric);
    return metric;
  }

  static async findByUserAndMonth(userId, month) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    return usageMetrics().findOne({
      user_id: new ObjectId(userId),
      month: monthDate,
    });
  }

  static async incrementUpload(userId, month, bytes) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    await usageMetrics().updateOne(
      { user_id: new ObjectId(userId), month: monthDate },
      {
        $inc: {
          upload_bytes: bytes,
          request_count: 1,
          put_requests: 1,
        },
      }
    );
  }

  static async incrementDownload(userId, month, bytes) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    await usageMetrics().updateOne(
      { user_id: new ObjectId(userId), month: monthDate },
      {
        $inc: {
          download_bytes: bytes,
          request_count: 1,
          get_requests: 1,
        },
      }
    );
  }

  static async incrementRequest(userId, month, type = 'other') {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    const updateObj = { $inc: { request_count: 1 } };
    if (type === 'delete') {
      updateObj.$inc.delete_requests = 1;
    }

    await usageMetrics().updateOne(
      { user_id: new ObjectId(userId), month: monthDate },
      updateObj
    );
  }

  static async finalize(userId, month) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    return usageMetrics().updateOne(
      { user_id: new ObjectId(userId), month: monthDate },
      {
        $set: {
          finalized: true,
          generated_at: new Date(),
        },
      }
    );
  }

  static async setQuotaWarned(userId, month, type) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    await usageMetrics().updateOne(
      { user_id: new ObjectId(userId), month: monthDate },
      { $set: { [`quota_warned.${type}`]: true } }
    );
  }

  static async findLastNMonths(userId, n = 6) {
    const cutoff = new Date();
    cutoff.setUTCDate(1);
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - (n - 1));

    return usageMetrics()
      .find({ user_id: new ObjectId(userId), month: { $gte: cutoff } })
      .sort({ month: 1 })
      .toArray();
  }

  static async listUnfinalized(limit = 100) {
    return usageMetrics()
      .find({ finalized: false })
      .limit(limit)
      .toArray();
  }
}
