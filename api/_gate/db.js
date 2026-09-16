/* Supabase, through its REST interface with the service-role key.

   No client library: one fetch wrapper is less to install and less to
   keep current, and the whole sync needs five operations. The
   service-role key bypasses Row Level Security, which is the point;
   every table has RLS on with no policies, so this key is the only
   way in. It lives in Vercel's environment and nowhere else. */
'use strict';

const url = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = () => process.env.SUPABASE_SERVICE_KEY || '';

function configured() {
  return Boolean(url() && key());
}

async function rest(method, path, body, prefer) {
  const headers = {
    apikey: key(),
    Authorization: `Bearer ${key()}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`supabase ${method} ${path} -> ${res.status} ${data && data.message ? data.message : text}`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

const select = (path) => rest('GET', path);
const insert = (table, rows) => rest('POST', table, rows, 'return=representation');
const upsert = (table, rows, onConflict) =>
  rest('POST', `${table}?on_conflict=${onConflict}`, rows, 'resolution=merge-duplicates,return=minimal');
const update = (table, filter, patch) => rest('PATCH', `${table}?${filter}`, patch, 'return=minimal');

async function event(tenant_key, kind, detail) {
  try {
    await insert('events', [{ tenant_key, kind, detail: detail || null }]);
  } catch (e) {
    /* The log failing must not stop the sync. */
    console.error('event log failed:', e.message);
  }
}

module.exports = { configured, rest, select, insert, upsert, update, event };
