/* ================================================================
   CapRock Self Storage — gate code sync
   GET /api/gate-sync      (Authorization: Bearer <GATE_SYNC_SECRET>)

   WHY THIS EXISTS
   WebSelfStorage can push gate codes only to the controllers on its
   own list, and CapRock's are not on it (U-Haul, 16 Sept 2026: no
   Alarm.com integration, no API for codes, none planned). So codes
   are issued here instead: one per person, stored in Supabase, texted
   to the tenant, and handed to the controller through _gate/alarm.js.

   WHAT ONE RUN DOES
     1. read the rentroll: every current contract, with phone, room,
        paid-through date and balance
     2. mirror it into tenants; a contract that has left the list is
        marked departed
     3. for each person with at least one live contract:
          no code, or a revoked one  -> issue a new code, text it
          behind on rent             -> suspend (see SUSPEND_AFTER_DAYS)
          paid up again              -> reinstate
     4. a person with no live contracts left -> revoke
     5. every change goes to the controller, and to the events log
     6. if the controller is not connected, the office is told what
        to key in by hand

   It is idempotent: running it twice in a row changes nothing the
   second time. That is what makes a five-minute schedule safe.

   SETTINGS (Vercel environment)
     GATE_ENABLED          "on" or the sync does nothing at all
     GATE_SYNC_SECRET      required; the scheduler sends it as a Bearer
     SUPABASE_URL          required
     SUPABASE_SERVICE_KEY  required; service role, never the anon key
     WSS_API_KEY           already set for the price proxy
     GHL_API_KEY           Private Integration token, see _gate/ghl.js
     GHL_LOCATION_ID
     GATE_TEXTING          "on" to actually send; anything else rehearses
     GATE_TEXT_ONLY        comma-separated phones; when set, only these
                           are texted (the first-real-message safety)
     OFFICE_PHONE          ten digits, texted "please key this in"
     OFFICE_EMAIL          or emailed; either or both
     SUSPEND_AFTER_DAYS    default 30
     GATE_DRY_RUN          "1": read and report, write nothing at all

   SCHEDULING
   vercel.json asks for every five minutes. Vercel's Hobby plan only
   allows daily crons; on Hobby, point any external scheduler at this
   URL with the secret instead (or upgrade). The endpoint does not
   care who calls it, only that the secret matches.
   ================================================================ */
'use strict';

const db = require('./_gate/db');
const ghl = require('./_gate/ghl');
const alarm = require('./_gate/alarm');
const codes = require('./_gate/codes');
const { fetchRentroll } = require('./_gate/rentroll');

const OFFICE_NUMBER_DISPLAY = '(806) 589-1472';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysPast(dateStr) {
  if (!dateStr) return 0;
  const ms = Date.now() - new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.floor(ms / 86400000);
}

/* Behind on rent: a balance owing, and paid-through further back than
   the grace period. Both together, so a tenant whose paid-through
   just rolled over yesterday is not locked out over $0.00. */
function delinquent(contracts) {
  const grace = Number(process.env.SUSPEND_AFTER_DAYS || 30);
  return contracts.some((c) => c.balance > 0 && daysPast(c.paid_thru) > grace);
}

function tenantMessage(code, rooms) {
  const unit = rooms.length === 1 ? `unit ${rooms[0]}` : `units ${rooms.join(', ')}`;
  return `CapRock Self Storage: your gate code for ${unit} is ${code}. ` +
         `Please keep it private. Questions? Call ${OFFICE_NUMBER_DISPLAY}.`;
}

function officeMessage(kind, person, code) {
  const who = `${person.customer_name} (${person.rooms.join(', ')})`;
  if (kind === 'issued')     return `Gate: ADD code ${code} for ${who}.`;
  if (kind === 'suspended')  return `Gate: SUSPEND code ${code} for ${who} (behind on rent).`;
  if (kind === 'reinstated') return `Gate: REINSTATE code ${code} for ${who} (paid up).`;
  if (kind === 'revoked')    return `Gate: REMOVE code ${code} for ${who} (moved out).`;
  return `Gate: ${kind} ${code} for ${who}.`;
}

/* Insert a fresh code, drawing again if the database says the number
   is already live. Five tries is far more than the odds need. */
async function issueCode(person, status) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = codes.generate();
    try {
      await db.rest('POST', 'codes?on_conflict=tenant_key', [{
        tenant_key: person.tenant_key,
        code,
        status: status || 'active',
        customer_name: person.customer_name,
        phone: person.phone,
        issued_at: new Date().toISOString(),
        texted_at: null,
        suspended_at: status === 'suspended' ? new Date().toISOString() : null,
        revoked_at: null,
        alarm_synced_at: null,
        alarm_ref: null,
        updated_at: new Date().toISOString(),
      }], 'resolution=merge-duplicates,return=minimal');
      return code;
    } catch (e) {
      if (e.code === '23505') continue;   // codes_live_code: drawn a live number, draw again
      throw e;
    }
  }
  throw new Error('could not find a free code in five draws');
}

async function pushToController(kind, code, person, stats) {
  const fn = kind === 'issued' || kind === 'reinstated' ? alarm.add
           : kind === 'suspended' ? alarm.suspend
           : alarm.remove;
  const r = await fn(code, person);
  if (r.ok) {
    await db.update('codes', `tenant_key=eq.${encodeURIComponent(person.tenant_key)}`,
      { alarm_synced_at: new Date().toISOString(), alarm_ref: r.ref || null });
    await db.event(person.tenant_key, 'alarm_synced', { kind, code });
    return;
  }
  await db.event(person.tenant_key, 'alarm_failed', { kind, code, reason: r.reason });
  /* Not connected yet: the office keys it in. One message per change. */
  const sent = await ghl.office(officeMessage(kind, person, code));
  await db.event(person.tenant_key, sent.sent ? 'office_notified' : 'office_notify_failed',
    { kind, code, reason: sent.reason });
  stats.pending++;
}

async function run() {
  const stats = { tenants_seen: 0, issued: 0, suspended: 0, reinstated: 0, revoked: 0, texted: 0, pending: 0 };
  const dry = process.env.GATE_DRY_RUN === '1';
  const now = new Date().toISOString();

  const feed = await fetchRentroll();
  stats.tenants_seen = feed.length;

  /* Group contracts by person. */
  const people = new Map();
  for (const c of feed) {
    if (!people.has(c.tenant_key)) {
      people.set(c.tenant_key, { tenant_key: c.tenant_key, customer_name: c.customer_name, phone: c.phone, rooms: [], contracts: [] });
    }
    const p = people.get(c.tenant_key);
    p.rooms.push(c.room);
    p.contracts.push(c);
  }

  const existingCodes = new Map((await db.select('codes?select=*')).map((r) => [r.tenant_key, r]));
  const knownContracts = await db.select('tenants?select=contract_unit_id,tenant_key&departed_at=is.null');
  const feedIds = new Set(feed.map((c) => c.contract_unit_id));
  const departed = knownContracts.filter((t) => !feedIds.has(t.contract_unit_id));

  if (dry) {
    const plan = [];
    for (const p of people.values()) {
      const c = existingCodes.get(p.tenant_key);
      if (!c || c.status === 'revoked') plan.push({ kind: delinquent(p.contracts) ? 'issue_suspended' : 'issue', who: p.customer_name, rooms: p.rooms });
      else if (delinquent(p.contracts) && c.status === 'active') plan.push({ kind: 'suspend', who: p.customer_name });
      else if (!delinquent(p.contracts) && c.status === 'suspended') plan.push({ kind: 'reinstate', who: p.customer_name });
    }
    for (const [k, c] of existingCodes) if (!people.has(k) && c.status !== 'revoked') plan.push({ kind: 'revoke', who: c.customer_name });
    /* Recorded as counts, so a rehearsal can be read from the
       database without the endpoint's secret, and without writing
       tenant names anywhere a dry run should not. */
    const counts = {};
    for (const step of plan) counts[step.kind] = (counts[step.kind] || 0) + 1;
    counts.people = people.size;
    counts.no_phone = [...people.values()].filter((p) => !p.phone).length;
    await db.insert('sync_runs', [{
      started_at: now, finished_at: new Date().toISOString(), ok: true, dry_run: true,
      tenants_seen: stats.tenants_seen, plan: { ...counts, departed: departed.length },
    }]).catch((e) => console.error('dry run record failed:', e.message));
    return { dry_run: true, stats, departed: departed.length, plan };
  }

  /* 2. mirror */
  await db.upsert('tenants', feed.map((c) => ({ ...c, last_seen: now, departed_at: null })), 'contract_unit_id');
  for (const t of departed) {
    await db.update('tenants', `contract_unit_id=eq.${t.contract_unit_id}`, { departed_at: now });
  }

  /* 3. people with a live contract */
  for (const p of people.values()) {
    const current = existingCodes.get(p.tenant_key);
    const behind = delinquent(p.contracts);

    if (!current || current.status === 'revoked') {
      /* Already behind on rent when first seen (the backfill will find
         several): the code is created suspended, not texted, and not
         sent to the gate. Texting someone a code and locking it five
         minutes later would be worse than silence. It goes live, and
         they are told, when the balance clears. */
      const code = await issueCode(p, behind ? 'suspended' : 'active');
      stats.issued++;
      await db.event(p.tenant_key, 'issued', { code, rooms: p.rooms, name: p.customer_name, suspended: behind });
      if (behind) { stats.suspended++; continue; }

      if (p.phone) {
        const sent = await ghl.text({ customerName: p.customer_name, phone: p.phone, message: tenantMessage(code, p.rooms) });
        if (sent.sent) {
          stats.texted++;
          await db.update('codes', `tenant_key=eq.${encodeURIComponent(p.tenant_key)}`, { texted_at: new Date().toISOString() });
          await db.event(p.tenant_key, 'texted', { code });
        } else {
          await db.event(p.tenant_key, 'text_failed', { code, reason: sent.reason });
        }
      } else {
        await db.event(p.tenant_key, 'text_failed', { code, reason: 'no_phone_on_record' });
      }
      await pushToController('issued', code, p, stats);
      continue;
    }

    if (behind && current.status === 'active') {
      await db.update('codes', `tenant_key=eq.${encodeURIComponent(p.tenant_key)}`,
        { status: 'suspended', suspended_at: now, updated_at: now });
      stats.suspended++;
      await db.event(p.tenant_key, 'suspended', { code: current.code, paid_thru: p.contracts.map((c) => c.paid_thru) });
      await pushToController('suspended', current.code, p, stats);
    } else if (!behind && current.status === 'suspended') {
      await db.update('codes', `tenant_key=eq.${encodeURIComponent(p.tenant_key)}`,
        { status: 'active', suspended_at: null, updated_at: now });
      stats.reinstated++;
      await db.event(p.tenant_key, 'reinstated', { code: current.code });
      if (!current.texted_at && p.phone) {
        const sent = await ghl.text({ customerName: p.customer_name, phone: p.phone, message: tenantMessage(current.code, p.rooms) });
        await db.event(p.tenant_key, sent.sent ? 'texted' : 'text_failed', { code: current.code, reason: sent.reason });
        if (sent.sent) { stats.texted++; await db.update('codes', `tenant_key=eq.${encodeURIComponent(p.tenant_key)}`, { texted_at: new Date().toISOString() }); }
      }
      await pushToController('reinstated', current.code, p, stats);
    }
  }

  /* 4. people with no live contract left */
  for (const [key, c] of existingCodes) {
    if (people.has(key) || c.status === 'revoked') continue;
    await db.update('codes', `tenant_key=eq.${encodeURIComponent(key)}`,
      { status: 'revoked', revoked_at: now, updated_at: now });
    stats.revoked++;
    await db.event(key, 'revoked', { code: c.code });
    await pushToController('revoked', c.code, { tenant_key: key, customer_name: c.customer_name, phone: c.phone, rooms: [] }, stats);
  }

  return { dry_run: false, stats, departed: departed.length };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  /* Vercel's own scheduler sends CRON_SECRET; anything else sends
     GATE_SYNC_SECRET. Either name works so the cron needs no extra
     setting beyond the one Vercel documents. */
  const secret = process.env.GATE_SYNC_SECRET || process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!db.configured()) return res.status(503).json({ error: 'supabase_not_configured' });

  /* Paused unless GATE_ENABLED is exactly "on". Added 16 September
     after the first live run sent 38 texts two steps ahead of the
     plan: from now on the sync does nothing at all, scheduler or not,
     until someone sets this deliberately. */
  if (process.env.GATE_ENABLED !== 'on') {
    return res.status(200).json({ paused: true, reason: 'GATE_ENABLED is not on' });
  }

  const started = new Date().toISOString();
  let runId = null;
  try {
    if (process.env.GATE_DRY_RUN !== '1') {
      const row = await db.insert('sync_runs', [{ started_at: started }]);
      runId = row && row[0] && row[0].id;
    }
    const result = await run();
    if (runId) {
      await db.update('sync_runs', `id=eq.${runId}`, {
        finished_at: new Date().toISOString(), ok: true,
        tenants_seen: result.stats.tenants_seen, issued: result.stats.issued,
        suspended: result.stats.suspended, reinstated: result.stats.reinstated, revoked: result.stats.revoked,
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('gate-sync failed:', err);
    if (runId) {
      await db.update('sync_runs', `id=eq.${runId}`, { finished_at: new Date().toISOString(), ok: false, error: String(err.message).slice(0, 500) }).catch(() => {});
    }
    await db.event(null, 'error', { message: String(err.message).slice(0, 500) });
    return res.status(500).json({ error: 'sync_failed' });
  }
};
