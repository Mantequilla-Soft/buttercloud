import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { getMyBucket } from '../../api/usage';
import { listCredentials } from '../../api/credentials';

const SDK = 'YOUR_SECRET_KEY';

function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  function handle() {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={handle} style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      color: copied ? 'var(--sage)' : 'var(--fg-2)',
      cursor: 'pointer',
      fontSize: '11px',
      padding: '3px 10px',
      transition: 'color 0.15s',
    }}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
        <CopyBtn text={code} />
      </div>
      <pre style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        color: 'var(--fg-1)',
        fontSize: '12.5px',
        lineHeight: 1.65,
        margin: 0,
        overflowX: 'auto',
        padding: '16px 16px 16px 20px',
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InfoRow({ label, value, mono = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--fg-2)', fontSize: '13px', minWidth: '130px' }}>{label}</span>
      <span style={{ color: 'var(--fg-1)', fontFamily: mono ? 'monospace' : undefined, fontSize: '13px', flex: 1, wordBreak: 'break-all' }}>
        {value}
      </span>
      <CopyBtn text={value} />
    </div>
  );
}

const TABS = ['AWS CLI', 'Python', 'Node.js', 'rclone'];

export default function Docs() {
  const { token } = useAuth();
  const [bucket, setBucket] = useState(null);
  const [accessKey, setAccessKey] = useState(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [b, creds] = await Promise.all([getMyBucket(token), listCredentials(token)]);
        setBucket(b);
        const active = creds.credentials?.find(c => c.active);
        setAccessKey(active?.access_key || null);
      } catch (e) {
        setError(e.message);
      }
    }
    load();
  }, [token]);

  const endpoint = window.location.origin;
  const bucketName = bucket?.bucket_name || '<YOUR_BUCKET>';
  const ak = accessKey || '<YOUR_ACCESS_KEY>';

  const snippets = [
    // AWS CLI
    `# Install: https://aws.amazon.com/cli/

# Configure
aws configure set aws_access_key_id     ${ak}
aws configure set aws_secret_access_key ${SDK}
aws configure set default.region        us-east-1

# List bucket
aws s3 ls s3://${bucketName}/ --endpoint-url ${endpoint}

# Upload a file
aws s3 cp ./myfile.txt s3://${bucketName}/myfile.txt \\
    --endpoint-url ${endpoint}

# Download a file
aws s3 cp s3://${bucketName}/myfile.txt ./myfile.txt \\
    --endpoint-url ${endpoint}

# Delete a file
aws s3 rm s3://${bucketName}/myfile.txt \\
    --endpoint-url ${endpoint}`,

    // Python
    `# pip install boto3

import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="${endpoint}",
    aws_access_key_id="${ak}",
    aws_secret_access_key="${SDK}",
    region_name="us-east-1",
)

# List objects
resp = s3.list_objects_v2(Bucket="${bucketName}")
for obj in resp.get("Contents", []):
    print(obj["Key"])

# Upload
s3.upload_file("myfile.txt", "${bucketName}", "myfile.txt")

# Download
s3.download_file("${bucketName}", "myfile.txt", "myfile.txt")

# Delete
s3.delete_object(Bucket="${bucketName}", Key="myfile.txt")`,

    // Node.js
    `// npm install @aws-sdk/client-s3

import { S3Client, ListObjectsV2Command,
         PutObjectCommand, GetObjectCommand,
         DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "fs";

const s3 = new S3Client({
  endpoint: "${endpoint}",
  region: "us-east-1",
  credentials: {
    accessKeyId: "${ak}",
    secretAccessKey: "${SDK}",
  },
  forcePathStyle: true,
});

// List
const list = await s3.send(new ListObjectsV2Command({ Bucket: "${bucketName}" }));
list.Contents?.forEach(o => console.log(o.Key));

// Upload
await s3.send(new PutObjectCommand({
  Bucket: "${bucketName}",
  Key: "myfile.txt",
  Body: createReadStream("./myfile.txt"),
}));

// Download
const { Body } = await s3.send(new GetObjectCommand({
  Bucket: "${bucketName}", Key: "myfile.txt",
}));
Body.pipe(createWriteStream("./myfile.txt"));

// Delete
await s3.send(new DeleteObjectCommand({ Bucket: "${bucketName}", Key: "myfile.txt" }));`,

    // rclone
    `# Install: https://rclone.org/install/

# Add to ~/.config/rclone/rclone.conf
[buttercloud]
type = s3
provider = Other
env_auth = false
access_key_id = ${ak}
secret_access_key = ${SDK}
endpoint = ${endpoint}
force_path_style = true

# List files
rclone ls buttercloud:${bucketName}

# Copy local → cloud
rclone copy ./localfolder buttercloud:${bucketName}/localfolder

# Copy cloud → local
rclone copy buttercloud:${bucketName}/localfolder ./localfolder

# Sync (one-way mirror)
rclone sync ./localfolder buttercloud:${bucketName}/backup`,
  ];

  return (
    <Layout>
      <div style={{ maxWidth: '780px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Developer Docs</h1>
        <p style={{ color: 'var(--fg-2)', fontSize: '14px', margin: '0 0 28px' }}>
          Connect any S3-compatible client to your Buttercloud bucket.
        </p>

        {error && (
          <div style={{ background: 'rgba(200,60,60,0.1)', border: '1px solid rgba(200,60,60,0.3)', borderRadius: '8px', color: '#e07070', fontSize: '13px', marginBottom: '20px', padding: '12px 16px' }}>
            {error}
          </div>
        )}

        {/* Connection info */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '28px', padding: '20px 24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Connection info</div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '12px' }}>
            <InfoRow label="Endpoint" value={endpoint} />
            <InfoRow label="Bucket" value={bucketName} />
            <InfoRow label="Access Key" value={ak} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0' }}>
              <span style={{ color: 'var(--fg-2)', fontSize: '13px', minWidth: '130px' }}>Secret Key</span>
              <span style={{ color: 'var(--fg-2)', fontSize: '13px' }}>
                Shown once at creation —{' '}
                <Link to="/keys" style={{ color: 'var(--butter)', textDecoration: 'none' }}>go to API Keys</Link>
                {' '}to create a new key.
              </span>
            </div>
          </div>
        </div>

        {/* SDK tabs */}
        <div style={{ marginBottom: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)} style={{
              background: tab === i ? 'var(--butter)' : 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: tab === i ? '#1a1400' : 'var(--fg-1)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: tab === i ? 600 : 400,
              padding: '7px 16px',
              transition: 'all 0.1s',
            }}>
              {t}
            </button>
          ))}
        </div>

        <CodeBlock code={snippets[tab]} />

        <div style={{ color: 'var(--fg-2)', fontSize: '12px', marginTop: '14px' }}>
          Replace <code style={{ background: 'var(--bg-2)', borderRadius: '4px', padding: '1px 5px' }}>{SDK}</code> with your actual secret key.
          Set <code style={{ background: 'var(--bg-2)', borderRadius: '4px', padding: '1px 5px' }}>region</code> to any non-empty string — Buttercloud ignores it.
        </div>
      </div>
    </Layout>
  );
}
