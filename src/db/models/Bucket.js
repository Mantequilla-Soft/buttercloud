import { ObjectId } from 'mongodb';
import { buckets } from '../index.js';

export class BucketModel {
  static async create(data) {
    const bucket = {
      _id: new ObjectId(),
      user_id: new ObjectId(data.user_id),
      bucket_name: data.bucket_name,
      node_id: new ObjectId(data.node_id),
      quota_bytes: data.quota_bytes,
      current_usage_bytes: 0,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: {
        region: data.region || 'default',
        replication_enabled: false,
        backup_policy: 'none',
      },
      deleted_at: null,
    };

    await buckets().insertOne(bucket);
    return bucket;
  }

  static async findByName(bucketName) {
    return buckets().findOne({ bucket_name: bucketName, deleted_at: null });
  }

  static async findById(bucketId) {
    return buckets().findOne({ _id: new ObjectId(bucketId), deleted_at: null });
  }

  static async findByUserId(userId) {
    return buckets().findOne({ user_id: new ObjectId(userId), deleted_at: null });
  }

  static async findByNodeId(nodeId, limit = 100, offset = 0) {
    const query = { node_id: new ObjectId(nodeId), deleted_at: null };
    const total = await buckets().countDocuments(query);
    const items = await buckets()
      .find(query)
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }

  static async update(bucketId, data) {
    const result = await buckets().findOneAndUpdate(
      { _id: new ObjectId(bucketId) },
      {
        $set: {
          ...data,
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
    return result.value;
  }

  static async incrementUsage(bucketId, bytes) {
    return buckets().updateOne(
      { _id: new ObjectId(bucketId) },
      {
        $inc: { current_usage_bytes: bytes },
        $set: { updated_at: new Date() },
      }
    );
  }

  static async setUsage(bucketId, bytes) {
    return buckets().updateOne(
      { _id: new ObjectId(bucketId) },
      {
        $set: {
          current_usage_bytes: bytes,
          updated_at: new Date(),
        },
      }
    );
  }

  static async softDelete(bucketId) {
    return BucketModel.update(bucketId, { deleted_at: new Date() });
  }

  static async checkQuotaAvailable(bucketId, bytesNeeded) {
    const bucket = await BucketModel.findById(bucketId);
    if (!bucket) return false;

    const available = bucket.quota_bytes - bucket.current_usage_bytes;
    return available >= bytesNeeded;
  }
}
