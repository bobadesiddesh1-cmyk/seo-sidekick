/**
 * popup/tabs/report.js — "Fixes" tab: one consolidated, prioritised action list.
 * Registers window.SEO_TABS.report = { init }.
 *
 * Runs every fast analyzer (on-page, schema, content, headers, robots.txt,
 * llms.txt, sitemap, hreflang), then aggregates recommendations from the shared
 * rules (shared/reco-rules.js) into a single High→Low list, each tagged with the
 * tool it came from. Broken-link recommendations are added on demand (the scan
 * is slow) via a button. Lazy-init: only runs when the tab is first opened.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { ctx: null, running: false, data: null, links: null, scanning: false,
               pageType: null, clusters: null, aiBusy: false };

  function init(ctx) {
    state.ctx = ctx;
    if (state.data) render(ctx);
    else run(ctx);
  }

  function ok(r) { return r && r.ok ? r.data : null; }
  // Reuse the page GET already made for headers — no extra request.
  function rawMetricsFrom(httpRes, url) {
    try {
      if (!httpRes || !httpRes.body || !window.__SEO_extractRenderMetrics) return null;
      var doc = new DOMParser().parseFromString(httpRes.body, 'text/html');
      return window.__SEO_extractRenderMetrics(doc, url);
    } catch (e) { return null; }
  }
  function activeUrl(ctx) { return ctx.activeTab && ctx.activeTab.url ? ctx.activeTab.url : ''; }
  function setStatus(ctx, text, isErr) {
    var s = ctx.qs('#report-status');
    s.className = 'status' + (isErr ? ' err' : (text ? ' busy' : ''));
    s.textContent = text;
  }

  async function run(ctx, force) {
    if (state.running) return;
    if (state.data && !force) { render(ctx); return; }
    var url = activeUrl(ctx);
    if (!/^https?:\/\//i.test(url)) { setStatus(ctx, 'Open a normal website tab to run a full audit.', true); return; }
    var origin = '', path = '/';
    try { var u = new URL(url); origin = u.origin; path = u.pathname || '/'; } catch (e) {}

    state.running = true;
    setStatus(ctx, 'Auditing the page — on-page, schema, tech, AI, hreflang & rendering', false);
    ctx.qs('#report-results').innerHTML = '';

    var res = await Promise.all([
      ctx.send({ type: 'analyze-onpage' }),
      ctx.send({ type: 'analyze-schema' }),
      ctx.send({ type: 'analyze-content' }),
      ctx.send({ type: 'fetch-resource', url: url, method: 'GET' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/robots.txt' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/llms.txt', method: 'HEAD' }),
      ctx.send({ type: 'check-hreflang' }),
      ctx.send({ type: 'analyze-rendered' })
    ]);
    var robots = ok(res[4]);
    var sitemapUrl = origin + '/sitemap.xml';
    if (robots && robots.body) { var m = robots.body.match(/^\s*sitemap:\s*(\S+)/im); if (m) sitemapUrl = m[1].trim(); }
    var sitemap = ok(await ctx.send({ type: 'fetch-resource', url: sitemapUrl }));

    state.running = false;
    setStatus(ctx, '', false);
    state.data = {
      url: url, path: path,
      onpage: ok(res[0]), schema: ok(res[1]), content: ok(res[2]),
      headers: ok(res[3]), robots: robots, llms: ok(res[5]), hreflang: ok(res[6]), sitemap: sitemap,
      rendered: ok(res[7]), rawMetrics: rawMetricsFrom(ok(res[3]), url)
    };
    render(ctx);
  }

  async function scanLinks(ctx) {
    if (state.scanning) return;
    state.scanning = true;
    setStatus(ctx, 'Scanning links (this can take a moment)', false);
    var resp = await ctx.send({ type: 'scan-links' });
    state.scanning = false;
    setStatus(ctx, '', false);
    if (resp && resp.ok) { state.links = resp.data; render(ctx); }
    else setStatus(ctx, (resp && resp.error) ? resp.error : 'Link scan failed.', true);
  }

  function aggregate(d) {
    var R = window.SEO_RECO_RULES, all = [];
    function add(list, src) {
      (list || []).forEach(function (r) {
        var c = {}; for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
        c.source = c.source || src; all.push(c);
      });
    }
    if (!R) return all;
    add(R.onpage(d.onpage), 'On-Page');
    add(R.tech({ onpage: d.onpage, headers: d.headers, robots: d.robots, sitemap: d.sitemap, url: d.url, path: d.path }), 'Tech');
    add(R.ai({ content: d.content, robots: d.robots, llms: d.llms, url: d.url, path: d.path }), 'AI/GEO');
    add(R.hreflang(d.hreflang), 'Hreflang');
    add(R.schema(d.schema), 'Schema');
    add(R.render({ raw: d.rawMetrics, rendered: d.rendered, url: d.url }), 'Render');
    if (state.links) add(R.links(state.links), 'Links');
    add(pageTypeRecos(d), 'Page type');
    // Dedupe: the same fix can be reported by two tools (e.g. a canonical
    // mismatch shows in On-Page and Tech). Collapse them, combining sources.
    var seen = {}, out = [];
    all.forEach(function (r) {
      var key = r.title + '|' + (r.current == null ? '' : r.current) + '|' + (r.recommended == null ? '' : r.recommended);
      if (seen[key]) {
        var prev = seen[key];
        if (prev.source.indexOf(r.source) === -1) prev.source += ' · ' + r.source;
      } else { seen[key] = r; out.push(r); }
    });
    return out;
  }


  // ---- Page-type awareness ------------------------------------------------
  // Once the model classifies the page, we expect the schema that page type
  // actually needs, instead of checking every page identically.
  var EXPECTED_SCHEMA = {
    product: { types: ['Product'], label: 'Product' },
    article: { types: ['Article', 'NewsArticle', 'BlogPosting'], label: 'Article' },
    localbusiness: { types: ['LocalBusiness', 'Organization'], label: 'LocalBusiness' },
    homepage: { types: ['Organization', 'WebSite'], label: 'Organization + WebSite' },
    category: { types: ['ItemList', 'CollectionPage'], label: 'ItemList' },
    contact: { types: ['Organization', 'LocalBusiness'], label: 'Organization' }
  };
  function pageTypeRecos(d) {
    var pt = state.pageType;
    if (!pt || !pt.type) return [];
    var exp = EXPECTED_SCHEMA[pt.type];
    if (!exp) return [];
    var have = (d.schema && d.schema.allTypes) || [];
    var hit = exp.types.some(function (t) { return have.indexOf(t) !== -1; });
    if (hit) return [];
    return [{
      sev: pt.type === 'product' || pt.type === 'localbusiness' ? 'high' : 'med',
      title: 'This looks like a ' + pt.type + ' page but has no ' + exp.label + ' schema',
      detail: (pt.why ? pt.why + ' ' : '') +
        'Pages of this type are expected to carry ' + exp.types.join(' or ') +
        ' structured data — without it you cannot win the rich results this page type qualifies for.',
      current: have.length ? ('schema found: ' + have.slice(0, 6).join(', ')) : 'no schema on the page',
      recommended: 'add ' + exp.label + ' schema'
    }];
  }

  // ---- Root-cause clustering ----------------------------------------------
  // Grouping is deterministic (reliable); the model only narrates the fix.
  var THEMES = [
    { key: 'render', label: 'Client-side rendering', test: function (r) { return r.source === 'Render' || /JavaScript/i.test(r.title); } },
    { key: 'index', label: 'Indexability & crawling', test: function (r) { return /noindex|robots\.txt|HTTP status|sitemap|canonical/i.test(r.title); } },
    { key: 'meta', label: 'Titles, meta & snippets', test: function (r) { return /title|meta description|Open Graph|H1/i.test(r.title); } },
    { key: 'schema', label: 'Structured data', test: function (r) { return r.source === 'Schema' || /schema|JSON-LD/i.test(r.title); } },
    { key: 'geo', label: 'AI search readiness', test: function (r) { return r.source === 'AI/GEO' || /AI crawler|llms\.txt/i.test(r.title); } },
    { key: 'intl', label: 'International (hreflang)', test: function (r) { return r.source === 'Hreflang'; } },
    { key: 'content', label: 'Content quality', test: function (r) { return /alt text|writing|paragraph|takeaway|heading/i.test(r.title); } },
    { key: 'links', label: 'Links', test: function (r) { return r.source === 'Links' || /broken link|redirect/i.test(r.title); } }
  ];
  var SEVW = { high: 3, med: 2, low: 1 };
  function clusterRecos(recos) {
    var used = {}, groups = [];
    THEMES.forEach(function (t) {
      var items = recos.filter(function (r, i) { return !used[i] && t.test(r); });
      recos.forEach(function (r, i) { if (!used[i] && t.test(r)) used[i] = true; });
      if (items.length >= 2) groups.push({ label: t.label, items: items,
        weight: items.reduce(function (a, r) { return a + (SEVW[r.sev] || 1); }, 0) });
    });
    groups.sort(function (a, b) { return b.weight - a.weight; });
    return groups.slice(0, 5);
  }

  async function runAiInsight(ctx) {
    if (state.aiBusy) return;
    state.aiBusy = true; render(ctx);
    try {
      var pc = await ctx.pageContext();
      if (!pc) throw new Error('no context');
      // 1) classify the page
      try {
        var t = await window.SEO_AI.run('pageType', pc);
        if (t.variants && t.variants[0]) {
          var j = JSON.parse(t.variants[0].text);
          if (j && j.type) state.pageType = { type: String(j.type).toLowerCase(), confidence: j.confidence || '', why: j.why || '' };
        }
      } catch (e) { /* classification is best-effort */ }
      // 2) narrate the deterministic clusters
      try {
        var groups = clusterRecos(aggregate(state.data));
        if (groups.length) {
          var text = groups.map(function (g, i) {
            return (i + 1) + '. ' + g.label + ': ' + g.items.map(function (r) { return r.title; }).join('; ');
          }).join('\n');
          var c = await window.SEO_AI.run('cluster', { url: state.data.url, clusterText: text });
          groups.forEach(function (g, i) { g.fix = (c.variants[i] && c.variants[i].text) || ''; });
        }
        state.clusters = groups;
      } catch (e) { state.clusters = clusterRecos(aggregate(state.data)); }
    } catch (e) { /* surfaced by the empty state below */ }
    state.aiBusy = false; render(ctx);
  }

  function renderAiInsight(ctx, wrap, recos) {
    var el = ctx.el;
    var sec = el('div', { class: 'ai-insight' });
    var head = el('div', { class: 'ai-insight-hd' }, [
      el('span', { class: 'ai-spark', text: '✨' }),
      el('div', {}, [
        el('b', { text: 'AI insight' }),
        el('small', { text: 'Runs entirely on your device — page type + what is actually causing these issues.' })
      ])
    ]);
    sec.appendChild(head);

    if (state.pageType) {
      var pt = state.pageType;
      sec.appendChild(el('div', { class: 'ai-ptype' }, [
        el('span', { class: 'ai-ptype-tag', text: pt.type }),
        el('span', { class: 'ai-ptype-why', text: (pt.why || '') + (pt.confidence ? ' (' + pt.confidence + ' confidence)' : '') })
      ]));
    }
    (state.clusters || []).forEach(function (g) {
      var box = el('div', { class: 'ai-cluster' });
      box.appendChild(el('div', { class: 'ai-cluster-hd' }, [
        el('b', { text: g.label }),
        el('span', { class: 'ai-cluster-n', text: g.items.length + ' issues' })
      ]));
      if (g.fix) box.appendChild(el('div', { class: 'ai-cluster-fix', text: '→ ' + g.fix }));
      box.appendChild(el('div', { class: 'ai-cluster-items',
        text: g.items.map(function (r) { return r.title; }).join(' · ') }));
      sec.appendChild(box);
    });

    if (!state.pageType && !state.clusters) {
      sec.appendChild(el('div', { class: 'ai-insight-cta' }, [
        tbtn(ctx, state.aiBusy ? 'Analysing…' : 'Analyse this page with on-device AI',
          function () { runAiInsight(ctx); })
      ]));
    }
    wrap.appendChild(sec);
  }

  function render(ctx) {
    var d = state.data, el = ctx.el;
    var wrap = ctx.qs('#report-results');
    wrap.innerHTML = '';
    if (!d) return;

    var recos = aggregate(d);
    var counts = { high: 0, med: 0, low: 0 };
    recos.forEach(function (r) { counts[r.sev] = (counts[r.sev] || 0) + 1; });

    // Summary scorecards.
    var grid = el('div', { class: 'sc-grid' });
    grid.appendChild(scCard(el, recos.length, 'total fixes', recos.length ? 'warn' : 'good'));
    grid.appendChild(scCard(el, counts.high, 'high priority', counts.high ? 'bad' : 'good'));
    grid.appendChild(scCard(el, counts.med, 'medium', counts.med ? 'warn' : 'muted'));
    grid.appendChild(scCard(el, counts.low, 'low', 'muted'));
    wrap.appendChild(grid);

    // Toolbar.
    var actions = el('div', { class: 'sd-actions' });
    actions.appendChild(tbtn(ctx, 'Re-run audit', function () { run(ctx, true); }));
    if (recos.length) actions.appendChild(tbtn(ctx, 'Export CSV (Excel)', function () {
      window.SEO_CSV.download('seo-sidekick-issues-' + hostOf(d) + '.csv', issuesCsv(d, recos));
    }));
    if (recos.length) actions.appendChild(tbtn(ctx, 'Download action plan (.txt)', function () {
      window.SEO_CSV.downloadText('seo-sidekick-action-plan-' + hostOf(d) + '.txt', actionPlanText(d, recos), 'text/plain');
    }));
    if (!state.links) actions.appendChild(tbtn(ctx, state.scanning ? 'Scanning…' : 'Include broken-link scan', function () { scanLinks(ctx); }));
    wrap.appendChild(actions);

    if (!state.links) wrap.appendChild(el('div', { class: 'reco-hint-note',
      text: 'Tip: broken-link checking is off by default because it’s slower. Click “Include broken-link scan” to fold link fixes into this list.' }));

    // AI insight (page type + root causes) — only where on-device AI can run.
    if (window.SEO_AI && window.SEO_RECO) {
      window.SEO_AI.availability().then(function (a) {
        if (a === 'unsupported' || a === 'unavailable') return;
        if (ctx.qs('#report-results .ai-insight')) return;
        var holder = ctx.el('div');
        renderAiInsight(ctx, holder, recos);
        var anchor = ctx.qs('#report-results .reco-section');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(holder.firstChild, anchor);
      });
    }

    // The consolidated, prioritised action list (High → Low), each tagged by tool.
    wrap.appendChild(window.SEO_RECO.section(ctx, 'Action plan',
      'Everything to fix on this page, most important first — copy or download the code for each.',
      recos, { empty: '✓ No issues found across the page. Great job!' }));
  }

  function scCard(el, num, label, tone) {
    return el('div', { class: 'sc-card ' + (tone || '') }, [
      el('div', { class: 'sc-num', text: String(num) }),
      el('div', { class: 'sc-lbl', text: label })
    ]);
  }
  function tbtn(ctx, label, onClick) {
    var b = ctx.el('button', { class: 'sd-btn' });
    b.innerHTML = '<span>' + ctx.escapeHtml(label) + '</span>';
    b.addEventListener('click', onClick);
    return b;
  }
  function hostOf(d) { try { return new URL(d.url).hostname; } catch (e) { return 'page'; } }

  function actionPlanText(d, recos) {
    var order = { high: 0, med: 1, low: 2 };
    var list = recos.slice().sort(function (a, b) { return (order[a.sev] || 1) - (order[b.sev] || 1); });
    var L = [];
    L.push('SEO Sidekick — Action plan');
    L.push('URL: ' + d.url);
    L.push('Generated: ' + new Date().toString());
    L.push('Total: ' + recos.length + ' recommendation(s)');
    L.push('=====================================================');
    L.push('');
    list.forEach(function (r, i) {
      L.push((i + 1) + '. [' + (r.sev || 'med').toUpperCase() + '] (' + (r.source || '') + ') ' + r.title);
      if (r.detail) L.push('   ' + r.detail);
      if (r.current != null) L.push('   Now: ' + r.current);
      if (r.recommended != null) L.push('   Use: ' + r.recommended);
      if (r.code) { L.push('   Fix:'); r.code.split('\n').forEach(function (ln) { L.push('     ' + ln); }); }
      L.push('');
    });
    return L.join('\n');
  }

  // Export every issue + recommendation as an Excel-friendly CSV (one row each).
  function issuesCsv(d, recos) {
    var order = { high: 0, med: 1, low: 2 };
    var PLABEL = { high: 'High', med: 'Medium', low: 'Low' };
    var list = recos.slice().sort(function (a, b) { return (order[a.sev] || 1) - (order[b.sev] || 1); });
    var rows = [['#', 'Priority', 'Source', 'Issue', 'Explanation', 'Current value', 'Recommended value', 'Fix code', 'Page URL']];
    list.forEach(function (r, i) {
      rows.push([
        i + 1,
        PLABEL[r.sev] || 'Medium',
        r.source || '',
        r.title || '',
        r.detail || '',
        r.current == null ? '' : r.current,
        r.recommended == null ? '' : r.recommended,
        r.code || '',
        d.url || ''
      ]);
    });
    return window.SEO_CSV.toCsv(rows);
  }

  window.SEO_TABS.report = { init: init };
})();
