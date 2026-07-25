/**
 * popup/tabs/tech.js — Module 9 (Technical: indexability + robots + sitemap)
 * Registers window.SEO_TABS.tech = { init }.
 *
 * On "Run checks" it combines:
 *  1. Indexability verdict — HTTP status + X-Robots-Tag header + meta robots +
 *     canonical + robots.txt Disallow → a single "Will Google index this?" answer.
 *  2. Response headers — status, X-Robots-Tag, content-type, and a few useful
 *     security/cache headers most on-page tools ignore.
 *  3. robots.txt — found?, rule count, declared sitemaps, Googlebot access.
 *  4. XML sitemap — type (index/urlset), URL count, and whether this page is in it.
 *
 * Reuses analyze-onpage for meta robots/canonical; fetches headers/robots/sitemap
 * via the worker (host_permissions bypass CORS).
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { ctx: null, running: false, data: null };

  function init(ctx) {
    state.ctx = ctx;
    ctx.qs('#tech-run').addEventListener('click', function () { run(ctx); });
    if (state.data) render(ctx, state.data);
  }

  function activeUrl(ctx) { return ctx.activeTab && ctx.activeTab.url ? ctx.activeTab.url : ''; }
  function norm(u) { try { var x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch (e) { return (u || '').replace(/#.*$/, '').replace(/\/$/, ''); } }

  async function run(ctx) {
    if (state.running) return;
    var url = activeUrl(ctx);
    if (!/^https?:\/\//i.test(url)) { setStatus(ctx, 'Open a normal website tab.', true); return; }
    var origin = '', path = '/';
    try { var u = new URL(url); origin = u.origin; path = u.pathname || '/'; } catch (e) {}

    state.running = true;
    ctx.qs('#tech-run').disabled = true;
    setStatus(ctx, 'Fetching headers, robots.txt & sitemap', false);
    ctx.qs('#tech-results').innerHTML = '';

    // meta robots/canonical + page headers + robots.txt in parallel.
    var res = await Promise.all([
      ctx.send({ type: 'analyze-onpage' }),
      ctx.send({ type: 'fetch-resource', url: url, method: 'GET' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/robots.txt' })
    ]);
    var onpage = res[0] && res[0].ok ? res[0].data : {};
    var headers = res[1] && res[1].ok ? res[1].data : null;
    var robots = res[2] && res[2].ok ? res[2].data : null;

    // Find a sitemap: declared in robots.txt, else /sitemap.xml.
    var sitemapUrl = '';
    if (robots && robots.body) {
      var m = robots.body.match(/^\s*sitemap:\s*(\S+)/im);
      if (m) sitemapUrl = m[1].trim();
    }
    if (!sitemapUrl) sitemapUrl = origin + '/sitemap.xml';
    var sitemapRes = await ctx.send({ type: 'fetch-resource', url: sitemapUrl });
    var sitemap = sitemapRes && sitemapRes.ok ? sitemapRes.data : null;

    state.running = false;
    ctx.qs('#tech-run').disabled = false;
    setStatus(ctx, '', false);
    state.data = { url: url, path: path, onpage: onpage, headers: headers, robots: robots, sitemap: sitemap, sitemapUrl: sitemapUrl };
    render(ctx, state.data);
  }

  // ---- robots.txt: minimal Googlebot allow check + sitemaps -----------------
  function parseRobots(txt) {
    var groups = [], cur = null, lastAgent = false, sitemaps = [];
    (txt || '').split(/\r?\n/).forEach(function (line) {
      var clean = line.replace(/#.*$/, '').trim();
      if (!clean) return;
      var i = clean.indexOf(':'); if (i < 0) return;
      var f = clean.slice(0, i).trim().toLowerCase(), v = clean.slice(i + 1).trim();
      if (f === 'sitemap') { sitemaps.push(v); return; }
      if (f === 'user-agent') {
        if (!lastAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
        cur.agents.push(v.toLowerCase()); lastAgent = true;
      } else if (f === 'allow' || f === 'disallow') {
        if (!cur) { cur = { agents: ['*'], rules: [] }; groups.push(cur); }
        cur.rules.push({ allow: f === 'allow', path: v }); lastAgent = false;
      } else lastAgent = false;
    });
    return { groups: groups, sitemaps: sitemaps };
  }
  function matchRule(rule, path) {
    if (rule === '') return false;
    var hasEnd = rule.slice(-1) === '$', body = hasEnd ? rule.slice(0, -1) : rule;
    var re = '^' + body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (hasEnd ? '$' : '');
    try { return new RegExp(re).test(path); } catch (e) { return path.indexOf(body.replace(/\*.*$/, '')) === 0; }
  }
  function allows(groups, ua, path) {
    ua = ua.toLowerCase(); var group = null;
    groups.forEach(function (g) { if (g.agents.indexOf(ua) !== -1) group = g; });
    if (!group) groups.forEach(function (g) { if (!group && g.agents.indexOf('*') !== -1) group = g; });
    if (!group) return true;
    var best = null;
    group.rules.forEach(function (r) {
      if (r.path === '' && !r.allow) return;
      if (matchRule(r.path, path)) {
        if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
      }
    });
    return best ? best.allow : true;
  }

  // ---- sitemap parse --------------------------------------------------------
  function parseSitemap(xml) {
    if (!xml) return null;
    var isIndex = /<sitemapindex[\s>]/i.test(xml);
    var locs = (xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).map(function (s) {
      return s.replace(/<\/?loc>/gi, '').trim();
    });
    return { isIndex: isIndex, count: locs.length, locs: locs };
  }

  // ---- render ---------------------------------------------------------------
  function render(ctx, d) {
    var el = ctx.el, esc = ctx.escapeHtml;
    var wrap = ctx.qs('#tech-results');
    wrap.innerHTML = '';

    var h = d.headers || {};
    var hdr = h.headers || {};
    var metaRobots = (d.onpage && d.onpage.robots) || '';
    var xRobots = hdr['x-robots-tag'] || '';
    var canonical = (d.onpage && d.onpage.canonical) || '';
    var canonMatches = d.onpage && d.onpage.canonicalMatchesUrl;

    var robotsParsed = d.robots && d.robots.body ? parseRobots(d.robots.body) : null;
    var robotsBlocked = false;
    if (robotsParsed && d.robots.status >= 200 && d.robots.status < 400) {
      robotsBlocked = !allows(robotsParsed.groups, 'googlebot', d.path);
    }

    // ---- Verdict ----
    var reasons = [];
    var indexable = true;
    if (h.status && (h.status < 200 || h.status >= 400)) { indexable = false; reasons.push('Page returns HTTP ' + h.status); }
    if (/noindex/i.test(metaRobots)) { indexable = false; reasons.push('Meta robots contains "noindex"'); }
    if (/noindex/i.test(xRobots)) { indexable = false; reasons.push('X-Robots-Tag header contains "noindex"'); }
    var softReasons = [];
    if (robotsBlocked) softReasons.push('robots.txt disallows crawling this path for Googlebot');
    if (canonical && !canonMatches) softReasons.push('Canonical points to a different URL (this URL may not be the indexed one)');

    var verdictCard = el('div', { class: 'verdict ' + (indexable ? (softReasons.length ? 'warn' : 'ok') : 'bad') });
    verdictCard.innerHTML =
      '<div class="verdict-ico">' + (indexable ? (softReasons.length ? '⚠' : '✓') : '✗') + '</div>' +
      '<div class="verdict-txt"><b>' +
      (indexable ? (softReasons.length ? 'Indexable, with caveats' : 'Indexable') : 'Not indexable') +
      '</b><br><span>' +
      (reasons.concat(softReasons).length ? esc(reasons.concat(softReasons).join('; ')) : 'No blockers found — meta robots, headers, status and robots.txt all allow indexing.') +
      '</span></div>';
    wrap.appendChild(verdictCard);

    // ---- Signals detail ----
    var sig = section(ctx, 'Indexability signals', [
      kv(ctx, 'HTTP status', h.status ? String(h.status) : 'n/a', (h.status >= 200 && h.status < 300) ? 'ok' : (h.status ? 'bad' : 'int')),
      kv(ctx, 'Meta robots', metaRobots || '(default index,follow)', /noindex/i.test(metaRobots) ? 'bad' : 'ok'),
      kv(ctx, 'X-Robots-Tag', xRobots || '(none)', /noindex/i.test(xRobots) ? 'bad' : (xRobots ? 'warn' : 'ok')),
      kv(ctx, 'Canonical', canonical ? (canonMatches ? 'self ✓' : 'differs ⚠') : '(none)', canonical ? (canonMatches ? 'ok' : 'warn') : 'warn'),
      kv(ctx, 'robots.txt (Googlebot)', d.robots && d.robots.status === 404 ? 'no robots.txt' : (robotsBlocked ? 'DISALLOWED' : 'allowed'), robotsBlocked ? 'bad' : 'ok')
    ]);
    wrap.appendChild(sig);

    // ---- Response headers ----
    var interesting = ['content-type', 'x-robots-tag', 'cache-control', 'content-encoding', 'server', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'vary', 'age'];
    var hSec = section(ctx, 'Response headers', []);
    if (!h.status) hSec.appendChild(el('div', { class: 'op-note warn', text: 'Could not fetch the page for headers.' }));
    else {
      hSec.appendChild(kv(ctx, 'final URL', h.finalUrl + (h.redirected ? '  (redirected)' : ''), h.redirected ? 'warn' : 'int'));
      interesting.forEach(function (k) {
        if (hdr[k]) hSec.appendChild(kv(ctx, k, hdr[k].length > 90 ? hdr[k].slice(0, 89) + '…' : hdr[k], 'int'));
      });
    }
    wrap.appendChild(hSec);

    // ---- robots.txt ----
    var rSec = section(ctx, 'robots.txt', []);
    if (!d.robots || d.robots.status === 0) rSec.appendChild(el('div', { class: 'op-note warn', text: 'Could not fetch robots.txt.' }));
    else if (d.robots.status === 404) rSec.appendChild(el('div', { class: 'op-note', text: 'No robots.txt (404) — everything is crawlable by default.' }));
    else {
      var ruleCount = robotsParsed ? robotsParsed.groups.reduce(function (a, g) { return a + g.rules.length; }, 0) : 0;
      rSec.appendChild(kv(ctx, 'Status', String(d.robots.status), 'ok'));
      rSec.appendChild(kv(ctx, 'Rules', String(ruleCount), 'int'));
      rSec.appendChild(kv(ctx, 'Sitemaps declared', String(robotsParsed ? robotsParsed.sitemaps.length : 0), 'int'));
      (robotsParsed ? robotsParsed.sitemaps : []).slice(0, 5).forEach(function (sm) {
        rSec.appendChild(el('a', { class: 'inv-href', href: sm, target: '_blank', rel: 'noreferrer', text: sm }));
      });
    }
    wrap.appendChild(rSec);

    // ---- Sitemap ----
    var sSec = section(ctx, 'XML sitemap', []);
    var sm2 = d.sitemap && d.sitemap.status >= 200 && d.sitemap.status < 400 ? parseSitemap(d.sitemap.body) : null;
    if (!sm2) {
      sSec.appendChild(el('div', { class: 'op-note warn', text: 'No readable sitemap at ' + shortUrl(d.sitemapUrl) + ' (status ' + (d.sitemap ? d.sitemap.status : '—') + ').' }));
    } else {
      sSec.appendChild(kv(ctx, 'Sitemap', shortUrl(d.sitemapUrl), 'int'));
      sSec.appendChild(kv(ctx, 'Type', sm2.isIndex ? 'sitemap index' : 'URL set', 'int'));
      sSec.appendChild(kv(ctx, sm2.isIndex ? 'Child sitemaps' : 'URLs', String(sm2.count), sm2.count ? 'ok' : 'warn'));
      if (!sm2.isIndex) {
        var present = sm2.locs.some(function (l) { return norm(l) === norm(d.url); });
        sSec.appendChild(kv(ctx, 'This page in sitemap', present ? 'yes ✓' : 'not found', present ? 'ok' : 'warn'));
        if (!present) sSec.appendChild(el('div', { class: 'op-note', text: 'Note: the page may be listed in a different child sitemap if this is part of a set.' }));
      } else {
        sSec.appendChild(el('div', { class: 'op-note', text: 'This is a sitemap index — open a child sitemap to check for the page URL.' }));
      }
    }
    wrap.appendChild(sSec);
  }

  // ---- UI helpers ----
  function section(ctx, title, kids) {
    var sec = ctx.el('div', { class: 'op-section' });
    sec.appendChild(ctx.el('div', { class: 'op-title', text: title }));
    (kids || []).forEach(function (k) { if (k) sec.appendChild(k); });
    return sec;
  }
  function kv(ctx, k, v, color) {
    var row = ctx.el('div', { class: 'op-kv' });
    row.appendChild(ctx.el('span', { class: 'op-k', text: k }));
    row.appendChild(ctx.el('span', { class: 'op-v ' + (color ? 'c-' + color : ''), text: v }));
    return row;
  }
  function shortUrl(u) { try { var x = new URL(u); return x.hostname + x.pathname; } catch (e) { return u; } }
  function setStatus(ctx, text, isErr) {
    var s = ctx.qs('#tech-status');
    s.className = 'status' + (isErr ? ' err' : (text ? ' busy' : ''));
    s.textContent = text;
  }

  window.SEO_TABS.tech = { init: init };
})();
