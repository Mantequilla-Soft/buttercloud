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

export async function uploadFile(token, file, prefix = '') {
  const formData = new FormData();
  if (prefix) formData.append('prefix', prefix);
  formData.append('file', file);

  const response = await fetch('/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || 'Upload failed');
  }

  return response.json();
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

