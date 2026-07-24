/**
 * popup/tabs/speed.js — Module 7 UI (PageSpeed Insights)
 * Registers window.SEO_TABS.speed = { init }.
 *
 * Calls Google's public PageSpeed Insights (PSI) API for the active tab's URL
 * and shows the Lighthouse performance score, Core Web Vitals (lab + real-user
 * CrUX field data), and the other Lighthouse category scores. Mobile/Desktop
 * toggle. Optional API key (stored locally) to raise the rate limit.
 *
 * PRIVACY: running this sends the current page's URL to Google's PSI API. It is
 * only ever sent when the user clicks "Run test" — never automatically. This is
 * documented in the UI, README and DECISIONS.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  var TIMEOUT_MS = 60000; // PSI can take a while, especially on mobile strategy.

  var state = { ctx: null, strategy: 'mobile', running: false, apiKey: '', dataByStrategy: {} };

  function init(ctx) {
    state.ctx = ctx;

    // Load any stored API key.
    try {
      window.SEO_STORE.get('psi_api_key', '').then(function (k) {
        state.apiKey = k || '';
        var i = ctx.qs('#speed-key');
        if (i) i.value = state.apiKey;
      });
    } catch (e) { /* ignore */ }

    ctx.qs('#speed-run').addEventListener('click', function () { run(ctx); });
    ctx.qsa('.speed-strat').forEach(function (b) {
      b.addEventListener('click', function () { setStrategy(ctx, b.getAttribute('data-strat')); });
    });
    var keyInput = ctx.qs('#speed-key');
    if (keyInput) keyInput.addEventListener('change', function () {
      state.apiKey = keyInput.value.trim();
      try { window.SEO_STORE.set('psi_api_key', state.apiKey); } catch (e) {}
    });

    setStrategy(ctx, state.strategy);
    showTarget(ctx);
  }

  function activeUrl(ctx) {
    return ctx.activeTab && ctx.activeTab.url ? ctx.activeTab.url : '';
  }
  function isPublicHttp(url) {
    if (!/^https?:\/\//i.test(url)) return false;
    // PSI needs a publicly reachable URL; localhost / private hosts will fail.
    try {
      var h = new URL(url).hostname;
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
      if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
      if (/\.local$/i.test(h)) return false;
      return true;
    } catch (e) { return false; }
  }

  function showTarget(ctx) {
    var url = activeUrl(ctx);
    var note = ctx.qs('#speed-target');
    var runBtn = ctx.qs('#speed-run');
    if (!url) { note.textContent = 'No active tab.'; runBtn.disabled = true; return; }
    if (!isPublicHttp(url)) {
      note.textContent = 'PageSpeed can only test a public http(s) URL (not local, private, or browser pages).';
      runBtn.disabled = true;
      return;
    }
    note.textContent = 'Will test: ' + url;
    runBtn.disabled = false;
  }

  function setStrategy(ctx, strat) {
    state.strategy = (strat === 'desktop') ? 'desktop' : 'mobile';
    ctx.qsa('.speed-strat').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-strat') === state.strategy);
    });
    // If we already have a result for this strategy, show it; else clear.
    if (state.dataByStrategy[state.strategy]) render(ctx, state.dataByStrategy[state.strategy]);
    else ctx.qs('#speed-results').innerHTML = '';
  }

  function timedFetch(url) {
    var controller = new AbortController();
    var t = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: controller.signal, credentials: 'omit' })
      .then(function (r) { clearTimeout(t); return r; })
      .catch(function (e) { clearTimeout(t); throw e; });
  }

  async function run(ctx) {
    if (state.running) return;
    var url = activeUrl(ctx);
    if (!isPublicHttp(url)) { showTarget(ctx); return; }

    state.running = true;
    var status = ctx.qs('#speed-status');
    var runBtn = ctx.qs('#speed-run');
    runBtn.disabled = true;
    status.className = 'status busy';
    status.textContent = 'Running PageSpeed test (' + state.strategy + ') — this can take up to a minute';
    ctx.qs('#speed-results').innerHTML = '';

    var api = PSI_ENDPOINT + '?url=' + encodeURIComponent(url) +
      '&strategy=' + state.strategy +
      '&category=performance&category=accessibility&category=best-practices&category=seo' +
      (state.apiKey ? '&key=' + encodeURIComponent(state.apiKey) : '');

    try {
      var resp = await timedFetch(api);
      var data = await resp.json();
      if (!resp.ok || data.error) {
        var msg = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + resp.status);
        status.className = 'status err';
        if (resp.status === 429 || /quota/i.test(msg)) {
          status.textContent = 'PageSpeed rate limit reached. Add a free Google API key above to raise the limit, then run again.';
        } else {
          status.textContent = 'PageSpeed error: ' + msg;
        }
        state.running = false; runBtn.disabled = false;
        return;
      }
      status.className = 'status';
      status.textContent = '';
      state.dataByStrategy[state.strategy] = data;
      render(ctx, data);
    } catch (e) {
      status.className = 'status err';
      status.textContent = (e && e.name === 'AbortError')
        ? 'Timed out after 60s — try again (mobile tests are slower).'
        : 'Could not reach the PageSpeed API. Check your connection and try again.';
    }
    state.running = false;
    runBtn.disabled = false;
  }

  // ---- rendering ----------------------------------------------------------
  function scoreColor(pct) {
    if (pct == null) return 'int';
    if (pct >= 90) return 'ok';
    if (pct >= 50) return 'warn';
    return 'bad';
  }
  function auditColor(score) {
    if (score == null) return 'int';
    if (score >= 0.9) return 'ok';
    if (score >= 0.5) return 'warn';
    return 'bad';
  }
  function cruxColor(cat) {
    if (cat === 'FAST') return 'ok';
    if (cat === 'AVERAGE') return 'warn';
    if (cat === 'SLOW') return 'bad';
    return 'int';
  }
  function pctOf(score) { return score == null ? null : Math.round(score * 100); }

  function render(ctx, data) {
    var el = ctx.el, esc = ctx.escapeHtml;
    var wrap = ctx.qs('#speed-results');
    wrap.innerHTML = '';

    var lh = data.lighthouseResult || {};
    var cats = lh.categories || {};
    var audits = lh.audits || {};

    // --- Big performance score ---
    var perf = pctOf(cats.performance ? cats.performance.score : null);
    var ring = el('div', { class: 'psi-scorecard' });
    ring.innerHTML =
      '<div class="psi-score c-' + scoreColor(perf) + '">' + (perf == null ? '—' : perf) + '</div>' +
      '<div class="psi-score-lbl">Performance<br><span>' + esc(state.strategy) + '</span></div>';
    wrap.appendChild(ring);

    // --- Other category scores ---
    var catRow = el('div', { class: 'op-inline', style: 'margin-bottom:8px;' });
    [['accessibility', 'Accessibility'], ['best-practices', 'Best Practices'], ['seo', 'SEO']]
      .forEach(function (pair) {
        var c = cats[pair[0]];
        var p = pctOf(c ? c.score : null);
        catRow.appendChild(el('div', { class: 'op-stat ' + scoreColor(p) }, [
          el('span', { class: 'op-stat-n c-' + scoreColor(p), text: p == null ? '—' : String(p) }),
          el('span', { class: 'op-stat-l', text: pair[1] })
        ]));
      });
    wrap.appendChild(section(ctx, 'Lighthouse categories', [catRow]));

    // --- Lab metrics (Core Web Vitals + others) ---
    var labKeys = [
      ['largest-contentful-paint', 'LCP'],
      ['cumulative-layout-shift', 'CLS'],
      ['total-blocking-time', 'TBT'],
      ['first-contentful-paint', 'FCP'],
      ['speed-index', 'Speed Index'],
      ['interactive', 'TTI']
    ];
    var labWrap = el('div', { class: 'psi-metrics' });
    labKeys.forEach(function (k) {
      var a = audits[k[0]];
      if (!a) return;
      var color = auditColor(a.score);
      labWrap.appendChild(el('div', { class: 'psi-metric' }, [
        el('div', { class: 'psi-metric-top' }, [
          el('span', { class: 'psi-metric-k', text: k[1] }),
          el('span', { class: 'psi-dot c-' + color, text: '●' })
        ]),
        el('div', { class: 'psi-metric-v', text: a.displayValue || '—' })
      ]));
    });
    wrap.appendChild(section(ctx, 'Lab data (Lighthouse, ' + state.strategy + ')', [labWrap]));

    // --- Field data (CrUX real-user), if available ---
    var le = data.loadingExperience || {};
    var lm = le.metrics || {};
    if (Object.keys(lm).length) {
      var overall = le.overall_category;
      var fieldWrap = el('div', { class: 'psi-metrics' });
      var fieldKeys = [
        ['LARGEST_CONTENTFUL_PAINT_MS', 'LCP', function (v) { return (v / 1000).toFixed(2) + ' s'; }],
        ['INTERACTION_TO_NEXT_PAINT', 'INP', function (v) { return v + ' ms'; }],
        ['CUMULATIVE_LAYOUT_SHIFT_SCORE', 'CLS', function (v) { return (v / 100).toFixed(2); }],
        ['FIRST_CONTENTFUL_PAINT_MS', 'FCP', function (v) { return (v / 1000).toFixed(2) + ' s'; }]
      ];
      fieldKeys.forEach(function (k) {
        var m = lm[k[0]];
        if (!m) return;
        var color = cruxColor(m.category);
        fieldWrap.appendChild(el('div', { class: 'psi-metric' }, [
          el('div', { class: 'psi-metric-top' }, [
            el('span', { class: 'psi-metric-k', text: k[1] }),
            el('span', { class: 'psi-dot c-' + color, text: '●' })
          ]),
          el('div', { class: 'psi-metric-v', text: k[2](m.percentile) })
        ]));
      });
      var fieldSec = section(ctx, 'Real-user data (CrUX, 28-day)', [fieldWrap]);
      fieldSec.appendChild(el('div', { class: 'op-note ' + cruxColor(overall),
        text: 'Overall: ' + (overall || 'n/a') }));
      wrap.appendChild(fieldSec);
    } else {
      wrap.appendChild(section(ctx, 'Real-user data (CrUX)', [
        el('div', { class: 'op-note', text: 'No field data — this URL doesn’t have enough real-user traffic in the Chrome UX Report yet. Lab data above still applies.' })
      ]));
    }

    // --- Footer / attribution ---
    var tested = lh.finalUrl || data.id || '';
    wrap.appendChild(el('div', { class: 'op-note', style: 'margin-top:8px;',
      html: 'Tested URL: ' + esc(tested) + '<br>Powered by Google PageSpeed Insights. The tested URL is sent to Google only when you run a test.' }));
  }

  function section(ctx, title, children) {
    var sec = ctx.el('div', { class: 'op-section' });
    sec.appendChild(ctx.el('div', { class: 'op-title', text: title }));
    (children || []).forEach(function (c) { if (c) sec.appendChild(c); });
    return sec;
  }

  window.SEO_TABS.speed = { init: init };
})();
