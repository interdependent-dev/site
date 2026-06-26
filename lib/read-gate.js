/*
 * read-gate.js — the single source of truth for "has this screenplay been read?"
 *
 * Shared, dependency-free, and intentionally duplicated byte-for-byte by the API
 * (interdependent-api/src/lib/readGate.js) so the portal and the server agree on
 * what "finished" means. A read counts when the reader reached the end (depth)
 * AND spent real, active time consistent with actually reading it — never scroll
 * alone. Forgiving by design: the gate exists to stop UNREAD actions and nudge
 * reading, not to defeat a determined faker (that's the server's job). Page-count
 * aware when known, safe when it isn't.
 *
 * Loads as a browser global (window.ReadGate) and as a Node/CommonJS module
 * (module.exports) so the same logic can be unit-tested.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ReadGate = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function isFinishedRead(depth, seconds, pages) {
    var d = depth || 0, s = seconds || 0;
    var reached = pages ? Math.max(1, Math.round(pages * (d / 100))) : 0;
    var timeFloor = Math.max(90, reached * 3); // ~3s per page reached, min 90s
    return d >= 85 && s >= timeFloor;
  }
  return { isFinishedRead: isFinishedRead };
});
