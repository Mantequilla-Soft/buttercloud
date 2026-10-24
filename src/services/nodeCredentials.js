import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyHex = config.security.nodeCredentialsKey;
  if (!keyHex) {
    throw new Error(
      'NODE_CREDENTIALS_KEY environment variable is required to store per-node storage credentials'
    );
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('NODE_CREDENTIALS_KEY must be a 32-byte key, hex-encoded (64 hex characters)');
  }
  return key;
}

/**
 * Encrypt a credential string for storage. Format: iv:authTag:ciphertext, all hex.
 */
export function encryptCredential(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptCredential(encrypted) {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Resolve the access/secret key to use when talking to a storage node.
 * Falls back to the global MinIO root credentials for nodes that don't carry
 * their own (the default node, or any node registered before this existed) —
 * that's what keeps existing single-backend deployments working unchanged.
 */
export function resolveNodeCredentials(node) {
  if (node?.access_key_encrypted && node?.secret_key_encrypted) {
    return {
      accessKey: decryptCredential(node.access_key_encrypted),
      secretKey: decryptCredential(node.secret_key_encrypted),
    };
  }
  return {
    accessKey: config.minio.rootUser,
    secretKey: config.minio.rootPassword,
  };
}
