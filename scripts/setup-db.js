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
  // All monetary values in cents. Transfer = 10x storage (our pattern).
  const quotas = [
    {
      plan: 'free',
      storage_gb: 0.5,             // 500 MB
      monthly_transfer_gb: 5,      // 5 GB (10× storage)
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
      storage_gb: 100,             // 100 GB
      monthly_transfer_gb: 1000,   // 1 TB
      monthly_requests: 100000,
      max_object_size_gb: 5,
      max_buckets: 1,
      base_monthly_usd: 625,       // $6.25/month
      storage_overage_per_gb_usd: 38,  // $0.38/GB
      transfer_overage_per_gb_usd: 10, // $0.10/GB
      request_overage_per_1m_usd: 0,
      supports_replication: false,
      supports_lifecycle_policies: true,
      api_support: true,
    },
    {
      plan: 'professional',
      storage_gb: 1000,            // 1 TB
      monthly_transfer_gb: 10000,  // 10 TB
      monthly_requests: 1000000,
      max_object_size_gb: 10,
      max_buckets: 1,
      base_monthly_usd: 3749,      // $37.49/month
      storage_overage_per_gb_usd: 25,  // $0.25/GB
      transfer_overage_per_gb_usd: 6,  // $0.06/GB
      request_overage_per_1m_usd: 0,
      supports_replication: true,
      supports_lifecycle_policies: true,
      api_support: true,
    },
    {
      plan: 'enterprise',
      storage_gb: 10000,           // 10 TB
      monthly_transfer_gb: 100000, // 100 TB
      monthly_requests: 10000000,
      max_object_size_gb: 50,
      max_buckets: 1,
      base_monthly_usd: 12499,     // $124.99/month
      storage_overage_per_gb_usd: 13,  // $0.13/GB
      transfer_overage_per_gb_usd: 3,  // $0.03/GB
      request_overage_per_1m_usd: 0,
      supports_replication: true,
      supports_lifecycle_policies: true,
      api_support: true,
    },
  ];

  // Upsert — re-running setup-db always applies latest values
  for (const quotaData of quotas) {
    const existing = await QuotaModel.findByPlan(quotaData.plan);
    if (existing) {
      await QuotaModel.update(quotaData.plan, quotaData);
      console.log(`  ↺ Updated ${quotaData.plan} quota plan`);
    } else {
      await QuotaModel.create(quotaData);
      console.log(`  ✓ Seeded ${quotaData.plan} quota plan`);
    }
  }
}

setupDatabase();
