/* ================================================================
   CapRock Self-Storage — WebSelfStorage AffiliateAPI proxy
   Vercel serverless function.
   GET /api/wss?facility=<slug>&resource=<name>

   WHY THIS EXISTS, AND WHY IT IS STRICTLY SCOPED
   The key must never reach the browser: GHL pages are Custom Code, so
   anything in them is readable with View Source.

   More importantly, this is a single key with broad read access. The
   same credential that lists available units also reads
   /location/{entity}/rentroll and /waitingList, which return live
   tenant records — names and contact details of real customers. A
   general "pass the path through" proxy would put that PII one crafted
   query string away from being public.

   So RESOURCES below is an allowlist of fixed upstream paths, the
   client only ever sends a key from that map, and rentroll and
   waitingList are deliberately absent. Do not add them: nothing on a
   public marketing site needs tenant data.

   API VERSION
   v4 only. U-Haul is retiring v3, and per their Affiliate Marketing
   Services team the v3 failures we saw were a documentation-portal
   artefact, not the key. Paths mirror between versions, so v3 is never
   worth falling back to.

   AUTH
   The API's own 401 body says "Specify your API key in the
   Authorization header", so the raw key is sent, with no Bearer
   prefix. If their Postman collection shows otherwise, set
   WSS_AUTH_SCHEME=Bearer in Vercel rather than editing this file.

   DEPLOYING
     vercel link
     vercel env add WSS_API_KEY production     <- paste at the prompt
     vercel deploy --prod
   ================================================================ */

/* Environment variables are baked in at build time, so a change to
   WSS_API_KEY in the Vercel dashboard does nothing until the next
   deployment. If the key looks right but the upstream still returns
   401, redeploy before assuming the value is wrong. */
const API_BASE = 'https://api.webselfstorage.com/v4';
const UPSTREAM_TIMEOUT_MS = 8000;

/* Not "*": an open proxy lets anyone spend CapRock's API quota. */
const ALLOWED_ORIGINS = [
  'https://sites.leadconnectorhq.com',
  // TODO add CapRock's live domain, and its www. variant, at launch.
];

/* Slug the page asks for -> WebSelfStorage entity id. Keeps the raw id
   off the client and stops the query string being used to enumerate
   other locations on the account. */
const FACILITIES = {
  'lubbock-2213-n-quaker': '1030298',
};

/* Every upstream path this proxy will ever call. Adding a key here is
   a deliberate decision; see the PII note at the top of the file. */
const RESOURCES = {
  // Available move-in units: the Units section.
  movein:        (id) => `/movein/${id}`,
  // Address, office hours, unit types, coupons.
  location:      (id) => `/location/${id}`,
  // Facility photography.
  images:        (id) => `/location/${id}/images`,
  // Customer reviews.
  reviews:       (id) => `/location/${id}/reviews`,
  // Tenant-facing payment portal link, for "Pay Your Bill".
  paymentPortal: (id) => `/paymentPortalUrl/${id}`,
};

/* Case-insensitive field read. Responses are PascalCase
   ({"Value":{"Success":...}}), but be tolerant rather than brittle. */
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

/* Shaping is per resource and enumerated on purpose. Anything not
   named here is dropped, so a change upstream cannot start leaking
   fields the page never asked for. Unknown shapes therefore fail
   closed: the section renders empty rather than dumping raw data. */
const SHAPE = {
  /* /movein returns unit TYPES, not individual units: each entry is a
     size/attribute group with a count of how many are vacant.

     Four things are dropped on purpose rather than passed through:

       units[]           the unit NUMBERS of every vacant unit. A public
                         list of which units are empty is not something
                         a storage facility should publish.
       totalUnits        with vacantUnits it gives away occupancy rate,
                         which is commercially sensitive. vacantCount
                         alone is kept: "3 left" is normal retail copy.
       insuranceOptions  insurance products and their GUIDs; the page
                         does not sell insurance.
       cubicFootage,
       orderGrouping,
       bonusComments,
       isCampusStorage   unused internals.

     locationName IS kept, deliberately. If it ever reads as anything
     other than CapRock, that is a wrong-entity bug worth seeing rather
     than silently rendering another operator's inventory. */
  movein: (v) => {
    const list = pick(v, 'availableUnits') || [];
    return {
      locationName: pick(v, 'locationName') ||
                    (Array.isArray(list) && list[0] ? pick(list[0], 'locationName') : null),
      unitTypes: (Array.isArray(list) ? list : []).map((g) => {
        /* sizeDescriptionsField is a space-joined attribute blob, e.g.
           "Drive Up 1st Floor Outside Level No Climate Drivethrough
           Rollup Electricity". Rather than try to parse the whole
           vocabulary, derive only flags that can be read reliably and
           keep the raw string for display. */
        const descList = pick(g, 'sizeDescriptionsField') || [];
        const desc = (Array.isArray(descList) ? descList : [descList]).join(' ');
        const width = pick(g, 'width');
        const length = pick(g, 'length');
        const vacant = Number(pick(g, 'vacantUnits') || 0);
        return {
          /* unitSize is WxLxH ("10x30x8"); the page wants W x L. */
          size: (width != null && length != null) ? `${width} x ${length}` : pick(g, 'unitSize'),
          width: width,
          length: length,
          height: pick(g, 'height'),
          sqft: pick(g, 'squareFootage'),
          rate: pick(g, 'monthly'),
          available: vacant > 0,
          vacantCount: vacant,
          driveUp: /drive\s?up/i.test(desc),
          /* "No Climate" appears verbatim, so the negative must be
             excluded or every unit reads as climate controlled. */
          climate: /\bclimate\b/i.test(desc) && !/no\s+climate/i.test(desc),
          ada: /\bADA\b/.test(desc),
          electricity: /electricity/i.test(desc),
          description: desc || null,
          /* Identifies the type for a future reserve link. */
          rentableObjectId: pick(g, 'rentableObjectId'),
        };
      }),
    };
  },
  location: (v) => ({
    name: pick(v, 'name', 'locationName'),
    address: pick(v, 'address', 'address1', 'street'),
    city: pick(v, 'city'),
    state: pick(v, 'state', 'region'),
    zip: pick(v, 'zip', 'postalCode', 'zipCode'),
    phone: pick(v, 'phone', 'phoneNumber'),
    officeHours: pick(v, 'officeHours', 'hours'),
    accessHours: pick(v, 'accessHours', 'gateHours'),
    coupons: pick(v, 'coupons', 'promotions') || [],
  }),
  images: (v) => {
    const list = Array.isArray(v) ? v : (pick(v, 'images') || []);
    return {
      images: (Array.isArray(list) ? list : [])
        .map((i) => (typeof i === 'string' ? i : pick(i, 'url', 'imageUrl', 'src')))
        .filter(Boolean),
    };
  },
  reviews: (v) => {
    const list = Array.isArray(v) ? v : (pick(v, 'reviews') || []);
    return {
      reviews: (Array.isArray(list) ? list : []).map((r) => ({
        rating: pick(r, 'rating', 'stars', 'score'),
        text: pick(r, 'text', 'comment', 'body', 'review'),
        // First name only. A public page has no business publishing
        // a reviewer's full name, and the upstream may include one.
        name: String(pick(r, 'name', 'author', 'customerName') || '').split(' ')[0] || null,
        date: pick(r, 'date', 'createdOn', 'reviewDate'),
      })),
    };
  },
  paymentPortal: (v) => ({
    url: typeof v === 'string' ? v : pick(v, 'url', 'paymentPortalUrl'),
  }),
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    /* GET only. The write endpoints (/reservation, POST /movein) take
       customer details and would need their own review before a public
       page could reach them. */
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  /* Trimmed. Pasting a key into `vercel env add` or the dashboard
     commonly captures a trailing newline or a stray space, and the
     upstream then rejects a key that is otherwise correct. The raw
     form is what this API wants: its own 401 says "Specify your API
     key in the Authorization header", and a raw-key request returns
     200 in Postman. */
  const rawKey = process.env.WSS_API_KEY;
  const key = typeof rawKey === 'string' ? rawKey.trim() : rawKey;
  if (!key) {
    console.error('WSS_API_KEY is not set on this deployment');
    return res.status(503).json({ error: 'not_configured' });
  }
  if (rawKey !== key) {
    /* Worth knowing: the stored value has surrounding whitespace
       that should be cleaned up at the source. */
    console.warn('WSS_API_KEY had surrounding whitespace; trimmed');
  }

  const entity = FACILITIES[String(req.query.facility || '')];
  if (!entity) return res.status(400).json({ error: 'unknown_facility' });

  const resourceName = String(req.query.resource || 'movein');
  const buildPath = RESOURCES[resourceName];
  if (!buildPath) return res.status(400).json({ error: 'unknown_resource' });

  const scheme = process.env.WSS_AUTH_SCHEME || '';
  const authValue = scheme ? `${scheme} ${key}` : key;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    /* TEMPORARY - remove once the scheme is known.

       A raw key and a "Bearer " prefix are both plausible. The API's
       401 says "Specify your API key in the Authorization header", but
       a deliberately invalid key returns that same text, so the wording
       proves nothing either way. Rather than redeploy once per guess,
       try the configured form, fall back to the other on 401, and log
       which one the upstream accepted.

       Once the log names a winner: set WSS_AUTH_SCHEME to match and
       delete this block. Left in permanently it would double the
       latency of every genuinely unauthorized request. */
    function callUpstream(authHeader) {
      return fetch(API_BASE + buildPath(entity), {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        signal: controller.signal,
      });
    }

    const alternate = scheme ? key : 'Bearer ' + key;
    let upstream = await callUpstream(authValue);

    if (upstream.status === 401) {
      const retry = await callUpstream(alternate);
      if (retry.ok) {
        console.warn(
          'AUTH SCHEME: upstream accepted the %s. Set WSS_AUTH_SCHEME to match and remove the fallback.',
          scheme ? 'raw key' : 'Bearer prefix'
        );
        upstream = retry;
      } else {
        console.error('AUTH SCHEME: raw key and Bearer prefix were both rejected with 401.');
      }
    }

    const body = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      /* Logged, never returned: upstream error bodies echo the request,
         and this API's 401 body describes the auth header directly. */
      console.error(
        'wss %s %s -> %s %s (key length %d)',
        resourceName, entity, upstream.status,
        (body && body.Value && body.Value.ErrorMessage) || '',
        key.length
      );
      /* Distinct codes on purpose. 'not_configured' means this
         deployment carries no key at all; 'upstream_unauthorized'
         means a key was sent and U-Haul refused it, which points at
         the auth scheme rather than a missing variable. Collapsing
         both into one message makes them indistinguishable from
         outside, which is exactly when you need to tell them apart. */
      return res.status(502).json({
        error: upstream.status === 401 ? 'upstream_unauthorized' : 'upstream_error',
      });
    }

    /* Error bodies wrap the payload ({"Value":{"Success":false,...}}),
       but success bodies are flat camelCase
       ({"availableUnits":[...],"success":true}). Handle both. */
    const value = (body && Object.prototype.hasOwnProperty.call(body, 'Value'))
      ? body.Value : body;

    if (value && pick(value, 'success') === false) {
      console.error('wss %s reported failure: %s', resourceName, pick(value, 'errorMessage'));
      return res.status(502).json({ error: 'upstream_error' });
    }

    const shaped = SHAPE[resourceName](value);

    /* Cached at the edge so a busy page does not hit U-Haul once per
       visitor. Availability and coupons change slowly; five minutes
       keeps it honest without hammering the upstream. */
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ facility: req.query.facility, resource: resourceName, ...shaped });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('wss %s failed: %s', resourceName, aborted ? 'timeout' : err);
    return res.status(aborted ? 504 : 500)
              .json({ error: aborted ? 'upstream_timeout' : 'internal_error' });
  } finally {
    clearTimeout(timer);
  }
};
