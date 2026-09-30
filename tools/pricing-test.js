/* What a price slot shows, checked against the offers the feed can
   actually send.

   This runs the real CRSS_WSS helper, lifted out of header.html, so
   it cannot drift from what the site does. The cases that matter are
   not the arithmetic, which is trivial, but the two refusals: an
   offer conditional on paying ahead must never move the headline
   rate, and an offer that expires must say what the rate goes back
   to. Both are things a customer could otherwise be quoted and not
   be able to get.

   node tools/pricing-test.js */
'use strict';

const { loadHelper } = require('./_wss');

/* The real helper, lifted out of header.html, so these cases run
   against the code that ships rather than a copy of it. */
const WSS = loadHelper();

/* ---- the cases ---- */
const UNIT = { rate: 69 };          /* the live 5 x 10 */
const CHEAP = { rate: 36 };         /* the live 5 x 5 */

const cases = [
  {
    name: 'the live offer: half off the first two months',
    coupons: [{ description: '50% Off First 2 Months', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: '$34.50', label: '50% off first 2 months', then: 'then $69 per month', note: '' },
  },
  {
    name: 'the same offer on a cheaper unit, rounded to the cent',
    coupons: [{ description: '50% Off First 2 Months', conditions: null }],
    unit: CHEAP,
    want: { list: '$36', now: '$18', label: '50% off first 2 months', then: 'then $36 per month', note: '' },
  },
  {
    name: 'a prepay offer NEVER moves the headline',
    coupons: [{ description: '10% Off 3 Mos Advance Rent', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: null, label: '', then: '', note: '10% Off 3 Mos Advance Rent' },
  },
  {
    name: 'prepay stated in the conditions, not the description',
    coupons: [{ description: '15% Off', conditions: 'Requires 6 months paid in advance' }],
    unit: UNIT,
    want: { list: '$69', now: null, label: '', then: '', note: '15% Off' },
  },
  {
    name: 'a free month is a period, not a $0 monthly rate',
    coupons: [{ description: '1 MONTH FREE', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: null, label: 'First month free', then: '', note: '' },
  },
  {
    name: 'two free months',
    coupons: [{ description: 'Free 2 Months', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: null, label: 'First 2 months free', then: '', note: '' },
  },
  {
    name: 'a flat dollar discount',
    coupons: [{ description: '$20 Off First 3 Months', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: '$49', label: '$20 off first 3 months', then: 'then $69 per month', note: '' },
  },
  {
    name: 'an open ended percentage says nothing about when it ends',
    coupons: [{ description: '10% Off', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: '$62.10', label: '10% off', then: '', note: '' },
  },
  {
    name: 'the better of two offers wins, over its whole run',
    coupons: [
      { description: '10% Off 6 Months', conditions: null },   /* worth $41.40 */
      { description: '50% Off First 2 Months', conditions: null }, /* worth $69 */
    ],
    unit: UNIT,
    want: { list: '$69', now: '$34.50', label: '50% off first 2 months', then: 'then $69 per month', note: '' },
  },
  {
    name: 'a prepay offer alongside a plain one: the plain one prices, the other is a note',
    coupons: [
      { description: '50% Off First 2 Months', conditions: null },
      { description: '10% Off 3 Mos Advance Rent', conditions: null },
    ],
    unit: UNIT,
    want: { list: '$69', now: '$34.50', label: '50% off first 2 months', then: 'then $69 per month', note: '10% Off 3 Mos Advance Rent' },
  },
  {
    name: 'an offer nobody can price is left alone',
    coupons: [{ description: 'Ask about our student deal', conditions: null }],
    unit: UNIT,
    want: { list: '$69', now: null, label: '', then: '', note: '' },
  },
  {
    name: 'no offers at all: the list price, untouched',
    coupons: [],
    unit: UNIT,
    want: { list: '$69', now: null, label: '', then: '', note: '' },
  },
  {
    name: 'offers not loaded yet: still the list price, never a blank',
    coupons: null,
    unit: UNIT,
    want: { list: '$69', now: null, label: '', then: '', note: '' },
  },
  {
    name: 'a unit with no rate prices nothing rather than guessing',
    coupons: [{ description: '50% Off First 2 Months', conditions: null }],
    unit: { rate: null },
    want: null,
  },
];

let failed = 0;
cases.forEach((c) => {
  WSS.OFFERS = c.coupons || [];
  const got = WSS.pricing(c.unit);
  const keys = c.want ? Object.keys(c.want) : [];
  const bad = c.want === null
    ? (got !== null ? ['pricing', null, got] : null)
    : (got === null ? ['pricing', c.want, null] : keys.map((k) => (got[k] === c.want[k] ? null : [k, c.want[k], got[k]])).filter(Boolean));
  if (bad && bad.length) {
    failed++;
    console.log('FAIL  ' + c.name);
    [].concat(bad).forEach((b) => {
      if (Array.isArray(b)) console.log('        ' + b[0] + ': want ' + JSON.stringify(b[1]) + ', got ' + JSON.stringify(b[2]));
    });
  } else {
    console.log('ok    ' + c.name);
  }
});

/* The rendered slot, once, so a broken tag is caught here and not
   on the live site. */
WSS.OFFERS = [{ description: '50% Off First 2 Months', conditions: null }];
const html = WSS.priceHtml(UNIT, { cls: 'crss-unit-rate', tag: 'div' });
/* Self-closing tags do not want a partner; the padlock is an SVG. */
const open = (html.match(/<\w+(?:\s[^>]*)?>/g) || []).filter((t) => !/\/>$/.test(t)).length;
const close = (html.match(/<\/\w+>/g) || []).length;
if (open !== close) { failed++; console.log('FAIL  priceHtml tags unbalanced (' + open + ' open, ' + close + ' close)'); }
else console.log('ok    priceHtml renders balanced markup');
console.log('\n' + html.replace(/></g, '>\n<'));

console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + (cases.length + 1) + ' passed'));
process.exit(failed ? 1 : 0);
