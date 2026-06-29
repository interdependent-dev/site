/* ============================================================================
 * INTERDEPENDENT — Reader XP bar
 * A single, framework-free component that renders the reader gamification bar
 * from the API's per-reader XP payload (GET /readers/:handle/xp).
 *
 * The bar is ONE fixed-length track divided into 5 level zones (Reader → Scout →
 * Curator → Tastemaker → Partner). XP fills the zones left-to-right; zones you
 * haven't reached are OUTLINED, not filled — so every reader's bar is identical
 * in shape and you read standing at a glance. Crucially, the fill STOPS at the
 * first locked gate (you have the XP but haven't done the required spread of
 * work) with a 🔒 and the exact action needed to advance — turning the bar into
 * a next-step nudge, not just a number.
 *
 * Usage:
 *   <script src="/lib/xp-bar.js"></script>
 *   const xp = await XpBar.fetch('jane-doe');          // GET /readers/jane-doe/xp
 *   XpBar.render(document.getElementById('slot'), xp, { showReward:true });
 *   XpBar.toast('+55 XP', 'Complete feedback');        // floating gain pop
 *
 * No dependencies. Dark-theme palette (the site is dark). Honors
 * prefers-reduced-motion. ~6 KB, zero network beyond the optional fetch().
 * ==========================================================================*/
(function (global) {
  'use strict';

  var API_DEFAULT = 'https://interdependent-api.onrender.com';
  function apiBase() {
    return (
      global.IDP_API_BASE ||
      (global.ReaderAuth && global.ReaderAuth.API) ||
      API_DEFAULT
    );
  }

  // Dark-theme zone palette, keyed by level. Red (#FF0000) is the brand hero and
  // sits at Curator — crossing into it reads as the milestone it is.
  var PALETTE = {
    reader: '#6b7280', // slate
    scout: '#9aa3b2', // steel
    curator: '#FF0000', // brand red
    tastemaker: '#FFD600', // gold
    partner: '#E5E4E2', // platinum
  };
  function zoneColor(level) {
    return PALETTE[level.key] || level.color || '#6b7280';
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
  // "1 more verified read + 2 more feedback" from an unmet-gate array.
  function unmetText(unmet) {
    if (!unmet || !unmet.length) return '';
    return unmet
      .map(function (u) {
        var need = Math.max(0, u.need - u.have);
        return plural(need, GATE_VERB[u.key] || u.key);
      })
      .join(' + ');
  }

  var STYLE_ID = 'idxp-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.idxp{font-family:"Eurostile","Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;width:100%}' +
      '.idxp *{box-sizing:border-box}' +
      '.idxp-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:7px}' +
      '.idxp-eyebrow{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#8a8a8a;font-weight:700}' +
      '.idxp-total{font-family:"Courier New",monospace;font-size:13px;color:#fff;letter-spacing:.02em;white-space:nowrap}' +
      '.idxp-total b{color:#FF0000;font-weight:700}' +
      '.idxp-level{font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;padding:2px 9px;border-radius:11px;white-space:nowrap}' +
      '.idxp-track{position:relative;display:flex;gap:3px;width:100%}' +
      '.idxp-seg{position:relative;flex:1;height:14px;border-radius:3px;border:1.5px solid;background:transparent;overflow:hidden}' +
      '.idxp-seg:first-child{border-top-left-radius:7px;border-bottom-left-radius:7px}' +
      '.idxp-seg:last-child{border-top-right-radius:7px;border-bottom-right-radius:7px}' +
      '.idxp-fill{position:absolute;left:0;top:0;height:100%;width:0;border-radius:2px;transition:width .9s cubic-bezier(.22,1,.36,1)}' +
      '.idxp-seg.cur .idxp-fill{box-shadow:0 0 9px 0 var(--g)}' +
      '.idxp-pulse{position:absolute;top:50%;width:7px;height:7px;border-radius:50%;transform:translate(-50%,-50%);background:#fff;opacity:.9;animation:idxp-pulse 1.6s ease-in-out infinite}' +
      '.idxp-lock{position:absolute;top:50%;transform:translate(-50%,-50%);font-size:11px;line-height:1;filter:drop-shadow(0 0 3px #000);z-index:2}' +
      '.idxp-foot{margin-top:8px;font-size:11.5px;color:#9a9a9a;line-height:1.5;display:flex;align-items:flex-start;gap:7px}' +
      '.idxp-foot .ic{font-size:13px;flex-shrink:0}' +
      '.idxp-foot b{color:#e6e6e6;font-weight:700}' +
      '.idxp-foot .lk{color:#FFD600}' +
      '.idxp-ticks{display:flex;gap:3px;margin-top:5px}' +
      '.idxp-tick{flex:1;text-align:center;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#5a5a5a;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.idxp-tick.on{color:#cfcfcf}' +
      '.idxp-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}' +
      '.idxp-badge{font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#cbb26a;border:1px solid #3a341e;background:#15120a;border-radius:10px;padding:2px 8px;font-weight:700}' +
      '@keyframes idxp-pulse{0%,100%{opacity:.35;transform:translate(-50%,-50%) scale(.8)}50%{opacity:.95;transform:translate(-50%,-50%) scale(1.15)}}' +
      /* gain toast */
      '.idxp-toast-wrap{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}' +
      '.idxp-toast{background:rgba(8,8,8,.96);border:1px solid #FF0000;border-radius:999px;padding:9px 18px;display:flex;align-items:center;gap:9px;box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 18px rgba(255,0,0,.25);animation:idxp-rise 2.4s cubic-bezier(.22,1,.36,1) forwards;font-family:"Eurostile","Helvetica Neue",sans-serif}' +
      '.idxp-toast .amt{font-family:"Courier New",monospace;font-weight:700;color:#FF0000;font-size:15px;letter-spacing:.02em}' +
      '.idxp-toast .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#ddd}' +
      '@keyframes idxp-rise{0%{opacity:0;transform:translateY(14px) scale(.92)}12%{opacity:1;transform:translateY(0) scale(1)}80%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-12px)}}' +
      '@media (prefers-reduced-motion:reduce){.idxp-fill{transition:none}.idxp-pulse{animation:none}.idxp-toast{animation:idxp-fade 2.4s linear forwards}}' +
      '@keyframes idxp-fade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}';
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // Fill fraction (0..1) of the WHOLE bar, plus where (if anywhere) it is gated.
  function computeFill(xp) {
    var levels = xp.levels || [];
    var N = levels.length || 1;
    var cur = (xp.level && xp.level.index) || 0;
    var next = xp.nextLevel;
    var prog = 1; // Partner / max
    var lockBoundary = -1; // segment index whose LEFT boundary holds the 🔒
    if (next) {
      var curMin = levels[cur] ? levels[cur].min : 0;
      var raw = (xp.totalXp - curMin) / Math.max(1, next.min - curMin);
      prog = Math.max(0, Math.min(1, raw));
      // Enough XP to cross, but the next level's action-gate isn't met → the bar
      // fills to the boundary and locks there (you've earned it, now do the work).
      if (raw >= 1 && next.gateMet === false) {
        prog = 1;
        lockBoundary = cur + 1;
      }
    }
    return { frac: (cur + prog) / N, cur: cur, lockBoundary: lockBoundary, N: N };
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /**
   * Render the XP bar for one reader's payload into `target`.
   * opts: { compact (no labels/footer), showReward (next-reward footer, default
   * true unless compact), showTicks (tier labels), showBadges, animate }.
   */
  function render(target, xp, opts) {
    if (!target || !xp) return;
    opts = opts || {};
    injectStyles();
    var levels = xp.levels || [];
    var compact = !!opts.compact;
    var fill = computeFill(xp);

    var root = el('div', 'idxp');
    root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(xp.barMax || 0));
    root.setAttribute('aria-valuenow', String(xp.totalXp || 0));
    root.setAttribute('aria-label', 'Reader XP — ' + (xp.level ? xp.level.name : '') + ', ' + (xp.totalXp || 0) + ' XP');

    // header: XP eyebrow · total · level pill
    if (!opts.noHead) {
      var head = el('div', 'idxp-head');
      head.appendChild(el('span', 'idxp-eyebrow', 'XP'));
      var right = el('div');
      right.style.cssText = 'display:flex;align-items:baseline;gap:10px';
      right.appendChild(el('span', 'idxp-total', '<b>' + (xp.totalXp || 0) + '</b> XP'));
      if (xp.level) {
        var pill = el('span', 'idxp-level', esc(xp.level.name));
        var lc = PALETTE[xp.level.key] || '#6b7280';
        pill.style.cssText = 'color:' + lc + ';border:1px solid ' + lc + ';background:' + hexA(lc, 0.12);
        right.appendChild(pill);
      }
      head.appendChild(right);
      root.appendChild(head);
    }

    // track of 5 outlined zones, each filled to its share of the global fill
    var track = el('div', 'idxp-track');
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      var color = zoneColor(lv);
      var seg = el('div', 'idxp-seg' + (i === fill.cur ? ' cur' : ''));
      seg.style.borderColor = hexA(color, lv.reached ? 0.85 : 0.4);
      seg.style.setProperty('--g', hexA(color, 0.6));
      // this segment's share of the global fill (0..1)
      var segFrac = Math.max(0, Math.min(1, fill.frac * fill.N - i));
      var f = el('div', 'idxp-fill');
      f.style.background = gradient(color);
      // when animating an intro, start at 0 and grow on next frame
      f.dataset.w = (segFrac * 100).toFixed(2) + '%';
      f.style.width = opts.animate ? '0%' : f.dataset.w;
      seg.appendChild(f);
      // pulse dot at the leading edge of the active (partially filled) segment
      if (i === fill.cur && segFrac > 0.02 && segFrac < 0.999) {
        var pulse = el('div', 'idxp-pulse');
        pulse.style.left = (segFrac * 100).toFixed(2) + '%';
        seg.appendChild(pulse);
      }
      // 🔒 on the gated boundary
      if (fill.lockBoundary === i) {
        var lock = el('div', 'idxp-lock', '🔒');
        lock.style.left = '0';
        seg.appendChild(lock);
      }
      track.appendChild(seg);
    }
    root.appendChild(track);

    // tier labels under each zone (optional)
    if (opts.showTicks && !compact) {
      var ticks = el('div', 'idxp-ticks');
      for (var t = 0; t < levels.length; t++) {
        ticks.appendChild(el('div', 'idxp-tick' + (t <= fill.cur ? ' on' : ''), esc(levels[t].name)));
      }
      root.appendChild(ticks);
    }

    // next-reward / nudge footer
    var showReward = opts.showReward != null ? opts.showReward : !compact;
    if (showReward) {
      root.appendChild(footer(xp));
    }

    // badges (optional)
    if (opts.showBadges && xp.badges && xp.badges.length) {
      var bw = el('div', 'idxp-badges');
      xp.badges.forEach(function (b) {
        bw.appendChild(el('span', 'idxp-badge', esc(badgeName(b))));
      });
      root.appendChild(bw);
    }

    target.innerHTML = '';
    target.appendChild(root);

    if (opts.animate) {
      // grow each fill from 0 → its target on the next frame (CSS transition)
      requestAnimationFrame(function () {
        var fills = root.querySelectorAll('.idxp-fill');
        for (var k = 0; k < fills.length; k++) fills[k].style.width = fills[k].dataset.w;
      });
    }
    return root;
  }

  // The single most useful line: what unlocks next and what it takes.
  function footer(xp) {
    var f = el('div', 'idxp-foot');
    var next = xp.nextLevel;
    if (!next) {
      f.innerHTML = '<span class="ic">🎬</span><span>Top tier reached — <b>Story Scout</b>. Keep curating.</span>';
      return f;
    }
    // find the next level's reward (from levels[])
    var nlv = (xp.levels || []).find(function (l) { return l.key === next.key; }) || {};
    var reward = nlv.reward || {};
    var icon = reward.icon || '⭑';
    var gateBlocked = next.gateMet === false && (xp.totalXp >= next.min);
    if (gateBlocked) {
      var todo = unmetText(next.unmet);
      f.innerHTML =
        '<span class="ic">🔒</span><span class="lk"><b>' +
        esc(todo) +
        '</b></span><span>to unlock <b>' +
        esc(next.name) +
        '</b> ' +
        esc(icon) +
        ' ' +
        esc(reward.label || '') +
        '</span>';
    } else {
      var toGo = next.xpToGo != null ? next.xpToGo : Math.max(0, next.min - (xp.totalXp || 0));
      f.innerHTML =
        '<span class="ic">' +
        esc(icon) +
        '</span><span><b>' +
        toGo +
        ' XP</b> to <b>' +
        esc(next.name) +
        '</b> — ' +
        esc(reward.label || '') +
        '</span>';
    }
    return f;
  }

  // Floating "+N XP" gain pop. Auto-removes.
  function toast(amount, label) {
    injectStyles();
    var wrap = document.querySelector('.idxp-toast-wrap');
    if (!wrap) {
      wrap = el('div', 'idxp-toast-wrap');
      document.body.appendChild(wrap);
    }
    var t = el('div', 'idxp-toast');
    t.innerHTML =
      '<span class="amt">' + esc(String(amount)) + '</span>' +
      (label ? '<span class="lbl">' + esc(label) + '</span>' : '');
    wrap.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      if (wrap && !wrap.children.length && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 2500);
  }

  // GET /readers/:handle/xp — returns the payload or null (graceful: never throws).
  function fetchXp(handle, base) {
    var url = (base || apiBase()) + '/readers/' + encodeURIComponent(handle) + '/xp';
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // ── small helpers ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function gradient(color) {
    return 'linear-gradient(90deg,' + hexA(color, 0.82) + ' 0%,' + color + ' 100%)';
  }
  var BADGE_NAMES = {
    'deep-reader': 'Deep Reader',
    'early-spotter': 'Early Spotter',
    tastemaker: 'Tastemaker',
    calibrator: 'Calibrator',
    prolific: 'Prolific',
    connector: 'Connector',
  };
  function badgeName(k) { return BADGE_NAMES[k] || k; }

  global.XpBar = {
    render: render,
    fetch: fetchXp,
    toast: toast,
    injectStyles: injectStyles,
    apiBase: apiBase,
    PALETTE: PALETTE,
  };
})(typeof window !== 'undefined' ? window : this);
