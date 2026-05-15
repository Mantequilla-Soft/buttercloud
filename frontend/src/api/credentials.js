export async function listCredentials(token) {
  const r = await fetch('/api/v1/credentials', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).message || 'Failed to load keys');
  return r.json();
}

export async function createCredential(token, name) {
  const r = await fetch('/api/v1/credentials', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error((await r.json()).message || 'Failed to create key');
  return r.json();
}

export async function revokeCredential(token, id) {
  const r = await fetch(`/api/v1/credentials/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 204) throw new Error('Failed to revoke key');
}
