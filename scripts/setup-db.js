import { connectDB, disconnectDB } from '../src/db/index.js';
import { QuotaModel } from '../src/db/models/Quota.js';

async function setupDatabase() {
  console.log('🔧 Setting up Buttercloud database...\n');

  try {
    // Connect to MongoDB
    console.log('📊 Connecting to MongoDB...');
    await connectDB();
    console.log('✓ Connected to MongoDB\n');

    // Create indexes
    console.log('🔍 Creating indexes...');
    await createIndexes();
    console.log('✓ Indexes created\n');

    // Seed quota plans
    console.log('💰 Seeding quota plans...');
    await seedQuotas();
    console.log('✓ Quota plans seeded\n');

    console.log('✅ Database setup complete!\n');
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

async function createIndexes() {
  const db = (await import('../src/db/index.js')).getDB();

  const indexes = [
    // users
    { collection: 'users', index: { email: 1 }, options: { unique: true } },
    { collection: 'users', index: { active: 1 } },
    { collection: 'users', index: { created_at: 1 } },

    // api_credentials (critical for every request)
    { collection: 'api_credentials', index: { access_key: 1 }, options: { unique: true } },
    { collection: 'api_credentials', index: { user_id: 1 } },
    { collection: 'api_credentials', index: { active: 1 } },

    // buckets
    { collection: 'buckets', index: { bucket_name: 1 }, options: { unique: true } },
    { collection: 'buckets', index: { user_id: 1 } },
    { collection: 'buckets', index: { node_id: 1 } },
    { collection: 'buckets', index: { deleted_at: 1 } },

    // storage_nodes
    { collection: 'storage_nodes', index: { name: 1 }, options: { unique: true } },
    { collection: 'storage_nodes', index: { status: 1 } },
    { collection: 'storage_nodes', index: { region: 1 } },

    // usage_metrics
    {
      collection: 'usage_metrics',
      index: { user_id: 1, month: 1 },
      options: { unique: true },
    },
    { collection: 'usage_metrics', index: { finalized: 1 } },

    // billing_records
    {
      collection: 'billing_records',
      index: { user_id: 1, month: 1 },
      options: { unique: true },
    },
    { collection: 'billing_records', index: { status: 1 } },
    { collection: 'billing_records', index: { due_date: 1 } },

    // audit_log (with TTL)
    { collection: 'audit_log', index: { expires_at: 1 }, options: { expireAfterSeconds: 0 } },
    { collection: 'audit_log', index: { user_id: 1, timestamp: 1 } },

    // credits
    { collection: 'credits', index: { user_id: 1, applied_to_invoice_id: 1 } },
  ];

  for (const { collection, index, options = {} } of indexes) {
    try {
      await db.collection(collection).createIndex(index, options);
      console.log(`  ✓ ${collection}: ${JSON.stringify(index)}`);
    } catch (error) {
      if (error.code === 48) {
        // Index already exists - OK
        console.log(`  ℹ ${collection}: ${JSON.stringify(index)} (already exists)`);
      } else {
        throw error;
      }
    }
  }
}

async function seedQuotas() {
  // Initial values for new installs only — see the create-only note below.
  // All monetary values in cents; per-GB rates may be fractional cents
  // (0.5 = $0.005/GB = $5/TB). Included transfer = 3× storage, and overage is
  // charged at the plan's own per-TB rate, so going over is never a price cliff.
  const quotas = [
    {
      plan: 'free',
      storage_gb: 10,              // 10 GB
      monthly_transfer_gb: 30,     // 30 GB (3× storage)
      monthly_requests: 10000,
      max_object_size_gb: 0.5,     // 500 MB max file
      max_buckets: 1,
      base_monthly_usd: 0,
      storage_overage_per_gb_usd: 0,   // hard-blocked at limit, no overage
      transfer_overage_per_gb_usd: 0,
      request_overage_per_1m_usd: 0,
      supports_replication: false,
      supports_lifecycle_policies: false,
      api_support: true,
    },
    {
      plan: 'starter',
      storage_gb: 1000,            // 1 TB
      monthly_transfer_gb: 3000,   // 3 TB
      monthly_requests: 100000,
      max_object_size_gb: 5,
      max_buckets: 1,
      base_monthly_usd: 500,       // $5/month ($5/TB)
      storage_overage_per_gb_usd: 0.5,   // $5/TB
      transfer_overage_per_gb_usd: 0.5,  // $5/TB
      request_overage_per_1m_usd: 0,
      supports_replication: false,
      supports_lifecycle_policies: true,
      api_support: true,
    },
    {
      plan: 'professional',
      storage_gb: 10000,           // 10 TB
      monthly_transfer_gb: 30000,  // 30 TB
      monthly_requests: 1000000,
      max_object_size_gb: 10,
      max_buckets: 1,
      base_monthly_usd: 4000,      // $40/month ($4/TB)
      storage_overage_per_gb_usd: 0.45,  // $4.50/TB
      transfer_overage_per_gb_usd: 0.4,  // $4/TB
      request_overage_per_1m_usd: 0,
      supports_replication: true,
      supports_lifecycle_policies: true,
      api_support: true,
    },
    {
      plan: 'enterprise',
      storage_gb: 100000,          // 100 TB
      monthly_transfer_gb: 300000, // 300 TB
      monthly_requests: 10000000,
      max_object_size_gb: 50,
      max_buckets: 1,
      base_monthly_usd: 35000,     // $350/month ($3.50/TB)
      storage_overage_per_gb_usd: 0.4,   // $4/TB
      transfer_overage_per_gb_usd: 0.3,  // $3/TB
      request_overage_per_1m_usd: 0,
      supports_replication: true,
      supports_lifecycle_policies: true,
      api_support: true,
    },
    {
      // For accounts that shouldn't be billed — e.g. 3Speak's own account storing
      // its own videos, since 3Speak pays for the infrastructure directly. Usage is
      // still tracked and a real $0 invoice is still generated every month (an
      // explicit record, not a silent skip) — see services/billing.js. Not tied to
      // admin access in any way; is_admin is a fully separate concern (see User model).
      plan: 'house',
      storage_gb: 50000,           // 50 TB — adjust to the actual node capacity in use
      monthly_transfer_gb: 500000, // 500 TB
      monthly_requests: 100000000,
      max_object_size_gb: 50,
      max_buckets: 1,
      base_monthly_usd: 0,
      storage_overage_per_gb_usd: 0,
      transfer_overage_per_gb_usd: 0,
      request_overage_per_1m_usd: 0,
      supports_replication: true,
      supports_lifecycle_policies: true,
      api_support: true,
    },
  ];

  // Create-only by default: once a plan exists, its rates and limits belong to
  // the admin dashboard (PATCH /api/v1/admin/plans/:plan), and update.sh re-runs
  // this script on every deploy — overwriting here would silently revert admin
  // edits. Pass --reset-plans to force the values below back onto existing plans.
  const resetPlans = process.argv.includes('--reset-plans');

  for (const quotaData of quotas) {
    const existing = await QuotaModel.findByPlan(quotaData.plan);
    if (existing && resetPlans) {
      await QuotaModel.update(quotaData.plan, quotaData);
      console.log(`  ↺ Reset ${quotaData.plan} quota plan to seed values`);
    } else if (existing) {
      console.log(`  ℹ ${quotaData.plan} quota plan exists (left as-is; --reset-plans to overwrite)`);
    } else {
      await QuotaModel.create(quotaData);
      console.log(`  ✓ Seeded ${quotaData.plan} quota plan`);
    }
  }
}

setupDatabase();
