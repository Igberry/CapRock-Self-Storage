/* ================================================================
   CapRock Self Storage — Rent Now / Reserve requests
   POST /api/request        { kind, unit, customer, consent, website }

   WHY THIS EXISTS
   Rent Now and Reserve used to send people to uhaul.com, where the ID
   verification step is currently failing and losing tenants. Both
   buttons now open a form on our own site, and this is where the form
   goes. It does three things and nothing else:

     1. creates or updates the customer as a GHL contact, tagged
        rent-request or reserve-request, with the unit and date on
        the record and a note with everything they typed
     2. tells the office, by text and/or email, so someone rings back
     3. thanks the customer by text, if they ticked the box

   WebSelfStorage is not written to. Its reservation and move-in
   endpoints demand the card number itself, and this site does not
   handle card numbers. The office completes the rental in
   WebSelfStorage from the alert, and takes payment there or at the
   counter. That is "Option A" (21 Sept 2026); the self-service
   version through a card vault is the next phase.

   SETTINGS (Vercel)
     REQUESTS_ENABLED   "on", or the form tells the customer to call
     GHL_API_KEY, GHL_LOCATION_ID
     OFFICE_PHONE and/or OFFICE_EMAIL   where the alert goes
   ================================================================ */
'use strict';

const ghl = require('./_gate/ghl');

const ALLOWED_ORIGINS = [
  'https://sites.leadconnectorhq.com',
  'https://caprock-storage.com',
  'https://www.caprock-storage.com',
  ...(process.env.CRSS_SITE_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
];

const FIELDS = [
  ['Requested Unit', 'TEXT'],
  ['Requested Move-In', 'TEXT'],
  ['Request Type', 'TEXT'],
];

/* A few per address per ten minutes. Memory only, per instance, so it
   is a speed bump rather than a wall; the honeypot below does more. */
const seen = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (seen.get(ip) || []).filter((t) => now - t < 600000);
  list.push(now);
  seen.set(ip, list);
  return list.length > 5;
}

function cors(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);

function validate(body) {
  const b = body || {};
  const c = b.customer || {};
  const u = b.unit || {};
  const out = {
    kind: b.kind === 'rent' ? 'rent' : b.kind === 'reserve' ? 'reserve' : null,
    first: clean(c.first, 60),
    last: clean(c.last, 60),
    phone: String(c.phone || '').replace(/\D/g, '').slice(-10),
    email: clean(c.email, 120).toLowerCase(),
    date: clean(c.date, 10),
    message: clean(c.message, 600),
    consent: Boolean(b.consent),
    unit: {
      size: clean(u.size, 20),
      rate: clean(u.rate, 12),
      kind: clean(u.kind, 30),
    },
  };
  const problems = [];
  if (!out.kind) problems.push('kind');
  if (!out.first) problems.push('first');
  if (!out.last) problems.push('last');
  if (out.phone.length !== 10) problems.push('phone');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) problems.push('email');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) problems.push('date');
  if (!out.unit.size) problems.push('unit');
  return { out, problems };
}

function usDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (process.env.REQUESTS_ENABLED !== 'on' || !ghl.configured()) return res.status(503).json({ error: 'not_available' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: 'slow_down' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  /* The honeypot: a field no person sees. Filled means a bot; say
     thank you and do nothing, so it cannot tell. */
  if (body && body.website) return res.status(200).json({ ok: true });

  const { out, problems } = validate(body);
  if (problems.length) return res.status(400).json({ error: 'invalid', fields: problems });

  const verb = out.kind === 'rent' ? 'Rent Now' : 'Reserve';
  const unitLine = `${out.unit.size}${out.unit.kind ? ', ' + out.unit.kind : ''}${out.unit.rate ? ', ' + out.unit.rate + ' per month' : ''}`;

  try {
    const fields = await ghl.ensureContactFields(FIELDS);
    const data = await ghl.call('POST', '/contacts/upsert', {
      locationId: process.env.GHL_LOCATION_ID,
      phone: '+1' + out.phone,
      email: out.email,
      firstName: out.first,
      lastName: out.last,
      source: 'website',
      tags: [out.kind === 'rent' ? 'rent-request' : 'reserve-request'],
      customFields: [
        { id: fields['Requested Unit'], field_value: unitLine },
        { id: fields['Requested Move-In'], field_value: usDate(out.date) },
        { id: fields['Request Type'], field_value: verb },
      ],
    });
    const contactId = data && data.contact && data.contact.id;
    if (!contactId) throw new Error('upsert returned no contact id');

    await ghl.call('POST', `/contacts/${contactId}/notes`, {
      body: `${verb} request from the website\nUnit: ${unitLine}\nMove-in: ${usDate(out.date)}\n` +
            (out.message ? `Message: ${out.message}\n` : '') +
            `Consent to text: ${out.consent ? 'yes' : 'no'}`,
    });

    const office = await ghl.office(
      `${verb.toUpperCase()} request: ${out.first} ${out.last}, ${unitLine}, move-in ${usDate(out.date)}. ` +
      `Call ${out.phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}.` +
      (out.message ? ` Note: ${out.message}` : ''),
      { force: true }
    );

    let thanked = false;
    if (out.consent) {
      const r = await ghl.sendSms(contactId,
        `CapRock Self Storage: thanks ${out.first}, we have your ${out.kind === 'rent' ? 'rental' : 'reservation'} request for a ${out.unit.size} unit ` +
        `from ${usDate(out.date)}. The office will call you to confirm. Questions? (806) 589-1472.`);
      thanked = r.sent;
    }

    /* The customer gets their thank-you either way; a failed office
       alert is our problem, not theirs. But the reason comes back in
       the response so it can be read from the browser's network tab
       instead of from the server log. */
    if (!office.sent) console.error('office alert failed:', office.reason);
    return res.status(200).json({ ok: true, office_notified: office.sent, office_sms: office.sms, office_email: office.email, office_reason: office.reason || null, thanked });
  } catch (err) {
    console.error('request failed:', err);
    return res.status(500).json({ error: 'failed' });
  }
};
