import { UserModel } from '../db/models/User.js';
import { BillingRecordModel } from '../db/models/BillingRecord.js';
import { config } from '../config.js';

/**
 * Whether a user's account is currently suspended from uploading (PUT/POST).
 * GET/DELETE/HEAD are never affected by this — suspension blocks new writes,
 * it never cuts a customer off from their own data.
 *
 * Suspension is derived from billing state by default — an account with an
 * invoice that's been overdue for longer than the configured grace period is
 * suspended, and the moment that invoice is marked paid (status leaves
 * 'overdue'), suspension lifts automatically on the very next request. No
 * separate "lift" step is needed or possible to forget.
 *
 * Two things short-circuit that derivation:
 * - plan: 'house' accounts are never billed in the first place, so they can
 *   never be suspended for non-payment, regardless of invoice state.
 * - suspension_override, set by an admin via PATCH /api/v1/admin/users/:id,
 *   forces the outcome either way ('suspended' or 'exempt') regardless of what
 *   the billing records say.
 */
export async function isUploadSuspended(userId) {
  const user = await UserModel.findById(userId);
  if (!user) return false;

  if (user.plan === 'house') return false;
  if (user.suspension_override === 'exempt') return false;
  if (user.suspension_override === 'suspended') return true;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.billing.suspensionGraceDays);

  return BillingRecordModel.hasInvoiceOverdueBeyond(userId, cutoff);
}
