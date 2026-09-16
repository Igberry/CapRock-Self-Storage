/* The gate controller. Alarm.com Access Control, once CapRock has
   API access; until then this file does nothing and says so.

   The rest of the sync only ever calls these three functions, so
   when the credentials and the endpoint shapes arrive, this is the
   one file that changes. Each returns { ok, ref, reason }:

     ok      the controller confirmed the change
     ref     the controller's own id for the code, if it issues one
     reason  why not, when ok is false

   While unconfigured every call returns ok:false with reason
   'not_configured'. The sync records that, leaves alarm_synced_at
   empty so the office list shows the code as needing entry, and tells
   the office. Nothing is lost; it is just manual for now. */
'use strict';

function configured() {
  return Boolean(process.env.ALARM_API_KEY);
}

async function add(code, tenant) {   // eslint-disable-line no-unused-vars
  if (!configured()) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'not_implemented' };
}

async function suspend(code, tenant) {   // eslint-disable-line no-unused-vars
  if (!configured()) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'not_implemented' };
}

async function remove(code, tenant) {   // eslint-disable-line no-unused-vars
  if (!configured()) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'not_implemented' };
}

module.exports = { configured, add, suspend, remove };
