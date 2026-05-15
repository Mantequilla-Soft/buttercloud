import { useState, useEffect, useRef } from 'react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import TopBar from '../../components/TopBar';
import { useAuth } from '../../hooks/useAuth';
import { listFiles, uploadFile, downloadFile, deleteFile } from '../../api/files';
import { formatBytes, getFileType } from '../../utils/format';
import { I } from '../../components/Icons';

// ─── Detail Rail ────────────────────────────────────────────────────────────

const PREVIEW_SIZE_LIMIT = 50 * 1024 * 1024; // auto-fetch up to 50 MB

function DetailRail({ file, onClose, onDelete, token }) {
  const fileType = file ? getFileType(file.name) : null;
  const isImage = fileType === 'img';
  const isVideo = fileType === 'video';
  const isAudio = fileType === 'audio';
  const isPreviewable = isImage || isVideo || isAudio;

  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  // Auto-fetch images and small videos/audio; show a "Load preview" button for large files
  const autoFetch = isPreviewable && file && file.size <= PREVIEW_SIZE_LIMIT;

  useEffect(() => {
    setPreviewUrl(null);
    setPreviewLoaded(false);
    if (autoFetch) fetchPreview();
  }, [file?.key]);

  async function fetchPreview() {
    setLoadingPreview(true);
    let objectUrl;
    try {
      const blob = await downloadFile(token, file.key);
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
      setPreviewLoaded(true);
    } catch {
      setPreviewUrl(null);
    } finally {
      setLoadingPreview(false);
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }

  async function handleDownload() {
    const blob = await downloadFile(token, file.key);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!file) return null;

  function PreviewContent() {
    if (loadingPreview) {
      return <div style={{ color: 'var(--fg-3)', fontSize: '12px' }}>Loading preview…</div>;
    }

    if (isImage && previewUrl) {
      return (
        <img src={previewUrl} alt={file.name}
          style={{ maxWidth: '100%', maxHeight: '180px', objectFit: 'contain', borderRadius: '6px' }} />
      );
    }

    if (isVideo && previewUrl) {
      return (
        <video controls src={previewUrl}
          style={{ width: '100%', borderRadius: '6px', maxHeight: '180px', background: '#000' }} />
      );
    }

    if (isAudio && previewUrl) {
      return (
        <audio controls src={previewUrl} style={{ width: '100%', marginTop: '8px' }} />
      );
    }

    if (isPreviewable && !previewLoaded && file.size > PREVIEW_SIZE_LIMIT) {
      return (
        <button className="btn" onClick={fetchPreview} style={{ fontSize: '12px' }}>
          {I.eye({ size: 13 })} Load preview ({formatBytes(file.size)})
        </button>
      );
    }

    return (
      <div className={`ico ${fileType}`} style={{ width: 48, height: 48, fontSize: '14px' }}>
        {I.file({ size: 24 })}
      </div>
    );
  }

  return (
    <div className="rail">
      <div className="rail-hd">
        <span className="title">Details</span>
        <button className="icon-btn" onClick={onClose} style={{ border: 'none', cursor: 'pointer' }}>
          {I.chevR({ size: 16 })}
        </button>
      </div>

      <div className="preview-card">
        <div className="preview" style={{ height: isAudio ? 'auto' : '200px', minHeight: '60px' }}>
          <PreviewContent />
        </div>
        <div className="preview-meta">
          <div className="nm" title={file.name}>{file.name}</div>
          <div className="sz">{formatBytes(file.size)}</div>
        </div>
      </div>

      <div className="action-row">
        <button className="btn" onClick={handleDownload}>
          {I.download({ size: 14 })} Download
        </button>
        <button className="btn danger" onClick={() => onDelete(file.key)}>
          {I.trash({ size: 14 })} Delete
        </button>
      </div>

      <div className="rail-section">
        <h4>Object info</h4>
        <dl className="kv">
          <dt>Name</dt>
          <dd className="id">{file.name}</dd>
          <dt>Size</dt>
          <dd>{formatBytes(file.size)}</dd>
          <dt>Modified</dt>
          <dd>{new Date(file.modified).toLocaleString()}</dd>
          <dt>Type</dt>
          <dd>{getFileType(file.name)}</dd>
          <dt>Key</dt>
          <dd className="id">{file.key}</dd>
        </dl>
      </div>
    </div>
  );
}

// ─── New Folder Modal ────────────────────────────────────────────────────────

function NewFolderModal({ prefix, onConfirm, onCancel }) {
  const [name, setName] = useState('');
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim().replace(/\//g, '');
    if (trimmed) onConfirm(prefix + trimmed + '/');
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .6)',
      display: 'grid', placeItems: 'center', zIndex: 200,
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
          borderRadius: 'var(--radius)', padding: '24px', width: '340px',
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>New Folder</h3>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="folder-name"
          style={{
            width: '100%', padding: '10px 12px', marginBottom: '16px',
            background: 'var(--bg)', border: '1px solid var(--line-soft)',
            borderRadius: '8px', color: 'var(--fg)', fontFamily: 'inherit',
            fontSize: '13px', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}

// ─── Main Files Page ─────────────────────────────────────────────────────────

export default function Files() {
  const { token } = useAuth();
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [noBucket, setNoBucket] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const fileInputRef = useRef();

  useEffect(() => {
    if (!token) return;
    loadFiles();
  }, [token, prefix]);

  async function loadFiles() {
    setLoading(true);
    setError('');
    setNoBucket(false);
    try {
      const result = await listFiles(token, prefix);
      setFiles(result.files);
      setFolders(result.folders);
    } catch (err) {
      if (err.code === 'bucket_not_found') {
        setNoBucket(true);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    e.target.value = '';
    setUploading(true);
    setError('');
    try {
      for (const file of picked) {
        await uploadFile(token, file, prefix);
      }
      await loadFiles();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(key) {
    if (!confirm(`Delete "${key.split('/').pop()}"?`)) return;
    try {
      await deleteFile(token, key);
      if (selectedFile?.key === key) setSelectedFile(null);
      await loadFiles();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMkdir(path) {
    setShowNewFolder(false);
    try {
      await fetch('/api/v1/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path }),
      });
      await loadFiles();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownload(file) {
    try {
      const blob = await downloadFile(token, file.key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  function navigateInto(folderKey) {
    setPrefix(folderKey);
    setSelectedFile(null);
  }

  function navigateBack() {
    const parts = prefix.split('/').filter(Boolean);
    parts.pop();
    setPrefix(parts.length ? parts.join('/') + '/' : '');
    setSelectedFile(null);
  }

  const breadcrumbs = prefix.split('/').filter(Boolean);
  const showRail = selectedFile !== null;

  if (noBucket) {
    return (
      <Layout title="Files">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', textAlign: 'center', color: 'var(--fg-2)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>☁️</div>
          <h2 style={{ color: 'var(--fg)', marginBottom: '8px' }}>No storage bucket yet</h2>
          <p style={{ maxWidth: '360px', lineHeight: '1.6' }}>
            Your account doesn't have a storage bucket. Contact your administrator.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <div className={`app${showRail ? '' : ' rail-closed'}`}>
      <Sidebar />

      {/* Top bar with breadcrumbs + actions */}
      <header className="topbar">
        <div className="crumbs">
          <span className="crumb">Files</span>
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              <span className="sep">/</span>
              <span className="crumb current">{crumb}</span>
            </span>
          ))}
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={() => setShowNewFolder(true)}>
            {I.plus({ size: 14 })} New folder
          </button>
          <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {I.upload({ size: 14 })} {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={handleUpload} style={{ display: 'none' }} />
        </div>
      </header>

      {/* Main content */}
      <main className="main">
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: '16px', background: 'oklch(0.72 0.145 25 / .15)', border: '1px solid oklch(0.72 0.145 25 / .4)', borderRadius: '8px', color: 'var(--coral)', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* Path bar */}
        {prefix && (
          <div className="toolbar" style={{ marginBottom: '12px' }}>
            <div className="path-bar">
              <button className="back" onClick={navigateBack} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                {I.arrowL({ size: 14 })}
              </button>
              <span className="slash">/</span>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="seg current">{crumb}</span>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-2)' }}>Loading…</div>
        ) : (
          <div className="files">
            {/* Header */}
            <div className="head no-cost">
              <span></span>
              <span></span>
              <span className="sortable active">Name</span>
              <span style={{ textAlign: 'right' }}>Size</span>
              <span style={{ textAlign: 'right' }}>Modified</span>
              <span></span>
            </div>

            {/* Folders */}
            {folders.map(folder => (
              <div key={folder.key} className="row no-cost" onDoubleClick={() => navigateInto(folder.key)} style={{ cursor: 'default' }}>
                <span className="cb" />
                <div className="ico folder">{I.folder({ size: 13 })}</div>
                <div className="fname"><span className="name">{folder.name}</span></div>
                <div className="col-mute" style={{ textAlign: 'right' }}>—</div>
                <div className="col-mute" style={{ textAlign: 'right' }}>—</div>
                <div className="row-actions">
                  <button onClick={() => navigateInto(folder.key)} title="Open" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-2)', padding: '4px' }}>
                    {I.chevR({ size: 14 })}
                  </button>
                </div>
              </div>
            ))}

            {/* Files */}
            {files.map(file => (
              <div
                key={file.key}
                className={`row no-cost${selectedFile?.key === file.key ? ' selected' : ''}`}
                onClick={() => setSelectedFile(selectedFile?.key === file.key ? null : file)}
                style={{ cursor: 'default' }}
              >
                <span className={`cb${selectedFile?.key === file.key ? ' on' : ''}`} />
                <div className={`ico ${getFileType(file.name)}`}>{I.file({ size: 13 })}</div>
                <div className="fname"><span className="name">{file.name}</span></div>
                <div className="col-mono" style={{ textAlign: 'right' }}>{formatBytes(file.size)}</div>
                <div className="col-mute" style={{ textAlign: 'right' }}>
                  {new Date(file.modified).toLocaleDateString()}
                </div>
                <div className="row-actions">
                  <button onClick={e => { e.stopPropagation(); handleDownload(file); }} title="Download" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-2)', padding: '4px' }}>
                    {I.download({ size: 14 })}
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(file.key); }} title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg-2)', padding: '4px' }}>
                    {I.trash({ size: 14 })}
                  </button>
                </div>
              </div>
            ))}

            {files.length === 0 && folders.length === 0 && (
              <div style={{ padding: '48px', textAlign: 'center', color: 'var(--fg-2)' }}>
                <div style={{ marginBottom: '8px' }}>{I.bucket({ size: 32 })}</div>
                <div style={{ fontWeight: 500, marginBottom: '4px', color: 'var(--fg-1)' }}>Empty bucket</div>
                <div style={{ fontSize: '12px' }}>Upload files or create a folder to get started</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Detail rail */}
      {showRail && (
        <DetailRail
          file={selectedFile}
          prefix={prefix}
          onClose={() => setSelectedFile(null)}
          onDelete={handleDelete}
          token={token}
        />
      )}

      {/* New folder modal */}
      {showNewFolder && (
        <NewFolderModal
          prefix={prefix}
          onConfirm={handleMkdir}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
    </div>
  );
}
