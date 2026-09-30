/* ================================================================
   GET /api/drift

   Is the published site still telling the truth about prices?

   The live unit rows a visitor sees cannot go stale; they are
   fetched. The copies the answer engines read can, because they are
   snapshots pasted into GHL by hand. This says when they have.

   Always returns the answer as JSON, so it can be opened in a browser
   any time without changing anything.

   SETTINGS (Vercel)
     DRIFT_ALERTS   "on" before this tells anyone. Left unset it is a
                    read-only endpoint and sends nothing. Deliberate:
                    the last job that could message people started
                    doing it before anyone meant it to, and thirty
                    eight tenants got a text at the wrong moment.
     OFFICE_EMAIL / OFFICE_PHONE   where the alert goes, as elsewhere.
   ================================================================ */
'use strict';

const ghl = require('./_gate/ghl');
const { check } = require('./_gate/drift');

const BUILD = 'drift-1';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed', build: BUILD });
  }

  let result;
  try {
    result = await check();
  } catch (e) {
    /* A check that cannot run is not a check that passed. */
    console.error('drift check failed:', e.message);
    return res.status(200).json({
      ok: false, build: BUILD, error: e.message,
      problems: ['The drift check could not run: ' + e.message],
    });
  }

  let told = null;
  if (!result.ok && process.env.DRIFT_ALERTS === 'on') {
    const lines = result.problems.map((p) => '- ' + p).join('\n');
    try {
      await ghl.office(
        'The CapRock website and the facility system disagree.\n\n' + lines +
        '\n\nRun the build tools and repaste the location page and the size guide.',
        {
          force: true,
          subject: 'Website prices are out of date (' + result.problems.length + ')',
          html: '<p>The CapRock website and the facility system disagree.</p><ul>' +
            result.problems.map((p) => '<li>' + p
              .replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</li>').join('') +
            '</ul><p>Run the build tools and repaste the location page and the size guide.</p>',
        }
      );
      told = 'sent';
    } catch (e) {
      told = 'failed';
      console.error('drift alert failed:', e.message);
    }
  }

  return res.status(200).json(Object.assign({ build: BUILD }, result, {
    alerts: process.env.DRIFT_ALERTS === 'on' ? (told || 'nothing to report') : 'off',
  }));
};
