# Storage Backends — MinIO is Just One Option

Buttercloud's S3 gateway is backend-agnostic. The storage layer is a thin adapter: any service that speaks the S3 API can sit underneath it. MinIO has historically been the default — self-hosted, runs on any VPS — but it is not special, and it's no longer the easiest free option for a brand-new node (see the note further down). Swapping backends, or mixing several, is a config change, not a code change.

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
   import { encryptCredential } from './src/services/nodeCredentials.js';
   await connectDB();
   await StorageNodeModel.create({
     name: 'my-new-backend',
     endpoint: 'https://your-backend-endpoint',
     capacity_total_bytes: 10 * 1024 ** 4, // 10 TB
     region: 'us-east-1',
     // Omit these two if this backend shares the global MINIO_ROOT_USER/PASSWORD
     // (only true if it's literally the same MinIO deployment). A genuinely
     // different backend/software gets its own credentials here instead.
     access_key_encrypted: encryptCredential('your-access-key'),
     secret_key_encrypted: encryptCredential('your-secret-key'),
   });
   console.log('Node registered');
   await disconnectDB();
   EOF
   ```

   Or use **Admin → Nodes → Add Node** in the dashboard, which takes `access_key`/`secret_key` fields directly and encrypts them before storing (`NODE_CREDENTIALS_KEY` must be set in `.env` — a 32-byte key, hex-encoded — before you register a node with its own credentials).

3. **Update `.env`** only if you're replacing the *default* node that nothing else overrides credentials for:

   ```env
   MINIO_INTERNAL_ENDPOINT=https://your-backend-endpoint
   MINIO_ROOT_USER=your-access-key
   MINIO_ROOT_PASSWORD=your-secret-key
   ```

4. **Migrate existing buckets** (zero-downtime) via **Admin → Buckets → Migrate**.

No code changes needed for a new node — each one carries its own credentials (or falls back to the global ones above), so two nodes running genuinely different software with different admin accounts can coexist.

---

## Compatible backends

### Self-hosted

| Backend | Notes |
|---|---|
| **Garage** | Rust-based, designed for geo-distributed self-hosting. Very lightweight. Recommended default for new nodes — see the note below on MinIO's distribution changes. |
| **MinIO** | Fine for a node that's already running one. Free binary/Docker distribution discontinued as of late 2025–2026 — see below before planning a new node around it. |
| **Ceph (RadosGW)** | Enterprise-grade, multi-node, erasure coding. Heavier to operate. |
| **SeaweedFS** | Lighter than Ceph, good for medium-scale clusters. |
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

## A note on MinIO specifically (as of late 2025–2026)

MinIO is no longer a straightforward default for a **new** node. The company discontinued free distribution of the community edition: pre-compiled binary releases stopped around October 2025, and the `minio/minio`/`minio/mc` images were pulled from both Docker Hub and Quay.io around September 2026 (Quay had been the common workaround until it too started requiring auth). None of this was ever confirmed via an official MinIO announcement we could find — multiple independent reports converge on the same timeline, which is enough to treat it as real, but exact dates aren't guaranteed.

Practical upshot:
- **An existing MinIO deployment** (image already pulled, binary already installed) keeps working fine — nothing about this breaks what's already running.
- **A brand new MinIO node is no longer a quick `docker pull` away.** If you hit `unauthorized: access to the requested resource is not authorized` pulling `minio/minio` or `quay.io/minio/minio`, that's this, not a mistake on your end.
- One source also flagged a CVE (reportedly CVSS 8.8, an auth bypass) against the last freely-distributed community release — verify independently against NVD before treating that as confirmed, but it's a reason not to go hunting for a cached copy of an old image as a workaround.

**[Garage](https://garagehq.deuxfleurs.fr/)** is a solid default for new nodes instead: Rust, built specifically for self-hosted/geo-distributed object storage, actively maintained, genuinely open-source, Docker images still freely available as of this writing. It's what we've actually run this through end-to-end — registering a Garage node as a second Buttercloud storage backend, alongside an existing MinIO one, with its own independent credentials.

For a bootstrapped storage platform, starting on a free self-hosted backend (Garage, or an existing MinIO deployment) and migrating high-value customers to R2 or Backblaze as you scale is still a perfectly viable strategy — Buttercloud's migration tooling makes it operationally straightforward regardless of which backend is on either end.
