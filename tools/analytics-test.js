/* What gets sent to Google Analytics, and what must never be.

   The second half matters more than the first. The request form holds
   a name, a phone number, an email address and a free text message,
   and all four are in scope at the moment the conversion event fires.
   Google's own setup screen says you must ensure no personally
   identifiable information is sent, and "I was careful" is not a way
   to know that. This asserts it.

   node tools/analytics-test.js */
'use strict';

const { loadHelper } = require('./_wss');

/* Capture what the helper would send instead of sending it. The stub
   goes into the helper's own sandbox, because that is where its
   window lives. */
const sent = [];
const gtag = (type, name, params) => sent.push({ type, name, params });
const WSS = loadHelper({ gtag: gtag });
WSS.OFFERS = [{ description: '50% Off First 2 Months', conditions: null }];

const UNIT = { width: 5, length: 10, height: 9, rate: 69, climate: true, vacantCount: 4 };
const DRIVE = { width: 10, length: 30, height: 8, rate: 83, climate: false, vacantCount: 2 };

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log('FAIL  ' + name + '\n        want ' + JSON.stringify(want) + '\n        got  ' + JSON.stringify(got)); }
  else console.log('ok    ' + name);
};

/* ---- what a unit looks like to a report ---- */
check('a temperature controlled unit, priced with the offer',
  WSS.unitParams(UNIT),
  { unit_size: '5x10x9', unit_type: 'temperature controlled', value: 34.5, currency: 'USD' });

check('a drive-up unit',
  WSS.unitParams(DRIVE),
  { unit_size: '10x30x8', unit_type: 'drive-up', value: 41.5, currency: 'USD' });

check('no unit at all does not throw', WSS.unitParams(null), {});

/* ---- the event actually goes out ---- */
sent.length = 0;
WSS.track('rent_now_click', WSS.unitParams(UNIT));
check('track sends one event', sent.length, 1);
check('with the right name', sent[0] && sent[0].name, 'rent_now_click');

/* ---- and never breaks the page ---- */
sent.length = 0;
const QUIET = loadHelper();
QUIET.track('rent_now_click', { a: 1 });
check('silent when analytics is absent', sent.length, 0);

const BLOCKED = loadHelper({ gtag: () => { throw new Error('blocked by an ad blocker'); } });
let threw = false;
try { BLOCKED.track('rent_now_click', {}); } catch (e) { threw = true; }
check('an analytics failure never reaches the button', threw, false);

/* ---- THE IMPORTANT ONE ----
   Nothing a customer typed may leave the browser. */
sent.length = 0;
WSS.track('request_submitted', (function () {
  const p = WSS.unitParams(UNIT);
  p.request_type = 'rent';
  return p;
})());

const FORBIDDEN = [
  ['first', 'first name'], ['last', 'last name'], ['name', 'any name field'],
  ['phone', 'phone number'], ['email', 'email address'],
  ['message', 'the free text message'], ['date', 'the move-in date'],
  ['customer', 'the customer object'],
];
const keys = Object.keys((sent[0] && sent[0].params) || {});
console.log('\nfields sent with a conversion: ' + keys.join(', '));
FORBIDDEN.forEach(([k, label]) => {
  const leaked = keys.some((key) => key.toLowerCase().indexOf(k) >= 0);
  if (leaked) { failed++; console.log('FAIL  ' + label + ' is being sent to Google'); }
  else console.log('ok    no ' + label);
});

console.log('\n' + (failed ? failed + ' FAILED' : 'all passed'));
process.exit(failed ? 1 : 0);
