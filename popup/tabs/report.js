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
               bots: null, botsBusy: false, botsProgress: '',
               pageType: null, clusters: null, aiBusy: false,
               // before/after history (shared/history.js)
               hist: null, histCount: 0, histSaved: false, trend: [], newKeys: {},
               // hand-off preview currently open: null | 'email' | 'tickets'
               handoff: null };

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
    var pageHttp = ok(res[3]);
    var onpageData = ok(res[0]);
    var canonicalTarget = null;
    if (onpageData && onpageData.canonical && window.SEO_INTEL) {
      var cst = window.SEO_INTEL.canonicalAssess(url, onpageData.canonical).status;
      if (cst !== 'self' && cst !== 'missing') {
        try { canonicalTarget = ok(await ctx.send({ type: 'fetch-resource', url: new URL(onpageData.canonical, url).href, method: 'GET' })); } catch (e) {}
      }
    }
    var clicks = ok(await ctx.send({ type: 'scan-clicks', rawHtml: pageHttp && pageHttp.body ? pageHttp.body : '' }));

    state.running = false;
    setStatus(ctx, '', false);
    state.data = {
      url: url, path: path,
      onpage: ok(res[0]), schema: ok(res[1]), content: ok(res[2]),
      headers: ok(res[3]), robots: robots, llms: ok(res[5]), hreflang: ok(res[6]), sitemap: sitemap,
      rendered: ok(res[7]), rawMetrics: rawMetricsFrom(ok(res[3]), url), clicks: clicks,
      canonicalTarget: canonicalTarget
    };
    state.histSaved = false;
    await updateHistory(false);
    render(ctx);
  }

  async function checkCrawlers(ctx) {
    if (state.botsBusy || !state.data || !window.SEO_BOTVIEW) return;
    state.botsBusy = true; state.botsProgress = 'Starting…'; render(ctx);
    try {
      state.bots = await window.SEO_BOTVIEW.run(ctx, state.data.url, function (i, n, a) {
        state.botsProgress = a.label + ' (' + (i + 1) + '/' + n + ')';
        setStatus(ctx, 'Fetching as ' + state.botsProgress, false);
      });
      await updateHistory(true);
    } catch (e) { state.bots = null; }
    state.botsBusy = false; setStatus(ctx, '', false);
    render(ctx);
  }

  async function scanLinks(ctx) {
    if (state.scanning) return;
    state.scanning = true;
    setStatus(ctx, 'Scanning links (this can take a moment)', false);
    var resp = await ctx.send({ type: 'scan-links' });
    state.scanning = false;
    setStatus(ctx, '', false);
    if (resp && resp.ok) { state.links = resp.data; await updateHistory(true); render(ctx); }
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
    add(R.tech({ onpage: d.onpage, headers: d.headers, robots: d.robots, sitemap: d.sitemap, url: d.url, path: d.path,
      canonicalTarget: d.canonicalTarget }), 'Tech');
    var schemaTypes = (d.schema && d.schema.allTypes) || [];
    add(R.ai({ content: d.content, robots: d.robots, llms: d.llms, url: d.url, path: d.path, schemaTypes: schemaTypes,
      pageType: state.pageType && state.pageType.type && /^(product|article|category|home)$/.test(state.pageType.type) ? state.pageType.type : null }), 'AI/GEO');
    add(R.hreflang(d.hreflang), 'Hreflang');
    add(R.schema(d.schema), 'Schema');
    add(R.render({ raw: d.rawMetrics, rendered: d.rendered, url: d.url }), 'Render');
    if (R.clicks && d.clicks) add(R.clicks(d.clicks), 'Clicks');
    if (R.botview && state.bots) add(R.botview(state.bots), 'Crawlers');
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
  // Themes are shared with the client email / report (shared/handoff.js).
  var THEMES = (window.SEO_HANDOFF && window.SEO_HANDOFF.THEMES) || [];
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
    if (state.pageType) await updateHistory(true);
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

  // ---- Before/after history ------------------------------------------------
  // Every audit of a URL is saved on-device; the next audit is compared with it.
  // extend=true means the SAME audit grew (link scan / AI page type added), so
  // the latest snapshot is replaced rather than a new one appended.
  var BASE_SOURCES = ['On-Page', 'Tech', 'AI/GEO', 'Hreflang', 'Schema', 'Render'];
  function sameAudit(a, b) {
    if (!a || !b || a.counts.total !== b.counts.total) return false;
    if ((a.sources || []).slice().sort().join('|') !== (b.sources || []).slice().sort().join('|')) return false;
    var ka = a.issues.map(function (i) { return i.k; }).sort().join('\n');
    var kb = b.issues.map(function (i) { return i.k; }).sort().join('\n');
    return ka === kb;
  }
  async function updateHistory(extend) {
    var H = window.SEO_HISTORY;
    if (!H || !state.data) return;
    try {
      var sources = BASE_SOURCES.slice();
      if (state.data.clicks) sources.push('Clicks');
      if (state.links) sources.push('Links');
      if (state.bots) sources.push('Crawlers');
      if (state.pageType) sources.push('Page type');
      var snap = H.snapshot(aggregate(state.data), { sources: sources });
      var arr = await H.list(state.data.url);
      var last = arr[arr.length - 1];
      // An unchanged re-check (e.g. the panel reloaded) doesn't push the real
      // "last check" out of view — it refreshes the latest snapshot instead.
      var replace = (extend && state.histSaved) || sameAudit(last, snap);
      var prev = replace ? arr[arr.length - 2] : last;
      arr = await H.record(state.data.url, snap, replace);
      state.histSaved = true;
      state.hist = prev ? H.diff(prev, snap) : null;
      state.histBaseline = !!(state.hist && state.hist.baseline);
      if (state.histBaseline) state.hist = null;
      state.histCount = arr.length;
      state.trend = arr.slice(-6).map(function (x) { return x.counts.total; });
      state.newKeys = {};
      if (state.hist) state.hist.added.forEach(function (i) { state.newKeys[i.k] = true; });
    } catch (e) { /* history is a nice-to-have; never break the audit */ }
  }
  async function clearHistory(ctx) {
    if (!window.SEO_HISTORY || !state.data) return;
    await window.SEO_HISTORY.clear(state.data.url);
    state.hist = null; state.histCount = 0; state.histSaved = false; state.trend = []; state.newKeys = {};
    await updateHistory(false);
    render(ctx);
  }
  function fmtWhen(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function renderHistory(ctx, wrap) {
    var el = ctx.el, h = state.hist;
    if (!window.SEO_HISTORY || !state.histSaved) return;
    if (!h) {
      wrap.appendChild(el('div', { class: 'hist hist-first' }, state.histBaseline ? [
        el('b', { text: 'New baseline saved.' }),
        el('span', { text: ' SEO Sidekick’s recommendations were updated since your last check, so comparisons start again from this audit.' })
      ] : [
        el('b', { text: 'First check of this URL saved.' }),
        el('span', { text: ' Fix a few things, then re-run — you’ll see exactly what was fixed and what’s new.' })
      ]));
      return;
    }
    var box = el('div', { class: 'hist' });
    var head = el('div', { class: 'hist-hd' }, [
      el('b', { text: 'Since last check' }),
      el('small', { text: fmtWhen(h.prevTs) })
    ]);
    var clr = el('button', { class: 'hist-clear', type: 'button', text: 'Clear history' });
    clr.addEventListener('click', function () { clearHistory(ctx); });
    head.appendChild(clr);
    box.appendChild(head);

    box.appendChild(el('div', { class: 'hist-chips' }, [
      el('span', { class: 'hist-chip fixed', text: '✓ ' + h.fixed.length + ' fixed' }),
      el('span', { class: 'hist-chip new', text: '▲ ' + h.added.length + ' new' }),
      el('span', { class: 'hist-chip same', text: h.unchanged + ' still open' })
    ]));
    if (state.trend.length > 1) {
      box.appendChild(el('div', { class: 'hist-trend' }, [
        el('span', { text: 'Issues over the last ' + state.trend.length + ' checks: ' }),
        el('b', { text: state.trend.join(' → ') })
      ]));
    }
    if (h.fixed.length) {
      var fx = el('details', { class: 'hist-list' });
      fx.appendChild(el('summary', { text: 'Fixed since last check (' + h.fixed.length + ')' }));
      h.fixed.forEach(function (i) { fx.appendChild(el('div', { class: 'hist-item fixed', text: i.title })); });
      box.appendChild(fx);
    }
    if (h.added.length) {
      box.appendChild(el('div', { class: 'hist-note', text: 'New issues are tagged “New” in the action plan below.' }));
    }
    wrap.appendChild(box);
  }

  // ---- Hand-off: client report, client email, dev tickets ------------------
  function handoffPayload(d, recos) {
    var counts = { high: 0, med: 0, low: 0, total: recos.length };
    recos.forEach(function (r) { counts[r.sev] = (counts[r.sev] || 0) + 1; });
    var clean = recos.map(function (r) {
      return { sev: r.sev, title: r.title, detail: r.detail, source: r.source,
               current: r.current, recommended: r.recommended, code: r.code };
    });
    return { url: d.url, date: Date.now(), recos: clean, counts: counts,
             pageType: state.pageType, hist: state.hist };
  }
  var REPORT_KEEP = 5;
  async function openReport(d, recos) {
    var id = 'r' + Date.now().toString(36);
    var S = window.SEO_STORE;
    await S.set('seo_report:' + id, handoffPayload(d, recos));
    var ids = await S.get('seo_report_ids', []);
    if (!Array.isArray(ids)) ids = [];
    ids.push(id);
    if (ids.length > REPORT_KEEP) {
      var drop = ids.slice(0, ids.length - REPORT_KEEP).map(function (x) { return 'seo_report:' + x; });
      ids = ids.slice(ids.length - REPORT_KEEP);
      try { chrome.storage.local.remove(drop); } catch (e) {}
    }
    await S.set('seo_report_ids', ids);
    try { chrome.tabs.create({ url: chrome.runtime.getURL('report/report.html?id=' + id) }); } catch (e) {}
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t); return; } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e2) {}
  }
  function copyBtn(ctx, label, getText) {
    return tbtn(ctx, label, function (ev) {
      copyText(getText());
      var s = ev.currentTarget.querySelector('span'), o = s.textContent;
      s.textContent = 'Copied ✓';
      setTimeout(function () { s.textContent = o; }, 1200);
    });
  }
  function renderHandoff(ctx, wrap, d, recos) {
    var el = ctx.el, HO = window.SEO_HANDOFF;
    if (!HO) return;
    var box = el('div', { class: 'handoff' });
    box.appendChild(el('div', { class: 'handoff-hd' }, [
      el('b', { text: 'Hand off' }),
      el('small', { text: 'Share this audit with a client or your developers.' })
    ]));
    var row = el('div', { class: 'handoff-row' });
    row.appendChild(tbtn(ctx, 'Client report (PDF)', function () { openReport(d, recos); }));
    row.appendChild(tbtn(ctx, state.handoff === 'email' ? 'Hide email' : 'Client email', function () {
      state.handoff = state.handoff === 'email' ? null : 'email'; render(ctx);
    }));
    if (recos.length) row.appendChild(tbtn(ctx, state.handoff === 'tickets' ? 'Hide tickets' : 'Dev tickets', function () {
      state.handoff = state.handoff === 'tickets' ? null : 'tickets'; render(ctx);
    }));
    box.appendChild(row);

    var p = handoffPayload(d, recos), host = hostOf(d);
    if (state.handoff === 'email') {
      var m = HO.clientEmail(p);
      var full = 'Subject: ' + m.subject + '\n\n' + m.body;
      var pv = el('div', { class: 'handoff-out' });
      pv.appendChild(el('div', { class: 'handoff-sub' }, [el('span', { text: 'Subject' }), el('b', { text: m.subject })]));
      pv.appendChild(el('pre', { class: 'handoff-pre', text: m.body }));
      var acts = el('div', { class: 'handoff-row' }, [
        copyBtn(ctx, 'Copy email', function () { return full; }),
        tbtn(ctx, 'Download .txt', function () {
          window.SEO_CSV.downloadText('seo-email-' + host + '.txt', full, 'text/plain');
        })
      ]);
      var mailto = 'mailto:?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
      if (mailto.length < 1900) {
        var a = el('a', { class: 'sd-btn', href: mailto, target: '_blank', rel: 'noopener' });
        a.innerHTML = '<span>Open in email app</span>';
        acts.appendChild(a);
      }
      pv.appendChild(acts);
      pv.appendChild(el('div', { class: 'handoff-tip', text: 'Plain-language and jargon-free. Replace [Name] and [Your name], and attach the client report.' }));
      box.appendChild(pv);
    } else if (state.handoff === 'tickets') {
      var tickets = HO.devTickets(p);
      var tv = el('div', { class: 'handoff-out' });
      tv.appendChild(el('div', { class: 'handoff-row' }, [
        copyBtn(ctx, 'Copy all (Markdown)', function () { return HO.ticketsMarkdown(tickets); }),
        tbtn(ctx, 'Download .md', function () {
          window.SEO_CSV.downloadText('seo-tickets-' + host + '.md', HO.ticketsMarkdown(tickets), 'text/markdown');
        }),
        tbtn(ctx, 'Jira CSV', function () {
          window.SEO_CSV.download('seo-tickets-jira-' + host + '.csv', HO.ticketsJiraCsv(tickets));
        })
      ]));
      var list = el('div', { class: 'tk-list' });
      tickets.forEach(function (t) {
        var it = el('details', { class: 'tk' });
        it.appendChild(el('summary', {}, [
          el('span', { class: 'tk-pri ' + t.priority.toLowerCase(), text: t.priority }),
          el('span', { class: 'tk-t', text: t.title })
        ]));
        it.appendChild(el('pre', { class: 'handoff-pre', text: t.description }));
        it.appendChild(el('div', { class: 'handoff-row' }, [
          copyBtn(ctx, 'Copy ticket', function () { return '# ' + t.title + '\n\n' + t.description; })
        ]));
        list.appendChild(it);
      });
      tv.appendChild(list);
      tv.appendChild(el('div', { class: 'handoff-tip', text: 'One ticket per fix, with acceptance criteria. Paste into Linear, GitHub or Notion, or import the CSV into Jira.' }));
      box.appendChild(tv);
    }
    wrap.appendChild(box);
  }

  function render(ctx) {
    var d = state.data, el = ctx.el;
    var wrap = ctx.qs('#report-results');
    wrap.innerHTML = '';
    if (!d) return;

    var recos = aggregate(d);
    if (window.SEO_HISTORY) recos.forEach(function (r) {
      if (state.newKeys[window.SEO_HISTORY.issueKey(r)]) r.isNew = true;
    });
    var counts = { high: 0, med: 0, low: 0 };
    recos.forEach(function (r) { counts[r.sev] = (counts[r.sev] || 0) + 1; });

    // Summary scorecards.
    var grid = el('div', { class: 'sc-grid' });
    grid.appendChild(scCard(el, recos.length, 'total fixes', recos.length ? 'warn' : 'good'));
    grid.appendChild(scCard(el, counts.high, 'high priority', counts.high ? 'bad' : 'good'));
    grid.appendChild(scCard(el, counts.med, 'medium', counts.med ? 'warn' : 'muted'));
    grid.appendChild(scCard(el, counts.low, 'low', 'muted'));
    wrap.appendChild(grid);

    renderHistory(ctx, wrap);

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
    actions.appendChild(tbtn(ctx, 'Audit the whole site (bulk)', function () {
      var site = '';
      try { site = new URL(d.url).origin; } catch (e) {}
      try { chrome.tabs.create({ url: chrome.runtime.getURL('bulk/bulk.html' + (site ? '?site=' + encodeURIComponent(site) : '')) }); } catch (e) {}
    }));
    if (!state.bots && window.SEO_BOTVIEW) actions.appendChild(tbtn(ctx, state.botsBusy ? 'Checking crawlers…' : 'Include crawler check (Googlebot & AI bots)', function () { checkCrawlers(ctx); }));
    wrap.appendChild(actions);

    renderHandoff(ctx, wrap, d, recos);

    if (!state.links || !state.bots) wrap.appendChild(el('div', { class: 'reco-hint-note',
      text: 'Tip: the broken-link scan and the crawler check are off by default because they make extra requests. Use the buttons above to fold their fixes into this list.' }));

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
