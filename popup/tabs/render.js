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
  // Live-page highlighting state (the marks themselves live in the page).
  var hl = { on: false, busy: false, data: null, showSsr: false, err: '', queried: false };
  // Content behind clicks (content/click-scan.js) and crawler view (shared/botview.js).
  var ck = { busy: false, data: null, outlined: false, err: '' };
  var bv = { busy: false, data: null, progress: '', err: '' };

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
    if (hl.on) hlOn(ctx);
    ckScan(ctx);
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

    // ---- Live-page highlighting ----
    wrap.appendChild(el('div', { id: 'render-hl', class: 'rhl' }));
    paintHl(ctx);
    if (!hl.queried) { hl.queried = true; hlQuery(ctx); }

    // ---- Content behind clicks + crawler view ----
    wrap.appendChild(el('div', { id: 'render-clicks', class: 'rhl ck' }));
    paintClicks(ctx);
    wrap.appendChild(el('div', { id: 'render-bots', class: 'rhl bv' }));
    paintBots(ctx);

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

  // ---- Live-page highlighting ---------------------------------------------
  async function hlQuery(ctx) {
    var r = await ctx.send({ type: 'render-highlight', action: 'state' });
    if (r && r.ok && r.data && r.data.on) {
      hl.on = true; hl.data = r.data; hl.showSsr = !!r.data.showSsr;
      paintHl(ctx);
    }
  }
  async function hlOn(ctx) {
    if (!state.data || !state.data.http) return;
    hl.busy = true; hl.err = ''; paintHl(ctx);
    var r = await ctx.send({ type: 'render-highlight', action: 'on',
      rawHtml: state.data.http.body, opts: { showSsr: hl.showSsr } });
    hl.busy = false;
    if (r && r.ok && r.data) { hl.on = true; hl.data = r.data; }
    else hl.err = (r && r.error) ? r.error : 'Could not highlight this page.';
    paintHl(ctx);
  }
  async function hlOff(ctx) {
    hl.busy = true; paintHl(ctx);
    await ctx.send({ type: 'render-highlight', action: 'off' });
    hl.busy = false; hl.on = false; hl.data = null;
    paintHl(ctx);
  }
  function hlFocus(ctx, id) { ctx.send({ type: 'render-highlight', action: 'focus', id: id }); }

  function paintHl(ctx) {
    var box = ctx.qs('#render-hl');
    if (!box) return;
    var el = ctx.el;
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'rhl-hd' }, [
      el('b', { text: 'See it on the live page' }),
      el('small', { text: 'Outlines every block that only appears after JavaScript runs — the parts non-rendering crawlers never see.' })
    ]));

    var row = el('div', { class: 'rhl-row' });
    var b = el('button', { class: 'sd-btn' + (hl.on ? '' : ' rhl-primary') });
    b.innerHTML = '<span>' + (hl.busy ? 'Working…' : (hl.on ? 'Hide highlights' : 'Highlight JS-only content')) + '</span>';
    b.disabled = hl.busy;
    b.addEventListener('click', function () { if (hl.on) hlOff(ctx); else hlOn(ctx); });
    row.appendChild(b);

    var lab = el('label', { class: 'rhl-opt' });
    var cb = el('input', { type: 'checkbox' });
    cb.checked = hl.showSsr;
    cb.addEventListener('change', function () { hl.showSsr = cb.checked; if (hl.on) hlOn(ctx); });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' Also outline server-rendered (green)'));
    row.appendChild(lab);
    box.appendChild(row);

    if (hl.err) box.appendChild(el('div', { class: 'reco-ai-err', text: hl.err }));
    if (!hl.on || !hl.data) return;

    var d = hl.data;
    box.appendChild(el('div', { class: 'rhl-sum' }, [
      el('span', { class: 'rhl-dot csr' }),
      el('span', { text: d.csr + ' block' + (d.csr === 1 ? '' : 's') + ' only appear after JavaScript' }),
      el('span', { class: 'rhl-dot ssr' }),
      el('span', { text: d.ssr + ' in the server HTML' })
    ]));
    if (!d.csr) {
      box.appendChild(el('div', { class: 'sd-note ok', text: '✓ Every visible block on this page is in the server HTML.' }));
      return;
    }
    var list = el('div', { class: 'rhl-list' });
    (d.items || []).slice(0, 60).forEach(function (it) {
      var r = el('div', { class: 'rhl-item' }, [
        el('span', { class: 'rhl-tag', text: it.tag }),
        el('span', { class: 'rhl-txt', text: it.text || '(no text)', title: it.text || '' })
      ]);
      var go = el('button', { class: 'sd-btn rhl-go', title: 'Scroll the page to this block' });
      go.innerHTML = '<span>Show</span>';
      go.addEventListener('click', function () { hlFocus(ctx, it.id); });
      r.appendChild(go);
      list.appendChild(r);
    });
    if ((d.items || []).length > 60) {
      list.appendChild(el('div', { class: 'sd-note', text: '…and ' + (d.items.length - 60) + ' more, outlined on the page.' }));
    }
    box.appendChild(list);
    if (state.data && state.data.rawBytes >= 600000) {
      box.appendChild(el('div', { class: 'sd-note',
        text: 'The server HTML was larger than 600 KB and was truncated, so blocks near the bottom of the page may be flagged incorrectly.' }));
    }
  }

  // ---- Content behind clicks ------------------------------------------------
  var CK_LABEL = {
    loadmore: 'Load-more buttons', 'lazy-toggle': 'Empty until opened', 'lazy-tab': 'Empty tabs',
    'js-link': 'Links without a URL', 'hidden-js': 'Collapsed, added by JS', 'hidden-ok': 'Collapsed, in server HTML'
  };
  var CK_ORDER = ['loadmore', 'lazy-toggle', 'lazy-tab', 'js-link', 'hidden-js', 'hidden-ok'];
  async function ckScan(ctx) {
    if (ck.busy || !state.data) return;
    ck.busy = true; ck.err = ''; paintClicks(ctx);
    var r = await ctx.send({ type: 'scan-clicks', rawHtml: state.data.http ? state.data.http.body : '' });
    ck.busy = false;
    if (r && r.ok && r.data) ck.data = r.data;
    else ck.err = (r && r.error) ? r.error : 'Could not scan this page.';
    if (ck.outlined) await ctx.send({ type: 'scan-clicks', action: 'outline', on: true });
    paintClicks(ctx);
  }
  async function ckOutline(ctx, on) {
    var r = await ctx.send({ type: 'scan-clicks', action: 'outline', on: on });
    if (r && r.ok) ck.outlined = !!r.data;
    paintClicks(ctx);
  }
  function paintClicks(ctx) {
    var box = ctx.qs('#render-clicks');
    if (!box) return;
    var el = ctx.el;
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'rhl-hd' }, [
      el('b', { text: 'Content behind clicks' }),
      el('small', { text: 'Crawlers don’t click, scroll or type. These are the places where content waits for a click.' })
    ]));
    if (ck.err) { box.appendChild(el('div', { class: 'reco-ai-err', text: ck.err })); return; }
    if (ck.busy && !ck.data) { box.appendChild(el('div', { class: 'sd-note', text: 'Scanning the page…' })); return; }
    var d = ck.data;
    if (!d) return;

    var issues = d.items.filter(function (i) { return i.kind !== 'hidden-ok'; }).length;
    var chips = el('div', { class: 'ck-chips' });
    CK_ORDER.forEach(function (k) {
      if (!d.counts[k]) return;
      chips.appendChild(el('span', { class: 'ck-chip ' + (k === 'hidden-ok' ? 'ok' : 'warn'), text: d.counts[k] + ' · ' + CK_LABEL[k] }));
    });
    if (!d.items.length) chips.appendChild(el('span', { class: 'ck-chip ok', text: 'No click-gated content found' }));
    box.appendChild(chips);

    var row = el('div', { class: 'rhl-row' });
    if (d.items.length) {
      var ob = el('button', { class: 'sd-btn' + (ck.outlined ? '' : ' ck-primary') });
      ob.innerHTML = '<span>' + (ck.outlined ? 'Hide outlines' : 'Outline on the page') + '</span>';
      ob.addEventListener('click', function () { ckOutline(ctx, !ck.outlined); });
      row.appendChild(ob);
    }
    row.appendChild(tbtn(ctx, ck.busy ? 'Scanning…' : 'Re-scan', function () { ckScan(ctx); }));
    box.appendChild(row);

    if (d.items.length) {
      var list = el('div', { class: 'rhl-list' });
      var sorted = d.items.slice().sort(function (a, b) { return CK_ORDER.indexOf(a.kind) - CK_ORDER.indexOf(b.kind); });
      sorted.forEach(function (it) {
        var r = el('div', { class: 'rhl-item' }, [
          el('span', { class: 'rhl-tag ck-tag ' + (it.kind === 'hidden-ok' ? 'ok' : ''), text: CK_LABEL[it.kind] }),
          el('span', { class: 'rhl-txt', text: it.text, title: it.tag + ' · ' + it.text })
        ]);
        var go = el('button', { class: 'sd-btn rhl-go', title: 'Scroll the page to this element' });
        go.innerHTML = '<span>Show</span>';
        go.addEventListener('click', function () { ctx.send({ type: 'scan-clicks', action: 'focus', id: it.id }); });
        r.appendChild(go);
        list.appendChild(r);
      });
      box.appendChild(list);
    }
    if (!d.rawChecked && d.items.length) box.appendChild(el('div', { class: 'sd-note',
      text: 'The server HTML could not be read, so collapsed content was not checked against it.' }));

    if (window.SEO_RECO && window.SEO_RECO_RULES) {
      box.appendChild(window.SEO_RECO.section(ctx, 'Fixes', issues ? 'Make this content reachable without a click.' : '',
        window.SEO_RECO_RULES.clicks(d), { empty: '✓ Nothing important is hidden behind a click.' }));
    }
  }

  // ---- Crawler view: Googlebot & AI bots vs browser --------------------------
  async function bvRun(ctx) {
    if (bv.busy || !state.data) return;
    bv.busy = true; bv.err = ''; bv.progress = 'Starting…'; paintBots(ctx);
    try {
      bv.data = await window.SEO_BOTVIEW.run(ctx, state.data.url, function (i, n, a) {
        bv.progress = 'Fetching as ' + a.label + ' (' + (i + 1) + '/' + n + ')…';
        paintBots(ctx);
      });
    } catch (e) { bv.err = 'The crawler comparison failed.'; }
    bv.busy = false; bv.progress = '';
    paintBots(ctx);
  }
  function paintBots(ctx) {
    var box = ctx.qs('#render-bots');
    if (!box) return;
    var el = ctx.el;
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'rhl-hd' }, [
      el('b', { text: 'Crawler view: Googlebot & AI bots' }),
      el('small', { text: 'Fetches this URL as Googlebot, Bingbot, GPTBot, ClaudeBot and PerplexityBot and compares each with what your browser gets.' })
    ]));
    var row = el('div', { class: 'rhl-row' });
    var b = el('button', { class: 'sd-btn' + (bv.data ? '' : ' ck-primary') });
    b.innerHTML = '<span>' + (bv.busy ? bv.progress : (bv.data ? 'Re-run comparison' : 'Compare crawler views')) + '</span>';
    b.disabled = bv.busy;
    b.addEventListener('click', function () { bvRun(ctx); });
    row.appendChild(b);
    box.appendChild(row);
    if (bv.err) box.appendChild(el('div', { class: 'reco-ai-err', text: bv.err }));
    if (!bv.data) return;

    var res = bv.data.results;
    var base = res.filter(function (r) { return r.key === 'browser'; })[0] || {};
    var bw = base.m && base.m.words ? base.m.words.body : 0;
    var tbl = el('div', { class: 'bv-tbl' });
    tbl.appendChild(el('div', { class: 'bv-row head' }, [
      el('div', { text: 'Crawler' }), el('div', { text: 'Status' }), el('div', { text: 'Words' }), el('div', { text: 'vs browser' })
    ]));
    res.forEach(function (r) {
      var words = r.m && r.m.words ? r.m.words.body : 0;
      var blocked = r.challenge || !r.status || r.status >= 400;
      var noidx = /noindex/i.test(r.xRobots || '') || /noindex/i.test((r.m && r.m.robots) || '');
      var verdict, tone;
      if (r.key === 'browser') { verdict = 'baseline'; tone = 'int'; }
      else if (blocked) { verdict = r.challenge ? 'challenge page' : 'blocked'; tone = 'bad'; }
      else if (noidx && !(/noindex/i.test(base.xRobots || '') || /noindex/i.test((base.m && base.m.robots) || ''))) { verdict = 'noindex'; tone = 'bad'; }
      else if (bw >= 50 && words < bw * 0.7) { verdict = 'less content'; tone = 'warn'; }
      else if (r.m && base.m && ((r.m.title || '') !== (base.m.title || '') || (r.m.canonical || '') !== (base.m.canonical || ''))) { verdict = 'differs'; tone = 'warn'; }
      else if (bw >= 50 && words > Math.max(bw * 1.3, bw + 80)) { verdict = 'pre-rendered'; tone = 'warn'; }
      else { verdict = 'same'; tone = 'ok'; }
      var name = el('div', { class: 'bv-name' }, [el('b', { text: r.label })]);
      if (r.note) name.appendChild(el('small', { text: r.note }));
      tbl.appendChild(el('div', { class: 'bv-row' }, [
        name,
        el('div', { class: 'bv-c ' + (blocked ? 'c-bad' : ''), text: r.status ? String(r.status) : '—', title: r.finalUrl || '' }),
        el('div', { class: 'bv-c', text: r.m ? String(words) : '—' }),
        el('div', { class: 'bv-v ' + tone, text: verdict })
      ]));
    });
    box.appendChild(tbl);
    box.appendChild(el('div', { class: 'sd-note',
      text: 'Sent with each crawler’s User-Agent from your connection. Some firewalls verify real bots by IP address, so a block here may not apply to the real crawler (and vice versa). Use Search Console’s URL Inspection to confirm for Googlebot.' }));
    if (window.SEO_RECO && window.SEO_RECO_RULES) {
      box.appendChild(window.SEO_RECO.section(ctx, 'Fixes', '',
        window.SEO_RECO_RULES.botview(bv.data), { empty: '✓ Every crawler gets the same page your visitors do.' }));
    }
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
    if (hl.on && hl.data && hl.data.items && hl.data.items.length) {
      out.push([]);
      out.push(['JS-only content (not in the server HTML)', 'Element', 'Text']);
      hl.data.items.forEach(function (it, i) { out.push([i + 1, it.tag, it.text]); });
    }
    return window.SEO_CSV.toCsv(out);
  }

  window.SEO_TABS.render = { init: init };
})();
