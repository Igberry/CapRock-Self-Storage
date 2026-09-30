#!/usr/bin/env node
/* Sanity checks over every block that gets pasted into GHL.
     node tools/check.js
   Exits non-zero on the first class of failure. Each check exists
   because the thing it guards has bitten this site at least once. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(path.join(root, 'global-sections')).map((f) => 'global-sections/' + f),
  ...fs.readdirSync(path.join(root, 'pages')).map((f) => 'pages/' + f),
].filter((f) => f.endsWith('.html'));

const problems = [];
const note = (f, msg) => problems.push(`${f}: ${msg}`);

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const styles = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const blocks = [...src.matchAll(/<script(?![^>]*src=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .map((m) => ({ type: /type\s*=\s*"([^"]*)"/.exec(m[1]), code: m[2] }))
    .map((b) => ({ type: b.type ? b.type[1].toLowerCase() : 'text/javascript', code: b.code }));
  const scripts = blocks.filter((b) => !/json/.test(b.type)).map((b) => b.code);
  const jsonLd = blocks.filter((b) => /json/.test(b.type)).map((b) => b.code);

  /* 1. Every <script> parses. A comment that swallows a function
        still parses, so the delimiter count below is separate. */
  scripts.forEach((code, i) => {
    try { new vm.Script(code); } catch (e) { note(f, `script block ${i + 1} does not parse: ${e.message}`); }
    const open = (code.match(/\/\*/g) || []).length;
    const close = (code.match(/\*\//g) || []).length;
    if (open !== close) note(f, `unbalanced block comments in <script> (${open} open / ${close} close)`);
  });

  /* 1b. Structured data is JSON, not JavaScript, so it is parsed as
         JSON and must carry an @type. A malformed block is worse than
         no block: a search engine discards the whole thing rather
         than the broken part of it, so this is worth failing on. */
  jsonLd.forEach((code, i) => {
    let doc;
    try { doc = JSON.parse(code); }
    catch (e) { return note(f, `JSON-LD block ${i + 1} is not valid JSON: ${e.message}`); }
    if (!doc || !doc['@type']) note(f, `JSON-LD block ${i + 1} has no @type`);
    if (!doc || !doc['@context']) note(f, `JSON-LD block ${i + 1} has no @context`);

    /* Every Product must carry its own price. Google rejects a
       Product with no offers, review or aggregateRating, and it
       rejects it silently as far as this repository is concerned:
       nothing here noticed that thirteen units had been published
       with the Product nested inside the Offer instead of the other
       way round, and all thirteen were invalid on the live site
       until the Rich Results Test said so. Caught here now. */
    const products = [];
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node['@type'] === 'Product') products.push(node);
      Object.values(node).forEach(walk);
    })(doc);
    products.forEach((p) => {
      if (!p.offers && !p.review && !p.aggregateRating) {
        note(f, `JSON-LD Product "${p.name || '(unnamed)'}" has no offers, review or aggregateRating, so Google will reject it`);
      }
    });
  });

  /* 2. Braces balance in CSS. */
  styles.forEach((css, i) => {
    const c = stripComments(css);
    const open = (c.match(/\{/g) || []).length;
    const close = (c.match(/\}/g) || []).length;
    if (open !== close) note(f, `style block ${i + 1} braces: ${open} open / ${close} close`);

    /* 3. max-width media queries descend, so later blocks win on the
          narrowest screens. */
    const widths = [...c.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    for (let k = 1; k < widths.length; k++) {
      if (widths[k] > widths[k - 1]) note(f, `media queries not descending: ${widths[k - 1]}px then ${widths[k]}px`);
    }

    /* 4. Element resets go through :where() so a class can override them. */
    for (const m of c.matchAll(/^\s*\.crss-[\w-]+ (?:h1|h2|h3|p|a|ul)(?:, ?(?:h1|h2|h3|p|a|ul))*\s*\{\s*margin:\s*0;\s*padding:\s*0;\s*\}/gm)) {
      note(f, `bare element reset without :where(): "${m[0].trim().split('{')[0].trim()}"`);
    }
  });

  /* 5. Style before markup, or the first paint is bare HTML. */
  const firstStyle = src.search(/^<style>/m);
  const firstMarkup = src.search(/^<(div|header|footer|nav|section|main)[\s>]/m);
  if (firstStyle > -1 && firstMarkup > -1 && firstStyle > firstMarkup) note(f, 'markup appears before <style>');

  /* 6. Every class used in markup has a rule somewhere (this file or
        the header, which is on every page). Scripts and comments are
        stripped first so JS-built markup is not scanned. */
  const headerCss = fs.readFileSync(path.join(root, 'global-sections/header.html'), 'utf8');
  const cssAll = stripComments(styles.join('\n') + '\n' + [...headerCss.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
  const markup = stripComments(src).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const used = new Set();
  for (const m of markup.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
  for (const c of used) {
    if (!c.startsWith('crss-')) continue;
    if (!new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(cssAll)) note(f, `class "${c}" has no rule`);
  }

  /* 7. House style: no em or en dashes in anything a visitor reads. */
  const visible = stripComments(src).replace(/<script[\s\S]*?<\/script>/g, '');
  const dash = visible.match(/[–—]/);
  if (dash) note(f, 'em or en dash in visible copy');

  /* 8. A literal "$1" in copy is a perl interpolation that leaked. */
  if (/[$]1([^0-9,.]|$)/m.test(visible)) note(f, 'literal "$1" in copy');
}

/* 9. The two legal pages share one stylesheet, byte for byte. */
const legal = ['pages/terms-of-use.html', 'pages/privacy-policy.html'].map((f) => {
  const m = /^<style>$([\s\S]*?)^<\/style>$/m.exec(fs.readFileSync(path.join(root, f), 'utf8'));
  return m ? m[1] : '';
});
if (legal[0] !== legal[1]) problems.push('terms-of-use and privacy-policy stylesheets differ');

if (problems.length) {
  console.log('FAIL');
  problems.forEach((p) => console.log('  ' + p));
  process.exit(1);
}
console.log(`PASS - ${files.length} blocks: scripts parse, comments balanced, braces balanced,`);
console.log('       breakpoints descending, style before markup, classes styled, no dashes');
