/* Texting through GHL.

   The tenant is upserted as a contact first, because GHL sends
   messages to contacts, not to numbers. That is also useful in itself:
   every tenant ends up in the CRM with a phone, a name and a
   "gate-code" tag, which the office can use for anything else later.

   Needs, in Vercel:
     GHL_API_KEY      a Private Integration token for the CapRock
                      location, with contacts.write and
                      conversations/message.write
     GHL_LOCATION_ID  the location id the token belongs to

   With GATE_TEXTING set to anything other than "on", nothing is sent
   and every call is logged as skipped. That is how the first run,
   which issues a code to every existing tenant, is rehearsed. */
'use strict';

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

function configured() {
  return Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
}

function on() {
  return process.env.GATE_TEXTING === 'on';
}

/* GATE_TEXT_ONLY, when set, is a comma-separated list of ten-digit
   numbers and only those are ever texted; everyone else is logged as
   skipped. It exists for one purpose: the first real message goes to
   one phone, gets read, and only then does the list come off. */
function allowed(phone) {
  const only = String(process.env.GATE_TEXT_ONLY || '').replace(/[^\d,]/g, '');
  if (!only) return true;
  return only.split(',').filter(Boolean).some((n) => n.slice(-10) === phone);
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`ghl ${method} ${path} -> ${res.status} ${data ? JSON.stringify(data).slice(0, 200) : ''}`);
  }
  return data;
}

/* "SURNAME, First" is how the rentroll writes names. */
function splitName(customerName) {
  const s = String(customerName || '').trim();
  const comma = s.indexOf(',');
  if (comma > -1) {
    return { lastName: s.slice(0, comma).trim(), firstName: s.slice(comma + 1).trim() };
  }
  const parts = s.split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

async function upsertContact({ customerName, phone, tags }) {
  const name = splitName(customerName);
  const data = await call('POST', '/contacts/upsert', {
    locationId: process.env.GHL_LOCATION_ID,
    phone: '+1' + phone,
    firstName: name.firstName,
    lastName: name.lastName,
    tags: tags || ['gate-code'],
    source: 'gate-code-sync',
  });
  const id = data && data.contact && data.contact.id;
  if (!id) throw new Error('ghl upsert returned no contact id');
  return id;
}

async function sms(contactId, message) {
  return call('POST', '/conversations/messages', {
    type: 'SMS',
    contactId,
    message,
  });
}

/* Returns { sent, reason }. Never throws: a text failing is an event
   to record, not a reason to abandon the rest of the run. */
async function text({ customerName, phone, message, tags }) {
  if (!configured()) return { sent: false, reason: 'ghl_not_configured' };
  if (!on()) return { sent: false, reason: 'texting_off' };
  if (!allowed(phone)) return { sent: false, reason: 'not_in_text_only_list' };
  try {
    const contactId = await upsertContact({ customerName, phone, tags });
    await sms(contactId, message);
    return { sent: true, contactId };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

/* Where "please key this in" goes while the controller is manual.
   OFFICE_PHONE sends a text; OFFICE_EMAIL sends an email; both set
   sends both. Email is the safer default when the office line is the
   same number GHL sends from, which cannot text itself. */
async function office(message, opts) {
  if (!configured()) return { sent: false, reason: 'ghl_not_configured' };
  /* force: a customer request the office must hear about regardless
     of the gate-code texting switch, which governs tenant texts. */
  if (!on() && !(opts && opts.force)) return { sent: false, reason: 'texting_off' };
  const phone = String(process.env.OFFICE_PHONE || '').replace(/\D/g, '').slice(-10);
  const email = String(process.env.OFFICE_EMAIL || '').trim();
  if (!phone && !email) return { sent: false, reason: 'no_office_contact' };
  try {
    const data = await call('POST', '/contacts/upsert', {
      locationId: process.env.GHL_LOCATION_ID,
      ...(phone ? { phone: '+1' + phone } : {}),
      ...(email ? { email } : {}),
      firstName: 'CapRock',
      lastName: 'Office',
      tags: ['gate-office'],
      source: 'gate-code-sync',
    });
    const contactId = data && data.contact && data.contact.id;
    if (!contactId) throw new Error('ghl upsert returned no contact id');

    /* Upsert matches an existing contact by phone and will not always
       write the email onto it, and GHL refuses to send an email to a
       contact that has none ("CONVERSATIONS_MSG_NO_EMAIL"). So set it
       explicitly before sending. */
    if (email) {
      try { await call('PUT', `/contacts/${contactId}`, { email }); }
      catch (e) { /* the send below reports it if this was the problem */ }
    }

    const problems = [];
    if (phone) {
      try { await sms(contactId, message); }
      catch (e) { problems.push('sms: ' + e.message); }
    }
    if (email) {
      try {
        await call('POST', '/conversations/messages', {
          type: 'Email', contactId, subject: message.slice(0, 78), html: '<p>' + message + '</p>',
        });
      } catch (e) { problems.push('email: ' + e.message); }
    }
    /* One channel arriving is enough to have told the office. */
    const wanted = (phone ? 1 : 0) + (email ? 1 : 0);
    if (problems.length >= wanted) return { sent: false, reason: problems.join(' | ') };
    return { sent: true, reason: problems.length ? problems.join(' | ') : undefined };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

/* One text to a contact that already exists, outside the gate-code
   switches: the customer asked for it on a form they just filled in. */
async function sendSms(contactId, message) {
  if (!configured()) return { sent: false, reason: 'ghl_not_configured' };
  try { await sms(contactId, message); return { sent: true }; }
  catch (e) { return { sent: false, reason: e.message }; }
}

/* Contact custom fields by name, created if missing. Returns
   { name: id }. Shared by anything that writes to a contact. */
async function ensureContactFields(list) {
  const data = await call('GET', `/locations/${process.env.GHL_LOCATION_ID}/customFields?model=contact`);
  const have = new Map((data.customFields || []).map((f) => [String(f.name).toLowerCase(), f.id]));
  const ids = {};
  for (const [name, dataType] of list) {
    let id = have.get(name.toLowerCase());
    if (!id) {
      const made = await call('POST', `/locations/${process.env.GHL_LOCATION_ID}/customFields`, { name, dataType, model: 'contact' });
      id = made && made.customField && made.customField.id;
      if (!id) throw new Error(`could not create custom field ${name}`);
    }
    ids[name] = id;
  }
  return ids;
}

module.exports = { configured, on, text, office, call, sendSms, ensureContactFields };
