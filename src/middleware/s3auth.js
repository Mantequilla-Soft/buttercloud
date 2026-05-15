import crypto from 'crypto';
import { ApiCredentialModel } from '../db/models/ApiCredential.js';
import { UserModel } from '../db/models/User.js';

/**
 * AWS Signature Version 4 Validation Middleware
 *
 * Validates incoming S3 requests using AWS SigV4 authentication.
 * Extracts the access_key from the Authorization header, looks up the
 * customer's secret_key, and validates the signature.
 *
 * On success, attaches user info to request for downstream handlers.
 */

export async function validateS3Auth(request, reply) {
  // Skip auth for health check and Admin API (uses JWT, not SigV4)
  const path = request.url.split('?')[0]; // Remove query string
  if (path === '/health' || path.startsWith('/api/v1/')) {
    return; // Continue to next handler
  }

  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.code(403).send({
      Code: 'AccessDenied',
      Message: 'Missing Authorization header',
    });
  }

  try {
    // Parse Authorization header
    const parsed = parseAuthorizationHeader(authHeader);
    if (!parsed) {
      return reply.code(403).send({
        Code: 'InvalidArgument',
        Message: 'Invalid Authorization header format',
      });
    }

    const { accessKey, timestamp, region, service, signature, signedHeaders } = parsed;

    // Look up credentials
    const credential = await ApiCredentialModel.findByAccessKey(accessKey);
    if (!credential) {
      return reply.code(403).send({
        Code: 'InvalidAccessKeyId',
        Message: 'The Access Key Id you provided does not exist in our records.',
      });
    }

    // Look up user
    const user = await UserModel.findById(credential.user_id.toString());
    if (!user || !user.active) {
      return reply.code(403).send({
        Code: 'AccessDenied',
        Message: 'User account is inactive',
      });
    }

    // Validate timestamp (within 15 minutes is standard for AWS)
    const requestTime = new Date(timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now - requestTime) / 1000; // seconds
    if (timeDiff > 900) {
      // 15 minutes
      return reply.code(403).send({
        Code: 'RequestTimeTooSkewed',
        Message: 'The difference between the request time and the current time is too large.',
      });
    }

    // Validate signature
    const isValid = await validateSignature(
      request,
      credential.secret_key,
      signature,
      signedHeaders,
      timestamp,
      region,
      service
    );

    if (!isValid) {
      return reply.code(403).send({
        Code: 'SignatureDoesNotMatch',
        Message: 'The request signature we calculated does not match the signature you provided.',
      });
    }

    // Update last used timestamp
    await ApiCredentialModel.updateLastUsed(credential._id);

    // Attach auth info to request for downstream handlers
    request.s3auth = {
      userId: user._id.toString(),
      user,
      credential,
      accessKey,
      timestamp,
      region,
      service,
    };

    // Call the next handler
  } catch (error) {
    console.error('S3 auth validation error:', error);
    return reply.code(500).send({
      Code: 'InternalError',
      Message: 'An error occurred during request authentication.',
    });
  }
}

/**
 * Parse the AWS Authorization header
 * Format: AWS4-HMAC-SHA256 Credential=KEY/DATE/REGION/SERVICE/aws4_request, SignedHeaders=..., Signature=...
 */
function parseAuthorizationHeader(header) {
  const match = header.match(/AWS4-HMAC-SHA256\s+Credential=([^,]+),\s+SignedHeaders=([^,]+),\s+Signature=(.+)/);

  if (!match) return null;

  const [, credential, signedHeaders, signature] = match;
  const [accessKey, date, region, service] = credential.split('/');

  // Convert date (YYYYMMDD) to timestamp (YYYYMMDDTHHMMSSZ)
  // We'll extract from x-amz-date header instead
  return {
    accessKey,
    date,
    region,
    service,
    signature,
    signedHeaders: signedHeaders.split(';'),
  };
}

/**
 * Validate AWS SigV4 signature
 *
 * This reconstructs the canonical request and verifies the signature
 * matches what the client provided.
 */
async function validateSignature(request, secretKeyHash, providedSignature, signedHeaders, timestamp, region, service) {
  try {
    // Get x-amz-date from headers (format: 20240514T185418Z)
    const amzDate = request.headers['x-amz-date'];
    if (!amzDate) return false;

    // Extract date part (YYYYMMDD)
    const dateStamp = amzDate.substring(0, 8);

    // Get the canonical request components
    const method = request.method;
    const path = request.url.split('?')[0]; // Remove query string for now
    const queryString = request.url.includes('?') ? request.url.split('?')[1] : '';
    const host = request.headers.host;

    // Build canonical headers (must be sorted and lowercase)
    const canonicalHeaders = buildCanonicalHeaders(request, signedHeaders, host);

    // Get payload hash from x-amz-content-sha256 header
    const payloadHash = request.headers['x-amz-content-sha256'] || 'UNSIGNED-PAYLOAD';

    // Construct canonical request
    const canonicalRequest = [
      method,
      canonicalizePath(path),
      canonicalizeQueryString(queryString),
      canonicalHeaders,
      signedHeaders.join(';'),
      payloadHash,
    ].join('\n');

    // Compute canonical request hash
    const canonicalRequestHash = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');

    // Construct string to sign
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      `${dateStamp}/${region}/${service}/aws4_request`,
      canonicalRequestHash,
    ].join('\n');

    // Derive signing key
    const kDate = crypto.createHmac('sha256', 'AWS4' + secretKeyHash).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    // Compute signature
    const computedSignature = crypto
      .createHmac('sha256', kSigning)
      .update(stringToSign)
      .digest('hex');

    // Compare signatures (constant-time to prevent timing attacks)
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(providedSignature)
    );
  } catch (error) {
    console.error('Signature validation error:', error);
    return false;
  }
}

/**
 * Build canonical headers string (sorted, lowercase)
 */
function buildCanonicalHeaders(request, signedHeaders, host) {
  const headers = {};

  // Add host (always included)
  headers['host'] = host.toLowerCase();

  // Add all signed headers
  for (const headerName of signedHeaders) {
    const lowerName = headerName.toLowerCase();
    if (lowerName === 'host') continue; // Already added
    const value = request.headers[lowerName];
    if (value) {
      headers[lowerName] = value.toLowerCase().trim();
    }
  }

  // Sort by header name and format
  return Object.keys(headers)
    .sort()
    .map(name => `${name}:${headers[name]}`)
    .join('\n') + '\n';
}

/**
 * Canonicalize path (URI encoding)
 */
function canonicalizePath(path) {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
    .replace(/%2F/g, '/'); // Don't encode slashes
}

/**
 * Canonicalize query string (sorted by key)
 */
function canonicalizeQueryString(queryString) {
  if (!queryString) return '';

  const params = new URLSearchParams(queryString);
  const sorted = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return sorted;
}
