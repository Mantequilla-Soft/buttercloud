import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { config } from './config.js';
import { connectDB, disconnectDB } from './db/index.js';
import { registerS3Gateway } from './gateway/index.js';
import { validateJWT } from './middleware/jwt.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerCredentialRoutes } from './api/credentials.js';
import { registerUsageRoutes } from './api/usage.js';
import { registerAdminUserRoutes } from './api/admin/users.js';
import { registerAdminNodeRoutes } from './api/admin/nodes.js';
import { registerAdminBucketRoutes } from './api/admin/buckets.js';
import { registerAdminBillingRoutes } from './api/admin/billing.js';
import { registerFileRoutes } from './api/files.js';
import { reconcileNodeUsage } from './services/reconcile.js';
import { generateMonthlyInvoices, previousMonth, markOverdueAndNotify } from './services/billing.js';
import { checkAndSendQuotaWarnings } from './services/quotaWarnings.js';
import { pollHivePayments } from './services/hivePayments.js';

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
        },
      },
    },
  });

  // Register plugins
  await fastify.register(fastifyCors, {
    origin: config.cors.origin,
  });
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50 GB hard cap
  });

  // JWT middleware for protected API routes
  const PUBLIC_PATHS = new Set([
    '/api/v1/auth/signup',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
    '/api/v1/auth/verify-email',
    '/api/v1/auth/forgot-password',
    '/api/v1/auth/reset-password',
  ]);

  fastify.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/v1/') && !PUBLIC_PATHS.has(path)) {
      await validateJWT(request, reply);
    }
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Public payment config — tells the frontend where to send crypto payments
  fastify.get('/api/v1/payment-config', async () => {
    return {
      hive_account: config.hive.account || null,
      currencies: config.hive.account ? ['HBD', 'HIVE'] : [],
      memo_prefix: 'BC-',
    };
  });

  // Register Admin API routes
  await registerAuthRoutes(fastify);
  await registerCredentialRoutes(fastify);
  await registerUsageRoutes(fastify);
  await registerAdminUserRoutes(fastify);
  await registerAdminNodeRoutes(fastify);
  await registerAdminBucketRoutes(fastify);
  await registerAdminBillingRoutes(fastify);
  await registerFileRoutes(fastify);

  // Register S3 gateway (catch-all route, must be last)
  await registerS3Gateway(fastify);

  return fastify;
}

export async function startServer() {
  const fastify = await createServer();

  // Connect to database
  try {
    await connectDB();
    console.log('Database connected');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Reconcile node usage on startup
  try {
    const results = await reconcileNodeUsage();
    const corrected = results.filter(r => r.corrected);
    if (corrected.length) {
      console.log(`Reconciled ${corrected.length} node(s):`, corrected.map(r => `${r.node} ${r.stored_bytes}→${r.actual_bytes} bytes`).join(', '));
    } else {
      console.log('Node usage in sync');
    }
  } catch (e) {
    console.warn('Reconciliation failed (non-fatal):', e.message);
  }

  // Reconcile hourly to catch any drift
  setInterval(async () => {
    try { await reconcileNodeUsage(); } catch {}
  }, 60 * 60 * 1000);

  // Poll HIVE/HBD payments every 60s
  if (config.hive.account) {
    setInterval(async () => {
      try { await pollHivePayments(); } catch (e) {
        console.warn('HIVE payment poll failed:', e.message);
      }
    }, 60 * 1000);
    console.log(`HIVE payment polling active — watching @${config.hive.account}`);
  }

  // Daily billing checks: mark overdue invoices + quota warnings
  async function runDailyBillingChecks() {
    try {
      const flipped = await markOverdueAndNotify();
      if (flipped > 0) console.log(`Marked ${flipped} invoice(s) as overdue`);
    } catch (e) {
      console.warn('markOverdueAndNotify failed (non-fatal):', e.message);
    }
    try {
      await checkAndSendQuotaWarnings();
    } catch (e) {
      console.warn('checkAndSendQuotaWarnings failed (non-fatal):', e.message);
    }
  }

  runDailyBillingChecks();
  setInterval(runDailyBillingChecks, 24 * 60 * 60 * 1000);

  // Auto-generate invoices on the 1st of each month at 02:00 UTC
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCDate() === 1 && now.getUTCHours() === 2) {
      try {
        const results = await generateMonthlyInvoices(previousMonth());
        console.log(`Monthly invoices: ${results.filter(r => !r.skipped && !r.error).length} created`);
      } catch (e) {
        console.error('Invoice generation failed:', e.message);
      }
    }
  }, 60 * 60 * 1000); // check every hour

  // Start server
  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`Server running at http://${config.host}:${config.port}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    await disconnectDB();
    process.exit(1);
  }

  // Graceful shutdown
  const signals = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      await fastify.close();
      await disconnectDB();
      process.exit(0);
    });
  }

  return fastify;
}
