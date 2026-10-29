import { proxyToMinIO } from './proxy.js';
import { trackUsageAsync, trackDownload } from '../services/usage.js';
import { BucketModel } from '../db/models/Bucket.js';
import { UserModel } from '../db/models/User.js';

/**
 * Unsigned GET/HEAD on objects in a `public_read` bucket (issue #22).
 *
 * HLS can't be played through presigned URLs: manifest.m3u8 refers to
 * 480p/index.m3u8, which refers to 480p_0.ts, all by relative path, and a signed
 * playlist URL doesn't sign the files it points to. A public_read bucket lets a CDN
 * pull zone (or a player) fetch the objects with no signature at all.
 *
 * Only object reads are opened up. Listing, PUT, DELETE and multipart still need
 * SigV4, and so does every bucket without the flag.
 */

// Unsigned GETs to anything that isn't a public object fall through to the SPA,
// so a public bucket with one of these names would hide that page (or the static
// assets / API). The admin API refuses to set the flag on them.
export const RESERVED_PUBLIC_NAMES = new Set([
  'api', 'health', 'assets',
  'login', 'signup', 'verify-email', 'forgot-password', 'reset-password',
  'files', 'keys', 'usage', 'billing', 'account', 'docs', 'admin',
]);

// Request headers worth passing to the storage node for a public read. Everything
// else is dropped rather than signed and forwarded on an anonymous caller's behalf
// (x-amz-* request options in particular).
const FORWARDED_HEADERS = [
  'range', 'if-range',
  'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since',
];

/**
 * Look up the public_read bucket an unsigned request is aimed at.
 * Returns the bucket, or null when the request should fall through to the SPA.
 */
export async function findPublicBucket(firstSegment) {
  if (!firstSegment || RESERVED_PUBLIC_NAMES.has(firstSegment)) return null;
  const bucket = await BucketModel.findByName(firstSegment);
  return bucket?.public_read === true ? bucket : null;
}

export async function handlePublicRead(request, reply, bucket, objectKey) {
  // Bucket-level requests would be ListObjects or HeadBucket. Neither is public.
  if (!objectKey || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return reply.code(403).send({ Code: 'AccessDenied', Message: 'Missing Authorization header' });
  }

  // A deactivated account stops being served, the same as its signed requests.
  const owner = await UserModel.findById(bucket.user_id.toString());
  if (!owner || !owner.active) {
    return reply.code(403).send({ Code: 'AccessDenied', Message: 'Access denied' });
  }

  // The query string is dropped entirely: no ?acl, ?tagging, ?presign or
  // response-* overrides for anonymous callers. A CDN appending cache-busting
  // parameters still gets the plain object.
  const headers = {};
  for (const name of FORWARDED_HEADERS) {
    if (request.headers[name] !== undefined) headers[name] = request.headers[name];
  }
  const path = request.url.split('?')[0];
  const response = await proxyToMinIO(
    { method: request.method, url: path, headers, body: undefined },
    bucket.bucket_name
  );

  if (request.method === 'GET' && (response.status === 200 || response.status === 206)) {
    const contentLength = parseInt(response.headers['content-length'] || '0');
    trackUsageAsync(() => trackDownload(bucket.user_id.toString(), null, bucket.bucket_name, contentLength));
  }

  return reply.code(response.status).headers(response.headers).send(response.body);
}
