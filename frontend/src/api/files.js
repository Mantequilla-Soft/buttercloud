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

// XMLHttpRequest, not fetch — fetch has no upload progress event in any browser
// that matters here; xhr.upload.onprogress is the only reliable way to get it.
export function uploadFile(token, file, prefix = '', onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    if (prefix) formData.append('prefix', prefix);
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/files/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.message || 'Upload failed'));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed (network error)'));

    xhr.send(formData);
  });
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

