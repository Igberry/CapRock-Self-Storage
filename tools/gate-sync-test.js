#!/usr/bin/env node
/* Exercises api/gate-sync.js against an in-memory database, a fake
   rentroll and a texting stub. No network, no real tenants.
     node tools/gate-sync-test.js
   Three runs: a first population, a day of changes, and an identical
   run that must change nothing. */
'use strict';
const path = require('path');
const assert = require('assert');

/* ---- in-memory stand-ins, registered before the sync is loaded ---- */
const mem = { tenants: new Map(), codes: new Map(), events: [], sync_runs: [] };
const texts = [];

function parseFilter(filter) {
  const [k, v] = filter.split('=');
  const m = /^(eq|is)\.(.*)$/.exec(v);
  return { key: k, op: m[1], val: m[2] };
}
const fakeDb = {
  configured: () => true,
  async rest(method, p, body) {
    if (method === 'POST' && p.startsWith('codes')) {
      for (const row of body) {
        for (const [k, c] of mem.codes) {
          if (k !== row.tenant_key && c.code === row.code && c.status !== 'revoked') {
            const e = new Error('duplicate'); e.code = '23505'; throw e;
          }
        }
        mem.codes.set(row.tenant_key, { ...row });
      }
      return null;
    }
    throw new Error('unexpected rest ' + method + ' ' + p);
  },
  async select(p) {
    if (p.startsWith('codes')) return [...mem.codes.values()].map((r) => ({ ...r }));
    if (p.startsWith('tenants')) return [...mem.tenants.values()].filter((t) => t.departed_at == null).map((r) => ({ ...r }));
    throw new Error('unexpected select ' + p);
  },
  async insert(table, rows) {
    if (table === 'events') { mem.events.push(...rows); return rows; }
    if (table === 'sync_runs') { const r = { id: mem.sync_runs.length + 1, ...rows[0] }; mem.sync_runs.push(r); return [r]; }
    throw new Error('unexpected insert ' + table);
  },
  async upsert(table, rows, key) {
    for (const r of rows) mem[table].set(r[key], { ...(mem[table].get(r[key]) || {}), ...r });
  },
  async update(table, filter, patch) {
    const f = parseFilter(filter);
    for (const row of mem[table].values ? mem[table].values() : mem[table]) {
      if (String(row[f.key]) === decodeURIComponent(f.val)) Object.assign(row, patch);
    }
  },
  async event(tenant_key, kind, detail) { mem.events.push({ tenant_key, kind, detail }); },
};
const fakeGhl = {
  configured: () => true, on: () => true,
  async text(t) { texts.push(t); return { sent: true, contactId: 'c_' + t.phone }; },
  async office(message) { texts.push({ phone: 'office', message, tags: ['gate-office'] }); return { sent: true }; },
};
const fakeAlarm = { configured: () => false, add: async () => ({ ok: false, reason: 'not_configured' }), suspend: async () => ({ ok: false, reason: 'not_configured' }), remove: async () => ({ ok: false, reason: 'not_configured' }) };
let feed = [];
const fakeRentroll = { fetchRentroll: async () => feed.map((r) => ({ ...r })) };

const root = path.join(__dirname, '..', 'api');
require.cache[require.resolve(path.join(root, '_gate/db.js'))] = { exports: fakeDb, loaded: true, id: 'db' };
require.cache[require.resolve(path.join(root, '_gate/ghl.js'))] = { exports: fakeGhl, loaded: true, id: 'ghl' };
require.cache[require.resolve(path.join(root, '_gate/alarm.js'))] = { exports: fakeAlarm, loaded: true, id: 'alarm' };
require.cache[require.resolve(path.join(root, '_gate/rentroll.js'))] = { exports: fakeRentroll, loaded: true, id: 'rr' };

process.env.GATE_SYNC_SECRET = 'test';
process.env.GATE_ENABLED = 'on';
process.env.OFFICE_PHONE = '8065550000';
const handler = require(path.join(root, 'gate-sync.js'));

async function call() {
  let out;
  const res = { setHeader() {}, status(c) { out = { code: c }; return res; }, json(b) { out.body = b; return out; } };
  await handler({ headers: { authorization: 'Bearer test' } }, res);
  return out;
}

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const contract = (id, key, name, phone, room, extra) => ({
  contract_unit_id: id, tenant_key: key, customer_name: name, phone, room,
  moved_in: ago(100), paid_thru: ago(-14), balance: 0, street_rate: 60, ...extra,
});

(async () => {
  /* ---- run 1: first population ---- */
  feed = [
    contract('a1', '8060000001', 'ALPHA, ANN', '8060000001', '101'),
    contract('a2', '8060000001', 'ALPHA, ANN', '8060000001', '102'),
    contract('b1', '8060000002', 'BRAVO, BOB', '8060000002', '201', { paid_thru: ago(90), balance: 300 }),
    contract('c1', 'contract:c1', 'CHARLIE, CY', '', '301'),
  ];
  let r = await call();
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual([r.body.stats.issued, r.body.stats.suspended, r.body.stats.texted], [3, 1, 1], JSON.stringify(r.body.stats));
  const ann = mem.codes.get('8060000001'), bob = mem.codes.get('8060000002'), cy = mem.codes.get('contract:c1');
  assert.equal(ann.status, 'active'); assert.equal(bob.status, 'suspended'); assert.equal(cy.status, 'active');
  assert.ok(/^[1-9]\d{3}$/.test(ann.code));
  assert.equal(texts.filter((t) => t.phone === '8060000001').length, 1, 'Ann texted once');
  assert.ok(texts[0].message.includes('units 101, 102'), texts[0].message);
  assert.equal(texts.filter((t) => t.phone === '8060000002').length, 0, 'Bob (behind) not texted');
  assert.ok(mem.events.some((e) => e.tenant_key === 'contract:c1' && e.kind === 'text_failed' && e.detail.reason === 'no_phone_on_record'));
  const officeTexts = texts.filter((t) => t.tags && t.tags[0] === 'gate-office');
  assert.equal(officeTexts.length, 2, 'office told to ADD Ann and Cy, not suspended Bob');
  console.log('run 1  ok  issued 3 (1 suspended), texted 1, office notified 2');

  /* ---- run 2: Ann drops a unit, Bob pays, Cy leaves, Dee arrives ---- */
  texts.length = 0;
  feed = [
    contract('a1', '8060000001', 'ALPHA, ANN', '8060000001', '101'),
    contract('b1', '8060000002', 'BRAVO, BOB', '8060000002', '201'),
    contract('d1', '8060000004', 'DELTA, DEE', '8060000004', '401'),
  ];
  r = await call();
  assert.deepEqual([r.body.stats.issued, r.body.stats.reinstated, r.body.stats.revoked, r.body.departed], [1, 1, 1, 2], JSON.stringify(r.body));
  assert.equal(mem.codes.get('8060000001').code, ann.code, 'Ann keeps her code');
  assert.equal(mem.codes.get('8060000002').status, 'active');
  assert.equal(mem.codes.get('contract:c1').status, 'revoked');
  assert.equal(mem.codes.get('8060000004').status, 'active');
  assert.equal(texts.filter((t) => t.phone === '8060000002').length, 1, 'Bob texted on reinstatement, never before');
  assert.ok(texts.find((t) => t.phone === '8060000002').message.includes(bob.code));
  console.log('run 2  ok  Ann unchanged, Bob reinstated + texted, Cy revoked, Dee issued');

  /* ---- run 3: nothing changed ---- */
  texts.length = 0;
  const before = JSON.stringify([...mem.codes.values()]);
  r = await call();
  assert.deepEqual(r.body.stats, { ...r.body.stats, issued: 0, suspended: 0, reinstated: 0, revoked: 0, texted: 0 });
  assert.equal(JSON.stringify([...mem.codes.values()]), before, 'idempotent');
  assert.equal(texts.length, 0);
  console.log('run 3  ok  identical feed, nothing changed, nothing sent');

  /* ---- the code rules ---- */
  const codes = require(path.join(root, '_gate/codes.js'));
  for (let i = 0; i < 5000; i++) assert.ok(!codes.weak(codes.generate()));
  for (const bad of ['0000', '1234', '1111', '1212', '0123', '2026']) assert.ok(codes.weak(bad), bad);
  console.log('codes  ok  5000 draws, none weak');

  /* ---- wrong secret ---- */
  let out; const res = { setHeader() {}, status(c) { out = { code: c }; return res; }, json(b) { out.body = b; return out; } };
  await handler({ headers: { authorization: 'Bearer nope' } }, res);
  assert.equal(out.code, 401);
  console.log('auth   ok  wrong secret refused');
  console.log('\nPASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
