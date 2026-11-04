import { ObjectId } from 'mongodb';
import { multipartUploads } from '../index.js';

// One row per in-progress chunked dashboard upload. The storage backend knows the
// upload too, but not who started it or how big it was declared to be — this is
// what ties an upload to its owner and lets each part's size be checked against
// the size the quota was checked for at initiation. Clients address uploads by
// this row's _id, never the storage node's upload_id: those can be long enough
// (MinIO's run ~140 chars) to exceed Fastify's 100-char path-param limit, at
// which point the route silently stops matching and the S3 catch-all answers.
export class MultipartUploadModel {
  static async create(data) {
    const doc = {
      _id: new ObjectId(),
      upload_id: data.upload_id,
      user_id: new ObjectId(data.user_id),
      bucket_id: new ObjectId(data.bucket_id),
      bucket_name: data.bucket_name,
      key: data.key,
      size: data.size,
      part_size: data.part_size,
      content_type: data.content_type,
      created_at: new Date(),
    };
    await multipartUploads().insertOne(doc);
    return doc;
  }

  static async findForUser(id, userId) {
    if (!ObjectId.isValid(id)) return null;
    return multipartUploads().findOne({ _id: new ObjectId(id), user_id: new ObjectId(userId) });
  }

  static async listOlderThan(date) {
    return multipartUploads().find({ created_at: { $lt: date } }).toArray();
  }

  static async delete(id) {
    await multipartUploads().deleteOne({ _id: new ObjectId(id) });
  }
}
