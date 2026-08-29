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

  var state = { ctx: null, running: false, data: null, links: null, scanning: false };

  function init(ctx) {
    state.ctx = ctx;
    if (state.data) render(ctx);
    else run(ctx);
  }

  function ok(r) { return r && r.ok ? r.data : null; }
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
    setStatus(ctx, 'Auditing the page — on-page, schema, tech, AI & hreflang', false);
    ctx.qs('#report-results').innerHTML = '';

    var res = await Promise.all([
      ctx.send({ type: 'analyze-onpage' }),
      ctx.send({ type: 'analyze-schema' }),
      ctx.send({ type: 'analyze-content' }),
      ctx.send({ type: 'fetch-resource', url: url, method: 'GET' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/robots.txt' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/llms.txt', method: 'HEAD' }),
      ctx.send({ type: 'check-hreflang' })
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
      headers: ok(res[3]), robots: robots, llms: ok(res[5]), hreflang: ok(res[6]), sitemap: sitemap
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
    if (state.links) add(R.links(state.links), 'Links');
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
    if (recos.length) actions.appendChild(tbtn(ctx, 'Download action plan', function () {
      window.SEO_CSV.downloadText('seo-sidekick-action-plan-' + hostOf(d) + '.txt', actionPlanText(d, recos), 'text/plain');
    }));
    if (!state.links) actions.appendChild(tbtn(ctx, state.scanning ? 'Scanning…' : 'Include broken-link scan', function () { scanLinks(ctx); }));
    wrap.appendChild(actions);

    if (!state.links) wrap.appendChild(el('div', { class: 'reco-hint-note',
      text: 'Tip: broken-link checking is off by default because it’s slower. Click “Include broken-link scan” to fold link fixes into this list.' }));

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

  window.SEO_TABS.report = { init: init };
})();
