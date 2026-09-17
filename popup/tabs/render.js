/**
 * popup/tabs/render.js — "Render" tab: server-side vs client-side rendering.
 * Registers window.SEO_TABS.render = { init }.
 *
 * Fetches the raw HTML the server returns (via the worker, cookie-less, like an
 * anonymous crawler) and parses it with DOMParser — which never executes
 * scripts, so it is exactly what a non-rendering crawler sees. Then compares it
 * against the live post-JavaScript DOM using the SAME extractor
 * (inject/render-extract.js), so the diff is apples-to-apples.
 *
 * Lazy-init: only runs when the tab is first opened.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { ctx: null, running: false, data: null };

  function init(ctx) {
    state.ctx = ctx;
    if (state.data) render(ctx);
    else run(ctx);
  }

  function setStatus(ctx, text, isErr) {
    var s = ctx.qs('#render-status');
    s.className = 'status' + (isErr ? ' err' : (text ? ' busy' : ''));
    s.textContent = text;
  }
  function activeUrl(ctx) { return ctx.activeTab && ctx.activeTab.url ? ctx.activeTab.url : ''; }

  async function run(ctx, force) {
    if (state.running) return;
    if (state.data && !force) { render(ctx); return; }
    var url = activeUrl(ctx);
    if (!/^https?:\/\//i.test(url)) { setStatus(ctx, 'Open a normal website tab to compare rendering.', true); return; }

    state.running = true;
    setStatus(ctx, 'Fetching raw HTML and comparing with the rendered DOM', false);
    ctx.qs('#render-results').innerHTML = '';

    var res = await Promise.all([
      ctx.send({ type: 'analyze-rendered' }),
      ctx.send({ type: 'fetch-resource', url: url, method: 'GET' })
    ]);
    state.running = false;

    var rendered = res[0] && res[0].ok ? res[0].data : null;
    var http = res[1] && res[1].ok ? res[1].data : null;

    if (!rendered) { setStatus(ctx, 'Could not read the rendered page.', true); return; }
    if (!http || !http.body) { setStatus(ctx, 'Could not fetch the raw HTML for this URL.', true); return; }

    var raw = parseRaw(http.body, url);
    if (!raw) { setStatus(ctx, 'Could not parse the raw HTML.', true); return; }

    setStatus(ctx, '', false);
    state.data = { url: url, raw: raw, rendered: rendered, http: http, rawBytes: http.body.length };
    render(ctx);
  }

  // Parse the server HTML with DOMParser (scripts never execute) and run the
  // shared extractor over it — the same function used on the live DOM.
  function parseRaw(html, url) {
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc || !window.__SEO_extractRenderMetrics) return null;
      return window.__SEO_extractRenderMetrics(doc, url);
    } catch (e) { return null; }
  }

  function render(ctx) {
    var d = state.data, el = ctx.el;
    var wrap = ctx.qs('#render-results');
    wrap.innerHTML = '';
    if (!d) return;

    var a = window.SEO_RECO_RULES._util.renderAnalyze(d.raw, d.rendered);
    if (!a) { wrap.appendChild(el('div', { class: 'sd-note bad', text: 'Comparison unavailable.' })); return; }

    // ---- Verdict ----
    var VTEXT = {
      ssr: 'The server sends a complete page. Every crawler — including AI bots that never run JavaScript — sees your content.',
      hybrid: 'The server sends part of the page and JavaScript fills in the rest. Google will cope; non-rendering crawlers will miss whatever comes later.',
      csr: 'The page is largely built in the browser. Crawlers that do not execute JavaScript see almost nothing — and that includes most AI crawlers.'
    };
    var verdict = el('div', { class: 'verdict ' + (a.tone === 'ok' ? 'ok' : a.tone === 'warn' ? 'warn' : 'bad') });
    verdict.innerHTML =
      '<div class="verdict-ico">' + (a.tone === 'ok' ? '✓' : a.tone === 'warn' ? '⚠' : '✗') + '</div>' +
      '<div class="verdict-txt"><b>' + ctx.escapeHtml(a.label) + '</b><br><span>' +
      ctx.escapeHtml(VTEXT[a.verdict]) + '</span></div>';
    wrap.appendChild(verdict);

    // ---- Coverage meter ----
    var meter = el('div', { class: 'rnd-meter' });
    meter.innerHTML =
      '<div class="rnd-meter-top"><b>' + a.coverage + '%</b>' +
      '<span>of the page text is in the raw HTML</span></div>' +
      '<div class="rnd-bar"><div class="rnd-bar-fill ' + a.tone + '" style="width:' + a.coverage + '%"></div></div>' +
      '<div class="rnd-meter-sub">' + a.rawWords.toLocaleString() + ' of ' + a.domWords.toLocaleString() +
      ' words served before JavaScript runs</div>';
    wrap.appendChild(meter);

    // ---- Toolbar ----
    var actions = el('div', { class: 'sd-actions' }, [
      tbtn(ctx, 'Re-check', function () { run(ctx, true); }),
      tbtn(ctx, 'Export CSV', function () {
        window.SEO_CSV.download('seo-sidekick-rendering-' + hostOf(d) + '.csv', toCsv(d, a));
      })
    ]);
    wrap.appendChild(actions);

    // ---- Side-by-side comparison ----
    var sec = el('div', { class: 'sd-block' });
    sec.appendChild(el('div', { class: 'sd-block-head' }, [
      el('h3', { class: 'sd-block-t', text: 'Raw HTML vs rendered DOM' }),
      el('p', { class: 'sd-block-s', text: 'Left: what the server returned. Right: after JavaScript ran.' })
    ]));

    var tbl = el('div', { class: 'rnd-tbl' });
    tbl.appendChild(row(ctx, 'Element', 'Raw HTML', 'Rendered', true));
    rows(d, a).forEach(function (r) { tbl.appendChild(row(ctx, r[0], r[1], r[2], false, r[3])); });
    sec.appendChild(tbl);
    wrap.appendChild(sec);

    // ---- Framework + transfer info ----
    var fw = (d.rendered.frameworks || []).concat((d.raw.frameworks || []).filter(function (f) {
      return (d.rendered.frameworks || []).indexOf(f) === -1;
    }));
    var info = el('div', { class: 'sd-block' });
    info.appendChild(el('div', { class: 'sd-block-head' }, [el('h3', { class: 'sd-block-t', text: 'Details' })]));
    info.appendChild(kv(ctx, 'Detected framework', fw.length ? fw.join(', ') : 'none detected', 'int'));
    info.appendChild(kv(ctx, 'Raw HTML size', Math.round(d.rawBytes / 1024) + ' KB', 'int'));
    info.appendChild(kv(ctx, 'HTTP status', String(d.http.status || '—'),
      (d.http.status >= 200 && d.http.status < 300) ? 'ok' : 'warn'));
    info.appendChild(kv(ctx, 'DOM nodes (raw → rendered)',
      d.raw.domNodes + ' → ' + d.rendered.domNodes, 'int'));
    info.appendChild(el('div', { class: 'sd-note',
      text: 'The raw HTML is fetched without cookies, the way an anonymous crawler would request it. Googlebot does execute JavaScript on a second pass; GPTBot, ClaudeBot, PerplexityBot and CCBot do not.' }));
    wrap.appendChild(info);

    // ---- Recommendations (shared engine) ----
    if (window.SEO_RECO && window.SEO_RECO_RULES) {
      wrap.appendChild(window.SEO_RECO.section(ctx, 'Recommendations',
        'What to move server-side, most important first.',
        window.SEO_RECO_RULES.render({ raw: d.raw, rendered: d.rendered, url: d.url }),
        { empty: '✓ Nothing critical depends on JavaScript — crawlers get the full page.' }));
    }
  }

  // Each row: [label, rawValue, renderedValue, tone]
  function rows(d, a) {
    var r = d.raw, v = d.rendered;
    function txt(s) { return s ? String(s) : '—'; }
    function tone(missingFlag, changedFlag) {
      return missingFlag ? 'bad' : (changedFlag ? 'warn' : 'ok');
    }
    return [
      ['Title', txt(r.title), txt(v.title), tone(a.missing.title, a.changed.title)],
      ['Meta description', r.metaDescription ? (r.metaDescription.length + ' chars') : '—',
        v.metaDescription ? (v.metaDescription.length + ' chars') : '—', tone(a.missing.metaDescription)],
      ['Canonical', txt(r.canonical), txt(v.canonical), tone(a.missing.canonical, a.changed.canonical)],
      ['H1', String(r.headingCounts.h1 || 0), String(v.headingCounts.h1 || 0), tone(a.missing.h1)],
      ['All headings', String(r.headingTotal || 0), String(v.headingTotal || 0), a.deltas.headings > 0 ? 'warn' : 'ok'],
      ['Body words', String(r.words.body || 0), String(v.words.body || 0), a.coverage >= 85 ? 'ok' : a.coverage >= 50 ? 'warn' : 'bad'],
      ['Links', String(r.links.total || 0), String(v.links.total || 0), a.deltas.links > 20 ? 'warn' : 'ok'],
      ['Images', String(r.images.total || 0), String(v.images.total || 0), a.deltas.images > 5 ? 'warn' : 'ok'],
      ['JSON-LD blocks', String(r.jsonLd.blocks || 0), String(v.jsonLd.blocks || 0), tone(a.missing.jsonLd)],
      ['Schema types', (r.jsonLd.types || []).join(', ') || '—', (v.jsonLd.types || []).join(', ') || '—',
        a.missing.jsonLd ? 'bad' : 'ok'],
      ['og:title', txt(r.openGraph.title), txt(v.openGraph.title),
        (!r.openGraph.title && v.openGraph.title) ? 'warn' : 'ok']
    ];
  }

  // ---- small builders ----
  function row(ctx, label, rawVal, domVal, isHead, tone) {
    var el = ctx.el;
    var cls = 'rnd-row' + (isHead ? ' head' : '') + (tone ? ' t-' + tone : '');
    return el('div', { class: cls }, [
      el('div', { class: 'rnd-c rnd-lbl', text: label }),
      el('div', { class: 'rnd-c rnd-raw', text: rawVal, title: rawVal }),
      el('div', { class: 'rnd-c rnd-dom', text: domVal, title: domVal })
    ]);
  }
  function kv(ctx, k, v, color) {
    var r = ctx.el('div', { class: 'op-kv' });
    r.appendChild(ctx.el('span', { class: 'op-k', text: k }));
    r.appendChild(ctx.el('span', { class: 'op-v ' + (color ? 'c-' + color : ''), text: v }));
    return r;
  }
  function tbtn(ctx, label, onClick) {
    var b = ctx.el('button', { class: 'sd-btn' });
    b.innerHTML = '<span>' + ctx.escapeHtml(label) + '</span>';
    b.addEventListener('click', onClick);
    return b;
  }
  function hostOf(d) { try { return new URL(d.url).hostname; } catch (e) { return 'page'; } }

  function toCsv(d, a) {
    var out = [['Element', 'Raw HTML (server)', 'Rendered DOM (after JS)', 'Status']];
    rows(d, a).forEach(function (r) {
      out.push([r[0], r[1], r[2], r[3] === 'ok' ? 'OK' : r[3] === 'warn' ? 'Differs' : 'Missing in raw HTML']);
    });
    out.push([]);
    out.push(['Verdict', a.label]);
    out.push(['Server-rendered content', a.coverage + '%']);
    out.push(['URL', d.url]);
    return window.SEO_CSV.toCsv(out);
  }

  window.SEO_TABS.render = { init: init };
})();
