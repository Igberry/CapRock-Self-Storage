/* Does WSS_HIDE_COUPONS drop the right promotion, and only it?

   WHY THIS EXISTS
   On 28 October the office needed 50% off First 4 Months off the
   website and the Enabled checkbox in WebSelfStorage would not save.
   This filter is the stopgap. A stopgap that quietly hides the wrong
   offer, or hides nothing, is worse than no stopgap, because the
   website would be advertising a price the counter will not honour
   and nobody would know until a customer argued about it.

   So: unset hides nothing, a name that matches hides exactly that
   one, and a name nobody has hides nothing rather than everything.

   node tools/coupon-filter-test.js */
'use strict';

const path = require('path');
const F = path.resolve(__dirname, '..', 'api', 'wss.js');

const UPSTREAM = {
  address: { city: 'Lubbock' },
  phone: '8065551212',
  coupons: [
    { description: '50% Off First 2 Months', instructions: 'New rentals only.' },
    { description: '50% off First 4 Months', instructions: 'New rentals only.' },
  ],
};

async function run(hide) {
  delete require.cache[F];
  process.env.WSS_API_KEY = 'k';
  if (hide === null) delete process.env.WSS_HIDE_COUPONS;
  else process.env.WSS_HIDE_COUPONS = hide;
  /* The proxy's only outside dependency, stubbed so this test never
     spends a call on CapRock's U-Haul key. */
  global.fetch = async () => ({ ok: true, status: 200, json: async () => UPSTREAM });
  const handler = require(F);
  const res = {
    setHeader() {},
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
  await handler(
    { method: 'GET', headers: {}, query: { facility: 'lubbock-2213-n-quaker', resource: 'location' } },
    res,
  );
  return (res.body.coupons || []).map((c) => c.description);
}

(async () => {
  let failed = 0;
  const check = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log((ok ? 'ok    ' : 'FAIL  ') + label
      + '\n        got  ' + JSON.stringify(got)
      + '\n        want ' + JSON.stringify(want));
  };

  const BOTH = ['50% Off First 2 Months', '50% off First 4 Months'];

  check('unset, so nothing is hidden', await run(null), BOTH);
  check('empty, so nothing is hidden', await run(''), BOTH);
  check('hides the 4 month offer and keeps the 2 month one', await run('First 4 Months'),
        ['50% Off First 2 Months']);
  check('matching ignores case', await run('first 4 months'),
        ['50% Off First 2 Months']);
  check('a name nobody has hides nothing', await run('Half Price Tuesdays'), BOTH);

  console.log('\n' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
