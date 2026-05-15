import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel } from '../db/models/User.js';
import { BucketModel } from '../db/models/Bucket.js';
import { StorageNodeModel } from '../db/models/StorageNode.js';
import { QuotaModel } from '../db/models/Quota.js';
import { createBucketInMinIO } from './files.js';
import { config } from '../config.js';

/**
 * Hash a password with bcrypt
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, config.hashing.passwordHashRounds);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Create a JWT token
 */
export function createToken(userId, email, plan) {
  return jwt.sign(
    {
      sub: userId,
      email,
      plan,
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expirationSeconds,
      algorithm: 'HS256',
    }
  );
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
    });
  } catch (error) {
    return null;
  }
}

/**
 * Register a new user
 */
export async function registerUser(email, password, companyName) {
  // Check if user already exists
  const existing = await UserModel.findByEmail(email);
  if (existing) {
    const error = new Error('Email already exists');
    error.statusCode = 400;
    throw error;
  }

  // Validate password strength
  if (!isStrongPassword(password)) {
    const error = new Error('Password must be at least 8 characters with uppercase, lowercase, and numbers');
    error.statusCode = 400;
    throw error;
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const user = await UserModel.create({
    email,
    password_hash: passwordHash,
    company_name: companyName,
    plan: 'free',
  });

  // Auto-provision bucket — all accounts get one on signup
  try {
    const node = await StorageNodeModel.getLeastUsedNode();
    if (node) {
      const quota = await QuotaModel.findByPlan('free');
      const quotaBytes = quota
        ? Math.floor(quota.limits.storage_gb * 1024 * 1024 * 1024)
        : 500 * 1024 * 1024; // fallback: 500 MB

      // Bucket name: slug from email prefix, guaranteed unique via userId suffix
      const emailSlug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
      const bucketName = `${emailSlug}-${user._id.toString().slice(-6)}`;

      await BucketModel.create({
        user_id: user._id.toString(),
        bucket_name: bucketName,
        node_id: node._id.toString(),
        quota_bytes: quotaBytes,
        region: node.region || 'default',
      });

      // Create the bucket in MinIO so it's ready to use immediately
      await createBucketInMinIO(bucketName, node);
    }
  } catch (bucketErr) {
    // Non-fatal — user can still log in, admin can provision later
    console.warn(`Could not auto-create bucket for ${email}:`, bucketErr.message);
  }

  // Create JWT token
  const token = createToken(user._id.toString(), user.email, user.plan);

  return {
    id: user._id.toString(),
    email: user.email,
    plan: user.plan,
    company_name: user.company_name,
    created_at: user.created_at,
    token,
    expires_in: config.jwt.expirationSeconds,
  };
}

/**
 * Login user
 */
export async function loginUser(email, password) {
  // Find user
  const user = await UserModel.findByEmail(email);
  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  // Verify password
  const isValid = await comparePassword(password, user.password_hash);
  if (!isValid) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  // Check if account is active
  if (!user.active) {
    const error = new Error('Account is not active');
    error.statusCode = 403;
    throw error;
  }

  // Create JWT token
  const token = createToken(user._id.toString(), user.email, user.plan);

  return {
    id: user._id.toString(),
    email: user.email,
    plan: user.plan,
    token,
    expires_in: config.jwt.expirationSeconds,
  };
}

/**
 * Validate password strength
 */
function isStrongPassword(password) {
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false; // Must have uppercase
  if (!/[a-z]/.test(password)) return false; // Must have lowercase
  if (!/[0-9]/.test(password)) return false; // Must have number
  return true;
}
