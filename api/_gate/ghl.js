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
async function office(message) {
  if (!configured()) return { sent: false, reason: 'ghl_not_configured' };
  if (!on()) return { sent: false, reason: 'texting_off' };
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
    if (phone) await sms(contactId, message);
    if (email) {
      await call('POST', '/conversations/messages', {
        type: 'Email', contactId, subject: message.slice(0, 78), html: '<p>' + message + '</p>',
      });
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { configured, on, text, office, call };
