/* Reader analytics — tiny, best-effort, privacy-light. Sends events to the public
 * /events ingest with an anonymous device id (and reader identity only when the
 * reader has already volunteered it via passkey). Never throws into the page. */
(function () {
  const API = 'https://interdependent-api.onrender.com';
  let sid = '';
  try {
    sid = localStorage.getItem('analytics_sid') || '';
    if (!sid) { sid = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('analytics_sid', sid); }
  } catch { sid = 's_' + Math.random().toString(36).slice(2); }

  function readerId() {
    try { const r = window.ReaderAuth && ReaderAuth.getReader && ReaderAuth.getReader(); return r && r.readerId || undefined; } catch { return undefined; }
  }
  // The reader session JWT ReaderAuth stores (see reader-auth.js LS_SESSION).
  function sessionToken() {
    try { return localStorage.getItem('reader_session') || ''; } catch { return ''; }
  }
  function send(body) {
    try {
      const json = JSON.stringify(body);
      // Reader attribution rides ONLY on the X-Reader-Session header — the API
      // ignores body reader_id. sendBeacon cannot set headers, so a signed-in
      // reader must use fetch; keepalive makes it survive unload like a beacon.
      const token = sessionToken();
      if (token) {
        fetch(API + '/events', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', 'X-Reader-Session': token },
          body: json,
        }).catch(() => {});
        return;
      }
      // Anonymous events need no headers — beacon is the most reliable on unload.
      if (navigator.sendBeacon) { navigator.sendBeacon(API + '/events', new Blob([json], { type: 'application/json' })); return; }
      fetch(API + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
    } catch { /* ignore */ }
  }
  function track(eventType, props) {
    send(Object.assign({ event_type: eventType, session_id: sid, reader_id: readerId() }, props || {}));
  }
  window.Analytics = { track, sessionId: sid };
})();
