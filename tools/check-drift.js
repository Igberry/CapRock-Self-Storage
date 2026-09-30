/* Is the published site still quoting the right prices?

   The same check the scheduled job runs, run by hand, reading from
   the live site and the live feed. Use it after repasting, to confirm
   the paste actually landed, and any time a rate or a promotion is
   said to have changed.

     node tools/check-drift.js

   Exits non-zero when the site and the facility system disagree. */
'use strict';

const { check } = require('../api/_gate/drift');

check().then((r) => {
  console.log('sizes   facility system: ' + r.sizes.feed +
    '   page: ' + r.sizes.page + '   structured data: ' + r.sizes.schema);
  console.log('offer   ' + (r.offer || 'none'));
  console.log();

  if (r.ok) {
    console.log('The site and the facility system agree.');
    return;
  }

  console.log('THEY DISAGREE:');
  r.problems.forEach((p) => console.log('  - ' + p));
  console.log('\nTo fix:');
  r.fix.forEach((f) => console.log('  ' + f));
  process.exitCode = 1;
}).catch((e) => {
  console.error('The check could not run: ' + e.message);
  process.exitCode = 1;
});
