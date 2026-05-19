# Storage Backends — MinIO is Just One Option

Buttercloud's S3 gateway is backend-agnostic. The storage layer is a thin adapter: any service that speaks the S3 API can sit underneath it. MinIO is the default because it's free, self-hosted, and runs on any VPS — but it is not special. Swapping it out is a config change, not a code change.

---

## How the storage layer works

Every object operation (upload, download, delete, list) flows through `src/gateway/proxy.js`. That file reads the target node's endpoint from MongoDB (`storage_nodes` collection) and proxies the request using standard AWS Signature V4. It does not import anything MinIO-specific.

```
Client request (SigV4)
       │
       ▼
Buttercloud gateway         ← auth, quota, usage tracking
       │
       ▼
proxyToMinIO()              ← despite the name, just an HTTP proxy
       │
       ▼
Any S3-compatible endpoint  ← MinIO, Ceph, R2, Backblaze, Wasabi, AWS…
```

The function is called `proxyToMinIO` for historical reasons. It could as well be called `proxyToS3Backend`.

---

## Swapping the backend

1. **Set up your new storage backend** (see options below).
2. **Register it as a node in Buttercloud:**

   ```bash
   node --input-type=module <<'EOF'
   import { connectDB, disconnectDB } from './src/db/index.js';
   import { StorageNodeModel } from './src/db/models/StorageNode.js';
   await connectDB();
   await StorageNodeModel.create({
     name: 'my-new-backend',
     endpoint: 'https://your-backend-endpoint',
     capacity_total_bytes: 10 * 1024 ** 4, // 10 TB
     region: 'us-east-1',
   });
   console.log('Node registered');
   await disconnectDB();
   EOF
   ```

   Or use **Admin → Nodes → Add Node** in the dashboard.

3. **Update `.env`** if you are also replacing the node used for credential management:

   ```env
   MINIO_INTERNAL_ENDPOINT=https://your-backend-endpoint
   MINIO_ROOT_USER=your-access-key
   MINIO_ROOT_PASSWORD=your-secret-key
   ```

4. **Migrate existing buckets** (zero-downtime) via **Admin → Buckets → Migrate**.

No code changes. No redeployment needed except to restart after `.env` changes.

---

## Compatible backends

### Self-hosted

| Backend | Notes |
|---|---|
| **MinIO** | Default. Runs on any Linux VPS. Single-node or distributed cluster. |
| **Ceph (RadosGW)** | Enterprise-grade, multi-node, erasure coding. Heavier to operate. |
| **SeaweedFS** | Lighter than Ceph, good for medium-scale clusters. |
| **Garage** | Rust-based, designed for geo-distributed self-hosting. Very lightweight. |
| **Zenko CloudServer** | Open-source S3 server by Scality. |

### Managed (pay-per-use, no infra)

| Provider | Notes |
|---|---|
| **Cloudflare R2** | No egress fees. Good for high-download workloads (video, media). |
| **Backblaze B2** | Cheap storage ($6/TB/month). Egress free to Cloudflare partners. |
| **Wasabi** | Flat-rate storage, no egress fees. S3-compatible. |
| **AWS S3** | The original. Most expensive at scale but most featureful. |
| **DigitalOcean Spaces** | Simple, S3-compatible, $5/mo base. |
| **Vultr Object Storage** | S3-compatible, good if already on Vultr. |
| **Linode/Akamai Object Storage** | S3-compatible, good if already on Linode. |

---

## Multi-backend setup

Buttercloud supports multiple nodes simultaneously. New user buckets land on the least-loaded node automatically. You can mix backends:

```
Node 1: MinIO on your VPS          ← free-tier users (cheap storage)
Node 2: Cloudflare R2              ← paid plans (no egress cost)
Node 3: Backblaze B2               ← archive / cold storage
```

Each bucket is permanently mapped to the node it was created on. Users can be migrated between nodes at any time via Admin → Buckets → Migrate with no client downtime.

---

## A note on credentials

When a user creates an API key in Buttercloud, the key is stored in MongoDB and validated by Buttercloud's own SigV4 middleware — it is **not** a key issued by the underlying storage backend. The user never has direct access to the backend. This means:

- You can rotate or swap the backend credentials in `.env` without affecting any user's API keys.
- You can move from MinIO to R2 to Backblaze without your customers noticing.
- The access control layer is entirely Buttercloud's — independent of whatever backend is underneath.

---

## Why MinIO is still a good default

- Runs on a $5/mo VPS with 1 GB RAM
- No egress fees (you own the server)
- No per-request charges
- Supports TLS, bucket versioning, lifecycle policies, and distributed mode for larger deployments
- Easy to upgrade to a distributed cluster as you grow (register the cluster as a single Buttercloud node)

For a bootstrapped storage platform, starting on MinIO and migrating high-value customers to R2 or Backblaze as you scale is a perfectly viable strategy — Buttercloud's migration tooling makes it operationally straightforward.
