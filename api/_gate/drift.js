/* Has the published site fallen behind the facility system?

   WHY THIS EXISTS
   The unit rows a visitor sees are fetched live, so they are never
   wrong. The copies the answer engines read are not: the static table
   and the structured data are snapshots, written into the pages by
   tools/build-static-units.js and tools/build-schema.js, and then
   pasted into GHL by hand. Nothing about that is automatic, and it
   cannot be, because publishing means someone pasting into GHL.

   So the snapshots go stale silently. A rate changes, or a size is
   added or withdrawn, and the page keeps quoting the old answer to
   ChatGPT and Perplexity for as long as nobody notices. U-Haul
   already swapped the promotion from "1 MONTH FREE" to "50% Off First
   2 Months" without telling anyone; a rate can move the same way.

   This compares what caprock-storage.com actually serves against what
   the facility system actually says, which catches both ways of
   getting it wrong: forgetting to run the tools, and running them and
   forgetting to repaste.

   WHAT IT DOES NOT DO
   It does not recompute the discount. It compares the list prices,
   which the table carries struck through, and the offer text in the
   caption. If those agree then the discounted figures were derived
   from the same inputs by the same code and must agree too. That is
   deliberate: a second copy of the pricing maths living here is
   exactly the drift this file is supposed to catch. */
'use strict';

const SITE = 'https://caprock-storage.com/lubbock-2213-n-quaker';
const FEED = 'https://cap-rock-self-storage.vercel.app/api/wss' +
  '?facility=lubbock-2213-n-quaker&resource=';

const sizeOf = (u) => [u.width, u.length, u.height].map(Number).join('x');

async function json(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(url.replace(/\?.*/, '') + ' returned ' + r.status);
  return r.json();
}

async function check() {
  const [movein, location, page] = await Promise.all([
    json(FEED + 'movein'),
    json(FEED + 'location'),
    fetch(SITE, { headers: { 'cache-control': 'no-cache' } }).then((r) => {
      if (!r.ok) throw new Error('the site returned ' + r.status);
      return r.text();
    }),
  ]);

  const units = ((movein && movein.unitTypes) || [])
    .filter((u) => u && u.width && u.length && Number(u.rate) > 0);
  if (!units.length) throw new Error('the feed returned no priced unit types');

  /* ---- what the feed says ---- */
  const feed = {};
  units.forEach((u) => { feed[sizeOf(u)] = Number(u.rate); });
  const offer = ((location && location.coupons) || [])
    .map((c) => String(c.description || '').trim()).filter(Boolean).join('; ');

  /* ---- what the page serves ---- */
  const table = {};
  const rowRe = /<th scope="row">([\d× ]+) ft<\/th>[\s\S]{0,240}?<td>(?:<s>\$([\d.]+)<\/s>\s*)?\$([\d.]+) per month/g;
  let m;
  while ((m = rowRe.exec(page))) {
    const size = m[1].replace(/\s/g, '').split('×').join('x');
    /* Struck price when an offer applies, otherwise the only price. */
    table[size] = Number(m[2] !== undefined ? m[2] : m[3]);
  }

  const problems = [];
  if (!Object.keys(table).length) {
    problems.push('The page is serving no unit table at all. Either the snapshot ' +
      'was never pasted, or something has removed it.');
  }

  /* ---- compare ---- */
  const added = Object.keys(feed).filter((s) => !(s in table));
  const gone = Object.keys(table).filter((s) => !(s in feed));
  const moved = Object.keys(feed)
    .filter((s) => s in table && feed[s] !== table[s])
    .map((s) => ({ size: s, was: table[s], now: feed[s] }));

  added.forEach((s) => problems.push(
    'New size ' + s.split('x').join(' x ') + ' at $' + feed[s] + ' is in the ' +
    'facility system but not on the page.'));
  gone.forEach((s) => problems.push(
    'Size ' + s.split('x').join(' x ') + ' is on the page but no longer in the ' +
    'facility system.'));
  moved.forEach((c) => problems.push(
    'Rate for ' + c.size.split('x').join(' x ') + ' changed from $' + c.was +
    ' to $' + c.now + '.'));

  /* The caption names the current offer. If the feed's offer is not
     in it, the page is advertising a promotion that has moved on. */
  if (offer) {
    const caption = (/<caption>([\s\S]*?)<\/caption>/.exec(page) || ['', ''])[1];
    const words = offer.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const seen = caption.toLowerCase();
    if (words.length && !words.every((w) => seen.indexOf(w) >= 0)) {
      problems.push('The current offer is "' + offer + '" but the page does not say so.');
    }
  }

  /* The structured data must agree with the table it sits beside. */
  const blocks = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  let listed = 0;
  for (const b of blocks) {
    try {
      const doc = JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
      if (doc['@type'] === 'ItemList') listed = (doc.itemListElement || []).length;
    } catch (e) { problems.push('A structured data block on the page is not valid JSON.'); }
  }
  if (listed && listed !== Object.keys(feed).length) {
    problems.push('The structured data lists ' + listed + ' units but the facility ' +
      'system has ' + Object.keys(feed).length + '.');
  }

  return {
    ok: problems.length === 0,
    checked: new Date().toISOString(),
    sizes: { feed: Object.keys(feed).length, page: Object.keys(table).length, schema: listed },
    offer: offer || null,
    problems,
    /* What to do about it, in the order it has to happen. */
    fix: problems.length ? [
      'node tools/build-static-units.js',
      'node tools/build-schema.js',
      'bash tools/build-preview.sh && node tools/check.js',
      'repaste lubbock-2213-n-quaker.html and size-guide.html into GHL',
    ] : [],
  };
}

module.exports = { check };
