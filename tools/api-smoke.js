#!/usr/bin/env node
/* Invoke every endpoint's handler with a fake request and assert it
   answers instead of throwing.
     node tools/api-smoke.js

   WHY THIS EXISTS
   On 16 September "String" became "Smftring" in the proxy. That is
   valid JavaScript, so node --check passed and so did every other
   check; it threw only when the line actually ran, outside the try
   block, so Vercel returned its own 500 and the unit list vanished
   from the website for nine days.

   A syntax check cannot catch a call to a function that does not
   exist. Running the code can. Nothing here touches the network:
   fetch, the GHL client and the database are all replaced, so this
   is safe to run any time and needs no credentials. */
'use strict';
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'api');
const req = (p) => require.resolve(path.join(root, p));

/* Stubs. Every one records that it was called and returns something
   shaped like the real thing, so the handler runs its whole path. */
const calls = [];
const fakeGhl = {
  configured: () => true,
  on: () => true,
  async call(m, p, b) {
    calls.push([m, p]);
    if (m === 'GET' && p.includes('customFields')) return { customFields: [] };
    if (m === 'POST' && p.includes('customFields')) return { customField: { id: 'f1' } };
    if (m === 'GET' && p.includes('customValues')) return { customValues: [] };
    if (m === 'POST' && p === '/contacts/search') return { contacts: [] };
    if (m === 'POST' && p === '/contacts/upsert') return { contact: { id: 'c1' } };
    return {};
  },
  async text() { return { sent: true }; },
  async office() { return { sent: true }; },
  async sendSms() { return { sent: true }; },
  async ensureContactFields(list) {
    const ids = {};
    list.forEach(([n], i) => { ids[n] = 'f' + i; });
    return ids;
  },
};
const fakeDb = {
  configured: () => true,
  async select() { return []; },
  async insert() { return [{ id: 1 }]; },
  async upsert() {}, async update() {}, async event() {}, async rest() {},
};
const unit = {
  width: 10, length: 10, height: 8, sqft: 100, rate: 109,
  vacant: 2, total: 12, climate: true, driveUp: false, units: ['128'],
};
const contract = {
  contract_unit_id: 'a1', tenant_key: '8060000001', customer_name: 'ALPHA, ANN',
  phone: '8060000001', room: '101', moved_in: '2026-01-02', paid_thru: '2026-10-31',
  balance: 0, street_rate: 109, address: '1 Main St', city: 'Lubbock', state: 'Texas', zip: '79416',
};

require.cache[req('_gate/ghl.js')] = { exports: fakeGhl, loaded: true, id: 'ghl' };
require.cache[req('_gate/db.js')] = { exports: fakeDb, loaded: true, id: 'db' };
require.cache[req('_gate/rentroll.js')] = { exports: { fetchRentroll: async () => [contract], shape: (x) => x }, loaded: true, id: 'rr' };
require.cache[req('_avail/movein.js')] = { exports: { fetchMovein: async () => [unit], fetchAvailability: async () => [unit], KNOWN_SIZES: [] }, loaded: true, id: 'mi' };

/* api/wss.js talks to WebSelfStorage directly, so fetch is the stub. */
global.fetch = async () => ({
  ok: true,
  json: async () => ({
    availableUnits: [{
      locationName: 'Caprock Self Storage', width: 10, length: 10, height: 8,
      squareFootage: 100, monthly: 109, vacantUnits: 2, totalUnits: 12,
      sizeDescriptionsField: ['Interior 1st Floor Climate'], units: [{ unitNumber: '128' }],
    }],
    success: true,
  }),
});

process.env.WSS_API_KEY = 'test';
process.env.CRON_SECRET = 'test';
process.env.GHL_API_KEY = 'test';
process.env.GHL_LOCATION_ID = 'L1';
process.env.GHL_AVAIL_ENABLED = 'on';
process.env.GHL_TENANTS_ENABLED = 'on';
process.env.GATE_ENABLED = 'on';
process.env.REQUESTS_ENABLED = 'on';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test';

function run(file, request) {
  const handler = require(path.join(root, file));
  return new Promise((resolve, reject) => {
    let code = 0;
    const res = {
      setHeader() {}, end() { resolve({ code, body: null }); },
      status(c) { code = c; return res; },
      json(b) { resolve({ code, body: b }); return res; },
    };
    Promise.resolve(handler(request, res)).catch(reject);
  });
}

const auth = { authorization: 'Bearer test' };
const cases = [
  ['wss.js', { method: 'GET', headers: { origin: 'https://caprock-storage.com' }, query: { facility: 'lubbock-2213-n-quaker', resource: 'movein' } }, 200],
  ['wss.js', { method: 'GET', headers: {}, query: { facility: 'lubbock-2213-n-quaker', resource: 'location' } }, 200],
  ['wss.js', { method: 'GET', headers: {}, query: { facility: 'lubbock-2213-n-quaker', resource: 'nope' } }, 400],
  ['wss.js', { method: 'GET', headers: {}, query: { facility: 'nope', resource: 'movein' } }, 400],
  ['wss.js', { method: 'GET', headers: {}, query: { facility: 'lubbock-2213-n-quaker', resource: 'movein', x: '1' } }, 400],
  ['wss.js', { method: 'OPTIONS', headers: {}, query: {} }, 204],
  ['ghl-availability.js', { method: 'GET', headers: auth, query: {} }, 200],
  ['ghl-tenants.js', { method: 'GET', headers: auth, query: {} }, 200],
  ['gate-sync.js', { method: 'GET', headers: auth, query: {} }, 200],
  ['request.js', { method: 'POST', headers: { origin: 'https://caprock-storage.com' }, query: {}, body: {
    kind: 'rent', unit: { size: '10 x 10 x 8', rate: '$109', kind: 'Temperature controlled' },
    customer: { first: 'Jo', last: 'Smith', phone: '8065551234', email: 'jo@example.com', date: '2026-12-01', message: 'hello' },
    consent: true,
  } }, 200],
  ['request.js', { method: 'POST', headers: {}, query: {}, body: { kind: 'rent', unit: {}, customer: {} } }, 400],
  ['request.js', { method: 'GET', headers: {}, query: {} }, 405],
];

(async () => {
  let failed = 0;
  for (const [file, request, expect] of cases) {
    const what = `${file} ${request.method} ${JSON.stringify(request.query || {})}`;
    try {
      const { code, body } = await run(file, request);
      if (code !== expect) {
        failed++;
        console.log(`FAIL  ${what}\n      expected ${expect}, got ${code} ${JSON.stringify(body)}`);
      } else {
        console.log(`ok    ${what} -> ${code}`);
      }
    } catch (e) {
      failed++;
      console.log(`THREW ${what}\n      ${e && e.message}`);
    }
  }
  console.log(failed ? `\nFAIL: ${failed} of ${cases.length}` : `\nPASS: ${cases.length} handler calls, none threw`);
  process.exit(failed ? 1 : 0);
})();
