/* ================================================================
   CapRock Self Storage — tenants into GHL
   GET /api/ghl-tenants   (Authorization: Bearer <CRON_SECRET>)

   WHY THIS EXISTS
   Tenants who sign up through uhaul.com exist in WebSelfStorage and
   nowhere else; the CRM never hears about them. This reads the
   rentroll every fifteen minutes and makes sure every current tenant
   is a GHL contact, with their units, dates and balance on the record,
   and marks the ones who have moved out. Nothing is sent to anyone;
   it only keeps the CRM true. What the office does with a "tenant"
   tag (a welcome text, a review request at day 30) is a workflow in
   GHL and their decision.

   WHAT A CONTACT GETS
     name, phone, postal address     from the rentroll
     tag "tenant"                    while they hold a unit
     tag "former-tenant"             once they no longer do
     source "webselfstorage"
     custom fields (created on first run if missing):
       Unit Numbers, Move-In Date, Paid Through, Balance Owed,
       Tenant Status, Gate Code, WSS Contract IDs

   Gate Code is filled from the gate-code database when a code exists
   for the person, so the code shows on the contact in the CRM. That
   is the "gate codes flow into GHL contact info" Chris asked for.

   One person, one contact: several units under one phone number are
   one record with all the unit numbers listed, the same rule the
   gate sync uses.

   SETTINGS (Vercel)
     GHL_TENANTS_ENABLED   "on" or nothing is written
     CRON_SECRET
     GHL_API_KEY           needs contacts.write, contacts.readonly,
                           locations/customFields.readonly and
                           locations/customFields.write
     GHL_LOCATION_ID
     WSS_API_KEY
     SUPABASE_URL, SUPABASE_SERVICE_KEY   optional, for gate codes
   ================================================================ */
'use strict';

const ghl = require('./_gate/ghl');
const db = require('./_gate/db');
const { fetchRentroll } = require('./_gate/rentroll');

const LOC = () => process.env.GHL_LOCATION_ID;

/* The contact custom fields this sync owns. Looked up by name and
   created if absent, so the office never has to make them by hand. */
const FIELDS = [
  ['Unit Numbers',     'TEXT'],
  ['Move-In Date',     'TEXT'],
  ['Paid Through',     'TEXT'],
  ['Balance Owed',     'TEXT'],
  ['Tenant Status',    'TEXT'],
  ['Gate Code',        'TEXT'],
  ['WSS Contract IDs', 'TEXT'],
];

/* "SURNAME, First" is how the rentroll writes names; the CRM wants
   them the other way round, in normal case. */
function splitName(customerName) {
  const s = String(customerName || '').trim();
  const cap = (w) => w.toLowerCase().replace(/(^|[\s'-])(\w)/g, (m, p, c) => p + c.toUpperCase());
  const comma = s.indexOf(',');
  if (comma > -1) return { firstName: cap(s.slice(comma + 1).trim()), lastName: cap(s.slice(0, comma).trim()) };
  const parts = s.split(/\s+/);
  return { firstName: cap(parts[0] || ''), lastName: cap(parts.slice(1).join(' ')) };
}

function usDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
}

const ensureFields = () => ghl.ensureContactFields(FIELDS);

/* Every contact currently tagged as a tenant, by phone. This is how a
   move-out is noticed: tagged, but no longer in the rentroll. */
async function currentTenantContacts() {
  const out = new Map();
  let page = 1;
  for (;;) {
    const data = await ghl.call('POST', '/contacts/search', {
      locationId: LOC(), page, pageLimit: 100,
      filters: [{ field: 'tags', operator: 'eq', value: 'tenant' }],
    });
    const list = (data && data.contacts) || [];
    for (const c of list) {
      const phone = String(c.phone || '').replace(/\D/g, '').slice(-10);
      if (phone) out.set(phone, c);
    }
    if (list.length < 100) break;
    page++;
  }
  return out;
}

async function gateCodes() {
  if (!db.configured()) return new Map();
  try {
    const rows = await db.select('codes?select=tenant_key,code,status&status=neq.revoked');
    return new Map(rows.map((r) => [r.tenant_key, r.status === 'active' ? r.code : `${r.code} (suspended)`]));
  } catch (e) {
    console.error('gate codes unavailable:', e.message);
    return new Map();
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET || process.env.GATE_SYNC_SECRET;
  if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (process.env.GHL_TENANTS_ENABLED !== 'on') {
    return res.status(200).json({ paused: true, reason: 'GHL_TENANTS_ENABLED is not on' });
  }
  if (!ghl.configured()) return res.status(503).json({ error: 'ghl_not_configured' });

  const stats = { contracts: 0, people: 0, upserted: 0, no_phone: 0, moved_out: 0, errors: 0 };
  try {
    const [feed, fields, tagged, codes] = await Promise.all([fetchRentroll(), ensureFields(), currentTenantContacts(), gateCodes()]);
    stats.contracts = feed.length;

    const people = new Map();
    for (const c of feed) {
      if (!c.phone) { stats.no_phone++; continue; }   // no phone, no CRM record to match on
      const p = people.get(c.phone) || { ...c, rooms: [], ids: [], paid: [], balance: 0, moved: null };
      p.rooms.push(c.room);
      p.ids.push(c.contract_unit_id);
      p.paid.push(c.paid_thru);
      p.balance += c.balance;
      if (!p.moved || (c.moved_in && c.moved_in < p.moved)) p.moved = c.moved_in;
      people.set(c.phone, p);
    }
    stats.people = people.size;

    for (const p of people.values()) {
      const name = splitName(p.customer_name);
      const earliestPaid = p.paid.filter(Boolean).sort()[0] || '';
      const f = (n, v) => ({ id: fields[n], field_value: v });
      try {
        await ghl.call('POST', '/contacts/upsert', {
          locationId: LOC(),
          phone: '+1' + p.phone,
          firstName: name.firstName,
          lastName: name.lastName,
          address1: p.address || undefined,
          city: p.city || undefined,
          state: p.state || undefined,
          postalCode: p.zip || undefined,
          source: 'webselfstorage',
          tags: ['tenant'],
          customFields: [
            f('Unit Numbers', p.rooms.sort().join(', ')),
            f('Move-In Date', usDate(p.moved)),
            f('Paid Through', usDate(earliestPaid)),
            f('Balance Owed', p.balance ? '$' + p.balance.toFixed(2) : '$0.00'),
            f('Tenant Status', 'Active'),
            f('Gate Code', codes.get(p.phone) || ''),
            f('WSS Contract IDs', p.ids.join(', ')),
          ],
        });
        stats.upserted++;
      } catch (e) {
        stats.errors++;
        console.error('upsert failed for a tenant:', e.message);
      }
    }

    /* Tagged as a tenant in the CRM, no longer in the rentroll. */
    for (const [phone, c] of tagged) {
      if (people.has(phone)) continue;
      try {
        await ghl.call('DELETE', `/contacts/${c.id}/tags`, { tags: ['tenant'] });
        await ghl.call('POST', `/contacts/${c.id}/tags`, { tags: ['former-tenant'] });
        await ghl.call('PUT', `/contacts/${c.id}`, {
          customFields: [{ id: fields['Tenant Status'], field_value: 'Former' }, { id: fields['Unit Numbers'], field_value: '' }],
        });
        stats.moved_out++;
      } catch (e) {
        stats.errors++;
        console.error('move-out update failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, ...stats });
  } catch (err) {
    console.error('ghl-tenants failed:', err);
    return res.status(500).json({ error: 'sync_failed', message: String(err.message).slice(0, 300), ...stats });
  }
};
