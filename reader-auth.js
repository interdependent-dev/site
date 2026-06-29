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
    email_required:        'Please enter a valid email address.',
    // Account recovery
    recovery_invalid:      'This recovery link isn’t valid. Request a new one.',
    recovery_expired:      'This recovery link has expired. Request a new one.',
    recovery_used:         'This recovery link has already been used. Request a new one.',
    // Profile photo
    bad_image:             'Please choose a PNG, JPEG, or WebP image under 3 MB.',
    no_file:               'Please choose an image first.',
  };

  // Shown when the device can't do passkeys at all (STEP 0 fails).
  const UNSUPPORTED_MESSAGE =
    "Passkeys aren't available on this device. Use a device with Touch ID, Face ID, Windows Hello, or a screen lock (a recent iPhone, iPad, Mac, Windows PC, or Android phone).";

  // Client-side / WebAuthn codes we raise ourselves.
  const LOCAL_MESSAGES = {
    unsupported:        UNSUPPORTED_MESSAGE,
    insecure_context:   'Passkeys require a secure (https) connection.',
    not_registered:     'This device is not registered yet — please register first.',
    missing_name:       'Please enter your first and last name.',
    missing_email:      'Please enter a valid email address.',
    passkey_cancelled:  'Passkey prompt was dismissed — please try again.',
    already_registered: 'A passkey already exists for this account on this device — try signing in instead.',
    network:            'Could not reach the server — please try again.',
    bad_response:       'Unexpected response from the server — please try again.',
  };

  // Minimal email sanity check — the server is authoritative (zod .email()),
  // this just catches obvious typos before a round-trip.
  function looksLikeEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

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

  async function postJSON(path, body, { retries = 0, timeout = 30000, headers = null } = {}) {
    const opts = {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
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
    // Surface the server's real reason for debugging (the user-facing message is
    // intentionally generic; the console keeps the exact code/detail).
    try { console.warn('[ReaderAuth] ' + path + ' → ' + res.status, bodyJson); } catch {}
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
    if (name === 'NotSupportedError') return err('unsupported');
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
  // Cheap synchronous pre-check: is the WebAuthn API even present? (false on IE
  // and very old browsers, where PublicKeyCredential is undefined.)
  function isSupported() {
    return typeof window !== 'undefined'
      && !!window.PublicKeyCredential
      && !!(navigator.credentials && navigator.credentials.create && navigator.credentials.get);
  }

  // Is this an Apple platform (Mac / iPhone / iPad)? Readers must use iCloud
  // Keychain so their passkey syncs across their devices, and no web API reports
  // "iCloud Keychain" directly — UVPAA only says a platform authenticator exists
  // (it's true for Windows Hello / Android too). So we additionally require an
  // Apple platform. Prefer userAgentData (precise on Chromium); fall back to the
  // UA/platform string for Safari, which has no userAgentData.
  function isApplePlatform() {
    try {
      const uaData = navigator.userAgentData;
      if (uaData && typeof uaData.platform === 'string' && uaData.platform) {
        const p = uaData.platform.toLowerCase();
        return p.includes('mac') || p.includes('ios') || p.includes('iphone') || p.includes('ipad');
      }
      const ua = navigator.userAgent || '';
      const plat = navigator.platform || '';
      if (/iPhone|iPod|iPad/.test(ua)) return true;       // iOS / iPadOS browsers
      return /Mac/i.test(plat) || /Macintosh/i.test(ua);  // macOS, and iPadOS that reports as Mac
    } catch { return false; }
  }

  // Authoritative STEP-0 check, async + cached. Cross-platform: the WebAuthn API
  // is present (false on IE), the page is secure (https), and a user-verifying
  // platform authenticator is actually available — true for Touch ID / Face ID
  // (Apple), Windows Hello, and Android's screen lock. (Previously gated to Apple
  // only; lifted so Microsoft/Android readers work too.) If false → show the
  // unsupported message and never attempt an auth ceremony.
  let _supportPromise = null;
  function checkSupport() {
    if (_supportPromise) return _supportPromise;
    _supportPromise = (async () => {
      try {
        if (!isSupported()) return false;
        if (window.isSecureContext === false) return false;
        if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch { return false; }
    })();
    return _supportPromise;
  }

  async function ensureCapable() {
    if (window.isSecureContext === false) throw err('insecure_context');
    if (!(await checkSupport())) throw err('unsupported');
  }

  // Is passkey autofill (conditional mediation) usable? Lets a returning reader's
  // synced passkey appear as a silent autofill suggestion — no modal, no QR.
  async function isConditionalMediationAvailable() {
    try {
      return !!(window.PublicKeyCredential
        && PublicKeyCredential.isConditionalMediationAvailable
        && await PublicKeyCredential.isConditionalMediationAvailable());
    } catch { return false; }
  }

  // ── Flow 1: registration ──────────────────────────────────────────────────
  // Pure primitive: takes the name + recovery email, performs the WebAuthn
  // create ceremony, persists the new reader. The UI (or promptRegister below)
  // owns the inputs. Email is collected here so a reader who later loses every
  // passkey can recover via an emailed link.
  async function register(firstName, lastName, email) {
    await ensureCapable();
    const first = String(firstName || '').trim();
    const last  = String(lastName || '').trim();
    const mail  = String(email || '').trim();
    if (!first || !last) throw err('missing_name');
    if (!looksLikeEmail(mail)) throw err('missing_email');

    const begin = await postJSON('/readers/register/begin',
      { firstName: first, lastName: last, email: mail }, { retries: 1, timeout: 45000 });
    if (!begin || !begin.challengeId || !begin.options) throw err('bad_response');

    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: prepCreationOptions(begin.options) });
    } catch (e) { throw mapCeremonyError(e, 'register'); }
    if (!cred) throw err('passkey_cancelled');

    const done = await postJSON('/readers/register/complete',
      { challengeId: begin.challengeId, credential: encodeAttestation(cred) }, { retries: 0, timeout: 30000 });
    if (!done || !done.readerId) throw err('bad_response');

    if (done.actionToken) setToken(done.actionToken); // server mints one on register — no second prompt
    return storeReader(done);
  }

  // ── Flows 2 & 3: authentication ───────────────────────────────────────────
  // handle present → reauth (Flow 2); handle null → discoverable (Flow 3, the
  // browser picks the passkey). Both return a fresh action token and refresh
  // the stored identity.
  async function authenticate(handle) {
    await ensureCapable();

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
  // Never shows the name form — used for writes by readers who already exist.
  function signIn() {
    return isRegistered() ? reauth() : signInWithPasskey();
  }

  // Reader entry point — the one place that may register. No QR, ever:
  //   1. This browser knows the reader (reader_handle in localStorage) → reauth,
  //      a targeted get() by credential id → Face/Touch ID, no QR.
  //   2. This browser doesn't → open the modal, which runs passkey AUTOFILL
  //      (conditional mediation) alongside the name form. A returning reader on a
  //      fresh browser sees their synced passkey as a silent suggestion → one tap
  //      signs them in (no QR). A true first-timer types their name and registers.
  async function signInOrRegister() {
    // Known device → reauth with the stored handle (one Face/Touch ID, no name
    // form). If the stored identity is STALE (server reader/credential gone),
    // clear it and fall through to registration instead of dead-ending on an
    // error — "smart enough to register one if it doesn't exist".
    if (isRegistered()) {
      try {
        return await reauth();
      } catch (e) {
        const c = e && e.code;
        const stale = c === 'reader_not_found' || c === 'credential_not_found' || c === 'not_registered' || (e && e.status === 404);
        if (!stale) throw e;          // genuine cancel / verify failure → surface it
        clearReader();                // stale identity — re-register below
      }
    }
    // New / cleared device → the modal: passkey autofill (a returning reader on a
    // fresh browser taps their synced passkey) OR registration (a true first-timer
    // types their name). Registration now returns an action token directly.
    const res = await promptRegister({ conditional: true });
    if (res && res.signedIn) {
      return { actionToken: res.actionToken, readerId: res.readerId, handle: res.handle, displayName: res.displayName };
    }
    // Registered via the form — register() already minted the action token.
    const tok = getActionToken();
    const r = getReader();
    if (tok && r) return { actionToken: tok, readerId: r.readerId, handle: r.handle, displayName: r.displayName };
    return reauth(); // fallback for an older server that didn't return a token
  }

  // Reauth against a SPECIFIC handle (e.g. a leaderboard's owner handle from the
  // URL) without relying on localStorage. Still a targeted, non-discoverable
  // get() → no QR. Only the holder of that handle's passkey can pass.
  function signInAs(handle) {
    return handle ? authenticate(handle) : signInOrRegister();
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

  // ── Flow 4: add a device (register an extra passkey while signed in) ────────
  // Prove an existing passkey (fresh action token), then run a create() ceremony
  // bound to the same account. Two prompts: existing passkey, then the new one.
  async function addDevice() {
    await ensureCapable();
    const token = await ensureActionToken({ forceFresh: true });
    const begin = await postJSON('/readers/credentials/add/begin', {},
      { retries: 1, timeout: 45000, headers: { Authorization: `Bearer ${token}` } });
    if (!begin || !begin.challengeId || !begin.options) throw err('bad_response');

    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: prepCreationOptions(begin.options) });
    } catch (e) { throw mapCeremonyError(e, 'register'); }
    if (!cred) throw err('passkey_cancelled');

    const token2 = await ensureActionToken(); // reuse the in-memory token, no re-prompt
    const done = await postJSON('/readers/credentials/add/complete',
      { challengeId: begin.challengeId, credential: encodeAttestation(cred) },
      { retries: 0, timeout: 30000, headers: { Authorization: `Bearer ${token2}` } });
    if (!done || !done.credentialAdded) throw err('bad_response');
    if (done.actionToken) setToken(done.actionToken);
    storeReader(done);
    return done;
  }

  // ── Profile photo: upload / replace on a signed-in account ─────────────────
  // Sends the image as multipart (FormData) with a fresh action token. Resolves
  // with { ok, handle, photoUrl }.
  async function setPhoto(file) {
    if (!file) throw err('no_file');
    const token = await ensureActionToken();
    const fd = new FormData();
    fd.append('photo', file, file.name || 'photo');
    let res;
    try {
      res = await fetchWithTimeout(`${API}/readers/photo`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }, 45000);
    } catch { throw err('network'); }
    if (res.ok) { try { return await res.json(); } catch { throw err('bad_response', res.status); } }
    let bj = {}; try { bj = await res.json(); } catch {}
    const code = bj.code;
    if (code && (CODE_MESSAGES[code] || LOCAL_MESSAGES[code])) throw err(code, res.status);
    throw new ReaderAuthError(code || `http_${res.status}`, bj.error || `Upload failed (${res.status})`, res.status);
  }

  // ── Recovery email: set / update on a signed-in account ────────────────────
  // Used to add a recovery email to an account that predates the feature, or to
  // change it. Prompts the passkey (ensureActionToken) if no fresh token.
  async function setRecoveryEmail(email) {
    const mail = String(email || '').trim();
    if (!looksLikeEmail(mail)) throw err('missing_email');
    const token = await ensureActionToken();
    const done = await postJSON('/readers/email', { email: mail },
      { retries: 0, timeout: 30000, headers: { Authorization: `Bearer ${token}` } });
    if (!done || !done.ok) throw err('bad_response');
    return done;
  }

  // ── Flow 5: account recovery (lost every passkey) ──────────────────────────
  // Step 1 (any device): email a one-time link. Always resolves with a generic
  // ok — it never reveals whether the handle/email matched.
  async function requestRecovery(handle, email) {
    const h = String(handle || '').trim().toLowerCase();
    const mail = String(email || '').trim();
    if (!h) throw err('not_registered');
    if (!looksLikeEmail(mail)) throw err('missing_email');
    const done = await postJSON('/readers/recover/request', { handle: h, email: mail },
      { retries: 1, timeout: 45000 });
    return done || { ok: true };
  }

  // Step 2 (on the link's device): validate the token, then create a new passkey
  // for the account. Called by recover.html with the rid + token from the URL.
  async function completeRecovery({ readerId, token } = {}) {
    await ensureCapable();
    const begin = await postJSON('/readers/recover/begin', { readerId, token },
      { retries: 1, timeout: 45000 });
    if (!begin || !begin.challengeId || !begin.options) throw err('bad_response');

    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: prepCreationOptions(begin.options) });
    } catch (e) { throw mapCeremonyError(e, 'register'); }
    if (!cred) throw err('passkey_cancelled');

    const done = await postJSON('/readers/recover/complete',
      { challengeId: begin.challengeId, credential: encodeAttestation(cred) },
      { retries: 0, timeout: 30000 });
    if (!done || !done.actionToken) throw err('bad_response');
    setToken(done.actionToken);
    storeReader(done);
    return done;
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

  // The brand-styled modal. With { conditional: true } it ALSO runs passkey
  // autofill (conditional mediation) anchored to the name field: a returning
  // reader's synced passkey appears as a silent suggestion — one tap signs them
  // in (no QR, no typing) and the promise resolves with { signedIn: true, ... };
  // a new reader types their name and the promise resolves with the reader.
  async function promptRegister(opts = {}) {
    if (!(await checkSupport())) throw err('unsupported');
    const conditional = !!opts.conditional
      && typeof AbortController !== 'undefined'
      && await isConditionalMediationAvailable();

    return new Promise((resolve, reject) => {
      injectStyles();

      const back = document.createElement('div');
      back.className = 'ra-back';
      back.innerHTML = `
        <div class="ra-card" role="dialog" aria-modal="true" aria-label="Sign in or register as a reader">
          <div class="ra-title">${conditional ? 'Sign in or register' : 'Register'}</div>
          <div class="ra-sub">${conditional
            ? "Returning reader? Choose your saved passkey. New here? Enter your name to create one — Touch ID, Face ID, Windows Hello, or your screen lock, no password."
            : "Create your reader passkey. You'll use Touch ID, Face ID, Windows Hello, or your device's screen lock — no password to remember."}</div>
          <div class="ra-field">
            <label for="ra-first">First name</label>
            <input id="ra-first" type="text" autocomplete="${conditional ? 'username webauthn' : 'given-name'}" placeholder="First name">
          </div>
          <div class="ra-field">
            <label for="ra-last">Last name</label>
            <input id="ra-last" type="text" autocomplete="family-name" placeholder="Last name">
          </div>
          <div class="ra-field">
            <label for="ra-email">Email <span style="color:#555;text-transform:none;letter-spacing:0;">— to recover your account</span></label>
            <input id="ra-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com">
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
      const emailEl = back.querySelector('#ra-email');
      const errEl  = back.querySelector('#ra-err');
      const goBtn  = back.querySelector('#ra-go');
      const goText = back.querySelector('.ra-go-text');
      const cancel = back.querySelector('#ra-cancel');
      let busy = false, done = false;
      const condAC = conditional ? new AbortController() : null;

      function close(result, error) {
        if (done) return;
        done = true;
        if (condAC) { try { condAC.abort(); } catch {} }
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        if (error) reject(error); else resolve(result);
      }
      function bail() { if (!busy) close(null, err('passkey_cancelled')); }

      async function go() {
        if (busy) return;
        errEl.textContent = '';
        const f = first.value.trim(), l = last.value.trim(), m = emailEl.value.trim();
        if (!f || !l) { errEl.textContent = LOCAL_MESSAGES.missing_name; (f ? last : first).focus(); return; }
        if (!looksLikeEmail(m)) { errEl.textContent = LOCAL_MESSAGES.missing_email; emailEl.focus(); return; }
        if (condAC) { try { condAC.abort(); } catch {} } // stop autofill before creating

        busy = true;
        goBtn.classList.add('busy'); goBtn.disabled = true; cancel.disabled = true;
        goText.textContent = 'Creating passkey';
        first.disabled = last.disabled = emailEl.disabled = true;
        try {
          const reader = await register(f, l, m);
          close(reader, null);
        } catch (e) {
          busy = false;
          goBtn.classList.remove('busy'); goBtn.disabled = false; cancel.disabled = false;
          goText.textContent = 'Create passkey';
          first.disabled = last.disabled = emailEl.disabled = false;
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

      // Passkey autofill — best-effort; registration stays available regardless.
      if (conditional) startConditional();

      async function startConditional() {
        try {
          const begin = await postJSON('/readers/auth/begin', {}, { retries: 0, timeout: 30000 });
          if (done || !begin || !begin.challengeId || !begin.options) return;

          let cred;
          try {
            cred = await navigator.credentials.get({
              publicKey: prepRequestOptions(begin.options),
              mediation: 'conditional',
              signal: condAC.signal,
            });
          } catch { return; } // aborted (registered/cancelled) or dismissed — stay silent
          if (done || !cred) return;

          const completed = await postJSON('/readers/auth/complete',
            { challengeId: begin.challengeId, credential: encodeAssertion(cred) }, { retries: 0, timeout: 30000 });
          if (done || !completed || !completed.actionToken) return;

          setToken(completed.actionToken);
          storeReader(completed);
          close({
            signedIn: true,
            actionToken: completed.actionToken,
            readerId: completed.readerId,
            handle: completed.handle,
            displayName: completed.displayName,
          }, null);
        } catch { /* conditional UI is best-effort */ }
      }
    });
  }

  // ── public surface ────────────────────────────────────────────────────────
  window.ReaderAuth = {
    API,
    ReaderAuthError,
    CODES: CODE_MESSAGES,

    // capability
    isSupported,                  // sync: is the WebAuthn API present at all?
    checkSupport,                 // async STEP 0: platform authenticator actually available?
    UNSUPPORTED_MESSAGE,

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
    promptRegister,    // modal; { conditional:true } adds passkey autofill (sign-in or register)
    reauth,            // Flow 2: returning reader, stored handle
    signInWithPasskey, // Flow 3: discoverable, no handle
    signIn,            // smart: reauth if registered, else discoverable (never registers)
    signInOrRegister,  // reauth if known browser, else register form — no discoverable, no QR
    signInAs,          // reauth against a specific handle (leaderboard owner) — no QR

    // device + recovery management
    addDevice,         // register an additional passkey on this account (signed in)
    setRecoveryEmail,  // add/update the recovery email (signed in)
    setPhoto,          // upload/replace the profile photo (signed in)
    requestRecovery,   // email a one-time recovery link (handle + email)
    completeRecovery,  // consume a recovery link → new passkey (used by recover.html)

    // protected writes (leaderboard)
    authedWrite,
  };
})();
