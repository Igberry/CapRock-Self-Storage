/* The WebSelfStorage rentroll: every current contract at the facility.

   This is the one place tenant data is read, and it is read on the
   server only. The public proxy in api/wss.js deliberately does not
   expose this endpoint, and must not. */
'use strict';

const API_BASE = 'https://api.webselfstorage.com/v4';
const ENTITY = '1030298';   // CapRock Self Storage, Lubbock
const TIMEOUT_MS = 15000;

/* One row per contract, with only the fields the sync uses. Phone is
   reduced to its last ten digits and doubles as the key that groups a
   person's contracts: a tenant with three units gets one code. A
   record with no usable phone falls back to the contract id, so it
   still gets a code, but nobody can be texted it. */
function shape(r) {
  const digits = String(r.customerPhoneNumber || '').replace(/\D/g, '');
  const phone = digits.length >= 10 ? digits.slice(-10) : '';
  return {
    contract_unit_id: r.contractUnitId,
    tenant_key: phone || `contract:${r.contractUnitId}`,
    customer_name: String(r.customerName || '').trim() || 'Unknown',
    phone,
    room: String(r.roomNumber || '').trim(),
    moved_in: r.dateMovedIn ? String(r.dateMovedIn).slice(0, 10) : null,
    paid_thru: r.paidThru ? String(r.paidThru).slice(0, 10) : null,
    balance: Number(r.balance) || 0,
    street_rate: r.streetRate == null ? null : Number(r.streetRate),
    /* The postal address, for the CRM record only. The gate sync
       ignores these; ghl-tenants writes them to the contact. */
    address: [String(r.address1 || '').trim(), String(r.apartment || '').trim()].filter(Boolean).join(' #'),
    city: String(r.city || '').trim(),
    state: String(r.stateName || '').trim(),
    zip: String(r.zip || '').trim(),
  };
}

async function fetchRentroll() {
  const key = (process.env.WSS_API_KEY || '').trim();
  if (!key) throw new Error('WSS_API_KEY is not set');
  const scheme = process.env.WSS_AUTH_SCHEME || 'Bearer';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/location/${ENTITY}/rentroll`, {
      headers: { Authorization: scheme ? `${scheme} ${key}` : key, Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`rentroll -> ${res.status}`);
    const value = body && Object.prototype.hasOwnProperty.call(body, 'Value') ? body.Value : body;
    const list = value && (value.rentRoll || value.RentRoll);
    if (!Array.isArray(list)) throw new Error('rentroll: no rentRoll array in response');
    return list.map(shape).filter((t) => t.contract_unit_id);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchRentroll, shape };
