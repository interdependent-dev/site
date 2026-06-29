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
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
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
      // gain toast
      '.idxp-toast-wrap{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}' +
      '.idxp-toast{background:rgba(8,8,8,.96);border:1px solid #FF0000;border-radius:999px;padding:9px 18px;display:flex;align-items:center;gap:9px;box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 18px rgba(255,0,0,.25);animation:idxp-rise 2.4s cubic-bezier(.22,1,.36,1) forwards;font-family:"Eurostile","Helvetica Neue",sans-serif}' +
      '.idxp-toast .amt{font-family:"Eurostile Wide","Eurostile",sans-serif;font-weight:700;color:#FF0000;font-size:15px}' +
      '.idxp-toast .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#ddd}' +
      '@keyframes idxp-rise{0%{opacity:0;transform:translateY(14px) scale(.92)}12%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-12px)}}' +
      '@media (prefers-reduced-motion:reduce){.idxp-veil,.idxp-edge{transition:none}.idxp-toast{animation:idxp-fade 2.4s linear forwards}}' +
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

    // headline: ROLE  ·  big XP number (the identity, in Eurostile)
    var head = el('div', 'idxp-head');
    head.appendChild(el('span', 'idxp-role', esc(role)));
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

  function toast(amount, label) {
    injectStyles();
    var wrap = document.querySelector('.idxp-toast-wrap');
    if (!wrap) { wrap = el('div', 'idxp-toast-wrap'); document.body.appendChild(wrap); }
    var t = el('div', 'idxp-toast');
    t.innerHTML = '<span class="amt">' + esc(String(amount)) + '</span>' + (label ? '<span class="lbl">' + esc(label) + '</span>' : '');
    wrap.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      if (wrap && !wrap.children.length && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 2500);
  }

  function fetchXp(handle, base) {
    var url = (base || apiBase()) + '/readers/' + encodeURIComponent(handle) + '/xp';
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var BADGE_NAMES = {
    'deep-reader': 'Deep Reader', 'early-spotter': 'Early Spotter', tastemaker: 'Tastemaker',
    calibrator: 'Calibrator', prolific: 'Prolific', connector: 'Connector',
  };
  function badgeName(k) { return BADGE_NAMES[k] || k; }

  global.XpBar = {
    render: render,
    fetch: fetchXp,
    toast: toast,
    injectStyles: injectStyles,
    apiBase: apiBase,
    GRADIENT: GRADIENT,
    ICONS: ICONS,
  };
})(typeof window !== 'undefined' ? window : this);
