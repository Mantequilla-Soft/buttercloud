import { ObjectId } from 'mongodb';
import { storageNodes } from '../index.js';

export class StorageNodeModel {
  static async create(data) {
    const node = {
      _id: new ObjectId(),
      name: data.name,
      endpoint: data.endpoint,
      capacity_total_bytes: data.capacity_total_bytes,
      capacity_used_bytes: 0,
      status: 'healthy',
      region: data.region || 'default',
      created_at: new Date(),
      updated_at: new Date(),
      last_health_check: new Date(),
      health_check_interval_seconds: 300,
      metadata: {
        minio_version: null,
        hostname: data.hostname || null,
        disk_type: data.disk_type || 'hdd',
      },
    };

    await storageNodes().insertOne(node);
    return node;
  }

  static async findById(nodeId) {
    return storageNodes().findOne({ _id: new ObjectId(nodeId) });
  }

  static async findByName(name) {
    return storageNodes().findOne({ name });
  }

  static async findAll(status = null) {
    const query = status ? { status } : {};
    return storageNodes().find(query).toArray();
  }

  static async update(nodeId, data) {
    const result = await storageNodes().findOneAndUpdate(
      { _id: new ObjectId(nodeId) },
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

  static async updateHealth(nodeId, status) {
    return StorageNodeModel.update(nodeId, {
      status,
      last_health_check: new Date(),
    });
  }

  static async updateCapacity(nodeId, usedBytes, totalBytes) {
    return StorageNodeModel.update(nodeId, {
      capacity_used_bytes: usedBytes,
      capacity_total_bytes: totalBytes,
    });
  }

  static async incrementUsed(nodeId, bytes) {
    return storageNodes().updateOne(
      { _id: new ObjectId(nodeId) },
      { $inc: { capacity_used_bytes: bytes }, $set: { updated_at: new Date() } }
    );
  }

  static async getLeastUsedNode(region = 'default') {
    // capacity_used_bytes is kept accurate by reconcileNodeUsage (startup + hourly)
    const query = region
      ? { status: 'healthy', 'metadata.region': region }
      : { status: 'healthy' };

    let nodes = await storageNodes()
      .find(query)
      .sort({ capacity_used_bytes: 1 })
      .limit(1)
      .toArray();

    if (nodes.length === 0) {
      // Fallback: any healthy node regardless of region
      nodes = await storageNodes()
        .find({ status: 'healthy' })
        .sort({ capacity_used_bytes: 1 })
        .limit(1)
        .toArray();
    }

    return nodes.length > 0 ? nodes[0] : null;
  }
}
