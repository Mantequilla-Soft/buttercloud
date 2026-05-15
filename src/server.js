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
import { registerFileRoutes } from './api/files.js';

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
  fastify.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    // Apply JWT to all /api/v1/* except /api/v1/auth/* which are public
    if (path.startsWith('/api/v1/') && !path.startsWith('/api/v1/auth/')) {
      await validateJWT(request, reply);
    }
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register Admin API routes
  await registerAuthRoutes(fastify);
  await registerCredentialRoutes(fastify);
  await registerUsageRoutes(fastify);
  await registerAdminUserRoutes(fastify);
  await registerAdminNodeRoutes(fastify);
  await registerAdminBucketRoutes(fastify);
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
