import { describe, it, expect, afterEach } from 'vitest';
import { UserModel } from '../src/db/models/User.js';
import { BillingRecordModel } from '../src/db/models/BillingRecord.js';
import { isUploadSuspended } from '../src/services/suspension.js';
import { getDB } from '../src/db/index.js';

afterEach(async () => {
  const db = getDB();
  const colls = await db.listCollections().toArray();
  await Promise.all(colls.map(c => db.collection(c.name).deleteMany({})));
});

async function createUser(overrides = {}) {
  return UserModel.create({
    email: overrides.email || 'test@example.com',
    password_hash: 'x',
    plan: overrides.plan || 'free',
    suspension_override: overrides.suspension_override || null,
  });
}

// Creates a billing record already in the given status, with due_date `daysAgo`
// days in the past (negative = due in the future).
async function createInvoice(userId, status, daysAgo) {
  const record = await BillingRecordModel.create({ user_id: userId, month: '2025-01-01' });
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() - daysAgo);
  return BillingRecordModel.update(record._id.toString(), { status, due_date: dueDate });
}

describe('isUploadSuspended()', () => {
  it('is false for an account with no invoices at all', async () => {
    const user = await createUser();
    expect(await isUploadSuspended(user._id.toString())).toBe(false);
  });

  it('is false for an invoice overdue, but not past the grace period', async () => {
    const user = await createUser();
    await createInvoice(user._id.toString(), 'overdue', 10); // 10 days overdue, default grace is 30
    expect(await isUploadSuspended(user._id.toString())).toBe(false);
  });

  it('is true for an invoice overdue well past the grace period', async () => {
    const user = await createUser();
    await createInvoice(user._id.toString(), 'overdue', 45);
    expect(await isUploadSuspended(user._id.toString())).toBe(true);
  });

  it('is false for a pending (not yet overdue) invoice, however old its due date', async () => {
    const user = await createUser();
    // Never transitioned to 'overdue' by markOverdueAndNotify — shouldn't suspend.
    await createInvoice(user._id.toString(), 'pending', 45);
    expect(await isUploadSuspended(user._id.toString())).toBe(false);
  });

  it('lifts automatically once the invoice is marked paid', async () => {
    const user = await createUser();
    const invoice = await createInvoice(user._id.toString(), 'overdue', 45);
    expect(await isUploadSuspended(user._id.toString())).toBe(true);

    await BillingRecordModel.markPaid(invoice._id.toString());

    expect(await isUploadSuspended(user._id.toString())).toBe(false);
  });

  it('never suspends a house-plan account, regardless of overdue invoices', async () => {
    const user = await createUser({ plan: 'house' });
    await createInvoice(user._id.toString(), 'overdue', 90);
    expect(await isUploadSuspended(user._id.toString())).toBe(false);
  });

  it('admin override "suspended" forces suspension with no overdue invoice at all', async () => {
    const user = await createUser({ suspension_override: 'suspended' });
    expect(await isUploadSuspended(user._id.toString())).toBe(true);
  });

  it('admin override "exempt" prevents suspension despite a long-overdue invoice', async () => {
    const user = await createUser({ suspension_override: 'exempt' });
    await createInvoice(user._id.toString(), 'overdue', 90);
    expect(await isUploadSuspended(user._id.toString())).toBe(false);
  });
});
