import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  isDev: process.env.NODE_ENV === 'development',

  // MongoDB
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/buttercloud',
    dbName: process.env.MONGODB_DB_NAME || 'buttercloud',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expirationSeconds: parseInt(process.env.JWT_EXPIRATION || '3600'),
  },

  // MinIO
  minio: {
    rootUser: process.env.MINIO_ROOT_USER || 'minioadmin',
    rootPassword: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
    internalEndpoint: process.env.MINIO_INTERNAL_ENDPOINT || 'http://localhost:9000',
  },

  // Hashing
  hashing: {
    apiKeyHashRounds: parseInt(process.env.API_KEY_HASH_ROUNDS || '10'),
    passwordHashRounds: parseInt(process.env.PASSWORD_HASH_ROUNDS || '10'),
  },

  // Quotas
  quotas: {
    maxApiKeysPerUser: parseInt(process.env.MAX_API_KEYS_PER_USER || '10'),
    maxBucketsPerUser: parseInt(process.env.MAX_BUCKETS_PER_USER || '1'),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '1000'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },

  // Admin
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@buttercloud.com',
    password: process.env.ADMIN_PASSWORD || 'AdminPassword123!',
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
};

// Validate critical config
if (!config.jwt.secret) {
  throw new Error('JWT_SECRET environment variable is required');
}

if (!config.mongodb.uri) {
  throw new Error('MONGODB_URI environment variable is required');
}
