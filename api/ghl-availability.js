/* ================================================================
   CapRock Self Storage — availability into GHL
   GET /api/ghl-availability   (Authorization: Bearer <CRON_SECRET>)

   WHY THIS EXISTS
   The voice agent and the office answer "what do you have free?" from
   GHL, and GHL knows nothing about WebSelfStorage. This writes what
   the website shows, the same feed the website reads, into GHL
   Custom Values every fifteen minutes, so the phone and the site can
   never disagree about what is available.

   WHAT IS WRITTEN
   Location-level Custom Values (Settings > Custom Values), one per
   size plus a few summaries. Custom Values, not contact fields: this
   is facility inventory, not something about a person, and Custom
   Values are what a voice agent prompt can merge with
   {{ custom_values.<key> }}.

     avail_summary          one paragraph for the agent to read from
     avail_updated          when, in Lubbock time
     avail_full             sizes with nothing free
     avail_5x5x8 ...        one per size: count, rate, type, units

   Every value is plain text a voice agent can say aloud. The per-size
   values carry the unit numbers, which the website deliberately never
   shows; GHL is private and the office may need them.

   SETTINGS (Vercel)
     GHL_AVAIL_ENABLED   "on" or nothing is written
     CRON_SECRET         the scheduler's bearer
     GHL_API_KEY         needs locations/customValues.readonly and
                         locations/customValues.write on top of the
                         scopes it already has
     GHL_LOCATION_ID
     WSS_API_KEY
   ================================================================ */
'use strict';

const ghl = require('./_gate/ghl');
const { fetchAvailability } = require('./_avail/movein');

const money = (n) => '$' + (Number(n) % 1 === 0 ? Number(n).toFixed(0) : Number(n).toFixed(2));
const sizeKey = (u) => `${u.width}x${u.length}x${u.height}`;
const sizeSaid = (u) => `${u.width} by ${u.length}`;

function lubbockNow() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/* What the agent reads. Written to be spoken: no symbols a voice
   would stumble on, sizes as "5 by 5", counts as words when small. */
function summary(units, updated) {
  /* A caller hears "5 by 5", not "5 by 5 by 8" and "5 by 5 by 9" as
     two things, so the 8 and 9 foot versions of a footprint are one
     line here, counts added, cheapest rate quoted. */
  const groups = new Map();
  for (const u of units) {
    const k = `${u.width}x${u.length}|${u.climate ? 'c' : 'd'}`;
    const g = groups.get(k) || { ...u, vacant: 0, rate: Infinity, heights: [] };
    g.vacant += Math.max(0, u.vacant);
    if (u.vacant > 0 && u.rate < g.rate) g.rate = u.rate;
    if (u.height) g.heights.push(u.height);
    groups.set(k, g);
  }
  const all = [...groups.values()];
  const open = all.filter((u) => u.vacant > 0).sort((a, b) => a.sqft - b.sqft);
  const full = all.filter((u) => u.vacant <= 0);
  if (!open.length) return `As of ${updated}, no units are showing as available. Offer the waiting list.`;
  const parts = open.map((u) => {
    const kind = u.climate ? 'temperature controlled' : 'drive-up';
    const count = u.vacant === 1 ? 'only one left' : u.vacant <= 3 ? `only ${u.vacant} left` : `${u.vacant} available`;
    return `${sizeSaid(u)} ${kind} at ${money(u.rate)} a month, ${count}`;
  });
  let s = `As of ${updated}, CapRock has ${open.length} unit size${open.length === 1 ? '' : 's'} available: ` +
          parts.join('; ') + '.';
  if (full.length) s += ` Currently full: ${full.map(sizeSaid).join(', ')}; offer the waiting list for those.`;
  s += ' Prices are per month. Rates are locked for the first 12 months.';
  return s;
}

function perSize(u) {
  const kind = u.climate ? 'temperature controlled, interior' : 'drive-up, outdoor';
  if (u.vacant <= 0) return `Full right now, ${kind}. Offer the waiting list.`;
  const nums = u.units.length ? ` Units: ${u.units.join(', ')}.` : '';
  return `${u.vacant} available at ${money(u.rate)} per month, ${kind}.${nums}`;
}

async function readValues() {
  const data = await ghl.call('GET', `/locations/${process.env.GHL_LOCATION_ID}/customValues`);
  const list = (data && data.customValues) || [];
  const byName = new Map();
  for (const v of list) byName.set(String(v.name).toLowerCase(), v);
  return byName;
}

async function writeValue(existing, name, value) {
  const cur = existing.get(name.toLowerCase());
  if (cur && String(cur.value) === value) return 'unchanged';
  if (cur) {
    await ghl.call('PUT', `/locations/${process.env.GHL_LOCATION_ID}/customValues/${cur.id}`, { name, value });
    return 'updated';
  }
  await ghl.call('POST', `/locations/${process.env.GHL_LOCATION_ID}/customValues`, { name, value });
  return 'created';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET || process.env.GATE_SYNC_SECRET;
  if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (process.env.GHL_AVAIL_ENABLED !== 'on') {
    return res.status(200).json({ paused: true, reason: 'GHL_AVAIL_ENABLED is not on' });
  }
  if (!ghl.configured()) return res.status(503).json({ error: 'ghl_not_configured' });

  try {
    const units = await fetchAvailability();
    const updated = lubbockNow();
    const values = {
      avail_updated: updated,
      avail_summary: summary(units, updated),
      avail_full: units.filter((u) => u.vacant <= 0).map(sizeKey).join(', ') || 'none',
    };
    for (const u of units) values[`avail_${sizeKey(u)}`] = perSize(u);

    const existing = await readValues();
    const result = {};
    for (const [name, value] of Object.entries(values)) {
      result[name] = await writeValue(existing, name, value);
    }
    const counts = Object.values(result).reduce((c, r) => ((c[r] = (c[r] || 0) + 1), c), {});
    return res.status(200).json({ ok: true, sizes: units.length, updated, counts, summary: values.avail_summary });
  } catch (err) {
    console.error('ghl-availability failed:', err);
    return res.status(500).json({ error: 'sync_failed', message: String(err.message).slice(0, 300) });
  }
};
