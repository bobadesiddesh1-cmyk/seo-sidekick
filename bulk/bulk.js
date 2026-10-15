/**
 * bulk/bulk.js — site audit: many pages at once, from a sitemap or a URL list.
 *
 * Each page's server HTML is fetched through the worker ('fetch-resource':
 * cookie-less, like a crawler) and parsed with DOMParser + the shared extractor
 * (inject/render-extract.js), so no tab is opened and no JavaScript runs — this
 * is what non-rendering crawlers and most AI bots see. Page checks are
 * deterministic; site-wide checks (duplicate titles / descriptions) run once
 * all pages are in.
 *
 * Concurrency 4, cap 500 pages. The last audit per site is kept on-device.
 */
(function () {
  'use strict';

  var CONCURRENCY = 4;
  var HARD_MAX = 500;
  var MAX_SITEMAPS = 25;
  var SAVE_KEY = 'seo_bulk_last';

  var state = { mode: 'sitemap', running: false, stop: false, pages: [], site: '', ts: 0,
                filter: null, sort: 'score', open: {} };

  // ---- tiny DOM helpers ------------------------------------------------------
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function btn(label, onClick, cls) {
    var b = el('button', { class: 'sd-btn' + (cls ? ' ' + cls : ''), type: 'button' }, [el('span', { text: label })]);
    b.addEventListener('click', onClick);
    return b;
  }
  function setStatus(t, isErr) {
    var s = $('#bk-status');
    s.className = 'status' + (isErr ? ' err' : (t ? ' busy' : ''));
    s.textContent = t || '';
  }
  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(r || { ok: false });
        });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  }
  async function fetchText(url) {
    var r = await send({ type: 'fetch-resource', url: url, method: 'GET' });
    return r && r.ok ? r.data : null;
  }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'site'; } }
  function pathOf(u) { try { var x = new URL(u); return (x.pathname || '/') + x.search; } catch (e) { return u; } }
  function normUrl(u) { try { var x = new URL(u); x.hash = ''; return x.href; } catch (e) { return ''; } }

  // ---- URL discovery -------------------------------------------------------
  async function sitemapUrls(input, max) {
    var start = String(input || '').trim();
    if (!/^https?:\/\//i.test(start)) start = 'https://' + start;
    var candidates = [], fallbacks = [];
    if (/\.xml(\?|$)/i.test(start) || /sitemap/i.test(start)) candidates.push(start);
    else {
      var origin = originOf(start);
      if (!origin) throw new Error('That does not look like a URL.');
      setStatus('Looking for the sitemap in robots.txt…');
      var robots = await fetchText(origin + '/robots.txt');
      if (robots && robots.status === 200 && robots.body) {
        robots.body.split(/\r?\n/).forEach(function (ln) {
          var m = ln.match(/^\s*sitemap:\s*(\S+)/i);
          if (m) candidates.push(m[1].trim());
        });
      }
      fallbacks = [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
      candidates = candidates.concat(fallbacks);
    }

    var urls = [], seen = {}, queue = candidates.slice(), visited = {}, fetched = 0, found = false;
    while (queue.length && urls.length < max && fetched < MAX_SITEMAPS) {
      var sm = queue.shift();
      if (visited[sm]) continue;
      visited[sm] = true; fetched++;
      setStatus('Reading ' + sm + '…');
      var r = await fetchText(sm);
      if (!r || r.status !== 200 || !r.body) continue;
      if (/\.gz(\?|$)/i.test(sm) && !/<urlset|<sitemapindex/i.test(r.body.slice(0, 2000))) continue;
      var doc = new DOMParser().parseFromString(r.body, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) continue;
      var root = doc.documentElement && doc.documentElement.localName;
      if (root === 'sitemapindex') {
        found = true;
        Array.prototype.forEach.call(doc.getElementsByTagNameNS('*', 'loc'), function (n) { queue.push(n.textContent.trim()); });
      } else if (root === 'urlset') {
        found = true;
        Array.prototype.some.call(doc.getElementsByTagNameNS('*', 'url'), function (u) {
          var loc = u.getElementsByTagNameNS('*', 'loc')[0];
          var v = loc ? normUrl(loc.textContent.trim()) : '';
          if (v && !seen[v]) { seen[v] = 1; urls.push(v); }
          return urls.length >= max;
        });
        // The guessed locations are only needed until a real sitemap works.
        if (fallbacks.length) queue = queue.filter(function (q) { return fallbacks.indexOf(q) === -1; });
      }
    }
    if (!found) throw new Error('No readable XML sitemap was found. Try the sitemap’s exact URL, or paste URLs instead.');
    return urls;
  }
  function listUrls(text, max) {
    var out = [], seen = {};
    String(text || '').split(/[\s,]+/).forEach(function (t) {
      if (!t || out.length >= max) return;
      if (!/^https?:\/\//i.test(t)) return;
      var v = normUrl(t);
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }

  // ---- page audit ----------------------------------------------------------
  function auditPage(url, r, fromSitemap) {
    var p = { url: url, status: r ? r.status : 0, finalUrl: r ? r.finalUrl : url, redirected: !!(r && r.redirected),
              issues: [], title: '', words: 0 };
    function add(sev, title, detail) { p.issues.push({ sev: sev, title: title, detail: detail || '' }); }
    if (!r || !r.status) { add('high', 'Page did not respond', r && r.error === 'timeout' ? 'Timed out after 15 seconds.' : 'The server could not be reached.'); return finish(p); }
    if (r.status >= 400) { add('high', 'Returns HTTP ' + r.status, fromSitemap ? 'Sitemaps should list only live pages (HTTP 200).' : 'This URL is an error page.'); return finish(p); }
    if (p.redirected && normUrl(r.finalUrl) !== normUrl(url)) {
      add('med', 'Redirects to another URL', (fromSitemap ? 'List the final URL in the sitemap instead: ' : 'Ends at: ') + r.finalUrl);
    }
    var ct = (r.headers && r.headers['content-type']) || '';
    if (ct && !/html/i.test(ct)) { add('low', 'Not an HTML page', 'Content-Type: ' + ct); return finish(p); }

    var doc, m;
    try { doc = new DOMParser().parseFromString(r.body || '', 'text/html'); m = window.__SEO_extractRenderMetrics(doc, r.finalUrl || url); }
    catch (e) { m = null; }
    if (!m) { add('med', 'Could not parse the HTML'); return finish(p); }

    p.title = m.title || '';
    p.description = m.metaDescription || '';
    p.words = (m.words && m.words.body) || 0;
    p.h1 = (m.headingCounts && m.headingCounts.h1) || 0;
    p.canonical = m.canonical || '';
    p.schema = (m.jsonLd && m.jsonLd.types) || [];
    var xr = (r.headers && r.headers['x-robots-tag']) || '';
    p.noindex = /noindex/i.test(m.robots || '') || /noindex/i.test(xr);

    var I = window.SEO_INTEL;
    var cx = (I && I.urlContext(r.finalUrl || url)) || {};
    var ptype = I ? I.pageType({ url: r.finalUrl || url, schemaTypes: p.schema }) : 'other';
    var lowValue = cx.isSearch || cx.isUtility || cx.isPaginated;
    var ca = I ? I.canonicalAssess(r.finalUrl || url, p.canonical) : null;
    p.canonStatus = ca ? ca.status : '';
    p.paginated = !!cx.isPaginated;

    if (p.noindex) {
      if (fromSitemap) add('high', 'Noindex page is listed in the sitemap',
        'Sitemaps should only list pages you want indexed. Either remove the noindex or remove the URL from the sitemap; the two signals contradict each other.');
      else if (!(I && I.noindexExpected(r.finalUrl || url))) add('high', 'Page is set to noindex', 'Search engines will keep this page out of results. Fine for utility pages; remove it if the page should rank.');
    }
    if (fromSitemap && ca && ca.status === 'different') add('med', 'Sitemap lists a URL that canonicalises elsewhere',
      'This URL’s canonical points to ' + p.canonical + '. Sitemaps should list only canonical URLs, so list that one instead.');
    if (fromSitemap && cx.hasTracking) add('med', 'Sitemap URL contains tracking parameters',
      'List the clean URL' + (I ? ' (' + I.preferredUrl(url) + ')' : '') + ' so search engines don’t crawl duplicate versions.');
    if (!p.title) add('high', 'Missing title');
    else if (!lowValue && p.title.length > 65) add('low', 'Title may be cut off in search results', p.title.length + ' characters. Google shows about 55–60 on desktop; length is not a ranking factor, so just keep the important words first.');
    else if (p.title.length < 15) add('low', 'Title is very short', p.title.length + ' characters. Room for a more descriptive title.');
    if (!lowValue) {
      if (!p.description) add('med', 'Missing meta description', 'Google will build its own snippet. Not a ranking factor, but a specific description usually earns more clicks.');
      else if (p.description.length > 160) add('low', 'Meta description may be cut off', p.description.length + ' characters. Google shows about 155–160 on desktop.');
      else if (p.description.length < 50) add('low', 'Meta description is very short', p.description.length + ' characters.');
    }
    if (!p.h1) add('med', 'Missing H1');
    else if (p.h1 > 1) add('low', 'Multiple H1s', p.h1 + ' H1 headings. Fine for Google; one main heading is clearer for accessibility.');
    if (ca) {
      // Judged like the panel does: a canonical that drops tracking, sorting or
      // page-1 parameters is correct; staging, homepage or page-N→1 are not.
      ca.findings.forEach(function (f) {
        if (f.sev === 'low' && p.canonical) return;
        if (fromSitemap && ca.status === 'different') return;   // reported above, in sitemap terms
        add(f.sev, f.title.replace(/\b\d+\b/g, 'N'), (f.current ? 'Now: ' + f.current + '. ' : '') + (f.recommended ? 'Use: ' + f.recommended + '. ' : '') + f.detail);
      });
    } else if (!p.canonical) add('low', 'Missing canonical');

    var fw = m.frameworks || [];
    if (p.words < 50 && fw.length) add('high', 'Almost no content in the server HTML', 'Only ' + p.words + ' words before JavaScript runs (' + fw.join(', ') + ') — likely client-rendered. AI crawlers that don’t run JavaScript see an empty page.');
    else if (p.words < 200 && !p.noindex && (ptype === 'article' || ptype === 'other')) add('low', 'Thin content', p.words + ' words in the server HTML. Check the page answers its topic fully.');
    var SCHEMA_FOR = { product: 'Product', article: 'Article', home: 'Organization or WebSite' };
    if (!p.schema.length && SCHEMA_FOR[ptype]) add('low', 'No structured data', 'This looks like a ' + ptype + ' page; ' + SCHEMA_FOR[ptype] + ' markup would describe it to search engines.');
    var imgs = m.images || {};
    if (imgs.total && imgs.withAlt < imgs.total) add('low', 'Images missing alt text', (imgs.total - imgs.withAlt) + ' of ' + imgs.total + ' images.');
    try {
      if (!doc.documentElement.getAttribute('lang')) add('low', 'Missing lang attribute');
      if (!doc.querySelector('meta[name="viewport"]')) add('med', 'Missing viewport meta tag', 'Needed for mobile-first indexing.');
    } catch (e) {}
    return finish(p);
  }
  var W = { high: 15, med: 6, low: 2 };
  function finish(p) {
    p.counts = { high: 0, med: 0, low: 0 };
    p.issues.forEach(function (i) { p.counts[i.sev]++; });
    // A page that errors or does not respond has nothing worth scoring.
    p.score = (!p.status || p.status >= 400) ? 0
      : Math.max(0, 100 - p.issues.reduce(function (n, i) { return n + W[i.sev]; }, 0));
    return p;
  }
  // Site-wide pass: duplicates only show up across pages.
  function siteChecks(pages) {
    function dup(field, title, sev) {
      var map = {};
      pages.forEach(function (p) {
        // A redirecting URL is the same page as its target, not a duplicate of it.
        // Duplicates by design aren't problems: redirects, noindex, pages that
        // canonicalise elsewhere and later pages of a paginated series.
        if (p.noindex || p.paginated || p.canonStatus === 'different' || (p.redirected && normUrl(p.finalUrl) !== normUrl(p.url))) return;
        var v = (p[field] || '').trim().toLowerCase();
        if (v) (map[v] = map[v] || []).push(p);
      });
      Object.keys(map).forEach(function (k) {
        var g = map[k];
        if (g.length < 2) return;
        g.forEach(function (p) {
          p.issues.push({ sev: sev, title: title, detail: 'Shared with ' + (g.length - 1) + ' other page' + (g.length > 2 ? 's' : '') + ': ' +
            g.filter(function (x) { return x !== p; }).slice(0, 3).map(function (x) { return pathOf(x.url); }).join(', ') });
          finish(p);
        });
      });
    }
    pages.forEach(function (p) { p.issues = p.issues.filter(function (i) { return !/^Duplicate /.test(i.title); }); finish(p); });
    dup('title', 'Duplicate title', 'med');
    dup('description', 'Duplicate meta description', 'low');
  }

  // ---- run -----------------------------------------------------------------
  async function start() {
    if (state.running) return;
    var max = Math.min(HARD_MAX, parseInt($('#bk-max').value, 10) || 100);
    var urls, fromSitemap = state.mode === 'sitemap';
    setStatus('');
    try {
      if (fromSitemap) {
        var v = $('#bk-sitemap').value.trim();
        if (!v) { setStatus('Enter a sitemap URL or a site address.', true); return; }
        state.running = true; paintControls();
        urls = await sitemapUrls(v, max);
      } else {
        urls = listUrls($('#bk-list').value, max);
        if (!urls.length) { setStatus('Paste at least one URL starting with http:// or https://', true); return; }
      }
    } catch (e) {
      state.running = false; paintControls();
      setStatus(e.message || 'Could not read the sitemap.', true);
      return;
    }
    if (!urls.length) { state.running = false; paintControls(); setStatus('The sitemap has no URLs.', true); return; }

    state.running = true; state.stop = false; state.pages = []; state.filter = null; state.open = {};
    state.site = originOf(urls[0]); state.ts = Date.now();
    paintControls();
    var done = 0, next = 0, results = new Array(urls.length);
    progress(0, urls.length);
    async function worker() {
      while (!state.stop) {
        var i = next++;
        if (i >= urls.length) return;
        var r = await fetchText(urls[i]);
        results[i] = auditPage(urls[i], r, fromSitemap);
        done++;
        progress(done, urls.length);
        if (done % 10 === 0 || done === urls.length) { state.pages = results.filter(Boolean); paintResults(); }
      }
    }
    var pool = [];
    for (var w = 0; w < Math.min(CONCURRENCY, urls.length); w++) pool.push(worker());
    await Promise.all(pool);

    state.pages = results.filter(Boolean);
    siteChecks(state.pages);
    state.running = false;
    paintControls();
    setStatus(state.stop ? 'Stopped after ' + state.pages.length + ' of ' + urls.length + ' pages.' : '');
    $('#bk-progress').hidden = true;
    paintResults();
    save();
  }
  function progress(done, total) {
    var bar = $('#bk-progress');
    bar.hidden = false;
    bar.firstElementChild.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    if (state.running) setStatus('Auditing ' + done + ' of ' + total + ' pages…');
  }
  function paintControls() {
    $('#bk-start').hidden = state.running;
    $('#bk-stop').hidden = !state.running;
  }

  async function save() {
    try {
      await window.SEO_STORE.set(SAVE_KEY, { site: state.site, ts: state.ts, mode: state.mode, pages: state.pages });
    } catch (e) {}
  }
  async function restore(site) {
    var last = await window.SEO_STORE.get(SAVE_KEY, null);
    if (!last || !last.pages || !last.pages.length) return;
    if (site && last.site && originOf(site) !== last.site) return;
    state.pages = last.pages; state.site = last.site; state.ts = last.ts;
    paintResults();
  }

  // ---- results -------------------------------------------------------------
  var LABEL = { high: 'High', med: 'Medium', low: 'Low' };
  function scoreTone(s) { return s >= 85 ? 'ok' : s >= 60 ? 'warn' : 'bad'; }
  function issueSummary(pages) {
    var map = {};
    pages.forEach(function (p) {
      p.issues.forEach(function (i) {
        var k = i.title;
        if (!map[k]) map[k] = { title: i.title, sev: i.sev, pages: 0 };
        map[k].pages++;
      });
    });
    var order = { high: 0, med: 1, low: 2 };
    return Object.keys(map).map(function (k) { map[k].key = k; return map[k]; })
      .sort(function (a, b) { return (order[a.sev] - order[b.sev]) || (b.pages - a.pages); });
  }

  function paintResults() {
    var wrap = $('#bk-results');
    wrap.innerHTML = '';
    var pages = state.pages;
    if (!pages.length) return;

    var hi = pages.filter(function (p) { return p.counts.high; }).length;
    var avg = Math.round(pages.reduce(function (n, p) { return n + p.score; }, 0) / pages.length);
    var total = pages.reduce(function (n, p) { return n + p.issues.length; }, 0);
    wrap.appendChild(el('div', { class: 'bk-meta' }, [
      el('b', { text: hostOf(state.site) }),
      el('span', { text: ' · ' + new Date(state.ts).toLocaleString() + (state.running ? ' · in progress' : '') })
    ]));
    wrap.appendChild(el('div', { class: 'sc-grid bk-cards' }, [
      card(pages.length, 'pages checked', ''),
      card(avg, 'average score', scoreTone(avg) === 'ok' ? 'good' : scoreTone(avg) === 'warn' ? 'warn' : 'bad'),
      card(hi, 'pages with high-priority issues', hi ? 'bad' : 'good'),
      card(total, 'issues in total', total ? 'warn' : 'good')
    ]));

    var acts = el('div', { class: 'sd-actions' }, [
      btn('Export pages CSV', function () { window.SEO_CSV.download('seo-site-audit-pages-' + hostOf(state.site) + '.csv', pagesCsv()); }),
      btn('Export issues CSV', function () { window.SEO_CSV.download('seo-site-audit-issues-' + hostOf(state.site) + '.csv', issuesCsv()); })
    ]);
    wrap.appendChild(acts);

    // Top issues across the site.
    var sum = issueSummary(pages);
    var top = el('div', { class: 'bk-card' });
    top.appendChild(el('div', { class: 'bk-h' }, [el('b', { text: 'Top issues across the site' }),
      el('small', { text: 'Click an issue to see only the pages that have it.' })]));
    if (!sum.length) top.appendChild(el('div', { class: 'reco-empty', text: '✓ No issues found on any page.' }));
    var list = el('div', { class: 'bk-issues' });
    sum.forEach(function (s) {
      var row = el('button', { class: 'bk-issue' + (state.filter === s.key ? ' on' : ''), type: 'button' }, [
        el('span', { class: 'reco-sev ' + s.sev, text: LABEL[s.sev] }),
        el('span', { class: 'bk-issue-t', text: s.title }),
        el('span', { class: 'bk-issue-n', text: s.pages + ' page' + (s.pages === 1 ? '' : 's') })
      ]);
      row.addEventListener('click', function () { state.filter = state.filter === s.key ? null : s.key; paintResults(); });
      list.appendChild(row);
    });
    top.appendChild(list);
    wrap.appendChild(top);

    // Pages table.
    var shown = pages.filter(function (p) {
      return !state.filter || p.issues.some(function (i) { return i.title === state.filter; });
    }).slice().sort(function (a, b) { return state.sort === 'url' ? a.url.localeCompare(b.url) : a.score - b.score; });
    var tb = el('div', { class: 'bk-card' });
    var head = el('div', { class: 'bk-h' }, [
      el('b', { text: state.filter ? 'Pages with this issue (' + shown.length + ')' : 'All pages (' + shown.length + ')' }),
      el('small', { text: 'Worst first. Click a page to see its issues.' })
    ]);
    if (state.filter) head.appendChild(btn('Show all pages', function () { state.filter = null; paintResults(); }, 'bk-mini'));
    tb.appendChild(head);
    var tbl = el('div', { class: 'bk-tbl' });
    tbl.appendChild(el('div', { class: 'bk-tr head' }, [
      el('div', { text: 'Page' }), el('div', { text: 'Status' }), el('div', { text: 'Score' }), el('div', { text: 'Issues' })
    ]));
    shown.forEach(function (p) {
      var tr = el('div', { class: 'bk-tr' + (state.open[p.url] ? ' open' : '') }, [
        el('div', { class: 'bk-url' }, [el('span', { text: pathOf(p.url) }), el('small', { text: p.title || '' })]),
        el('div', { class: 'bk-st ' + (p.status >= 200 && p.status < 300 && !p.redirected ? '' : 'bad'), text: p.status ? String(p.status) + (p.redirected ? ' →' : '') : '—' }),
        el('div', {}, [el('span', { class: 'bk-score ' + scoreTone(p.score), text: String(p.score) })]),
        el('div', { class: 'bk-cnt' }, [
          p.counts.high ? el('span', { class: 'reco-sev high', text: String(p.counts.high) }) : null,
          p.counts.med ? el('span', { class: 'reco-sev med', text: String(p.counts.med) }) : null,
          p.counts.low ? el('span', { class: 'reco-sev low', text: String(p.counts.low) }) : null,
          !p.issues.length ? el('span', { class: 'bk-okc', text: '✓' }) : null
        ])
      ]);
      tr.addEventListener('click', function () { state.open[p.url] = !state.open[p.url]; paintResults(); });
      tbl.appendChild(tr);
      if (state.open[p.url]) {
        var det = el('div', { class: 'bk-det' });
        det.appendChild(el('a', { href: p.url, target: '_blank', rel: 'noopener', text: p.url }));
        var order = { high: 0, med: 1, low: 2 };
        p.issues.slice().sort(function (a, b) { return order[a.sev] - order[b.sev]; }).forEach(function (i) {
          det.appendChild(el('div', { class: 'bk-di' }, [
            el('span', { class: 'reco-sev ' + i.sev, text: LABEL[i.sev] }),
            el('b', { text: i.title }),
            i.detail ? el('span', { class: 'bk-dd', text: i.detail }) : null
          ]));
        });
        if (!p.issues.length) det.appendChild(el('div', { class: 'reco-empty', text: '✓ No issues on this page.' }));
        tbl.appendChild(det);
      }
    });
    tb.appendChild(tbl);
    wrap.appendChild(tb);
    wrap.appendChild(el('p', { class: 'bk-hint', text: 'Checks the server HTML only (no JavaScript), like most AI crawlers. Open a page in the SEO Sidekick panel for the full audit including rendering, schema details and links.' }));
  }
  function card(num, label, tone) {
    return el('div', { class: 'sc-card ' + (tone || '') }, [el('div', { class: 'sc-num', text: String(num) }), el('div', { class: 'sc-lbl', text: label })]);
  }

  function pagesCsv() {
    var rows = [['URL', 'Status', 'Final URL', 'Score', 'High', 'Medium', 'Low', 'Title', 'Title length', 'Meta description length', 'H1 count', 'Words (server HTML)', 'Canonical', 'Noindex', 'Schema types', 'Issues']];
    state.pages.forEach(function (p) {
      rows.push([p.url, p.status, p.finalUrl || '', p.score, p.counts.high, p.counts.med, p.counts.low, p.title || '', (p.title || '').length,
        (p.description || '').length, p.h1 || 0, p.words || 0, p.canonical || '', p.noindex ? 'yes' : 'no', (p.schema || []).join(', '),
        p.issues.map(function (i) { return i.title; }).join('; ')]);
    });
    return window.SEO_CSV.toCsv(rows);
  }
  function issuesCsv() {
    var rows = [['URL', 'Priority', 'Issue', 'Detail']];
    state.pages.forEach(function (p) { p.issues.forEach(function (i) { rows.push([p.url, LABEL[i.sev], i.title, i.detail || '']); }); });
    return window.SEO_CSV.toCsv(rows);
  }

  // ---- wire up -------------------------------------------------------------
  function setMode(m) {
    state.mode = m;
    document.querySelectorAll('.bk-seg-b').forEach(function (b) {
      var on = b.getAttribute('data-mode') === m;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.bk-mode').forEach(function (d) { d.hidden = d.getAttribute('data-mode') !== m; });
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.bk-seg-b').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
    $('#bk-start').addEventListener('click', start);
    $('#bk-stop').addEventListener('click', function () { state.stop = true; setStatus('Stopping…'); });
    var site = new URLSearchParams(location.search).get('site') || '';
    if (site) $('#bk-sitemap').value = site;
    restore(site);
  });

  window.__SEO_bulk = { auditPage: auditPage, siteChecks: siteChecks, listUrls: listUrls };
})();
