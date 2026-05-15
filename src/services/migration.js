import * as Minio from 'minio';
import { config } from '../config.js';

function makeClient(node) {
  const url = new URL(node.endpoint);
  return new Minio.Client({
    endPoint: url.hostname,
    port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
    accessKey: config.minio.rootUser,
    secretKey: config.minio.rootPassword,
  });
}

/**
 * List all objects in a bucket recursively (for migration).
 */
function listAllObjects(client, bucketName) {
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream = client.listObjectsV2(bucketName, '', true); // recursive=true
    stream.on('data', obj => { if (obj.name) objects.push(obj); });
    stream.on('error', reject);
    stream.on('end', () => resolve(objects));
  });
}

/**
 * Migrate a bucket from one node to another.
 * Copies all objects, creates the bucket on destination, then returns the count.
 * Caller is responsible for updating bucket.node_id in MongoDB after success.
 */
export async function migrateBucket(bucketName, sourceNode, destNode) {
  const srcClient  = makeClient(sourceNode);
  const destClient = makeClient(destNode);

  // 1. Create bucket on destination if it doesn't exist
  const exists = await destClient.bucketExists(bucketName);
  if (!exists) {
    await destClient.makeBucket(bucketName, 'us-east-1');
  }

  // 2. List all objects on source
  const objects = await listAllObjects(srcClient, bucketName);

  // 3. Copy each object: download from source, upload to destination
  let copied = 0;
  for (const obj of objects) {
    const stream = await srcClient.getObject(bucketName, obj.name);
    await destClient.putObject(bucketName, obj.name, stream, obj.size, {
      'Content-Type': obj.metaData?.['content-type'] || 'application/octet-stream',
    });
    copied++;
  }

  // 4. Return stats — caller updates MongoDB and optionally deletes from source
  return { objects_copied: copied, bytes_copied: objects.reduce((s, o) => s + o.size, 0) };
}

/**
 * Delete all objects and the bucket itself from a node (post-migration cleanup).
 */
export async function cleanupSourceBucket(bucketName, sourceNode) {
  const client = makeClient(sourceNode);
  const objects = await listAllObjects(client, bucketName);

  for (const obj of objects) {
    await client.removeObject(bucketName, obj.name);
  }

  await client.removeBucket(bucketName);
}
