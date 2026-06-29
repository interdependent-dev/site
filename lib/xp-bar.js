/* ============================================================================
 * INTERDEPENDENT — Role XP bar
 * One role, one number. The bar is a single continuous gradient of commitment
 * (light gray → white → red); the XP NUMBER is the identity. A newbie reads
 * differently from a committed member at a glance — same role, different
 * standing. Subtle dividers mark the points where perks unlock; the fill stops
 * at a 🔒 divider if the perk's action-gate isn't met yet.
 *
 * Generic across roles — Reader today, and the same bar for Executive Producer,
 * Producer, Scriptographer, Director, Actor, … only the role name + number change.
 *
 * Usage:
 *   <script src="/lib/xp-bar.js"></script>
 *   const xp = await XpBar.fetch('jane-doe');          // GET /readers/jane-doe/xp
 *   XpBar.render(document.getElementById('slot'), xp); // role + number + bar
 *   XpBar.toast('+55 XP', 'Complete review');          // floating gain pop
 *
 * No dependencies. Dark theme. Honors prefers-reduced-motion.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var API_DEFAULT = 'https://interdependent-api.onrender.com';
  function apiBase() {
    return global.IDP_API_BASE || (global.ReaderAuth && global.ReaderAuth.API) || API_DEFAULT;
  }

  // The commitment gradient: dim (newbie) → bright → brand red (committed).
  var GRADIENT = 'linear-gradient(90deg, #8a93a3 0%, #e9edf2 50%, #FF0000 100%)';

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
      '.idxp{font-family:"Eurostile","Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;width:100%;--idxp-surface:#0a0a0a}' +
      '.idxp *{box-sizing:border-box}' +
      '.idxp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:9px}' +
      '.idxp-role{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#b9b9b9}' +
      '.idxp-num{font-family:"Courier New",monospace;font-weight:700;line-height:1;color:#fff;white-space:nowrap}' +
      '.idxp-num .n{font-size:26px;letter-spacing:.01em}' +
      '.idxp-num .u{font-size:12px;color:#8a8a8a;margin-left:5px;letter-spacing:.12em}' +
      '.idxp-bar{position:relative;padding-top:17px}' +              /* room for the marks row */
      '.idxp-marks{position:absolute;left:0;right:0;top:0;height:15px}' +
      '.idxp-mark{position:absolute;top:0;transform:translateX(-50%);font-size:12px;line-height:1;filter:grayscale(1) opacity(.4);transition:filter .3s}' +
      '.idxp-mark.earned{filter:none;text-shadow:0 0 7px rgba(255,0,0,.45)}' +
      '.idxp-mark.locked{filter:none}' +
      '.idxp-track{position:relative;height:15px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:var(--idxp-surface)}' +
      '.idxp-grad{position:absolute;inset:0;border-radius:inherit}' +
      /* veil DIMS the unearned span (rather than hiding it) so the full gray→white→red
         scale stays visible — you can see the red goal ahead, your earned part is vivid */
      '.idxp-veil{position:absolute;top:0;bottom:0;right:0;background:rgba(8,8,8,.72);transition:left .9s cubic-bezier(.22,1,.36,1)}' +
      '.idxp-div{position:absolute;top:2px;bottom:2px;width:1px;background:rgba(0,0,0,.45);box-shadow:1px 0 0 rgba(255,255,255,.16)}' +
      '.idxp-edge{position:absolute;top:-1px;bottom:-1px;width:2px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.7);transition:left .9s cubic-bezier(.22,1,.36,1)}' +
      '.idxp-foot{margin-top:10px;font-size:11.5px;color:#9a9a9a;line-height:1.5;display:flex;align-items:flex-start;gap:7px}' +
      '.idxp-foot .ic{font-size:13px;flex-shrink:0}' +
      '.idxp-foot b{color:#e6e6e6;font-weight:700}' +
      '.idxp-foot .lk{color:#FFD600}' +
      '.idxp-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}' +
      '.idxp-badge{font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#cbb26a;border:1px solid #3a341e;background:#15120a;border-radius:10px;padding:2px 8px;font-weight:700}' +
      /* gain toast */
      '.idxp-toast-wrap{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}' +
      '.idxp-toast{background:rgba(8,8,8,.96);border:1px solid #FF0000;border-radius:999px;padding:9px 18px;display:flex;align-items:center;gap:9px;box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 18px rgba(255,0,0,.25);animation:idxp-rise 2.4s cubic-bezier(.22,1,.36,1) forwards;font-family:"Eurostile","Helvetica Neue",sans-serif}' +
      '.idxp-toast .amt{font-family:"Courier New",monospace;font-weight:700;color:#FF0000;font-size:15px}' +
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
          icon: (l.reward && l.reward.icon) || '★',
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
   * opts: { compact (no footer/badges), showReward (footer, default !compact),
   * showBadges, animate, role (override label) }.
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

    // headline: ROLE  ·  big XP number (the identity)
    var head = el('div', 'idxp-head');
    head.appendChild(el('span', 'idxp-role', esc(role)));
    head.appendChild(el('span', 'idxp-num', '<span class="n">' + fmt(xp.totalXp || 0) + '</span><span class="u">XP</span>'));
    root.appendChild(head);

    // the bar: marks row + gradient track + veil + dividers + edge
    var bar = el('div', 'idxp-bar');
    var marksRow = el('div', 'idxp-marks');
    var track = el('div', 'idxp-track');
    track.appendChild(el('div', 'idxp-grad')).style.background = GRADIENT;
    // The veil covers the UNEARNED part (from the fill edge to the right), so the
    // earned span reveals the gradient — a newbie sees only the dim start, a
    // committed member's fill reaches into the red. Animate from 0% (empty).
    var veil = el('div', 'idxp-veil');
    veil.dataset.left = fillPct.toFixed(2) + '%';
    veil.style.left = opts.animate ? '0%' : veil.dataset.left;
    track.appendChild(veil);

    marks.forEach(function (m) {
      // divider line on the track
      var d = el('div', 'idxp-div');
      d.style.left = m.pos.toFixed(2) + '%';
      track.appendChild(d);
      // perk icon above the track (🔒 if the gate isn't met yet)
      var locked = m.reached && !m.gateMet;
      var mk = el('div', 'idxp-mark' + (m.reached && m.gateMet ? ' earned' : locked ? ' locked' : ''), locked ? '🔒' : esc(m.icon));
      mk.style.left = m.pos.toFixed(2) + '%';
      if (m.label) mk.title = (locked ? 'Locked — ' : '') + m.label + ' · ' + m.min + ' XP';
      marksRow.appendChild(mk);
    });

    var edge = el('div', 'idxp-edge');
    edge.style.left = opts.animate ? '0%' : fillPct.toFixed(2) + '%';
    edge.dataset.left = fillPct.toFixed(2) + '%';
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

  // The single most useful line: the next perk and what unlocks it.
  function footer(xp) {
    var f = el('div', 'idxp-foot');
    var next = xp.nextLevel;
    if (!next) {
      f.innerHTML = '<span class="ic">✦</span><span>Fully committed — every perk unlocked.</span>';
      return f;
    }
    var nlv = (xp.levels || []).find(function (l) { return l.key === next.key; }) || {};
    var reward = nlv.reward || {};
    var icon = reward.icon || '✦';
    var gateBlocked = next.gateMet === false && xp.totalXp >= next.min;
    if (gateBlocked) {
      f.innerHTML =
        '<span class="ic">🔒</span><span><span class="lk"><b>' + esc(unmetText(next.unmet)) +
        '</b></span> to unlock ' + esc(icon) + ' <b>' + esc(reward.label || '') + '</b></span>';
    } else {
      var toGo = next.xpToGo != null ? next.xpToGo : Math.max(0, next.min - (xp.totalXp || 0));
      f.innerHTML =
        '<span class="ic">' + esc(icon) + '</span><span><b>' + fmt(toGo) +
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
  };
})(typeof window !== 'undefined' ? window : this);
