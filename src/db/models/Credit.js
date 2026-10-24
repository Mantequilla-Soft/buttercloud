import { ObjectId } from 'mongodb';
import { credits } from '../index.js';

export class CreditModel {
  static async create(data) {
    const credit = {
      _id: new ObjectId(),
      user_id: new ObjectId(data.user_id),
      amount_cents: data.amount_cents,
      reason: data.reason || null,
      created_by: new ObjectId(data.created_by),
      created_at: new Date(),
      // Set once this credit has been consumed by an invoice — see
      // services/billing.js's applyCreditsToInvoice.
      applied_to_invoice_id: null,
      applied_at: null,
    };

    await credits().insertOne(credit);
    return credit;
  }

  static async findById(creditId) {
    return credits().findOne({ _id: new ObjectId(creditId) });
  }

  static async listByUser(userId, limit = 50, offset = 0) {
    const query = { user_id: new ObjectId(userId) };
    const total = await credits().countDocuments(query);
    const items = await credits()
      .find(query)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return { items, total };
  }

  /** Unapplied credits for a user, oldest first — the order they get consumed in. */
  static async findUnappliedByUser(userId) {
    return credits()
      .find({ user_id: new ObjectId(userId), applied_to_invoice_id: null })
      .sort({ created_at: 1 })
      .toArray();
  }

  static async markApplied(creditId, invoiceId) {
    return credits().updateOne(
      { _id: new ObjectId(creditId) },
      { $set: { applied_to_invoice_id: new ObjectId(invoiceId), applied_at: new Date() } }
    );
  }
}
