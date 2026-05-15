import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { listCredentials, createCredential, revokeCredential } from '../../api/credentials';
import { I } from '../../components/Icons';

function NewKeyModal({ onConfirm, onCancel }) {
  const [name, setName] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '24px', width: '360px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600 }}>New API Key</h3>
        <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--fg-2)' }}>Give this key a name so you can identify it later.</p>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Production app"
          onKeyDown={e => e.key === 'Enter' && name.trim() && onConfirm(name.trim())}
          style={{ width: '100%', padding: '10px 12px', marginBottom: '16px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onConfirm(name.trim())}>Create Key</button>
        </div>
      </div>
    </div>
  );
}

function SecretModal({ credential, onClose }) {
  const [copiedAccess, setCopiedAccess] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  function copy(text, setter) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)', display: 'grid', placeItems: 'center', zIndex: 200 }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: '28px', width: '420px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>API Key Created</h3>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--fg-2)' }}>
          Copy your secret key now — it <strong style={{ color: 'var(--coral)' }}>will not be shown again</strong>.
        </p>

        {[
          { label: 'Access Key', value: credential.access_key, copied: copiedAccess, onCopy: () => copy(credential.access_key, setCopiedAccess) },
          { label: 'Secret Key', value: credential.secret_key, copied: copiedSecret, onCopy: () => copy(credential.secret_key, setCopiedSecret), warn: true },
        ].map(({ label, value, copied, onCopy, warn }) => (
          <div key={label} style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--fg-2)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {label} {warn && <span style={{ color: 'var(--coral)', fontSize: '10px' }}>⚠ shown once</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '8px', padding: '8px 12px' }}>
              <span className="mono" style={{ flex: 1, fontSize: '12px', color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
              <button onClick={onCopy} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: copied ? 'var(--sage)' : 'var(--fg-2)', flexShrink: 0 }}>
                {copied ? '✓' : I.copy({ size: 14 })}
              </button>
            </div>
          </div>
        ))}

        <button className="btn primary" style={{ width: '100%', marginTop: '8px' }} onClick={onClose}>
          I've saved my secret key
        </button>
      </div>
    </div>
  );
}

export default function Keys() {
  const { token } = useAuth();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newSecret, setNewSecret] = useState(null);

  useEffect(() => { if (token) load(); }, [token]);

  async function load() {
    try {
      const data = await listCredentials(token);
      setKeys(data.credentials || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleCreate(name) {
    setShowNew(false);
    try {
      const cred = await createCredential(token, name);
      setNewSecret(cred);
      await load();
    } catch (e) { setError(e.message); }
  }

  async function handleRevoke(id) {
    if (!confirm('Revoke this key? Apps using it will stop working immediately.')) return;
    try {
      await revokeCredential(token, id);
      await load();
    } catch (e) { setError(e.message); }
  }

  return (
    <Layout title="API Keys">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 600 }}>API Keys</h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-2)' }}>Use these credentials to authenticate S3 requests against your bucket.</p>
        </div>
        <button className="btn primary" onClick={() => setShowNew(true)}>
          {I.plus({ size: 14 })} New Key
        </button>
      </div>

      {error && <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>
      ) : (
        <div className="files">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px 80px', gap: '10px', padding: '9px 16px', fontSize: '10.5px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)', borderBottom: '1px solid var(--line-soft)' }}>
            <span>Name / Access Key</span><span>Created</span><span>Last used</span><span></span>
          </div>

          {keys.length === 0 && (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--fg-2)' }}>
              <div style={{ marginBottom: '8px' }}>{I.key({ size: 28 })}</div>
              <div style={{ fontWeight: 500, color: 'var(--fg-1)' }}>No API keys yet</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>Create a key to start making S3 requests</div>
            </div>
          )}

          {keys.map(k => (
            <div key={k.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px 80px', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '13px', color: 'var(--fg)', marginBottom: '3px' }}>{k.name}</div>
                <div className="mono" style={{ fontSize: '11.5px', color: 'var(--fg-2)' }}>{k.access_key}</div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>{new Date(k.created_at).toLocaleDateString()}</div>
              <div style={{ fontSize: '12px', color: 'var(--fg-2)' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => handleRevoke(k.id)} className="btn danger" style={{ height: '28px', padding: '0 10px', fontSize: '12px' }}>
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewKeyModal onConfirm={handleCreate} onCancel={() => setShowNew(false)} />}
      {newSecret && <SecretModal credential={newSecret} onClose={() => setNewSecret(null)} />}
    </Layout>
  );
}
