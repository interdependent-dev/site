/*
 * read-gate.js — the single source of truth for "how much of this was actually read?"
 *
 * Shared, dependency-free, and intentionally duplicated byte-for-byte by the API
 * (interdependent-api/src/lib/readGate.js) so the portal and the server agree.
 *
 * The honest read % is the SMALLER of two things: how far you scrolled (depth) and
 * how much ACTIVE time you spent relative to a genuine read. Reading is paced by
 * content, not by scrolling — so flicking to the bottom of a 110-page script in 30s
 * is ~2% read, not 100%. A "finished read" needs both: near the end AND the time.
 *
 * Loads as a browser global (window.ReadGate) and as a Node/CommonJS module
 * (module.exports) so the logic can be unit-tested.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ReadGate = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Seconds of ACTIVE reading per page a genuine read takes (~3.5 pages/min for a
  // full read). Tunable: lower is more lenient, higher is stricter.
  var PACE_SEC_PER_PAGE = 20;

  // Honest "how much did you actually read" %, capped by BOTH depth and time.
  function readingPct(depth, seconds, pages) {
    var d = Math.max(0, Math.min(100, depth || 0));
    var s = Math.max(0, seconds || 0);
    var p = pages && pages > 0 ? pages : 100;
    var timePct = Math.min(100, Math.round((s / (p * PACE_SEC_PER_PAGE)) * 100));
    return Math.min(d, timePct);
  }

  // A finished read = reached (near) the end AND spent the time to read it.
  function isFinishedRead(depth, seconds, pages) {
    return readingPct(depth, seconds, pages) >= 85;
  }

  return { readingPct: readingPct, isFinishedRead: isFinishedRead, PACE_SEC_PER_PAGE: PACE_SEC_PER_PAGE };
});
