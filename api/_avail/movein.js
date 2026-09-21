/* The WebSelfStorage move-in feed, read on the server for GHL.

   The public proxy (api/wss.js) reads the same feed for the website
   and strips the unit numbers before they reach a browser. GHL is
   private, so this reader keeps them: the office and the voice agent
   may need to say "unit 128 is free", not only "one 10 x 24 is". */
'use strict';

const API_BASE = 'https://api.webselfstorage.com/v4';
const ENTITY = '1030298';   // CapRock Self Storage, Lubbock
const TIMEOUT_MS = 15000;

function pick(obj, ...names) {
  if (!obj || typeof obj !== 'object') return null;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function shape(g) {
  const descList = pick(g, 'sizeDescriptionsField') || [];
  const desc = (Array.isArray(descList) ? descList : [descList]).join(' ');
  const units = (pick(g, 'units') || []).map((u) => String(pick(u, 'unitNumber') || '').trim()).filter(Boolean);
  return {
    width: Number(pick(g, 'width')),
    length: Number(pick(g, 'length')),
    height: Number(pick(g, 'height')),
    sqft: Number(pick(g, 'squareFootage')),
    rate: Number(pick(g, 'monthly')),
    vacant: Number(pick(g, 'vacantUnits') || 0),
    total: Number(pick(g, 'totalUnits') || 0),
    climate: /\bclimate\b/i.test(desc) && !/no\s+climate/i.test(desc),
    driveUp: /drive\s?up/i.test(desc),
    units,
  };
}

async function fetchMovein() {
  const key = (process.env.WSS_API_KEY || '').trim();
  if (!key) throw new Error('WSS_API_KEY is not set');
  const scheme = process.env.WSS_AUTH_SCHEME || 'Bearer';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/movein/${ENTITY}`, {
      headers: { Authorization: scheme ? `${scheme} ${key}` : key, Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`movein -> ${res.status}`);
    const value = body && Object.prototype.hasOwnProperty.call(body, 'Value') ? body.Value : body;
    const list = value && (value.availableUnits || value.AvailableUnits);
    if (!Array.isArray(list)) throw new Error('movein: no availableUnits array');
    return list.map(shape).filter((u) => u.width && u.length);
  } finally {
    clearTimeout(timer);
  }
}

/* Every size code CapRock rents, from the Room Sizes & Rates screen.
   The feed only carries sizes with at least one vacant unit, so a
   size that is full simply vanishes from it. Listing them here is
   what lets the agent say "the 20 by 30 is full" instead of not
   knowing the 20 by 30 exists. Rates for full sizes are not quoted;
   nobody can rent one, and a typed-in number goes stale. */
const KNOWN_SIZES = [
  [5, 5, 8, true], [5, 5, 9, true], [5, 7, 8, true], [5, 7, 9, true],
  [5, 10, 8, true], [5, 10, 9, true], [10, 10, 8, true],
  [8, 10, 8, false], [16, 10, 8, false], [10, 24, 8, false],
  [10, 30, 8, false], [10, 40, 8, false], [20, 30, 8, false], [20, 40, 8, false],
];

/* The feed plus every known size it left out, marked full. */
async function fetchAvailability() {
  const live = await fetchMovein();
  const seen = new Set(live.map((u) => `${u.width}x${u.length}x${u.height}`));
  const full = KNOWN_SIZES
    .filter(([w, l, h]) => !seen.has(`${w}x${l}x${h}`))
    .map(([w, l, h, climate]) => ({ width: w, length: l, height: h, sqft: w * l, rate: null, vacant: 0, total: 0, climate, driveUp: !climate, units: [], live: false }));
  return live.concat(full);
}

module.exports = { fetchMovein, fetchAvailability, KNOWN_SIZES };
