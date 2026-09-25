/* The office alert, as an email.

   Email is not the web. Every rule the rest of this project follows
   is reversed here: tables for layout, inline styles on every cell,
   no custom properties, no flexbox, web-safe fonts with the brand
   faces named first for the few clients that have them. Outlook on
   Windows renders with Word, which understands almost nothing else.

   The brand values are repeated as literals for the same reason: a
   var() in an email is an empty string in most inboxes. */
'use strict';

const C = {
  ink: '#292724',
  inkSoft: '#5F564C',
  taupe: '#7F6C5D',
  terracotta: '#A44A23',
  cream: '#F1E3CC',
  bone: '#FAF7F1',
  sand: '#EFE7DA',
  rule: '#E7DECD',
  white: '#FFFFFF',
};
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "'Work Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const prettyPhone = (p) => String(p || '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');

/* One label-and-value row of the details table. */
function row(label, value, opts) {
  const last = opts && opts.last;
  return `
              <tr>
                <td style="padding:14px 0 ${last ? '0' : '14px'};${last ? '' : `border-bottom:1px solid ${C.rule};`}width:150px;vertical-align:top;font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${C.taupe};">${esc(label)}</td>
                <td style="padding:14px 0 ${last ? '0' : '14px'};${last ? '' : `border-bottom:1px solid ${C.rule};`}vertical-align:top;font-family:${SANS};font-size:16px;line-height:24px;color:${C.ink};">${value}</td>
              </tr>`;
}

/* A Rent Now or Reserve request from the website.
   Returns { subject, html, text }. */
function requestEmail(r) {
  const rent = r.kind === 'rent';
  const verb = rent ? 'Rent Now' : 'Reserve';
  const phone = prettyPhone(r.phone);
  const name = `${r.first} ${r.last}`.trim();

  const subject = `${verb} request: ${name}, ${r.unitSize}, move-in ${r.date}`;

  const text = `${verb.toUpperCase()} REQUEST from the website\n\n` +
    `Name: ${name}\nPhone: ${phone}\nEmail: ${r.email}\n` +
    `Unit: ${r.unitLine}\nMove-in: ${r.date}\n` +
    (r.message ? `Message: ${r.message}\n` : '') +
    `Texts OK: ${r.consent ? 'yes' : 'no'}\n\n` +
    (rent ? 'Call to confirm the unit and take payment, then complete the move-in in WebSelfStorage.'
          : 'Call to confirm the reservation, then hold the unit in WebSelfStorage.');

  const rows = [
    row('Name', esc(name)),
    row('Phone', `<a href="tel:+1${esc(r.phone)}" style="color:${C.terracotta};text-decoration:none;font-weight:600;">${esc(phone)}</a>`),
    row('Email', `<a href="mailto:${esc(r.email)}" style="color:${C.terracotta};text-decoration:none;">${esc(r.email)}</a>`),
    row('Move-in', esc(r.date)),
    r.message ? row('Their message', esc(r.message)) : '',
    row('Texts OK', r.consent ? 'Yes' : 'No, call only', { last: true }),
  ].join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.bone};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(name)} wants the ${esc(r.unitSize)}${r.rate ? ` at ${esc(r.rate)} a month` : ''}. Call ${esc(phone)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bone};">
    <tr>
      <td align="center" style="padding:28px 16px 40px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:${C.white};border:1px solid ${C.rule};">

          <tr><td style="height:4px;background-color:${C.terracotta};font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td style="padding:32px 36px 0;">
              <p style="margin:0 0 8px;font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${C.terracotta};">Website request</p>
              <h1 style="margin:0;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:500;color:${C.ink};">${rent ? 'Someone wants to rent a unit' : 'Someone wants to reserve a unit'}</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 36px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.sand};">
                <tr>
                  <td style="padding:18px 22px;">
                    <p style="margin:0;font-family:${SERIF};font-size:24px;line-height:30px;font-weight:500;color:${C.ink};">${esc(r.unitSize)}</p>
                    <p style="margin:6px 0 0;font-family:${SANS};font-size:14px;line-height:20px;color:${C.inkSoft};">${esc(r.unitType)}${r.rate ? ` &middot; ${esc(r.rate)} per month` : ''}${r.priceLock ? ` &middot; ${esc(r.priceLock)}` : ''}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 36px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 36px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:${C.ink};">
                    <a href="tel:+1${esc(r.phone)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1.3px;text-transform:uppercase;color:${C.cream};text-decoration:none;">Call ${esc(phone)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 36px 34px;">
              <p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.inkSoft};">
                ${rent
                  ? 'Call to confirm the unit and take payment, then complete the move-in in WebSelfStorage.'
                  : 'Call to confirm the reservation, then hold the unit in WebSelfStorage.'}
                They are already in the CRM, tagged <b style="color:${C.ink};">${rent ? 'rent-request' : 'reserve-request'}</b>.
              </p>
            </td>
          </tr>

        </table>

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
          <tr>
            <td style="padding:18px 6px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.taupe};">
              Sent automatically by caprock-storage.com when the form was submitted.<br>
              CapRock Self Storage, 2213 North Quaker Ave, Lubbock, TX 79416
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
