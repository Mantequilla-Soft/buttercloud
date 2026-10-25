import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getMyBucket } from '../api/usage';
import { I } from './Icons';

export default function TopBar({ title = 'Dashboard' }) {
  const { user, token } = useAuth();
  const [bucketName, setBucketName] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    getMyBucket(token).then(b => setBucketName(b.bucket_name)).catch(() => {});
  }, [token]);

  function copyBucketName() {
    navigator.clipboard.writeText(bucketName).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="crumb current">{title}</span>
      </div>

      <div className="topbar-actions">
        {bucketName && (
          <button
            onClick={copyBucketName}
            title="Click to copy bucket name"
            className="mono"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: '8px',
              padding: '5px 10px', fontSize: '12px', color: copied ? 'var(--sage)' : 'var(--fg-2)',
              cursor: 'pointer',
            }}
          >
            {I.bucket({ size: 14 })}
            {bucketName}
            {copied ? '✓' : I.copy({ size: 12 })}
          </button>
        )}
        <button className="icon-btn">
          {I.bell({ size: 18 })}
        </button>
        <div className="avatar">{user?.email?.[0].toUpperCase()}</div>
      </div>
    </header>
  );
}
