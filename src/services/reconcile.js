import { storageNodes, buckets } from '../db/index.js';
import { ObjectId } from 'mongodb';

/**
 * Reconcile capacity_used_bytes on all storage nodes by summing
 * the current_usage_bytes from every bucket assigned to that node.
 *
 * Called on server startup, hourly, and via admin API.
 * Returns a summary of what changed.
 */
export async function reconcileNodeUsage() {
  const nodes = await storageNodes().find({}).toArray();
  const results = [];

  for (const node of nodes) {
    const agg = await buckets().aggregate([
      { $match: { node_id: node._id, deleted_at: null } },
      { $group: { _id: null, total: { $sum: '$current_usage_bytes' } } },
    ]).toArray();

    const actual = agg[0]?.total || 0;
    const stored = node.capacity_used_bytes || 0;

    if (actual !== stored) {
      await storageNodes().updateOne(
        { _id: node._id },
        { $set: { capacity_used_bytes: actual, updated_at: new Date() } }
      );
    }

    results.push({
      node: node.name,
      stored_bytes: stored,
      actual_bytes: actual,
      corrected: actual !== stored,
    });
  }

  return results;
}
