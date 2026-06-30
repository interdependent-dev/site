/* ============================================================================
 * INTERDEPENDENT — Role XP bar
 * One role, one number. The bar is a single continuous gradient of commitment
 * (light gray → white → red); the XP NUMBER is the identity. A newbie reads
 * differently from a committed member at a glance — same role, different
 * standing. Line-icon dividers mark where perks unlock; a lock marks a perk
 * whose action-gate isn't met yet.
 *
 * Generic across roles — Reader today, and the same bar for Executive Producer,
 * Producer, Scriptographer, Director, Actor, … only the role name + number change.
 *
 * Branded: self-hosts Eurostile Next Pro (the role + number render in it) and
 * uses a stroke line-icon set (currentColor) matching the portal's other icons —
 * no emoji. No dependencies. Dark theme. Honors prefers-reduced-motion.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var API_DEFAULT = 'https://interdependent-api.onrender.com';
  function apiBase() {
    return global.IDP_API_BASE || (global.ReaderAuth && global.ReaderAuth.API) || API_DEFAULT;
  }

  // Per-handle memory of which perks were already unlocked, so sync() can detect
  // the MOMENT a new one unlocks and fire the level-up celebration (and only then).
  var _seen = {};

  // ── Sound (Web Audio, synthesized — no files) ───────────────────────────────
  // A bright coin/ping for an XP gain; a boom + ascending fanfare + sparkle for a
  // perk unlock. Default ON; silence with window.IDP_XP_SOUND=false or
  // XpBar.setSound(false). Only plays while the tab is visible. Gesture-triggered
  // (an action), so the autoplay policy is satisfied.
  var _actx = null, _soundOn = true;
  function audioCtx() {
    if (_actx) return _actx;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) _actx = new AC();
    } catch (e) { _actx = null; }
    return _actx;
  }
  function soundEnabled() {
    if (global.IDP_XP_SOUND === false || !_soundOn) return false;
    if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return false;
    return true;
  }
  // One enveloped oscillator note. opts: {type, freq, freqEnd, t, dur, vol, attack}
  function tone(ctx, dest, opts) {
    var t0 = ctx.currentTime + (opts.t || 0);
    var o = ctx.createOscillator();
    o.type = opts.type || 'triangle';
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + opts.dur);
    var g = ctx.createGain();
    var v = opts.vol == null ? 0.18 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (opts.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + opts.dur + 0.03);
  }
  // Reusable white-noise buffer for explosion texture.
  var _noiseBuf = null;
  function noiseBuffer(ctx) {
    if (_noiseBuf && _noiseBuf.sampleRate === ctx.sampleRate) return _noiseBuf;
    var len = Math.floor(ctx.sampleRate * 1.2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    _noiseBuf = buf;
    return _noiseBuf;
  }
  // A filtered noise hit — the crack/rumble/crackle of an explosion.
  function noiseHit(ctx, dest, opts) {
    var t0 = ctx.currentTime + (opts.t || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    var f = ctx.createBiquadFilter();
    f.type = opts.type || 'lowpass';
    f.frequency.setValueAtTime(opts.freq || 800, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t0 + opts.dur);
    if (opts.q) f.Q.value = opts.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.vol == null ? 0.2 : opts.vol, t0 + (opts.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }
  // A short synthesized reverb (exponentially-decaying noise impulse) — gives the
  // explosions AIR and distance, the difference between "in the sky" and "in a room".
  var _reverb = null;
  function reverbNode(ctx) {
    if (_reverb && _reverb.context === ctx) return _reverb;
    var len = Math.floor(ctx.sampleRate * 1.9);
    var ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    var c = ctx.createConvolver();
    c.buffer = ir;
    _reverb = c;
    return _reverb;
  }
  // A real aerial firework explosion — NOISE-based, no tonal kick. A sharp crack,
  // a broadband air-boom whose lowpass closes as it decays, a no-pitch sub rumble,
  // a delayed roll/echo, and the stars crackling. `pitch`/`vol` vary per burst.
  function boom(ctx, out, t, vol, pitch) {
    t = t || 0; vol = vol == null ? 0.55 : vol; pitch = pitch || 1;
    // sharp crack — the shell bursting
    noiseHit(ctx, out, { t: t, dur: 0.035, vol: 0.5 * vol, type: 'highpass', freq: 3000, freqEnd: 1500, attack: 0.001 });
    // the air-boom body — broadband noise, lowpass closing as it decays
    noiseHit(ctx, out, { t: t, dur: 0.62, vol: 0.5 * vol, type: 'lowpass', freq: 1100 * pitch, freqEnd: 110, attack: 0.005 });
    // sub rumble — low, NO clear pitch (reads as "air", not a drum)
    noiseHit(ctx, out, { t: t, dur: 0.95, vol: 0.32 * vol, type: 'lowpass', freq: 170, freqEnd: 46, attack: 0.012 });
    // the roll / echo across the sky — softer, slightly delayed
    noiseHit(ctx, out, { t: t + 0.14, dur: 0.55, vol: 0.15 * vol, type: 'lowpass', freq: 520, freqEnd: 80, attack: 0.03 });
    // crackle — the stars popping
    var pops = 16 + (Math.random() * 8 | 0);
    for (var i = 0; i < pops; i++) {
      noiseHit(ctx, out, { t: t + 0.05 + Math.random() * 0.85, dur: 0.018 + Math.random() * 0.022, vol: (0.04 + Math.random() * 0.05) * vol, type: 'bandpass', freq: 2200 + Math.random() * 4500, q: 14, attack: 0.001 });
    }
  }
  function withCtx(fn) {
    if (!soundEnabled()) return;
    var ctx = audioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    var master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    fn(ctx, master);
  }
  // One wave of the sparkle shower: two lead notes + a scatter of high shimmer.
  function sparkleWave(ctx, out, t0, count, vol) {
    var shimmer = [1568, 1760, 2093, 2637, 3136, 2349, 1976, 1318.5]; // G6 A6 C7 E7 G7 D7 B6 E6
    tone(ctx, out, { type: 'triangle', freq: 880, dur: 0.07, vol: vol * 3, t: t0 });
    tone(ctx, out, { type: 'triangle', freq: 1318.5, dur: 0.11, vol: vol * 3, t: t0 + 0.05 });
    for (var i = 0; i < count; i++) {
      var f = shimmer[(Math.random() * shimmer.length) | 0];
      tone(ctx, out, { type: 'sine', freq: f, dur: 0.06 + Math.random() * 0.05, vol: vol + Math.random() * 0.025, t: t0 + 0.02 + i * 0.03 + Math.random() * 0.02 });
    }
  }
  // Matches the DOUBLE confetti burst: a soft party-popper "poof", then two sparkle
  // waves timed to the two bursts (~0 and ~260ms).
  function gainSound() {
    withCtx(function (ctx, out) {
      noiseHit(ctx, out, { t: 0, dur: 0.11, vol: 0.16, type: 'highpass', freq: 1400, freqEnd: 3200, attack: 0.002 }); // poof (air)
      noiseHit(ctx, out, { t: 0, dur: 0.14, vol: 0.08, type: 'lowpass', freq: 420, freqEnd: 110, attack: 0.004 }); // poof (body)
      sparkleWave(ctx, out, 0.0, 8, 0.05); // wave 1
      sparkleWave(ctx, out, 0.26, 6, 0.038); // wave 2
    });
  }

  // The commitment gradient: dim (newbie) → bright → brand red (committed).
  var GRADIENT = 'linear-gradient(90deg, #8a93a3 0%, #e9edf2 50%, #FF0000 100%)';

  // Branded line-icon set (24×24, stroke, currentColor) — Lucide-derived, matching
  // the portal's existing reader/chevron icons. Keyed by the semantic reward icon.
  var ICONS = {
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    ticket:
      '<path d="M2 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z"/>',
    vote: '<path d="m9 12 2 2 4-4"/><path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5Z"/><path d="M22 19H2"/>',
    credit:
      '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    spark: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  };
  function icon(name, cls) {
    var p = ICONS[name] || ICONS.spark;
    return (
      '<svg class="idxp-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'
    );
  }

  var GATE_VERB = {
    reads: 'verified read',
    feedbacks: 'feedback',
    champions: 'champion',
    recsLanded: 'landed recommend',
    earlySpots: 'early spot',
    featuredRead: 'read of The Carrier',
    featuredFeedback: 'feedback on The Carrier',
  };
  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : word.charAt(word.length - 1) === 'h' ? 'es' : 's');
  }
  function unmetText(unmet) {
    if (!unmet || !unmet.length) return '';
    return unmet
      .map(function (u) { return plural(Math.max(0, u.need - u.have), GATE_VERB[u.key] || u.key); })
      .join(' + ');
  }

  var STYLE_ID = 'idxp-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      // Branded type — self-host so the bar is correct anywhere it's dropped.
      '@font-face{font-family:"Eurostile";src:url("/fonts/EurostileNextPro-Regular.ttf") format("truetype");font-weight:400;font-display:swap}' +
      '@font-face{font-family:"Eurostile";src:url("/fonts/EurostileNextPro-Bold.ttf") format("truetype");font-weight:700;font-display:swap}' +
      '@font-face{font-family:"Eurostile Wide";src:url("/fonts/EurostileNextPro-WideBold.ttf") format("truetype");font-weight:700;font-display:swap}' +
      '.idxp{font-family:"Eurostile","Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;width:100%;--idxp-surface:#0a0a0a}' +
      '.idxp *{box-sizing:border-box}' +
      '.idxp-ic{display:block}' +
      '.idxp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:9px}' +
      '.idxp-role{font-family:"Eurostile",sans-serif;font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#b9b9b9}' +
      '.idxp-num{font-family:"Eurostile Wide","Eurostile",sans-serif;font-weight:700;line-height:1;color:#fff;white-space:nowrap;display:flex;align-items:baseline;gap:5px}' +
      '.idxp-num .n{font-size:27px;letter-spacing:.005em}' +
      '.idxp-num .u{font-family:"Eurostile",sans-serif;font-size:12px;color:#8a8a8a;letter-spacing:.14em}' +
      '.idxp-bar{position:relative;padding-top:18px}' +
      '.idxp-marks{position:absolute;left:0;right:0;top:0;height:15px}' +
      '.idxp-mark{position:absolute;top:1px;transform:translateX(-50%);line-height:0;color:rgba(255,255,255,.32);transition:color .3s}' +
      '.idxp-mark .idxp-ic{width:13px;height:13px}' +
      '.idxp-mark.earned{color:#FF0000;filter:drop-shadow(0 0 5px rgba(255,0,0,.45))}' +
      '.idxp-mark.locked{color:#FFD600}' +
      '.idxp-track{position:relative;height:15px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:var(--idxp-surface)}' +
      '.idxp-grad{position:absolute;inset:0;border-radius:inherit}' +
      '.idxp-veil{position:absolute;top:0;bottom:0;right:0;background:rgba(8,8,8,.72);transition:left .9s cubic-bezier(.22,1,.36,1)}' +
      '.idxp-div{position:absolute;top:2px;bottom:2px;width:1px;background:rgba(0,0,0,.45);box-shadow:1px 0 0 rgba(255,255,255,.16)}' +
      '.idxp-edge{position:absolute;top:-1px;bottom:-1px;width:2px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.7);transition:left .9s cubic-bezier(.22,1,.36,1)}' +
      '.idxp-foot{margin-top:10px;font-size:11.5px;color:#9a9a9a;line-height:1.45;display:flex;align-items:center;gap:7px}' +
      '.idxp-foot .idxp-fic{flex-shrink:0;color:#cfcfcf}.idxp-foot .idxp-fic .idxp-ic{width:14px;height:14px}' +
      '.idxp-foot.lk .idxp-fic{color:#FFD600}' +
      '.idxp-foot b{color:#e6e6e6;font-weight:700}' +
      '.idxp-foot .lk{color:#FFD600}' +
      '.idxp-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}' +
      '.idxp-badge{font-family:"Eurostile",sans-serif;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#cbb26a;border:1px solid #3a341e;background:#15120a;border-radius:10px;padding:2px 8px;font-weight:700}' +
      // info button in the bar header
      '.idxp-rolewrap{display:flex;align-items:center;gap:7px}' +
      '.idxp-info{background:none;border:none;padding:0;margin:0;color:#6f6f6f;cursor:pointer;line-height:0;transition:color .15s}.idxp-info:hover{color:#FF0000}.idxp-info .idxp-ic{width:13px;height:13px}' +
      // explainer overlay
      '.idxp-guide-back{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.82);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow:auto}' +
      '.idxp-guide{font-family:"Eurostile","Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;width:100%;max-width:560px;background:#0b0b0b;border:1px solid #242424;border-radius:14px;padding:24px 26px 30px;box-shadow:0 30px 90px rgba(0,0,0,.75);animation:idxp-guidein .26s cubic-bezier(.22,1,.36,1)}' +
      '@keyframes idxp-guidein{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}' +
      '.idxp-g-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}' +
      '.idxp-guide h2{font-family:"Eurostile Wide","Eurostile",sans-serif;font-size:17px;letter-spacing:.05em;text-transform:uppercase;margin:0}' +
      '.idxp-g-x{background:none;border:1px solid #333;color:#aaa;width:30px;height:30px;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;font-family:Arial,Helvetica,sans-serif;padding:0;flex-shrink:0}.idxp-g-x:hover{border-color:#777;color:#fff}' +
      '.idxp-g-intro{color:#a8a8a8;font-size:13px;line-height:1.6;margin:8px 0 4px}.idxp-g-intro b{color:#e8e8e8}' +
      '.idxp-guide h3{font-family:"Eurostile",sans-serif;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:#FF0000;margin:22px 0 10px;font-weight:700}' +
      '.idxp-g-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:8px 0;border-top:1px solid #161616;font-size:13px}.idxp-g-row:first-of-type{border-top:none}' +
      '.idxp-g-l{color:#e6e6e6;font-weight:600}.idxp-g-sub{display:block;color:#888;font-weight:400;font-size:11.5px;margin-top:2px;max-width:340px;line-height:1.45}' +
      '.idxp-g-v{font-family:"Courier New",monospace;color:#FF0000;font-weight:700;white-space:nowrap;flex-shrink:0}' +
      '.idxp-g-bd{color:#999;font-size:12px;text-align:right;max-width:300px;line-height:1.45}' +
      '.idxp-g-perk{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid #161616}.idxp-g-perk:first-of-type{border-top:none}' +
      '.idxp-g-ic{color:#FFD600;line-height:0;flex-shrink:0}.idxp-g-ic .idxp-ic{width:18px;height:18px}' +
      '.idxp-g-plabel{color:#fff;font-weight:700;font-size:13px;line-height:1.35}.idxp-g-preq{color:#8f8f8f;font-size:11.5px;margin-top:2px}' +
      '.idxp-g-tag{font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:#FFD600;border:1px solid #5a4a12;border-radius:8px;padding:1px 6px;margin-left:4px;vertical-align:middle;white-space:nowrap}' +
      '.idxp-g-credit{display:flex;gap:12px;margin-top:14px;padding:14px;border:1px solid #4a3f12;background:#13110a;border-radius:10px;font-size:12.5px;line-height:1.55;color:#cfcfcf}.idxp-g-credit b{color:#fff}.idxp-g-credit .idxp-g-ic .idxp-ic{width:20px;height:20px}' +
      '.idxp-g-loading{color:#888;text-align:center;padding:30px}' +
      // gain toast
      '.idxp-toast-wrap{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}' +
      '.idxp-toast{background:rgba(8,8,8,.96);border:1px solid #FF0000;border-radius:999px;padding:9px 18px;display:flex;align-items:center;gap:9px;box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 18px rgba(255,0,0,.25);animation:idxp-rise 2.4s cubic-bezier(.22,1,.36,1) forwards;font-family:"Eurostile","Helvetica Neue",sans-serif}' +
      '.idxp-toast .amt{font-family:"Eurostile Wide","Eurostile",sans-serif;font-weight:700;color:#FF0000;font-size:15px}' +
      '.idxp-toast .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#ddd}' +
      '@keyframes idxp-rise{0%{opacity:0;transform:translateY(14px) scale(.92)}12%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-12px)}}' +
      // level-up banner — the PERK UNLOCKED payoff (gold, bigger)
      '.idxp-levelup{background:linear-gradient(180deg,#1a1407,#0b0b0b);border:1px solid #FFD600;border-radius:14px;padding:13px 22px;display:flex;align-items:center;gap:13px;box-shadow:0 12px 44px rgba(0,0,0,.6),0 0 28px rgba(255,214,0,.32);animation:idxp-pop 3.8s cubic-bezier(.22,1,.36,1) forwards;font-family:"Eurostile","Helvetica Neue",sans-serif}' +
      '.idxp-levelup .lu-ic{color:#FFD600;line-height:0}.idxp-levelup .lu-ic .idxp-ic{width:24px;height:24px}' +
      '.idxp-levelup .lu-txt{display:flex;flex-direction:column;gap:2px}' +
      '.idxp-levelup .lu-eyebrow{font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#FFD600;font-weight:700;font-family:"Eurostile",sans-serif}' +
      '.idxp-levelup .lu-label{font-family:"Eurostile Wide","Eurostile",sans-serif;font-size:14px;font-weight:700;color:#fff;letter-spacing:.01em}' +
      '@keyframes idxp-pop{0%{opacity:0;transform:translateY(18px) scale(.8)}10%{opacity:1;transform:translateY(0) scale(1.05)}16%{transform:scale(1)}88%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-14px)}}' +
      '@media (prefers-reduced-motion:reduce){.idxp-veil,.idxp-edge{transition:none}.idxp-toast{animation:idxp-fade 2.4s linear forwards}.idxp-levelup{animation:idxp-fade 3.8s linear forwards}}' +
      '@keyframes idxp-fade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}';
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // Perk milestones along the bar = the reward thresholds (min>0, within range).
  function milestonesOf(xp) {
    return (xp.levels || [])
      .filter(function (l) { return l.min > 0 && l.min <= xp.barMax; })
      .map(function (l) {
        return {
          pos: (l.min / xp.barMax) * 100,
          min: l.min,
          icon: (l.reward && l.reward.icon) || 'spark',
          label: (l.reward && l.reward.label) || '',
          reached: xp.totalXp >= l.min,
          gateMet: l.gateMet !== false,
        };
      });
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /**
   * Render the role XP bar for one payload into `target`.
   * opts: { compact, showReward, showBadges, animate, role }.
   */
  function render(target, xp, opts) {
    if (!target || !xp) return;
    opts = opts || {};
    injectStyles();
    var role = opts.role || xp.role || 'Reader';
    var barMax = xp.barMax || 1;
    var fillPct = Math.max(0, Math.min(100, (xp.totalXp / barMax) * 100));
    var marks = milestonesOf(xp);
    var compact = !!opts.compact;

    var root = el('div', 'idxp');
    root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(barMax));
    root.setAttribute('aria-valuenow', String(xp.totalXp || 0));
    root.setAttribute('aria-label', role + ' — ' + (xp.totalXp || 0) + ' XP');

    // headline: ROLE (+ an ⓘ "how it works") · big XP number (the identity)
    var head = el('div', 'idxp-head');
    var left = el('div', 'idxp-rolewrap');
    left.appendChild(el('span', 'idxp-role', esc(role)));
    if (!compact && opts.guide !== false) {
      var ib = el('button', 'idxp-info', icon('info'));
      ib.type = 'button';
      ib.title = 'How Reader XP works';
      ib.setAttribute('aria-label', 'How Reader XP works');
      ib.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openGuide(); });
      left.appendChild(ib);
    }
    head.appendChild(left);
    head.appendChild(el('span', 'idxp-num', '<span class="n">' + fmt(xp.totalXp || 0) + '</span><span class="u">XP</span>'));
    root.appendChild(head);

    // the bar: marks row + gradient track + veil + dividers + edge
    var bar = el('div', 'idxp-bar');
    var marksRow = el('div', 'idxp-marks');
    var track = el('div', 'idxp-track');
    track.appendChild(el('div', 'idxp-grad')).style.background = GRADIENT;

    var veil = el('div', 'idxp-veil');
    veil.dataset.left = fillPct.toFixed(2) + '%';
    veil.style.left = opts.animate ? '0%' : veil.dataset.left;
    track.appendChild(veil);

    marks.forEach(function (m) {
      var d = el('div', 'idxp-div');
      d.style.left = m.pos.toFixed(2) + '%';
      track.appendChild(d);
      var locked = m.reached && !m.gateMet;
      var earned = m.reached && m.gateMet;
      var mk = el('div', 'idxp-mark' + (earned ? ' earned' : locked ? ' locked' : ''), icon(locked ? 'lock' : m.icon));
      mk.style.left = m.pos.toFixed(2) + '%';
      if (m.label) mk.title = (locked ? 'Locked — ' : '') + m.label + ' · ' + m.min + ' XP';
      marksRow.appendChild(mk);
    });

    var edge = el('div', 'idxp-edge');
    edge.dataset.left = fillPct.toFixed(2) + '%';
    edge.style.left = opts.animate ? '0%' : edge.dataset.left;
    track.appendChild(edge);

    bar.appendChild(marksRow);
    bar.appendChild(track);
    root.appendChild(bar);

    var wantReward = opts.showReward != null ? opts.showReward : !compact;
    if (wantReward) root.appendChild(footer(xp));

    if (opts.showBadges && xp.badges && xp.badges.length) {
      var bw = el('div', 'idxp-badges');
      xp.badges.forEach(function (b) { bw.appendChild(el('span', 'idxp-badge', esc(badgeName(b)))); });
      root.appendChild(bw);
    }

    target.innerHTML = '';
    target.appendChild(root);

    if (opts.animate) {
      requestAnimationFrame(function () {
        veil.style.left = veil.dataset.left;
        edge.style.left = edge.dataset.left;
      });
    }
    return root;
  }

  // The next perk and what unlocks it.
  function footer(xp) {
    var next = xp.nextLevel;
    if (!next) {
      var f0 = el('div', 'idxp-foot');
      f0.innerHTML = '<span class="idxp-fic">' + icon('spark') + '</span><span>Fully committed — every perk unlocked.</span>';
      return f0;
    }
    var nlv = (xp.levels || []).find(function (l) { return l.key === next.key; }) || {};
    var reward = nlv.reward || {};
    var ic = reward.icon || 'spark';
    var gateBlocked = next.gateMet === false && xp.totalXp >= next.min;
    var f = el('div', 'idxp-foot' + (gateBlocked ? ' lk' : ''));
    if (gateBlocked) {
      f.innerHTML =
        '<span class="idxp-fic">' + icon('lock') + '</span><span><span class="lk"><b>' + esc(unmetText(next.unmet)) +
        '</b></span> to unlock <b>' + esc(reward.label || '') + '</b></span>';
    } else {
      var toGo = next.xpToGo != null ? next.xpToGo : Math.max(0, next.min - (xp.totalXp || 0));
      f.innerHTML =
        '<span class="idxp-fic">' + icon(ic) + '</span><span><b>' + fmt(toGo) +
        ' XP</b> to your next perk — <b>' + esc(reward.label || '') + '</b></span>';
    }
    return f;
  }

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Dependency-free canvas confetti — a brand-colored burst (red / white / gold)
  // for the dopamine hit on an XP gain. Bursts upward from `origin`, falls under
  // gravity, fades out, then removes its canvas. Honors prefers-reduced-motion.
  function confetti(opts) {
    opts = opts || {};
    if (reducedMotion()) return;
    var colors = opts.colors || ['#FF0000', '#ffffff', '#FFD600', '#ff5a5a', '#ff8a3d'];
    var count = Math.max(10, Math.min(220, opts.count || 90));
    var W = global.innerWidth, H = global.innerHeight;
    var origin = opts.origin || { x: W / 2, y: H - 96 };

    var cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9998';
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    if (!ctx) { if (cv.parentNode) cv.parentNode.removeChild(cv); return; } // canvas unavailable — skip the effect, never throw
    ctx.scale(dpr, dpr);

    var parts = [];
    for (var i = 0; i < count; i++) {
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95; // upward fan
      var speed = 6 + Math.random() * 9;
      parts.push({
        x: origin.x + (Math.random() - 0.5) * 46,
        y: origin.y,
        vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.9),
        vy: Math.sin(angle) * speed - Math.random() * 4,
        w: 5 + Math.random() * 6,
        h: 8 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.45,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
        ttl: 90 + Math.random() * 45,
      });
    }
    var gravity = 0.28, drag = 0.992, raf;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      var alive = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.life >= p.ttl) continue;
        p.life++;
        alive = true;
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(frame);
      else { cancelAnimationFrame(raf); if (cv.parentNode) cv.parentNode.removeChild(cv); }
    }
    raf = requestAnimationFrame(frame);
  }

  // Fireworks — the Perk Unlock ceremony. Deliberately DIFFERENT from the gain
  // confetti: glowing ROUND sparks exploding RADIALLY from several burst points
  // scattered across the whole screen (staggered), with additive glow + gravity.
  // (Confetti = rectangular paper fanning up from the chip; fireworks = sky-wide.)
  function fireworks(opts) {
    opts = opts || {};
    if (reducedMotion()) return;
    var W = global.innerWidth, H = global.innerHeight;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9998';
    cv.width = W * dpr;
    cv.height = H * dpr;
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    if (!ctx) { if (cv.parentNode) cv.parentNode.removeChild(cv); return; } // canvas unavailable — skip the effect, never throw
    ctx.scale(dpr, dpr);
    var TAU = Math.PI * 2;

    // Audio: a deep boom fires for EACH burst (iPhone-fireworks feel). Set up the
    // graph once; a soft launch whoosh leads the first explosion in.
    var actx = opts.boom && soundEnabled() ? audioCtx() : null;
    var aout = null;
    if (actx) {
      if (actx.state === 'suspended' && actx.resume) { try { actx.resume(); } catch (e) {} }
      aout = actx.createGain();
      aout.gain.value = 0.85;
      aout.connect(actx.destination); // dry
      // reverb send — puts the explosions "in the air"
      var conv = reverbNode(actx);
      var wet = actx.createGain();
      wet.gain.value = 0.45;
      aout.connect(conv);
      conv.connect(wet);
      wet.connect(actx.destination);
      // launch whistle — a rising shell on the way up, leading the first burst in
      tone(actx, aout, { type: 'sine', freq: 380, freqEnd: 1500, dur: 0.28, vol: 0.05 });
    }
    // each burst picks a [core, tint] pair → a multi-colored sky
    var palette = [
      ['#FF0000', '#ff7a7a'], ['#FFD600', '#fff1a8'], ['#ffffff', '#ffd9d9'],
      ['#ff8a3d', '#ffd2a6'], ['#ff3da0', '#ffc4e4'], ['#5ab0ff', '#cfe8ff'],
    ];
    var totalBursts = opts.bursts || 11;
    var parts = [];
    function burst() {
      var cx = W * (0.1 + Math.random() * 0.8);
      var cy = H * (0.1 + Math.random() * 0.52);
      var pair = palette[(Math.random() * palette.length) | 0];
      var n = 46 + (Math.random() * 42 | 0);
      var base = 2.4 + Math.random() * 4.2;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU;
        var sp = base * (0.4 + Math.random());
        parts.push({
          x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          r: 1.1 + Math.random() * 1.7,
          color: Math.random() < 0.72 ? pair[0] : pair[1],
          life: 0, ttl: 48 + Math.random() * 44,
        });
      }
      if (actx && aout) boom(actx, aout, 0, 0.42 + Math.random() * 0.34, 0.78 + Math.random() * 0.55);
    }
    var fired = 1;
    burst();
    var timer = setInterval(function () {
      burst();
      if (++fired >= totalBursts) { clearInterval(timer); timer = null; }
    }, 195 + Math.random() * 175); // a touch more spacing so each boom reads distinctly
    var gravity = 0.05, drag = 0.984, raf;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; // additive glow
      var alive = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.life >= p.ttl) continue;
        p.life++;
        alive = true;
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        var al = 1 - p.life / p.ttl;
        ctx.globalAlpha = al;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = al * 0.22; // halo
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive || timer) {
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
        ctx.globalCompositeOperation = 'source-over';
        if (cv.parentNode) cv.parentNode.removeChild(cv);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function toast(amount, label) {
    injectStyles();
    gainSound();
    var wrap = document.querySelector('.idxp-toast-wrap');
    if (!wrap) { wrap = el('div', 'idxp-toast-wrap'); document.body.appendChild(wrap); }
    var t = el('div', 'idxp-toast');
    t.innerHTML = '<span class="amt">' + esc(String(amount)) + '</span>' + (label ? '<span class="lbl">' + esc(label) + '</span>' : '');
    wrap.appendChild(t);
    // Dopamine: a DOUBLE confetti burst from the toast (200→150 at +55, the same
    // amount the level-up originally used), scaled by the size of the gain.
    var n = parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 0;
    var c1 = Math.max(60, Math.min(240, Math.round(n * 3.6)));
    confetti({ count: c1 });
    setTimeout(function () { confetti({ count: Math.round(c1 * 0.72) }); }, 240);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      if (wrap && !wrap.children.length && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 2500);
  }

  function fetchXp(handle, base) {
    var url = (base || apiBase()) + '/readers/' + encodeURIComponent(handle) + '/xp';
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // The PEAK moment: a perk just unlocked. A bigger, fuller confetti burst plus a
  // distinct gold "PERK UNLOCKED" banner naming the reward.
  function levelUp(reward) {
    injectStyles();
    fireworks({ bursts: 12, boom: true }); // sky-wide fireworks + a boom per burst
    var wrap = document.querySelector('.idxp-toast-wrap');
    if (!wrap) { wrap = el('div', 'idxp-toast-wrap'); document.body.appendChild(wrap); }
    var t = el('div', 'idxp-levelup');
    t.innerHTML =
      '<span class="lu-ic">' + icon((reward && reward.icon) || 'spark') + '</span>' +
      '<span class="lu-txt"><span class="lu-eyebrow">Perk unlocked</span>' +
      '<span class="lu-label">' + esc((reward && reward.label) || 'New perk') + '</span></span>';
    wrap.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      if (wrap && !wrap.children.length && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 3800);
  }

  function unlockedPerkKeys(xp) {
    var s = {};
    (xp.levels || []).forEach(function (l) { if (l.min > 0 && l.unlocked) s[l.key] = true; });
    return s;
  }

  // Fetch a reader's XP and, if a perk has newly unlocked since we last looked,
  // fire the level-up celebration. First call per handle just seeds the baseline
  // (so loading the page on an already-earned perk doesn't celebrate). Returns
  // the XP payload (or null). Use this in place of fetch() where actions happen.
  function sync(handle, opts) {
    opts = opts || {};
    return fetchXp(handle, opts.base).then(function (xp) {
      if (!xp) return null;
      var now = unlockedPerkKeys(xp);
      var prev = _seen[handle];
      // Normally the first observation per handle just seeds the baseline. But when
      // called right after an action (celebrateFirst), treat an empty baseline as
      // "nothing unlocked yet" so a brand-new reader whose very first action crosses
      // a perk threshold still gets the celebration.
      if (prev || opts.celebrateFirst) {
        var baseline = prev || {};
        var fresh = Object.keys(now).filter(function (k) { return !baseline[k]; });
        if (fresh.length) {
          var perks = (xp.levels || []).filter(function (l) { return fresh.indexOf(l.key) >= 0; });
          perks.sort(function (a, b) { return b.min - a.min; }); // celebrate the highest new one
          levelUp((perks[0] || {}).reward || {});
        }
      }
      _seen[handle] = now;
      return xp;
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Coerce to a number before formatting so a stray string in a numeric field can
  // never reach innerHTML as markup (defense-in-depth at the un-escaped sinks).
  function fmt(n) { return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var BADGE_NAMES = {
    'deep-reader': 'Deep Reader', 'early-spotter': 'Early Spotter', tastemaker: 'Tastemaker',
    calibrator: 'Calibrator', prolific: 'Prolific', connector: 'Connector',
  };
  function badgeName(k) { return BADGE_NAMES[k] || k; }

  // ── "How Reader XP works" explainer overlay (data-driven from /xp/config) ────
  var _guideCfg = null;
  function loadGuideConfig() {
    if (_guideCfg) return Promise.resolve(_guideCfg);
    return fetch(apiBase() + '/xp/config').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { _guideCfg = c; return c; }).catch(function () { return null; });
  }
  function gateReq(gate) {
    if (!gate) return 'Open to all';
    return Object.keys(gate).map(function (k) {
      var need = gate[k]; return need + ' ' + (GATE_VERB[k] || k) + (need === 1 ? '' : 's');
    }).join(' · ');
  }
  function earnRow(label, val, sub) {
    return '<div class="idxp-g-row"><div class="idxp-g-l">' + esc(label) +
      (sub ? '<span class="idxp-g-sub">' + esc(sub) + '</span>' : '') +
      '</div><div class="idxp-g-v">' + esc(val) + '</div></div>';
  }
  function guideBody(cfg) {
    var A = cfg.actions || {};
    var earn =
      earnRow('Read a script', '+' + A.read, 'finished — depth AND time, never a skim') +
      earnRow('Leave feedback', '+' + A.feedbackBase + ' → +' + cfg.feedbackMax, 'more thorough = more: rate the 1–5 dimensions, write notes, add a voice note') +
      earnRow('Champion a script', '+' + A.champion, 'back one you’d fight for') +
      earnRow('A recommend that’s opened', '+' + A.recommendOpened) +
      earnRow('…and that LANDS (a real read)', '+' + A.recommendLanded) +
      earnRow('Turn a recommend into a champion', '+' + A.recommendToChampion) +
      earnRow('Spot a film early', '+' + A.earlySpot, 'champion it before the crowd');
    var perks = (cfg.levels || []).filter(function (l) { return l.min > 0; }).map(function (l) {
      var r = l.reward || {};
      return '<div class="idxp-g-perk"><span class="idxp-g-ic">' + icon(r.icon) + '</span>' +
        '<div class="idxp-g-pmain"><div class="idxp-g-plabel">' + esc(r.label || '') +
        (l.competitive ? ' <span class="idxp-g-tag">competitive</span>' : '') + '</div>' +
        '<div class="idxp-g-preq">' + fmt(l.min) + ' XP · needs ' + esc(gateReq(l.gate)) + '</div></div></div>';
    }).join('');
    var slots = Number(cfg.credit && cfg.credit.slotsPerFilm) || 5; // coerce — it's interpolated raw below
    var credit = '<div class="idxp-g-credit"><span class="idxp-g-ic">' + icon('credit') + '</span><div>' +
      '<b>Screen credit is earned, not bought.</b> Reaching <b>Story Scout</b> makes you <b>eligible</b> — it doesn’t hand you a credit. ' +
      'Every film carries only <b>' + slots + '</b> “Story Scout” credit slots, and they go to the curators who did the most for <i>that</i> film: ' +
      'who <b>spotted it early</b>, <b>recommended</b> it and it landed, <b>championed</b> it, and <b>read &amp; reviewed</b> it. ' +
      'So back the right films early — that’s how you get your name on one.</div></div>';
    var badges = Object.keys(cfg.badges || {}).map(function (k) {
      var b = cfg.badges[k];
      return '<div class="idxp-g-row"><div class="idxp-g-l">' + esc(b.name) + '</div><div class="idxp-g-bd">' + esc(b.desc) + '</div></div>';
    }).join('');
    return '<div class="idxp-g-head"><h2>How Reader XP works</h2>' +
      '<button class="idxp-g-x" aria-label="Close">&times;</button></div>' +
      '<p class="idxp-g-intro">There’s one role — <b>Reader</b> — and your <b>XP number</b> is your standing. The bar fills gray → red as you curate; the further it runs, the more committed a reader you are. Earn XP by doing the real work, and cross milestones to unlock perks.</p>' +
      '<h3>Earn XP</h3>' + earn +
      '<h3>Unlock perks</h3>' + perks + credit +
      '<h3>Badges</h3>' + badges;
  }
  function openGuide() {
    injectStyles();
    if (document.querySelector('.idxp-guide-back')) return;
    var opener = document.activeElement; // restore focus here on close (a11y)
    var back = el('div', 'idxp-guide-back');
    back.innerHTML = '<div class="idxp-guide" role="dialog" aria-modal="true" aria-label="How Reader XP works" tabindex="-1"><div class="idxp-g-loading">Loading…</div></div>';
    document.body.appendChild(back);
    var panel = back.querySelector('.idxp-guide');
    function close() {
      if (back.parentNode) back.parentNode.removeChild(back);
      document.removeEventListener('keydown', onKey);
      try { if (opener && opener.focus) opener.focus(); } catch (e) { /* opener gone */ }
    }
    function focusables() {
      return Array.prototype.slice.call(panel.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])'));
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      // trap focus within the dialog (aria-modal contract)
      var f = focusables(); if (!f.length) { e.preventDefault(); panel.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    panel.focus(); // move focus into the dialog
    loadGuideConfig().then(function (cfg) {
      if (!cfg) { panel.innerHTML = '<div class="idxp-g-loading">Couldn’t load the guide — try again.</div>'; return; }
      panel.innerHTML = guideBody(cfg);
      var x = panel.querySelector('.idxp-g-x');
      if (x) { x.addEventListener('click', close); x.focus(); }
    });
  }

  global.XpBar = {
    render: render,
    fetch: fetchXp,
    sync: sync,
    toast: toast,
    confetti: confetti,
    fireworks: fireworks,
    levelUp: levelUp,
    openGuide: openGuide,
    setSound: function (on) { _soundOn = !!on; },
    injectStyles: injectStyles,
    apiBase: apiBase,
    GRADIENT: GRADIENT,
    ICONS: ICONS,
  };
})(typeof window !== 'undefined' ? window : this);
