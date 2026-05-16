async function req(token, path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!r.ok && r.status !== 204) {
    let message = `Request failed (${r.status})`;
    try { const d = await r.json(); message = d.message || message; } catch {}
    throw new Error(message);
  }
  return r.status === 204 ? null : r.json();
}

export const getUsers    = (token, params = '') => req(token, `/api/v1/admin/users${params}`);
export const updateUser  = (token, id, body)   => req(token, `/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const getNodes    = (token)             => req(token, '/api/v1/admin/nodes');
export const addNode     = (token, body)       => req(token, '/api/v1/admin/nodes', { method: 'POST', body: JSON.stringify(body) });
export const updateNode    = (token, id, body) => req(token, `/api/v1/admin/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const reconcileNodes    = (token)          => req(token, '/api/v1/admin/nodes/reconcile', { method: 'POST' });
export const getAdminBilling   = (token, status)  => req(token, `/api/v1/admin/billing?status=${status || 'draft'}&limit=100`);
export const generateInvoices  = (token, month)   => req(token, '/api/v1/admin/billing/generate', { method: 'POST', body: JSON.stringify({ month }) });
export const updateInvoice     = (token, id, status) => req(token, `/api/v1/admin/billing/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const getHealth   = (token)             => req(token, '/api/v1/admin/node-health');
export const getBuckets  = (token)             => req(token, '/api/v1/admin/buckets');
export const migrateBucket = (token, id, body) => req(token, `/api/v1/admin/buckets/${id}/migrate`, { method: 'POST', body: JSON.stringify(body) });
