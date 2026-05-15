import { ObjectId } from 'mongodb';
import { apiCredentials } from '../index.js';

export class ApiCredentialModel {
  static async create(data) {
    const credential = {
      _id: new ObjectId(),
      user_id: new ObjectId(data.user_id),
      access_key: data.access_key,
      secret_key: data.secret_key, // Stored plaintext for S3 SigV4 validation
      // Note: In production, consider encrypting this field with a master key
      name: data.name,
      created_at: new Date(),
      updated_at: new Date(),
      last_used_at: null,
      active: true,
      expires_at: data.expires_at || null,
    };

    await apiCredentials().insertOne(credential);
    return credential;
  }

  static async findByAccessKey(accessKey) {
    return apiCredentials().findOne({ access_key: accessKey, active: true });
  }

  static async findById(credentialId) {
    return apiCredentials().findOne({ _id: new ObjectId(credentialId) });
  }

  static async findByUserId(userId, limit = 50, offset = 0) {
    const query = { user_id: new ObjectId(userId) };
    const total = await apiCredentials().countDocuments(query);
    const items = await apiCredentials()
      .find(query)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }

  static async updateLastUsed(credentialId) {
    return apiCredentials().updateOne(
      { _id: new ObjectId(credentialId) },
      { $set: { last_used_at: new Date() } }
    );
  }

  static async revoke(credentialId) {
    return apiCredentials().updateOne(
      { _id: new ObjectId(credentialId) },
      { $set: { active: false, updated_at: new Date() } }
    );
  }

  static async countActiveByUserId(userId) {
    return apiCredentials().countDocuments({
      user_id: new ObjectId(userId),
      active: true,
    });
  }
}
