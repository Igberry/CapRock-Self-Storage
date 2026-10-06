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
/* ---- Where a tenant's details go ----

   Chris built fields and a workflow around them before this sync
   existed. An earlier version of this file was about to create its
   own Tenant Status next to his Status, and its own Move-In Date next
   to his Move In-Date, which would have left his welcome email
   reading two fields that nothing ever filled in. So these write to
   what is already there.

   ADOPTED: his, looked up by name and never created. If one of these
   goes missing the sync stops and says which, because a renamed field
   is a decision someone made in the CRM and not something to paper
   over by quietly making a new one.

   CREATED: genuinely new, and declared as the type they should have
   been in the first place. Paid Through as a date rather than text,
   so it can be compared. Balance Owed as money rather than text, so
   it can be summed. */
const ADOPTED = [
  'Status',                 // SINGLE_OPTIONS: Current / Delinquent / Move Out
  'Move In-Date',           // DATE, so it takes ISO and not 1/5/2026
  'Unit Number',            // MULTIPLE_OPTIONS, 234 of them, unpadded
  'Combined Unit Number',   // MULTIPLE_OPTIONS, the second half of a pair
  'Gate Code (New)',        // TEXT. The older Gate Code is NUMERICAL and
                            // would eat the leading zero on 0472.
];

const FIELDS = [
  ['Paid Through',     'DATE'],
  ['Balance Owed',     'MONETORY'],
  ['WSS Contract IDs', 'TEXT'],
];

/* When is somebody behind? Paid Through in the past, rather than a
   balance above zero: a tenant who owes five dollars on the morning
   it falls due is not delinquent, and marking them so would put them
   in front of whatever Chris hangs off that status. One constant, so
   the answer can change in one place. */
const DELINQUENT_WHEN = 'paid_through_has_passed';

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

/* Create ours, find Chris's, and refuse to run if one of his has
   gone. Returns a name to id map covering both sets. */
async function ensureFields() {
  const made = await ghl.ensureContactFields(FIELDS);
  const have = await existingFields(ADOPTED);
  const missing = ADOPTED.filter((n) => !have[n]);
  if (missing.length) {
    throw new Error('these contact fields are missing from GHL and this sync ' +
      'will not create them: ' + missing.join(', '));
  }
  return Object.assign({}, made, have);
}

/* The same lookup without the creating half, for the dry run.
   ensureContactFields() makes any field that does not exist yet,
   which is a write, and a preview that changes the CRM is not a
   preview. A name missing from here is reported rather than made. */
async function existingFields(names) {
  const want = names || FIELDS.map((pair) => pair[0]);
  const data = await ghl.call('GET', '/locations/' + LOC() + '/customFields?model=contact');
  const have = new Map((data.customFields || []).map(function (f) {
    return [String(f.name).toLowerCase(), f.id];
  }));
  const ids = {};
  want.forEach(function (name) {
    var id = have.get(String(name).toLowerCase());
    if (id) ids[name] = id;
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

  /* ---- One tenant first ----
     GHL_TENANTS_ONLY limits a real run to the phone numbers listed
     in it, comma separated, last ten digits. Set it to one number,
     watch that single contact and whatever workflow it wakes, then
     clear it and let the rest through.

     The same shape GATE_TEXT_ONLY had, and for the same reason:
     the first unrehearsed run of a job like this sent thirty eight
     texts nobody intended. */
  const onlyRaw = String(process.env.GHL_TENANTS_ONLY || '').replace(/[^0-9,]/g, '');
  const only = onlyRaw ? onlyRaw.split(',').map(function (x) { return x.slice(-10); }).filter(Boolean) : [];

  if (!dry && process.env.GHL_TENANTS_ENABLED !== 'on') {
    return res.status(200).json({ paused: true, reason: 'GHL_TENANTS_ENABLED is not on' });
  }
  if (!ghl.configured()) return res.status(503).json({ error: 'ghl_not_configured' });

  const stats = { contracts: 0, people: 0, upserted: 0, no_phone: 0, moved_out: 0, errors: 0, skipped_fields: {} };
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

    /* A rehearsal touches only the numbers it was given. */
    if (only.length) {
      for (const key of Array.from(people.keys())) {
        if (only.indexOf(key) < 0) people.delete(key);
      }
      stats.limited_to = people.size;
    }

    for (const p of people.values()) {
      const name = splitName(p.customer_name);
      const earliestPaid = p.paid.filter(Boolean).sort()[0] || '';
      /* A field with no id is not a field. Sending { id: undefined }
         to GHL writes nothing and reports nothing, so the value just
         vanishes and the record looks half filled for reasons nobody
         can see. Dropped here and counted instead. */
      const f = (n, v) => {
        if (!fields[n]) { stats.skipped_fields[n] = (stats.skipped_fields[n] || 0) + 1; return null; }
        return { id: fields[n], field_value: v };
      };

      /* The rentroll pads rooms with zeros and joins combined units
         with a hyphen; the CRM dropdowns do neither. */
      const units = { primary: [], combined: [] };
      p.rooms.forEach(function (room) {
        const sp = splitRoom(room);
        if (sp.unit && units.primary.indexOf(sp.unit) < 0) units.primary.push(sp.unit);
        sp.combined.forEach(function (c2) {
          if (units.combined.indexOf(c2) < 0) units.combined.push(c2);
        });
      });
      units.primary.sort(function (a, b) { return Number(a) - Number(b); });
      units.combined.sort(function (a, b) { return Number(a) - Number(b); });

      /* Behind on rent, by the rule named at the top of the file.
         Paid Through in the past rather than any balance at all. */
      const today = new Date().toISOString().slice(0, 10);
      const behind = DELINQUENT_WHEN === 'paid_through_has_passed'
        ? Boolean(earliestPaid && earliestPaid < today)
        : p.balance > 0;

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
            /* Rooms, split the way the CRM holds them: the first
               number of each on Unit Number, the second half of a
               combined pair on Combined Unit Number. Both are
               multi-selects, so both take arrays. */
            f('Unit Number', units.primary),
            f('Combined Unit Number', units.combined),
            /* A real DATE field, so ISO rather than 1/5/2026. */
            f('Move In-Date', p.moved || ''),
            f('Paid Through', earliestPaid || ''),
            /* MONETORY wants the number, not a string with a $. */
            f('Balance Owed', Number(p.balance.toFixed(2))),
            f('Status', behind ? 'Delinquent' : 'Current'),
            /* The TEXT one. The older Gate Code is NUMERICAL and
               would turn 0472 into 472. */
            f('Gate Code (New)', codes.get(p.phone) || ''),
            f('WSS Contract IDs', p.ids.join(', ')),
          ].filter(Boolean),
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
          /* "Move Out" is the option Chris's Status field actually
             offers. "Former" is not on the list and would be
             rejected or stored as nothing. The units are released so
             the room shows as theirs no longer. */
          customFields: [
            { id: fields['Status'], field_value: 'Move Out' },
            { id: fields['Unit Number'], field_value: [] },
            { id: fields['Combined Unit Number'], field_value: [] },
          ],
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
        limited_to_phones: only.length || null,
        /* How many of those numbers are actually tenants. Zero means
           the rehearsal would touch nobody, which reads as success
           and proves nothing: the usual cause is picking a number
           that belongs to someone who works here rather than someone
           who rents here. */
        limited_matched_tenants: only.length ? (stats.limited_to || 0) : null,
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
    /* A field that is not there is somebody renaming something in
       the CRM, not the server falling over. Say so plainly, with
       the name, rather than returning a stack trace to a cron. */
    if (String(err.message).indexOf('missing from GHL') >= 0) {
      return res.status(503).json({ error: 'fields_missing', message: err.message, ...stats });
    }
    return res.status(500).json({ error: 'sync_failed', message: String(err.message).slice(0, 300), ...stats });
  }
};
