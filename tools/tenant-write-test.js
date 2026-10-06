/* What the tenant sync writes to a contact, and what it must not.

   WHY THIS EXISTS
   On 6 October a rehearsal on a single tenant sent him a welcome text
   he did not need. The workflow condition reading "move-in date is in
   the next 14 days" had passed for somebody who moved in long ago,
   because the rentroll had no move-in date for him and this sync sent
   an empty string to a DATE field rather than leaving it alone.

   An empty string is not an empty date. It is a value, and something
   downstream has to decide what it means. Nobody should have to guess
   what GHL decided.

   So: a typed field is either written with a real value or not
   written at all. TEXT is different and may be cleared, because
   emptying a gate code is a legitimate thing to say.

   node tools/tenant-write-test.js */
'use strict';

const path = require('path');

const TYPES = {
  a1: ['Status', 'SINGLE_OPTIONS'],
  a2: ['Move In-Date', 'DATE'],
  a3: ['Unit Number', 'MULTIPLE_OPTIONS'],
  a4: ['Combined Unit Number', 'MULTIPLE_OPTIONS'],
  a5: ['Gate Code (New)', 'TEXT'],
  n1: ['Paid Through', 'DATE'],
  n2: ['Balance Owed', 'MONETORY'],
  n3: ['WSS Contract IDs', 'TEXT'],
};
/* Types where an empty value is a question rather than an answer. */
const TYPED = ['DATE', 'MONETORY', 'SINGLE_OPTIONS', 'MULTIPLE_OPTIONS'];

function stub(rentroll) {
  const g = path.resolve(__dirname, '..', 'api', '_gate', 'ghl.js');
  const r = path.resolve(__dirname, '..', 'api', '_gate', 'rentroll.js');
  const d = path.resolve(__dirname, '..', 'api', '_gate', 'db.js');
  const h = path.resolve(__dirname, '..', 'api', 'ghl-tenants.js');
  [g, r, d, h].forEach((m) => { try { require(m); } catch (e) { /* first load */ } });
  const sent = [];
  require.cache[g].exports = {
    configured: () => true,
    call: async (m, u, b) => {
      if (/customFields/.test(u)) {
        return { customFields: [
          { id: 'a1', name: 'Status' },
          { id: 'a2', name: 'Move In-Date' },
          { id: 'a3', name: 'Unit Number', picklistOptions: ['25', '116'] },
          { id: 'a4', name: 'Combined Unit Number', picklistOptions: ['117'] },
          { id: 'a5', name: 'Gate Code (New)' },
        ] };
      }
      if (/contacts\/search/.test(u)) return { contacts: [] };
      if (/contacts\/upsert/.test(u)) { sent.push(b); return { contact: { id: 'c' } }; }
      return {};
    },
    ensureContactFields: async () => ({ 'Paid Through': 'n1', 'Balance Owed': 'n2', 'WSS Contract IDs': 'n3' }),
    sendSms: async () => {}, office: async () => {}, on: () => false, text: async () => {},
  };
  require.cache[r].exports = { fetchRentroll: async () => rentroll };
  require.cache[d].exports = { select: async () => [], configured: () => false };
  delete require.cache[h];
  return { sent, handler: require(h) };
}

async function run(rentroll) {
  const { sent, handler } = stub(rentroll);
  process.env.CRON_SECRET = 't';
  process.env.GHL_LOCATION_ID = 'loc';
  process.env.GHL_TENANTS_ENABLED = 'on';
  delete process.env.GHL_TENANTS_ONLY;
  const res = { statusCode: 0, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
  await handler({ method: 'GET', headers: { authorization: 'Bearer t' }, query: {} }, res);
  return sent;
}

let failed = 0;
const report = (label, fieldsSent) => {
  console.log('\n' + label);
  fieldsSent.forEach((f) => {
    const t = TYPES[f.id] || [f.id, '?'];
    console.log('  ' + t[0].padEnd(22) + t[1].padEnd(18) + JSON.stringify(f.field_value));
  });
  const bad = fieldsSent.filter((f) => {
    const t = (TYPES[f.id] || [])[1];
    return TYPED.indexOf(t) >= 0 && (f.field_value === '' || f.field_value === null || f.field_value === undefined);
  });
  if (bad.length) {
    failed++;
    console.log('  FAIL  ' + bad.length + ' typed field(s) sent empty');
  } else {
    console.log('  ok    no typed field received an empty value');
  }
};

(async () => {
  const noDates = await run([
    { phone: '8065551111', customer_name: 'NO, Dates', room: '025', contract_unit_id: 'x1', paid_thru: null, balance: 0, moved_in: null },
  ]);
  report('a tenant the rentroll has no dates for:', noDates[0].customFields);
  const hasMoveIn = noDates[0].customFields.some((f) => f.id === 'a2');
  if (hasMoveIn) { failed++; console.log('  FAIL  Move In-Date was written anyway'); }
  else console.log('  ok    Move In-Date was left alone, so the 14 day condition answers no');

  const full = await run([
    { phone: '8065552222', customer_name: 'JONES, Bob', room: '025', contract_unit_id: 'x1', paid_thru: '2026-09-01', balance: 68, moved_in: '2025-06-02' },
    { phone: '8065552222', customer_name: 'JONES, Bob', room: '116-117', contract_unit_id: 'x2', paid_thru: '2026-12-31', balance: 0, moved_in: '2026-02-10' },
  ]);
  report('a tenant with two units, one combined, behind on rent:', full[0].customFields);

  console.log('\n' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
