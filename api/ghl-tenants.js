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

/* ---- Room numbers, as two systems spell them ----
   WebSelfStorage pads with zeros and joins combined units with a
   hyphen: 025, 05, 116-117. The CRM dropdown does neither: its 234
   options run 2 to 263, unpadded, one per unit, with a separate
   Combined Unit Number field for the second half of a pair.

   Twenty seven of sixty six rooms failed to match before this.
   Both causes were spelling, not missing units.

   Returns { unit, combined }: the first number, and the rest of a
   range if there is one. */
function splitRoom(room) {
  const parts = String(room || '').trim().split('-')
    .map(function (x) { return x.trim().replace(/^0+(?=[0-9])/, ''); })
    .filter(Boolean);
  return { unit: parts[0] || '', combined: parts.slice(1) };
}

function usDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
}

const ensureFields = () => ghl.ensureContactFields(FIELDS);

/* The same lookup without the creating half, for the dry run.
   ensureContactFields() makes any field that does not exist yet,
   which is a write, and a preview that changes the CRM is not a
   preview. A name missing from here is reported rather than made. */
async function existingFields() {
  const data = await ghl.call('GET', '/locations/' + LOC() + '/customFields?model=contact');
  const have = new Map((data.customFields || []).map(function (f) {
    return [String(f.name).toLowerCase(), f.id];
  }));
  const ids = {};
  FIELDS.forEach(function (pair) {
    var id = have.get(pair[0].toLowerCase());
    if (id) ids[pair[0]] = id;
  });
  return ids;
}

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

/* Everyone in the CRM, by phone.

   Only the dry run needs this. currentTenantContacts() asks who we
   have already synced; this asks who exists at all, which is what
   /contacts/upsert really matches on. The difference decides whether
   the first run creates a contact or edits one somebody else made,
   and those fire different workflows.

   Paged rather than filtered because there is no "any phone" filter,
   and a storage facility's CRM is small enough to walk. */
async function allContactsByPhone() {
  const out = new Map();
  let page = 1;
  for (;;) {
    const data = await ghl.call('POST', '/contacts/search', {
      locationId: LOC(), page, pageLimit: 100,
    });
    const list = (data && data.contacts) || [];
    for (const c of list) {
      const phone = String(c.phone || '').replace(/\D/g, '').slice(-10);
      if (phone && !out.has(phone)) out.set(phone, c);
    }
    if (list.length < 100) break;
    page++;
    /* A runaway page loop on someone else's API is not worth the
       completeness. Fifty pages is five thousand contacts. */
    if (page > 50) break;
  }
  return out;
}

/* Every contact custom field in the location: name, type, and the
   options if it is a dropdown.

   Only the dry run uses this. It exists because our sync was about
   to create its own Tenant Status and Move-In Date alongside the
   Status and Move In-Date that Chris already built a workflow
   around. Two fields describing the same thing is how a CRM ends
   up with one of them quietly wrong. This shows what is already
   there so the sync can write to it instead. */
async function fieldInventory() {
  const data = await ghl.call('GET', '/locations/' + LOC() + '/customFields?model=contact');
  return ((data && data.customFields) || []).map(function (f) {
    return {
      name: f.name,
      type: f.dataType,
      /* All of them. The caller truncates for display; the room
         number comparison needs the whole list or it reports
         every unit as unmatched. */
      options: f.picklistOptions || [],
    };
  }).sort(function (x, y) { return x.name < y.name ? -1 : 1; });
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
  /* ---- Dry run ----
     ?dry=1 runs the whole comparison and writes nothing. It is
     allowed past the enabled gate on purpose, because the question it
     answers is whether to open that gate at all.

     It still needs the secret. It reads the rentroll, which is every
     tenant's name, address and phone number, and that is not
     something to leave on an open URL.

     What comes back is counts and a de-identified sample. Initials
     and the last four digits are enough to recognise a record and not
     enough to be a leak if this ends up pasted into a chat window. */
  const dry = Boolean(req.query && req.query.dry);

  if (!dry && process.env.GHL_TENANTS_ENABLED !== 'on') {
    return res.status(200).json({ paused: true, reason: 'GHL_TENANTS_ENABLED is not on' });
  }
  if (!ghl.configured()) return res.status(503).json({ error: 'ghl_not_configured' });

  const stats = { contracts: 0, people: 0, upserted: 0, no_phone: 0, moved_out: 0, errors: 0 };
  const plan = { create: [], update: [], mark_former: [] };
  try {
    const [feed, fields, tagged, codes, everyone, inventory] = await Promise.all([
      fetchRentroll(),
      /* ensureFields() creates any custom field that does not exist
         yet, so a dry run must not call it. */
      dry ? existingFields() : ensureFields(),
      currentTenantContacts(),
      gateCodes(),
      dry ? allContactsByPhone() : Promise.resolve(new Map()),
      dry ? fieldInventory() : Promise.resolve([]),
    ]);
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
      if (dry) {
        /* upsert matches on phone against every contact in the
           location, not just the ones we have tagged. Asking the
           tagged list alone reported all fifty five as new, which
           was wrong in the way that matters: an update fires Contact
           Changed, and a create does not. */
        const existing = everyone.get(p.phone);
        plan[existing ? 'update' : 'create'].push({
          initials: (name.firstName.charAt(0) + '.' + name.lastName.charAt(0) + '.').toUpperCase(),
          phone_last4: p.phone.slice(-4),
          units: p.rooms.length,
          balance_owed: p.balance ? '$' + p.balance.toFixed(2) : '$0.00',
          has_gate_code: Boolean(codes.get(p.phone)),
          /* For an update, where the contact came from originally.
             A website request means they are already in a workflow. */
          existing_source: (everyone.get(p.phone) || {}).source || null,
          existing_tags: ((everyone.get(p.phone) || {}).tags || []).slice(0, 4),
        });
        continue;
      }
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
      if (dry) {
        plan.mark_former.push({ phone_last4: String(phone).slice(-4) });
        continue;
      }
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

    if (dry) {
      const missing = FIELDS.map((x) => x[0]).filter((n) => !fields[n]);

      /* Can the rentroll room numbers actually go into Chris's
         Unit Number dropdown? It is a multi-select with a fixed
         list of 234 options, so a room it does not contain cannot
         be written. Asking rather than assuming, because the two
         systems were built by different people at different times
         and nothing has ever made them agree. */
      const unitField = inventory.filter(function (f) { return f.name === 'Unit Number'; })[0];
      const allowed = unitField ? unitField.options.map(String) : [];
      const combinedField = inventory.filter(function (f) { return f.name === 'Combined Unit Number'; })[0];
      const combinedAllowed = combinedField ? combinedField.options.map(String) : [];
      const rooms = [];
      feed.forEach(function (c) {
        if (c.room && rooms.indexOf(c.room) < 0) rooms.push(c.room);
      });
      /* Raw, as the rentroll spells it, and again after splitRoom
         strips the padding and separates a combined pair. The gap
         between the two numbers is the whole argument for
         normalising rather than creating our own field. */
      const rawUnmatched = rooms.filter(function (r) { return allowed.indexOf(String(r)) < 0; });
      const unmatched = [];
      const combinedUnmatched = [];
      rooms.forEach(function (r) {
        const sp = splitRoom(r);
        if (allowed.indexOf(sp.unit) < 0) unmatched.push(r);
        sp.combined.forEach(function (c2) {
          if (combinedAllowed.indexOf(c2) < 0) combinedUnmatched.push(r);
        });
      });

      return res.status(200).json({
        dry_run: true,
        wrote_nothing: true,
        enabled: process.env.GHL_TENANTS_ENABLED === 'on',
        rentroll: {
          contracts: stats.contracts,
          people_with_a_phone: stats.people,
          skipped_no_phone: stats.no_phone,
        },
        already_tagged_tenant_in_ghl: tagged.size,
        contacts_in_ghl_with_a_phone: everyone.size,
        existing_custom_fields: inventory.map(function (f) {
          return { name: f.name, type: f.type, option_count: f.options.length, options: f.options.slice(0, 8) };
        }),
        unit_numbers: {
          distinct_rooms_in_rentroll: rooms.length,
          options_on_the_dropdown: allowed.length,
          rooms_not_on_the_dropdown_raw: rawUnmatched.length,
          rooms_not_on_the_dropdown_after_normalising: unmatched.length,
          combined_halves_not_on_their_dropdown: combinedUnmatched.length,
          sample_rooms: rooms.slice(0, 12),
          sample_unmatched: unmatched.slice(0, 12),
          sample_combined_unmatched: combinedUnmatched.slice(0, 12),
          sample_normalised: rooms.slice(0, 10).map(function (r) {
            const sp = splitRoom(r); return r + ' -> ' + sp.unit + (sp.combined.length ? ' + ' + sp.combined.join(',') : '');
          }),
        },
        would: {
          create: plan.create.length,
          update: plan.update.length,
          mark_former: plan.mark_former.length,
          custom_fields_to_create: missing,
        },
        /* Enough to recognise a record, not enough to be a leak. */
        sample_create: plan.create.slice(0, 5),
        sample_update: plan.update.slice(0, 5),
        sample_former: plan.mark_former.slice(0, 5),
      });
    }

    return res.status(200).json({ ok: true, ...stats });
  } catch (err) {
    console.error('ghl-tenants failed:', err);
    return res.status(500).json({ error: 'sync_failed', message: String(err.message).slice(0, 300), ...stats });
  }
};
