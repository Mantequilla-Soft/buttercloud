// One-time migration: before this, admin status was encoded as plan: 'admin',
// conflating role with billing plan (and silently breaking monthly invoice
// generation for those accounts, since no 'admin' quota plan exists).
//
// This finds every user with plan: 'admin', sets is_admin: true, and moves them
// to a real billing plan (defaults to 'free' — change below if you'd rather bill
// them normally, or wait for the house plan once that's built).
//
// Safe to run more than once — accounts already migrated won't match the query.
import { connectDB, disconnectDB } from '../src/db/index.js';
import { UserModel } from '../src/db/models/User.js';
import { getDB } from '../src/db/index.js';

const FALLBACK_PLAN = 'free';

async function migrate() {
  await connectDB();

  const db = getDB();
  const legacyAdmins = await db.collection('users').find({ plan: 'admin' }).toArray();

  if (legacyAdmins.length === 0) {
    console.log('No plan: "admin" accounts found — nothing to migrate.');
  } else {
    console.log(`Found ${legacyAdmins.length} account(s) with plan: "admin":`);
    for (const user of legacyAdmins) {
      console.log(`  - ${user.email}`);
      await UserModel.update(user._id.toString(), {
        is_admin: true,
        plan: FALLBACK_PLAN,
      });
    }
    console.log(`\nMigrated. Each is now is_admin: true, plan: "${FALLBACK_PLAN}".`);
    console.log('Change their plan via the admin dashboard if they should be billed differently.');
  }

  await disconnectDB();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
