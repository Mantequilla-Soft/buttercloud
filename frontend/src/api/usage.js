export async function getUsage(token, month) {
  const q = month ? `?month=${month}` : '';
  const r = await fetch(`/api/v1/usage${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).message || 'Failed to load usage');
  return r.json();
}

export async function getQuota(token) {
  const r = await fetch('/api/v1/quota', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).message || 'Failed to load quota');
  return r.json();
}

export async function getBilling(token) {
  const r = await fetch('/api/v1/billing', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json()).message || 'Failed to load billing');
  return r.json();
}
