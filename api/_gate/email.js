/* The office alert, as an email.

   Email is not the web. Every rule the rest of this project follows
   is reversed here: tables for layout, inline styles on every cell,
   no custom properties, no flexbox, web-safe fonts with the brand
   faces named first for the few clients that have them. Outlook on
   Windows renders with Word, which understands almost nothing else.

   The brand values are repeated as literals for the same reason: a
   var() in an email is an empty string in most inboxes.

   FOUR FIELDS, AND NO MORE (CapRock, 25 September). The office asked
   for the name, the unit, the price and the date, and nothing else:
   no phone number, no email address, no message, no footer. Everything
   the customer typed is on their contact in the CRM, which is where
   the office rings them from. Adding a row here means adding it in
   one place, below. */
'use strict';

const C = {
  ink: '#292724',
  taupe: '#7F6C5D',
  terracotta: '#A44A23',
  bone: '#FAF7F1',
  rule: '#E7DECD',
  white: '#FFFFFF',
};
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "'Work Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function row(label, value, last) {
  const pad = last ? '16px 0 0' : '16px 0';
  const border = last ? '' : `border-bottom:1px solid ${C.rule};`;
  return `
              <tr>
                <td style="padding:${pad};${border}width:170px;vertical-align:top;font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${C.taupe};">${esc(label)}</td>
                <td style="padding:${pad};${border}vertical-align:top;font-family:${SANS};font-size:17px;line-height:26px;color:${C.ink};">${esc(value)}</td>
              </tr>`;
}

/* A Rent Now or Reserve request from the website.
   Returns { subject, html, text }. */
function requestEmail(r) {
  const rent = r.kind === 'rent';
  const heading = rent ? 'RENT NOW REQUEST' : 'RESERVE REQUEST';
  const dateLabel = rent ? 'Move In Date' : 'Reserved Date';
  const name = `${r.first} ${r.last}`.trim();
  const unit = r.unitType ? `${r.unitSize}, ${r.unitType}` : r.unitSize;
  const price = r.rate ? `${r.rate} per month` : 'Not quoted';

  const subject = `${heading}: ${name}, ${r.unitSize}`;

  const text = `${heading}\n\n` +
    `Full Name: ${name}\n` +
    `Unit Requested: ${unit}\n` +
    `Price: ${price}\n` +
    `${dateLabel}: ${r.date}\n`;

  const rows = [
    row('Full Name', name),
    row('Unit Requested', unit),
    row('Price', price),
    row(dateLabel, r.date, true),
  ].join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.bone};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(name)}, ${esc(unit)}, ${esc(price)}, ${esc(r.date)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bone};">
    <tr>
      <td align="center" style="padding:28px 16px 40px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background-color:${C.white};border:1px solid ${C.rule};">

          <tr><td style="height:4px;background-color:${C.terracotta};font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td style="padding:32px 36px 4px;">
              <h1 style="margin:0;font-family:${SERIF};font-size:27px;line-height:34px;font-weight:500;letter-spacing:-0.3px;color:${C.ink};">${esc(heading)}</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:0 36px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { requestEmail };
