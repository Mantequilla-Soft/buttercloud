import { ObjectId } from 'mongodb';
import { auditLog } from '../index.js';

export class AuditLogModel {
  static async log(data) {
    const entry = {
      _id: new ObjectId(),
      user_id: data.user_id ? new ObjectId(data.user_id) : null,
      action: data.action,
      resource_type: data.resource_type,
      resource_id: data.resource_id ? new ObjectId(data.resource_id) : null,
      resource_name: data.resource_name,
      details: {
        size_bytes: data.size_bytes || null,
        error: data.error || null,
        ip_address: data.ip_address || null,
        user_agent: data.user_agent || null,
      },
      result: data.result || 'success',
      timestamp: new Date(),
      expires_at: new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year TTL
    };

    await auditLog().insertOne(entry);
    return entry;
  }

  static async listByUser(userId, limit = 100, offset = 0) {
    const query = { user_id: new ObjectId(userId) };
    const total = await auditLog().countDocuments(query);
    const items = await auditLog()
      .find(query)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }

  static async listByAction(action, limit = 100) {
    return auditLog()
      .find({ action })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }
}
