import { ObjectId } from 'mongodb';
import { billingRecords } from '../index.js';

export class BillingRecordModel {
  static async create(data) {
    const monthDate = new Date(data.month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    const record = {
      _id: new ObjectId(),
      user_id: new ObjectId(data.user_id),
      month: monthDate,
      period_start: new Date(monthDate),
      period_end: new Date(
        monthDate.getUTCFullYear(),
        monthDate.getUTCMonth() + 1,
        0,
        23,
        59,
        59
      ),
      usage_metrics_id: data.usage_metrics_id ? new ObjectId(data.usage_metrics_id) : null,
      storage_charge: data.storage_charge || 0,
      transfer_charge: data.transfer_charge || 0,
      request_charge: data.request_charge || 0,
      base_fee: data.base_fee || 0,
      subtotal: data.subtotal || 0,
      tax: data.tax || 0,
      total: data.total || 0,
      status: 'draft',
      payment_received_at: null,
      due_date: new Date(
        monthDate.getUTCFullYear(),
        monthDate.getUTCMonth() + 1,
        15
      ),
      created_at: new Date(),
      updated_at: new Date(),
    };

    await billingRecords().insertOne(record);
    return record;
  }

  static async findById(recordId) {
    return billingRecords().findOne({ _id: new ObjectId(recordId) });
  }

  static async findByUserAndMonth(userId, month) {
    const monthDate = new Date(month);
    monthDate.setUTCDate(1);
    monthDate.setUTCHours(0, 0, 0, 0);

    return billingRecords().findOne({
      user_id: new ObjectId(userId),
      month: monthDate,
    });
  }

  static async listByUser(userId, limit = 20, offset = 0, status = null) {
    const query = { user_id: new ObjectId(userId) };
    if (status) {
      query.status = status;
    }

    const total = await billingRecords().countDocuments(query);
    const items = await billingRecords()
      .find(query)
      .sort({ month: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }

  static async update(recordId, data) {
    const result = await billingRecords().findOneAndUpdate(
      { _id: new ObjectId(recordId) },
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

  static async markPaid(recordId) {
    return BillingRecordModel.update(recordId, {
      status: 'paid',
      payment_received_at: new Date(),
    });
  }

  static async finalize(recordId) {
    return BillingRecordModel.update(recordId, { status: 'finalized' });
  }

  static async listByStatus(status, limit = 100, offset = 0) {
    const query = { status };
    const total = await billingRecords().countDocuments(query);
    const items = await billingRecords()
      .find(query)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }
}
