/* Gate code generation.

   Four digits, because that is what the keypad takes. Not every
   four-digit string is a good code: a repeated digit or a run reads
   as a default and gets guessed first, and a code that starts with 0
   is typed wrong on some keypads. Uniqueness among live codes is
   enforced by the database (codes_live_code), so a collision here is
   caught on insert and the caller draws again. */
'use strict';
const crypto = require('crypto');

const REJECT = new Set([
  '1234', '2345', '3456', '4567', '5678', '6789',
  '9876', '8765', '7654', '6543', '5432', '4321', '3210',
  '1122', '1212', '2020', '2468', '1357', '1010', '2000', '1999', '2024', '2025', '2026',
]);

function weak(code) {
  if (REJECT.has(code)) return true;
  if (/^(\d)\1{3}$/.test(code)) return true;        // 1111
  if (/^(\d\d)\1$/.test(code)) return true;          // 1212
  if (code[0] === '0') return true;
  return false;
}

function generate() {
  for (;;) {
    const n = crypto.randomInt(1000, 10000);
    const code = String(n);
    if (!weak(code)) return code;
  }
}

module.exports = { generate, weak };
