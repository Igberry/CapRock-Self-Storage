/* The site's own pricing helper, borrowed by the build tools.

   WHY IT IS LIFTED RATHER THAN COPIED
   The discount maths lives in global-sections/header.html, because
   that is the file that ships. Two build tools also need it: the
   static table and the structured data both have to quote the same
   figure the page quotes, or a crawler reads one price and a visitor
   sees another.

   Copying the maths into Node would put three versions of it in the
   repository, and the day someone fixes a rounding bug in one of them
   is the day the other two start lying. So this lifts the real
   object out of the header and runs it. There is exactly one copy of
   the pricing rules in this project, and it is the one the browser
   executes.

   The header is pasted into GHL as a blob and cannot import or export
   anything, which is why this has to read it as text. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEADER = path.join(__dirname, '..', 'global-sections', 'header.html');
const ENDPOINT = 'https://cap-rock-self-storage.vercel.app/api/wss';
const FACILITY = 'lubbock-2213-n-quaker';

/* The helper is one object literal in the header. Take it from its
   opening brace to the matching close, by counting braces, so this
   keeps working when methods are added above or below it.

   Strings, both kinds of comment and regex literals are skipped,
   because a brace inside any of them is not a brace. */
function liftHelper(src) {
  const start = src.indexOf('window.CRSS_WSS = {');
  if (start < 0) throw new Error('CRSS_WSS not found in header.html');
  const i = src.indexOf('{', start);
  let depth = 0;
  let inStr = null;
  let inComment = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    const next = src[j + 1];
    if (inComment === 'line') { if (c === '\n') inComment = null; continue; }
    if (inComment === 'block') { if (c === '*' && next === '/') { inComment = null; j++; } continue; }
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && next === '/') { inComment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { inComment = 'block'; j++; continue; }
    /* A regex literal, which in this object always follows = or ( */
    if (c === '/') {
      const before = src.slice(Math.max(0, j - 40), j).replace(/\s+$/, '');
      if (/[=(,:|&!?]$/.test(before)) {
        for (let k = j + 1; k < src.length; k++) {
          if (src[k] === '\\') { k++; continue; }
          if (src[k] === '[') { while (k < src.length && src[k] !== ']') { if (src[k] === '\\') k++; k++; } continue; }
          if (src[k] === '/') { j = k; break; }
          if (src[k] === '\n') break;
        }
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces reading CRSS_WSS');
}

/* The helper, evaluated, with no offers loaded yet. */
function loadHelper() {
  const src = fs.readFileSync(HEADER, 'utf8');
  const sandbox = {
    console,
    document: { addEventListener() {} },
    window: {},
    fetch: () => Promise.resolve(null),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return vm.runInContext('(' + liftHelper(src) + ')', sandbox);
}

async function get(resource) {
  const url = ENDPOINT + '?facility=' + encodeURIComponent(FACILITY) +
    '&resource=' + encodeURIComponent(resource);
  const r = await fetch(url);
  if (!r.ok) throw new Error(resource + ' returned ' + r.status);
  return r.json();
}

/* The helper with today's offers in it, plus the catalogue, sorted
   small to large. One call, because both tools want both and neither
   should be able to fetch one without the other: a table priced
   without the offers is the bug this whole module exists to prevent. */
async function loadPriced() {
  const wss = loadHelper();
  const [movein, location] = await Promise.all([get('movein'), get('location')]);
  wss.OFFERS = (location && location.coupons) || [];
  const units = ((movein && movein.unitTypes) || [])
    .filter((u) => u && u.width && u.length && Number(u.rate) > 0)
    .sort((a, b) => (Number(a.sqft) || 0) - (Number(b.sqft) || 0));
  return { wss, units, offers: wss.OFFERS };
}

/* What one unit costs, as numbers rather than the helper's formatted
   strings, for the places that need arithmetic rather than display.
   The rules are still the helper's: this only asks bestOffer what
   applies and then does the same sum pricing() does. */
function numbers(wss, u) {
  const list = Number(u.rate);
  const o = wss.bestOffer(list);
  let now = list;
  if (o && o.kind === 'percent') now = Math.round(list * (1 - o.value / 100) * 100) / 100;
  else if (o && o.kind === 'amount') now = Math.max(0, Math.round((list - o.value) * 100) / 100);
  return {
    list,
    now,
    discounted: now !== list,
    months: o ? o.months : 0,
    offer: o || null,
  };
}

module.exports = { loadHelper, loadPriced, numbers, get, ENDPOINT, FACILITY };
