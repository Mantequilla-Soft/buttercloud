import { ObjectId } from 'mongodb';
import { users } from '../index.js';

export class UserModel {
  static async create(data) {
    const user = {
      _id: new ObjectId(),
      email: data.email.toLowerCase(),
      password_hash: data.password_hash,
      plan: data.plan || 'free',
      is_admin: data.is_admin || false,
      // null (default) = suspension is derived from overdue invoices; 'suspended' /
      // 'exempt' are explicit admin overrides that short-circuit that derivation —
      // see src/services/suspension.js.
      suspension_override: data.suspension_override || null,
      company_name: data.company_name || null,
      created_at: new Date(),
      updated_at: new Date(),
      active: true,
      deleted_at: null,
      email_verified: data.email_verified || false,
      verification_token: data.verification_token || null,
      verification_token_expires: data.verification_token_expires || null,
      reset_token: null,
      reset_token_expires: null,
    };

    await users().insertOne(user);
    return user;
  }

  static async findById(userId) {
    return users().findOne({ _id: new ObjectId(userId), deleted_at: null });
  }

  static async findByEmail(email) {
    return users().findOne({ email: email.toLowerCase(), deleted_at: null });
  }

  static async findByVerificationToken(token) {
    return users().findOne({ verification_token: token, deleted_at: null });
  }

  static async findByResetToken(token) {
    return users().findOne({ reset_token: token, deleted_at: null });
  }

  static async update(userId, data) {
    const result = await users().findOneAndUpdate(
      { _id: new ObjectId(userId) },
      {
        $set: {
          ...data,
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
    return result;
  }

  static async list(filter = {}, limit = 50, offset = 0) {
    const query = { deleted_at: null, ...filter };
    const total = await users().countDocuments(query);
    const items = await users()
      .find(query)
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }

  static async idsByPlan(plan) {
    const docs = await users().find({ plan, deleted_at: null }, { projection: { _id: 1 } }).toArray();
    return docs.map(d => d._id);
  }

  // { [plan]: number of non-deleted users on it }
  static async countByPlan() {
    const rows = await users()
      .aggregate([{ $match: { deleted_at: null } }, { $group: { _id: '$plan', count: { $sum: 1 } } }])
      .toArray();
    return Object.fromEntries(rows.map(r => [r._id, r.count]));
  }

  static async softDelete(userId) {
    return UserModel.update(userId, { deleted_at: new Date(), active: false });
  }
}
