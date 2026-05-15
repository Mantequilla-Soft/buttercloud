# Buttercloud

**Self-hosted S3-compatible object storage platform with multi-tenant support**

Rent out storage from your own VPS servers to developers and apps that use AWS S3. Point and go — no code changes required from your customers.

## What is Buttercloud?

Buttercloud is a full-stack storage rental platform built on MinIO. It provides a transparent S3-compatible API gateway, a customer portal for file management, and an admin dashboard for managing users, nodes, and billing.

Your customers point their existing AWS SDKs at your Buttercloud endpoint and get a fully S3-compatible experience — same API, same tools, just your infrastructure.

```
# Customers configure their existing AWS SDK:
endpoint_url = "https://your-buttercloud-domain.com"
aws_access_key_id = "AKIA..."       # issued by Buttercloud
aws_secret_access_key = "..."       # issued by Buttercloud

# Everything else works as-is — no code changes
```

## Features

**S3 Gateway**
- Full AWS Signature Version 4 (SigV4) validation
- Compatible with AWS CLI, boto3, aws-sdk-js, and all standard S3 clients
- PUT, GET, DELETE, HEAD, list-objects, create/delete bucket, list-buckets

**Customer Portal**
- File browser with folder navigation, upload, download, delete, image/video/audio preview
- API key management — create, copy-once secret, revoke
- Usage dashboard — storage, transfer, request breakdown with quota bars
- Billing history — invoice table with status badges
- Account management — profile, plan badge, password change

**Admin Panel**
- User management — list all users, change plans, activate/deactivate
- Storage node management — add nodes, edit capacity, monitor health
- Bucket overview — see all customer buckets across all nodes
- Bucket migration — move a customer's bucket between nodes with no client downtime

**Infrastructure**
- Multi-node MinIO support — distribute buckets across VPS servers
- Automatic node selection — new buckets go to the least-loaded node
- Usage tracking — per-upload/download byte counters, async (non-blocking)
- Quota enforcement — hard limits by plan at the upload level
- Audit logging with automatic 1-year TTL

## Plans

| Plan | Storage | Transfer/mo | Max file | Price |
|------|---------|-------------|----------|-------|
| Free | 500 MB | 5 GB | 500 MB | $0 |
| Starter | 100 GB | 1 TB | 5 GB | $6.25/mo |
| Professional | 1 TB | 10 TB | 10 GB | $37.49/mo |
| Enterprise | 10 TB | 100 TB | 50 GB | $124.99/mo |

## Stack

- **Backend** — Node.js, Fastify, MongoDB, MinIO SDK
- **Frontend** — React, Vite, React Router
- **Auth** — JWT (HS256) for portal, AWS SigV4 for S3 gateway
- **Storage** — MinIO (any number of independent nodes)

## Features

- ✅ **AWS Signature Version 4 Authentication** — Full SigV4 validation
- ✅ **Multi-MinIO Clustering** — Distribute buckets across nodes
- ✅ **Quota Enforcement** — Hard storage limits per customer
- ✅ **Usage Tracking** — Track bandwidth and requests for billing
- ✅ **Admin APIs** — Manage users, nodes, quotas
- ✅ **Audit Logging** — All operations logged for compliance
- ✅ **JWT Authentication** — Secure admin API access
- ✅ **Async Usage Tracking** — Doesn't block API responses

## Requirements

- Node.js 20+
- MongoDB 5.0+ (can be remote)
- MinIO instance(s) — one per VPS

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Mantequilla-Soft/buttercloud.git
cd buttercloud
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
PORT=3000
MONGODB_URI=mongodb://user:pass@your-host:27017/buttercloud?authSource=admin
MONGODB_DB_NAME=buttercloud
JWT_SECRET=change-this-to-a-long-random-string
MINIO_INTERNAL_ENDPOINT=http://your-minio-host:9000
MINIO_ROOT_USER=your-minio-user
MINIO_ROOT_PASSWORD=your-minio-password
```

### 3. Initialize database

Creates indexes and seeds the four plan tiers:

```bash
npm run setup-db
```

### 4. Register your first storage node

```bash
node --input-type=module <<'EOF'
import { connectDB, disconnectDB } from './src/db/index.js';
import { StorageNodeModel } from './src/db/models/StorageNode.js';
import { config } from './src/config.js';
await connectDB();
await StorageNodeModel.create({
  name: 'node-1',
  endpoint: config.minio.internalEndpoint,
  capacity_total_bytes: 150 * 1024 * 1024 * 1024, // 150 GB
  region: 'default',
});
console.log('Node registered');
await disconnectDB();
EOF
```

### 5. Start

```bash
# Backend
npm start

# Frontend dev server (separate terminal)
npm run dev:frontend
```

Open `http://localhost:5173` — sign up, and your first bucket is automatically created.

### 6. Promote yourself to admin

```bash
node --input-type=module <<'EOF'
import { connectDB, disconnectDB } from './src/db/index.js';
import { UserModel } from './src/db/models/User.js';
await connectDB();
const user = await UserModel.findByEmail('your@email.com');
await UserModel.update(user._id.toString(), { plan: 'admin' });
console.log('Done');
await disconnectDB();
EOF
```

Log out and back in — then navigate to `/admin`.

## Architecture

```
Browser / AWS SDK
       |
       v
  Buttercloud (Fastify, port 3000)
       |
  ┌────┴────────────────────────┐
  │  JWT middleware (/api/v1/*) │
  │  SigV4 middleware (S3 reqs) │
  └────┬────────────────────────┘
       |
  ┌────┴──────────┬─────────────────┐
  │  REST API     │  S3 Gateway     │
  │  /api/v1/*    │  /{bucket}/...  │
  └────┬──────────┴────────┬────────┘
       │                   │
  MongoDB            MinIO node(s)
  (users, buckets,   (actual files,
   quotas, billing)   one per VPS)
```

**Key design choices:**
- **Model A gateway** — full transparent proxy so all S3 SDKs work without changes
- **One bucket per user** — simplifies quota enforcement and billing
- **Bucket → node mapping** stored in MongoDB, resolved on every request
- **Async usage tracking** — upload/download counters written after response sent

## S3 API Reference

All standard S3 operations are supported via AWS SigV4:

```
GET    /                        List buckets
PUT    /{bucket}                Create bucket
DELETE /{bucket}                Delete bucket
HEAD   /{bucket}                Check bucket
GET    /{bucket}?list-type=2    List objects
PUT    /{bucket}/{key}          Upload object
GET    /{bucket}/{key}          Download object
DELETE /{bucket}/{key}          Delete object
HEAD   /{bucket}/{key}          Object metadata
POST   /{bucket}/{key}?uploads  Multipart upload
```

## Portal API Reference

All routes require `Authorization: Bearer <token>`:

```
POST   /api/v1/auth/signup          Create account
POST   /api/v1/auth/login           Login
GET    /api/v1/me                   Current user profile
GET    /api/v1/credentials          List API keys
POST   /api/v1/credentials          Create API key
DELETE /api/v1/credentials/:id      Revoke API key
GET    /api/v1/files                List files (MinIO proxy)
POST   /api/v1/files/upload         Upload file
GET    /api/v1/files/download/:key  Download file
DELETE /api/v1/files/:key           Delete file
POST   /api/v1/files/mkdir          Create folder
GET    /api/v1/usage                Monthly usage stats
GET    /api/v1/quota                Quota limits
GET    /api/v1/billing              Invoice history
```

Admin routes (require `plan: admin` or `plan: enterprise`):

```
GET    /api/v1/admin/users               List users
PATCH  /api/v1/admin/users/:id           Update user plan/status
GET    /api/v1/admin/nodes               List storage nodes
POST   /api/v1/admin/nodes               Add storage node
PATCH  /api/v1/admin/nodes/:id           Update node
GET    /api/v1/admin/buckets             List all buckets
POST   /api/v1/admin/buckets/:id/migrate Migrate bucket to another node
```

## Adding More Storage

When a node fills up, register a new MinIO server — new signups automatically land on the least-loaded node:

1. Spin up a new VPS, install MinIO
2. **Admin → Nodes → Add Node** — enter endpoint and capacity
3. New users get buckets on the new node automatically
4. **Admin → Buckets → Migrate** to move existing users with zero client downtime

For larger single-node capacity, MinIO also supports [distributed mode](https://min.io/docs/minio/linux/operations/install-deploy-manage/deploy-minio-multi-node-multi-drive.html) where multiple servers form one cluster — register the cluster as a single node in Buttercloud.

## Production Deployment

```nginx
# Nginx reverse proxy example
server {
    listen 443 ssl;
    server_name storage.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 50G;
    }
}
```

Checklist before going live:
- [ ] Strong, unique `JWT_SECRET` (32+ random characters)
- [ ] Strong MinIO and MongoDB passwords
- [ ] HTTPS on all public endpoints
- [ ] MongoDB backups configured
- [ ] Firewall: only port 443 public, MinIO port internal-only
- [ ] `NODE_ENV=production` in `.env`

## Development

```bash
npm run dev            # Backend with auto-reload
npm run dev:frontend   # Vite dev server (port 5173, proxies /api to :3000)
npm run build:frontend # Build frontend to frontend/dist/
npm run setup-db       # Initialize/update database indexes and plan quotas
```

## License

MIT — see [LICENSE](./LICENSE)

## Contributing

Pull requests welcome. Open an issue first for large changes.

Built by [Mantequilla-Soft](https://github.com/Mantequilla-Soft)
