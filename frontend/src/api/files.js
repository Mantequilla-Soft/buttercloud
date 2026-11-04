// File browser API client
export async function listFiles(token, prefix = '') {
  const query = new URLSearchParams();
  if (prefix) query.append('prefix', prefix);

  const response = await fetch(`/api/v1/files?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.message || 'Failed to list files');
    err.code = data.error;
    throw err;
  }

  return data; // { files: [...], folders: [...] }
}

// Files bigger than one part go up in parts: Cloudflare in front of the API rejects
// any single request body over 100 MB, so one big POST would fail outright. The
// part size comes from the server's init response; this threshold only decides
// which path a file takes and just needs to stay under that limit.
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const PART_CONCURRENCY = 4;
const PART_RETRIES = 3;

// XMLHttpRequest, not fetch — fetch has no upload progress event in any browser
// that matters here; xhr.upload.onprogress is the only reliable way to get it.
function xhrRequest({ method, url, token, body, contentType, onUploadProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);

    if (onUploadProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded);
      };
    }

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error(data.message || `Upload failed (HTTP ${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed (network error)'));

    xhr.send(body);
  });
}

export function uploadFile(token, file, prefix = '', onProgress) {
  const report = (loaded) => onProgress?.(Math.round((loaded / file.size) * 100));
  if (file.size <= MULTIPART_THRESHOLD) return uploadSingle(token, file, prefix, report);
  return uploadMultipart(token, file, prefix, report);
}

function uploadSingle(token, file, prefix, report) {
  const formData = new FormData();
  if (prefix) formData.append('prefix', prefix);
  formData.append('file', file);
  // Multipart form overhead makes e.loaded run slightly past file.size; clamp.
  return xhrRequest({
    method: 'POST',
    url: '/api/v1/files/upload',
    token,
    body: formData,
    onUploadProgress: (loaded) => report(Math.min(loaded, file.size)),
  });
}

async function uploadMultipart(token, file, prefix, report) {
  const { uploadId, partSize, partCount } = await xhrRequest({
    method: 'POST',
    url: '/api/v1/files/multipart',
    token,
    contentType: 'application/json',
    body: JSON.stringify({ filename: file.name, prefix, size: file.size, contentType: file.type || undefined }),
  });
  const base = `/api/v1/files/multipart/${encodeURIComponent(uploadId)}`;

  const loaded = new Array(partCount).fill(0);
  const reportAll = () => report(loaded.reduce((a, b) => a + b, 0));

  async function sendPart(partNumber) {
    const start = (partNumber - 1) * partSize;
    const blob = file.slice(start, Math.min(start + partSize, file.size));
    for (let attempt = 0; ; attempt++) {
      try {
        await xhrRequest({
          method: 'PUT',
          url: `${base}/parts/${partNumber}`,
          token,
          body: blob,
          contentType: 'application/octet-stream',
          onUploadProgress: (n) => { loaded[partNumber - 1] = n; reportAll(); },
        });
        loaded[partNumber - 1] = blob.size;
        reportAll();
        return;
      } catch (err) {
        loaded[partNumber - 1] = 0;
        reportAll();
        // 4xx (other than rate limiting) means retrying the same bytes won't help.
        const retryable = !err.status || err.status >= 500 || err.status === 429;
        if (!retryable || attempt >= PART_RETRIES) throw err;
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  let next = 1;
  let failed = false;
  async function worker() {
    while (!failed && next <= partCount) {
      const partNumber = next++;
      await sendPart(partNumber).catch((err) => { failed = true; throw err; });
    }
  }

  try {
    // allSettled, not all: on a failure the other workers stop taking new parts but
    // finish the one in flight, so the abort below doesn't race their PUTs.
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker)
    );
    const rejected = results.find(r => r.status === 'rejected');
    if (rejected) throw rejected.reason;
    return await xhrRequest({ method: 'POST', url: `${base}/complete`, token });
  } catch (err) {
    // Best-effort: frees the parts already stored. The server sweeps anything
    // this misses (e.g. the tab closing) after a day.
    xhrRequest({ method: 'DELETE', url: base, token }).catch(() => {});
    throw err;
  }
}

export async function downloadFile(token, key) {
  const encodedKey = encodeURIComponent(key);
  const response = await fetch(`/api/v1/files/download/${encodedKey}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('Download failed');
  }

  return response.blob();
}

export async function deleteFile(token, key) {
  const encodedKey = encodeURIComponent(key);
  const response = await fetch(`/api/v1/files/${encodedKey}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Delete failed');
  }

  return response.json();
}

