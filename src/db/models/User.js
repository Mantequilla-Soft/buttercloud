import { ObjectId } from 'mongodb';
import { users } from '../index.js';

export class UserModel {
  static async create(data) {
    const user = {
      _id: new ObjectId(),
      email: data.email.toLowerCase(),
      password_hash: data.password_hash,
      plan: data.plan || 'free',
      company_name: data.company_name || null,
      created_at: new Date(),
      updated_at: new Date(),
      active: true,
      deleted_at: null,
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
    return result.value;
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

  static async softDelete(userId) {
    return UserModel.update(userId, { deleted_at: new Date(), active: false });
  }
}
