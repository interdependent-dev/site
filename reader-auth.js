/* ============================================================================
 * reader-auth.js — passkey authentication for Interdependent "readers"
 * ----------------------------------------------------------------------------
 * Readers are a separate user type from screenplay submitters. They sign in
 * with passkeys (WebAuthn / iCloud Keychain — no passwords). There are NO
 * server-side sessions: every protected write requires a fresh passkey
 * verification that returns a short-lived, single-use "action token" (a 5-min
 * JWT). Identity (who this device is) persists in localStorage; the action
 * token lives in memory only and is spent after one write.
 *
 * No build step, no bundler — this is a classic script that hangs a single
 * global, `window.ReaderAuth`, off the page. Load it with:
 *     <script src="/reader-auth.js"></script>
 * then call e.g. `await ReaderAuth.promptRegister()` or `ReaderAuth.signIn()`.
 *
 * base64url encoding is done by hand (see encode/decode below) so the auth
 * path carries no third-party runtime dependency. The credential JSON produced
 * here matches the shape @github/webauthn-json emits, so the backend can't tell
 * the difference.
 * ==========================================================================*/
(function () {
  'use strict';

  const API = 'https://interdependent-api.onrender.com';

  // localStorage keys — keep these exact for cross-page consistency.
  const LS_ID      = 'reader_id';
  const LS_HANDLE  = 'reader_handle';
  const LS_DISPLAY = 'reader_display';

  // Action tokens are 5-minute JWTs. We treat ours as stale a little early to
  // avoid handing the server a token that expires mid-flight.
  const TOKEN_TTL_MS  = 5 * 60 * 1000;
  const TOKEN_SKEW_MS = 15 * 1000;

  // A token younger than this may be reused across consecutive writes so a
  // reader isn't re-prompted for their passkey every few seconds (e.g. enabling
  // edit, then saving a reorder). Older than this → reauth.
  const TOKEN_REUSE_MS = 4 * 60 * 1000;

  // ── error type ────────────────────────────────────────────────────────────
  // Every rejection from this module is a ReaderAuthError carrying a stable
  // `code` (for branching) and a human `message` (for display).
  class ReaderAuthError extends Error {
    constructor(code, message, status) {
      super(message || code);
      this.name = 'ReaderAuthError';
      this.code = code;
      this.status = status || null;
    }
  }

  // Server error codes (per the API contract) → reader-facing copy.
  const CODE_MESSAGES = {
    challenge_expired:     'That took too long — please try again.',
    passkey_verify_failed: 'Could not verify your passkey — please try again.',
    reader_not_found:      'No reader account found — please register first.',
    already_on_leaderboard:'This script is already on the leaderboard.',
  };

  // Client-side / WebAuthn codes we raise ourselves.
  const LOCAL_MESSAGES = {
    unsupported:        'This device or browser does not support passkeys.',
    insecure_context:   'Passkeys require a secure (https) connection.',
    not_registered:     'This device is not registered yet — please register first.',
    missing_name:       'Please enter your first and last name.',
    passkey_cancelled:  'Passkey prompt was dismissed — please try again.',
    already_registered: 'A passkey already exists for this account on this device — try signing in instead.',
    network:            'Could not reach the server — please try again.',
    bad_response:       'Unexpected response from the server — please try again.',
  };

  function err(code, status) {
    return new ReaderAuthError(code, CODE_MESSAGES[code] || LOCAL_MESSAGES[code] || code, status);
  }

  // ── base64url ⇄ ArrayBuffer ───────────────────────────────────────────────
  function bufToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function b64urlToBuf(value) {
    let str = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // Server hands back creation/request options with binary fields as base64url
  // strings (JSON-safe). navigator.credentials.* wants real ArrayBuffers —
  // convert the binary fields in place on a shallow copy.
  function prepCreationOptions(o) {
    const pub = Object.assign({}, o);
    pub.challenge = b64urlToBuf(o.challenge);
    pub.user = Object.assign({}, o.user, { id: b64urlToBuf(o.user.id) });
    if (Array.isArray(o.excludeCredentials)) {
      pub.excludeCredentials = o.excludeCredentials.map(c =>
        Object.assign({}, c, { id: b64urlToBuf(c.id) }));
    }
    return pub;
  }

  function prepRequestOptions(o) {
    const pub = Object.assign({}, o);
    pub.challenge = b64urlToBuf(o.challenge);
    if (Array.isArray(o.allowCredentials)) {
      pub.allowCredentials = o.allowCredentials.map(c =>
        Object.assign({}, c, { id: b64urlToBuf(c.id) }));
    }
    return pub;
  }

  // Encode the PublicKeyCredential returned by create()/get() into the JSON the
  // backend expects. `id` is already base64url; the binary response fields are
  // converted here.
  function encodeAttestation(cred) {
    const r = cred.response;
    const out = {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: {
        clientDataJSON: bufToB64url(r.clientDataJSON),
        attestationObject: bufToB64url(r.attestationObject),
        // @simplewebauthn/server expects this present — default to [].
        transports: (typeof r.getTransports === 'function' ? r.getTransports() : null) || [],
      },
    };
    if (cred.authenticatorAttachment) out.authenticatorAttachment = cred.authenticatorAttachment;
    return out;
  }

  function encodeAssertion(cred) {
    const r = cred.response;
    const out = {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: {
        clientDataJSON: bufToB64url(r.clientDataJSON),
        authenticatorData: bufToB64url(r.authenticatorData),
        signature: bufToB64url(r.signature),
        userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
      },
    };
    if (cred.authenticatorAttachment) out.authenticatorAttachment = cred.authenticatorAttachment;
    return out;
  }

  // ── network ───────────────────────────────────────────────────────────────
  // The API host cold-starts; the first request after a quiet spell can stall.
  // Give each request a hard timeout, and let `begin` calls retry once on a
  // network failure. `complete` calls never retry — the challenge is single-use,
  // so a retry would just burn it.
  function fetchWithTimeout(url, opts, ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      return fetch(url, Object.assign({}, opts, { signal: AbortSignal.timeout(ms) }));
    }
    return fetch(url, opts);
  }

  async function postJSON(path, body, { retries = 0, timeout = 30000 } = {}) {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    };

    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchWithTimeout(`${API}${path}`, opts, timeout);
        break;
      } catch (e) {
        if (attempt >= retries) throw err('network');
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    if (res.ok) {
      try { return await res.json(); }
      catch { throw err('bad_response', res.status); }
    }

    // Map server error codes; fall back to the HTTP status.
    let bodyJson = {};
    try { bodyJson = await res.json(); } catch { /* no body */ }
    const code = bodyJson.code;
    if (code && (CODE_MESSAGES[code] || LOCAL_MESSAGES[code])) throw err(code, res.status);
    throw new ReaderAuthError(code || `http_${res.status}`, bodyJson.error || `Request failed (${res.status})`, res.status);
  }

  // Translate a WebAuthn DOMException into our error vocabulary.
  function mapCeremonyError(e, phase) {
    if (e instanceof ReaderAuthError) return e;
    const name = e && e.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return err('passkey_cancelled');
    if (name === 'InvalidStateError' && phase === 'register') return err('already_registered');
    if (name === 'SecurityError') return err('insecure_context');
    return err('passkey_verify_failed');
  }

  // ── identity (localStorage) ───────────────────────────────────────────────
  function getReader() {
    const readerId = localStorage.getItem(LS_ID);
    if (!readerId) return null;
    return {
      readerId,
      handle: localStorage.getItem(LS_HANDLE) || '',
      displayName: localStorage.getItem(LS_DISPLAY) || '',
    };
  }

  function isRegistered() {
    return !!(localStorage.getItem(LS_ID) && localStorage.getItem(LS_HANDLE));
  }

  function storeReader({ readerId, handle, displayName }) {
    if (readerId)            localStorage.setItem(LS_ID, readerId);
    if (handle)             localStorage.setItem(LS_HANDLE, handle);
    if (displayName != null) localStorage.setItem(LS_DISPLAY, displayName);
    return getReader();
  }

  function clearReader() {
    localStorage.removeItem(LS_ID);
    localStorage.removeItem(LS_HANDLE);
    localStorage.removeItem(LS_DISPLAY);
    clearToken();
  }

  // ── action token (in-memory only) ─────────────────────────────────────────
  let _token = null;
  let _tokenExp = 0;
  let _tokenIssued = 0;

  function setToken(jwt) {
    _token = jwt || null;
    _tokenIssued = jwt ? Date.now() : 0;
    _tokenExp = jwt ? Date.now() + TOKEN_TTL_MS - TOKEN_SKEW_MS : 0;
  }
  function clearToken() { _token = null; _tokenExp = 0; _tokenIssued = 0; }
  function hasFreshToken() { return !!_token && Date.now() < _tokenExp; }
  function getActionToken() { return hasFreshToken() ? _token : null; }

  // Return a usable action token, reauthing only when needed. A token younger
  // than TOKEN_REUSE_MS is reused (no passkey prompt); otherwise this triggers
  // a fresh reauth. Pass { forceFresh: true } to always reauth.
  async function ensureActionToken({ maxAgeMs = TOKEN_REUSE_MS, forceFresh = false } = {}) {
    if (!forceFresh && _token && (Date.now() - _tokenIssued) < maxAgeMs) return _token;
    const { actionToken } = await signIn();
    return actionToken;
  }

  // ── capability ────────────────────────────────────────────────────────────
  function isSupported() {
    return typeof window !== 'undefined'
      && !!window.PublicKeyCredential
      && !!(navigator.credentials && navigator.credentials.create && navigator.credentials.get);
  }

  function assertSupported() {
    if (!isSupported()) throw err('unsupported');
    if (window.isSecureContext === false) throw err('insecure_context');
  }

  // ── Flow 1: registration ──────────────────────────────────────────────────
  // Pure primitive: takes two strings, performs the WebAuthn create ceremony,
  // persists the new reader. The UI (or promptRegister below) owns the inputs.
  async function register(firstName, lastName) {
    assertSupported();
    const first = String(firstName || '').trim();
    const last  = String(lastName || '').trim();
    if (!first || !last) throw err('missing_name');

    const begin = await postJSON('/readers/register/begin',
      { firstName: first, lastName: last }, { retries: 1, timeout: 45000 });
    if (!begin || !begin.challengeId || !begin.options) throw err('bad_response');

    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: prepCreationOptions(begin.options) });
    } catch (e) { throw mapCeremonyError(e, 'register'); }
    if (!cred) throw err('passkey_cancelled');

    const done = await postJSON('/readers/register/complete',
      { challengeId: begin.challengeId, credential: encodeAttestation(cred) }, { retries: 0, timeout: 30000 });
    if (!done || !done.readerId) throw err('bad_response');

    return storeReader(done);
  }

  // ── Flows 2 & 3: authentication ───────────────────────────────────────────
  // handle present → reauth (Flow 2); handle null → discoverable (Flow 3, the
  // browser picks the passkey). Both return a fresh action token and refresh
  // the stored identity.
  async function authenticate(handle) {
    assertSupported();

    const begin = await postJSON('/readers/auth/begin',
      handle ? { handle } : {}, { retries: 1, timeout: 45000 });
    if (!begin || !begin.challengeId || !begin.options) throw err('bad_response');

    let cred;
    try {
      cred = await navigator.credentials.get({ publicKey: prepRequestOptions(begin.options) });
    } catch (e) { throw mapCeremonyError(e, 'auth'); }
    if (!cred) throw err('passkey_cancelled');

    const done = await postJSON('/readers/auth/complete',
      { challengeId: begin.challengeId, credential: encodeAssertion(cred) }, { retries: 0, timeout: 30000 });
    if (!done || !done.actionToken) throw err('bad_response');

    setToken(done.actionToken);
    storeReader(done); // refresh id/handle/display (also persists discoverable sign-ins)
    return {
      actionToken: done.actionToken,
      readerId: done.readerId,
      handle: done.handle,
      displayName: done.displayName,
    };
  }

  // Returning reader on a known device — prompts the passkey, no name input.
  function reauth() {
    const handle = localStorage.getItem(LS_HANDLE);
    if (!handle) return Promise.reject(err('not_registered'));
    return authenticate(handle);
  }

  // Discoverable "sign in with a passkey" — no handle; the browser chooses.
  function signInWithPasskey() {
    return authenticate(null);
  }

  // Smart entry point: reauth if this device knows who it is, else discoverable.
  function signIn() {
    return isRegistered() ? reauth() : signInWithPasskey();
  }

  // ── protected writes (leaderboard add / remove / reorder) ──────────────────
  // Ensure a fresh-enough action token (reauthing only if needed) → attach it →
  // fire the request. The token is kept in memory for reuse within the reuse
  // window so a burst of writes doesn't re-prompt the passkey each time. Returns
  // the raw Response so the caller can branch on status / body code (e.g. 409
  // already_on_leaderboard).
  async function authedWrite(path, opts = {}) {
    const token = await ensureActionToken();
    const headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${token}` });
    return fetchWithTimeout(`${API}${path}`, Object.assign({}, opts, { headers }), opts.timeout || 30000);
  }

  // ── built-in registration modal (brand-styled, injected on demand) ─────────
  // The only DOM this module touches. Collects first/last name in a black/red/
  // Eurostile card matching the rest of the site, then runs register(). Resolves
  // with the stored reader, or rejects with a 'passkey_cancelled' error if the
  // visitor backs out.
  let _styleInjected = false;
  function injectStyles() {
    if (_styleInjected) return;
    _styleInjected = true;
    const css = `
.ra-back{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(0,0,0,.88);animation:ra-fade .2s ease-out both}
@keyframes ra-fade{from{opacity:0}to{opacity:1}}
.ra-card{width:100%;max-width:360px;background:#070707;border:1px solid #1c1c1c;
  padding:34px 28px 28px;position:relative;color:#fff;
  font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}
.ra-eur{font-family:"Eurostile","Helvetica Neue",sans-serif}
.ra-title{font-family:"Eurostile Wide","Eurostile",sans-serif;font-weight:700;font-size:12px;
  letter-spacing:.26em;margin-right:-.26em;color:#fff;text-transform:uppercase;margin-bottom:6px}
.ra-sub{font-size:12px;color:#777;line-height:1.6;margin-bottom:22px}
.ra-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.ra-field label{font-family:"Eurostile","Helvetica Neue",sans-serif;font-size:10px;letter-spacing:.18em;
  color:#888;text-transform:uppercase}
.ra-field input{background:#0a0a0a;border:1px solid #2a2a2a;padding:12px 14px;color:#fff;font-size:14px;
  outline:none;border-radius:0;-webkit-appearance:none;transition:border-color .15s;font-family:inherit}
.ra-field input::placeholder{color:#555}
.ra-field input:focus{border-color:red}
.ra-err{font-family:"Eurostile","Helvetica Neue",sans-serif;font-size:10px;letter-spacing:.1em;color:red;
  text-transform:uppercase;min-height:1.2em;margin:2px 0 10px}
.ra-actions{display:flex;gap:10px;margin-top:6px}
.ra-btn{flex:1;height:48px;border:none;font-family:"Eurostile","Helvetica Neue",sans-serif;font-size:11px;
  font-weight:700;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:9px;transition:opacity .15s,border-color .15s,color .15s}
.ra-btn.primary{background:red;color:#fff}
.ra-btn.primary:hover:not(:disabled){opacity:.85}
.ra-btn.ghost{background:none;border:1px solid #333;color:#999}
.ra-btn.ghost:hover:not(:disabled){border-color:#777;color:#fff}
.ra-btn:disabled{opacity:.4;cursor:default}
.ra-btn.busy{cursor:wait}
.ra-spin{display:none;width:13px;height:13px;border:1.5px solid rgba(255,255,255,.35);
  border-top-color:#fff;border-radius:50%;animation:ra-spin .7s linear infinite}
.ra-btn.busy .ra-spin{display:block}
@keyframes ra-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ra-back{animation:none}.ra-spin{animation-duration:1.4s}}`;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  function promptRegister() {
    return new Promise((resolve, reject) => {
      if (!isSupported()) { reject(err('unsupported')); return; }
      injectStyles();

      const back = document.createElement('div');
      back.className = 'ra-back';
      back.innerHTML = `
        <div class="ra-card" role="dialog" aria-modal="true" aria-label="Register as a reader">
          <div class="ra-title">Register</div>
          <div class="ra-sub">Create your reader passkey. You'll use Touch ID, Face ID, or your device passcode — no password to remember.</div>
          <div class="ra-field">
            <label for="ra-first">First name</label>
            <input id="ra-first" type="text" autocomplete="given-name" placeholder="First name">
          </div>
          <div class="ra-field">
            <label for="ra-last">Last name</label>
            <input id="ra-last" type="text" autocomplete="family-name" placeholder="Last name">
          </div>
          <div class="ra-err" id="ra-err" aria-live="polite"></div>
          <div class="ra-actions">
            <button class="ra-btn ghost" id="ra-cancel" type="button">Cancel</button>
            <button class="ra-btn primary" id="ra-go" type="button">
              <span class="ra-spin" aria-hidden="true"></span><span class="ra-go-text">Create passkey</span>
            </button>
          </div>
        </div>`;
      document.body.appendChild(back);

      const first  = back.querySelector('#ra-first');
      const last   = back.querySelector('#ra-last');
      const errEl  = back.querySelector('#ra-err');
      const goBtn  = back.querySelector('#ra-go');
      const goText = back.querySelector('.ra-go-text');
      const cancel = back.querySelector('#ra-cancel');
      let busy = false, done = false;

      function close(result, error) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        if (error) reject(error); else resolve(result);
      }
      function bail() { if (!busy) close(null, err('passkey_cancelled')); }

      async function go() {
        if (busy) return;
        errEl.textContent = '';
        const f = first.value.trim(), l = last.value.trim();
        if (!f || !l) { errEl.textContent = LOCAL_MESSAGES.missing_name; (f ? last : first).focus(); return; }

        busy = true;
        goBtn.classList.add('busy'); goBtn.disabled = true; cancel.disabled = true;
        goText.textContent = 'Creating passkey';
        first.disabled = last.disabled = true;
        try {
          const reader = await register(f, l);
          close(reader, null);
        } catch (e) {
          busy = false;
          goBtn.classList.remove('busy'); goBtn.disabled = false; cancel.disabled = false;
          goText.textContent = 'Create passkey';
          first.disabled = last.disabled = false;
          errEl.textContent = (e && e.message) || LOCAL_MESSAGES.passkey_verify_failed;
        }
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); bail(); }
        else if (e.key === 'Enter') { e.preventDefault(); go(); }
      }

      goBtn.addEventListener('click', go);
      cancel.addEventListener('click', bail);
      back.addEventListener('click', e => { if (e.target === back) bail(); });
      document.addEventListener('keydown', onKey, true);
      first.focus();
    });
  }

  // ── public surface ────────────────────────────────────────────────────────
  window.ReaderAuth = {
    API,
    ReaderAuthError,
    CODES: CODE_MESSAGES,

    // capability
    isSupported,

    // identity
    getReader,
    isRegistered,
    clearReader,

    // action token (in-memory)
    getActionToken,
    hasFreshToken,
    ensureActionToken, // reuse-or-reauth → returns a usable token

    // flows
    register,          // (firstName, lastName) — pure, no DOM
    promptRegister,    // built-in brand-styled modal → register()
    reauth,            // Flow 2: returning reader, stored handle
    signInWithPasskey, // Flow 3: discoverable, no handle
    signIn,            // smart: reauth if registered, else discoverable

    // protected writes (leaderboard)
    authedWrite,
  };
})();
