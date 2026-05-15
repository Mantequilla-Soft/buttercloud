import crypto from 'crypto';
import { ApiCredentialModel } from '../db/models/ApiCredential.js';

/**
 * Generate a new S3 API credential pair
 */
export async function generateCredential(userId, name, expiresInDays = null) {
  // Check credential limit
  const count = await ApiCredentialModel.countActiveByUserId(userId);
  if (count >= 10) {
    const error = new Error('Maximum number of active credentials reached');
    error.statusCode = 400;
    throw error;
  }

  // Generate access key (AKIA prefix like AWS)
  const accessKey = 'AKIA' + crypto.randomBytes(16).toString('hex').toUpperCase();

  // Generate secret key (40 characters like AWS)
  const secretKey = crypto.randomBytes(30).toString('base64').substring(0, 40);

  // Calculate expiration
  let expiresAt = null;
  if (expiresInDays) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  }

  // Create credential in database
  const credential = await ApiCredentialModel.create({
    user_id: userId,
    access_key: accessKey,
    secret_key: secretKey, // Stored plaintext for S3 SigV4 validation
    name,
    expires_at: expiresAt,
  });

  return {
    id: credential._id.toString(),
    access_key: accessKey,
    secret_key: secretKey, // Only revealed once
    name,
    created_at: credential.created_at,
    expires_at: expiresAt,
    active: true,
  };
}

/**
 * List credentials for a user (secret_key not included)
 */
export async function listCredentials(userId, limit = 50, offset = 0) {
  const result = await ApiCredentialModel.findByUserId(userId, limit, offset);

  return {
    credentials: result.items.map(cred => ({
      id: cred._id.toString(),
      access_key: cred.access_key,
      name: cred.name,
      created_at: cred.created_at,
      last_used_at: cred.last_used_at,
      active: cred.active,
      expires_at: cred.expires_at,
    })),
    total: result.total,
    limit,
    offset,
  };
}

/**
 * Revoke a credential
 */
export async function revokeCredential(credentialId, userId) {
  const credential = await ApiCredentialModel.findById(credentialId);

  if (!credential) {
    const error = new Error('Credential not found');
    error.statusCode = 404;
    throw error;
  }

  if (credential.user_id.toString() !== userId) {
    const error = new Error('Unauthorized');
    error.statusCode = 403;
    throw error;
  }

  await ApiCredentialModel.revoke(credentialId);

  return { success: true };
}
