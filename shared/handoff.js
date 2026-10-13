/**
 * shared/handoff.js — turn the action plan into things you hand to people.
 *
 *   clientEmail(payload)   -> { subject, body }   jargon-free, business framing
 *   devTickets(payload)    -> [ticket]            one per fix, with acceptance criteria
 *   ticketsMarkdown(t)     -> string              paste into Linear / GitHub / Notion
 *   ticketsJiraCsv(t)      -> string              Jira CSV import
 *   reportBody(payload)    -> HTML string         the shareable client report
 *   reportHtml(payload)    -> full standalone HTML document (inline CSS, no scripts)
 *   THEMES, themeOf(r)     -> shared issue themes (also used for root-cause clustering)
 *
 * Everything is deterministic — no AI needed, so it works for every user.
 *
 * payload = { url, date, recos:[reco], counts:{high,med,low,total},
 *             pageType?:{type,why}, hist?:{fixed:[],added:[],prevTs}, clusters? }
 */
(function () {
  'use strict';

  var THEMES = [
    { key: 'render', label: 'Client-side rendering', test: function (r) { return r.source === 'Render' || (r.source !== 'Clicks' && r.source !== 'Crawlers') && /JavaScript|client-side/i.test(r.title); },
      plain: 'Parts of the page only appear after JavaScript runs, so Google sees them late and AI assistants such as ChatGPT may not see them at all.' },
    { key: 'index', label: 'Indexability & crawling', test: function (r) { return (r.source === 'Crawlers' || /noindex|robots\.txt|HTTP status|sitemap|canonical|crawler view|blocked for/i.test(r.title)) && !/AI crawlers/i.test(r.title); },
      plain: 'Some settings affect whether search engines can find, crawl and index this page.' },
    { key: 'meta', label: 'Titles, meta & snippets', test: function (r) { return /title|meta description|Open Graph|H1/i.test(r.title); },
      plain: 'The title and description people see in Google results can be improved to earn more clicks.' },
    { key: 'schema', label: 'Structured data', test: function (r) { return r.source === 'Schema' || r.source === 'Page type' || /schema|JSON-LD/i.test(r.title); },
      plain: 'Structured data that lets Google show rich results (stars, prices, FAQs) is missing or incomplete.' },
    { key: 'geo', label: 'AI search readiness', test: function (r) { return r.source === 'AI/GEO' || /AI crawler|llms\.txt/i.test(r.title); },
      plain: 'The page could be easier for AI search tools to read, trust and quote.' },
    { key: 'clicks', label: 'Content behind clicks', test: function (r) { return r.source === 'Clicks' || /load more|behind a click|tab panel|accordion/i.test(r.title); },
      plain: 'Some content only loads when a visitor clicks, and search engines don’t click.' },
    { key: 'intl', label: 'International (hreflang)', test: function (r) { return r.source === 'Hreflang'; },
      plain: 'Language and region tags for international visitors need attention.' },
    { key: 'content', label: 'Content quality', test: function (r) { return /alt text|writing|paragraph|takeaway|heading/i.test(r.title); },
      plain: 'A few content improvements (image descriptions, readability) would help both visitors and search engines.' },
    { key: 'links', label: 'Links', test: function (r) { return r.source === 'Links' || /broken link|redirect/i.test(r.title); },
      plain: 'Some links are broken or redirect, which wastes visitors’ time and crawl budget.' }
  ];
  var OTHER = { key: 'other', label: 'Other improvements', plain: 'Other technical improvements.' };
  var SEVW = { high: 3, med: 2, low: 1 };
  var ORDER = { high: 0, med: 1, low: 2 };
  var PLABEL = { high: 'High', med: 'Medium', low: 'Low' };

  function themeOf(r) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].test(r)) return THEMES[i];
    return OTHER;
  }
  function sorted(recos) {
    return (recos || []).slice().sort(function (a, b) { return (ORDER[a.sev] == null ? 1 : ORDER[a.sev]) - (ORDER[b.sev] == null ? 1 : ORDER[b.sev]); });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u || 'the page'; } }
  function path(u) { try { return new URL(u).pathname || '/'; } catch (e) { return '/'; } }
  function fmtDate(ts) {
    try { return new Date(ts || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return ''; }
  }
  function firstSentence(s) {
    s = String(s || '').trim();
    var m = s.match(/^.*?[.!?](\s|$)/);
    return (m ? m[0] : s).trim();
  }
  function groupByTheme(recos) {
    var map = {}, out = [];
    sorted(recos).forEach(function (r) {
      var t = themeOf(r);
      if (!map[t.key]) { map[t.key] = { theme: t, items: [], weight: 0, high: 0 }; out.push(map[t.key]); }
      map[t.key].items.push(r);
      map[t.key].weight += SEVW[r.sev] || 1;
      if (r.sev === 'high') map[t.key].high++;
    });
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out;
  }

  // ---- client email ---------------------------------------------------------
  function clientEmail(p) {
    var recos = sorted(p.recos), c = p.counts || {};
    var h = host(p.url);
    var subject = 'SEO review for ' + h + ': ' + (c.total || recos.length) + ' improvements' +
      (c.high ? ', ' + c.high + ' high priority' : '');
    var L = [];
    L.push('Hi [Name],');
    L.push('');
    L.push('I ran a technical SEO check on ' + p.url + ' on ' + fmtDate(p.date) + '. Here’s the short version.');
    L.push('');
    if (!recos.length) {
      L.push('Good news: nothing needs fixing on this page right now.');
    } else {
      L.push('The headline: ' + recos.length + ' improvement' + (recos.length === 1 ? '' : 's') +
        (c.high ? ', of which ' + c.high + (c.high === 1 ? ' is' : ' are') + ' high priority' : '') + '.');
      if (p.hist && (p.hist.fixed.length || p.hist.added.length)) {
        L.push('Since the last check on ' + fmtDate(p.hist.prevTs) + ', ' + p.hist.fixed.length + ' issue' +
          (p.hist.fixed.length === 1 ? ' has' : 's have') + ' been resolved and ' + p.hist.added.length + ' new one' +
          (p.hist.added.length === 1 ? ' has' : 's have') + ' appeared.');
      }
      L.push('');
      L.push('What needs attention:');
      groupByTheme(recos).forEach(function (g) {
        L.push('• ' + g.theme.label + ' — ' + g.theme.plain + ' (' + g.items.length + ' item' +
          (g.items.length === 1 ? '' : 's') + (g.high ? ', ' + g.high + ' high priority' : '') + ')');
      });
      L.push('');
      L.push('What I’d fix first:');
      recos.slice(0, 3).forEach(function (r, i) {
        L.push((i + 1) + '. ' + r.title + (r.detail ? ' — ' + firstSentence(r.detail) : ''));
      });
    }
    L.push('');
    L.push('The full report with the exact fix for each item is attached. Happy to walk you through it.');
    L.push('');
    L.push('Best,');
    L.push('[Your name]');
    return { subject: subject, body: L.join('\n') };
  }

  // ---- dev tickets ----------------------------------------------------------
  var AC_RULES = [
    [/blocked for|crawler view|crawlers are served/i, function () { return ['The URL returns HTTP 200 with the same page for the listed crawler user-agent(s) as for a browser, verified against the CDN/WAF rules']; }],
    [/canonical/i, function (r) { return ['View Source shows <link rel="canonical" href="' + (r.recommended && /^https?:/.test(r.recommended) ? r.recommended : '<this page URL>') + '">']; }],
    [/noindex/i, function () { return ['Neither the meta robots tag nor the X-Robots-Tag header contains "noindex"']; }],
    [/robots\.txt/i, function () { return ['robots.txt no longer disallows this URL for Googlebot']; }],
    [/AI crawler/i, function () { return ['robots.txt allows GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Google-Extended on this path']; }],
    [/sitemap/i, function () { return ['The URL is listed in the XML sitemap', 'The sitemap is referenced from robots.txt']; }],
    [/HTTP status/i, function () { return ['The URL returns HTTP 200']; }],
    [/meta description/i, function () { return ['A meta description of 70–160 characters is present', 'It is in the server HTML (View Source), not added by JavaScript']; }],
    [/title/i, function () { return ['The <title> is 30–60 characters and describes the page', 'The title is in the server HTML (View Source), not added by JavaScript']; }],
    [/H1/i, function () { return ['View Source shows exactly one <h1>']; }],
    [/alt text/i, function () { return ['Every meaningful <img> has a descriptive alt attribute; decorative images use alt=""']; }],
    [/schema|JSON-LD|structured data|FAQPage/i, function () { return ['The JSON-LD passes Google’s Rich Results Test with no errors', 'The JSON-LD is present in the server HTML']; }],
    [/load more|behind a click|tab panel|accordion/i, function () { return ['The content is reachable without clicking: present in the server HTML, or linked with crawlable <a href> pagination']; }],
    [/JavaScript|client-side|server-render/i, function () { return ['The content is present in View Source (server HTML) without JavaScript', 'SEO Sidekick’s Render tab shows this content as server-rendered']; }],
    [/hreflang/i, function () { return ['Every hreflang alternate returns a reciprocal tag', 'All codes are valid ISO 639-1 (+ optional ISO 3166-1)']; }],
    [/can.t follow/i, function () { return ['Each listed item is an <a href="…"> pointing to a real URL', 'The target pages are reachable without JavaScript']; }],
    [/collapsed section/i, function () { return ['The collapsed content is present in View Source (server HTML)']; }],
    [/broken link/i, function () { return ['Every listed link returns HTTP 200, or has been removed']; }],
    [/redirect/i, function () { return ['Internal links point straight to the final URL (no redirect hop)']; }],
    [/viewport/i, function () { return ['<meta name="viewport" content="width=device-width, initial-scale=1"> is present']; }],
    [/language/i, function () { return ['<html> has a lang attribute matching the page language']; }],
    [/Open Graph/i, function () { return ['og:title, og:description and og:image are present; og:image is at least 1200×630']; }]
  ];
  function acceptance(r) {
    var out = [];
    for (var i = 0; i < AC_RULES.length; i++) {
      if (AC_RULES[i][0].test(r.title)) { out = AC_RULES[i][1](r); break; }
    }
    out.push('Re-running SEO Sidekick on this URL no longer shows this item');
    return out;
  }
  function slug(s) { return String(s || 'seo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function devTickets(p) {
    return sorted(p.recos).map(function (r, i) {
      var t = themeOf(r);
      var D = [];
      D.push('**Page:** ' + p.url);
      D.push('**Area:** ' + t.label + (r.source ? ' (found by SEO Sidekick · ' + r.source + ')' : ''));
      D.push('');
      if (r.detail) { D.push(r.detail); D.push(''); }
      if (r.current != null) D.push('**Current:** `' + String(r.current).replace(/`/g, "'") + '`');
      if (r.recommended != null) D.push('**Expected:** `' + String(r.recommended).replace(/`/g, "'") + '`');
      if (r.current != null || r.recommended != null) D.push('');
      if (r.code) { D.push('**Suggested fix:**'); D.push('```'); D.push(r.code); D.push('```'); D.push(''); }
      D.push('**Acceptance criteria**');
      acceptance(r).forEach(function (a) { D.push('- [ ] ' + a); });
      return {
        n: i + 1,
        title: '[SEO] ' + r.title + ' — ' + path(p.url),
        priority: PLABEL[r.sev] || 'Medium',
        labels: ['seo', slug(t.label)],
        description: D.join('\n')
      };
    });
  }
  function ticketsMarkdown(tickets) {
    return tickets.map(function (t) {
      return '## ' + t.n + '. ' + t.title + '\n**Priority:** ' + t.priority + ' · **Labels:** ' + t.labels.join(', ') + '\n\n' + t.description;
    }).join('\n\n---\n\n');
  }
  function ticketsJiraCsv(tickets) {
    var rows = [['Summary', 'Description', 'Priority', 'Labels', 'Labels']];
    tickets.forEach(function (t) { rows.push([t.title, t.description, t.priority, t.labels[0], t.labels[1] || '']); });
    return window.SEO_CSV.toCsv(rows);
  }

  // ---- shareable report -----------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var REPORT_CSS =
    ':root{--ok:#16a34a;--warn:#d97706;--bad:#dc2626;--acc:#0d9488;--fg:#12303a;--soft:#5b6473;--bd:#e2e6ec}' +
    '*{box-sizing:border-box}body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--fg);background:#fff}' +
    '.wrap{max-width:860px;margin:0 auto;padding:36px 28px 48px}' +
    '.hd{border-bottom:3px solid var(--acc);padding-bottom:16px;margin-bottom:22px}' +
    '.hd small{color:var(--soft);font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}' +
    '.hd h1{margin:6px 0 4px;font-size:26px;letter-spacing:-.01em}.hd .u{color:var(--acc);word-break:break-all;font-size:13.5px}' +
    '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 22px}' +
    '.c{border:1px solid var(--bd);border-radius:10px;padding:12px 14px}.c b{display:block;font-size:24px;line-height:1.1}' +
    '.c span{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--soft)}' +
    '.c.h b{color:var(--bad)}.c.m b{color:var(--warn)}.c.l b{color:var(--acc)}' +
    'h2{font-size:17px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--bd)}' +
    '.note{background:#f5f7fa;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:10px}' +
    '.note.g{background:#ecfdf3}.th{margin:6px 0;font-size:13.5px}.th b{color:var(--fg)}' +
    '.it{border:1px solid var(--bd);border-left:4px solid var(--soft);border-radius:9px;padding:11px 14px;margin:0 0 10px;page-break-inside:avoid;break-inside:avoid}' +
    '.it.high{border-left-color:var(--bad)}.it.med{border-left-color:var(--warn)}.it.low{border-left-color:var(--acc)}' +
    '.it .t{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.it .t b{font-size:14px}' +
    '.sev{font-size:10px;font-weight:800;text-transform:uppercase;color:#fff;border-radius:5px;padding:2px 7px}' +
    '.sev.high{background:var(--bad)}.sev.med{background:var(--warn)}.sev.low{background:var(--acc)}' +
    '.src{margin-left:auto;font-size:10.5px;font-weight:700;color:var(--soft);background:#eef2f7;border-radius:20px;padding:2px 8px}' +
    '.d{color:var(--soft);font-size:13px;margin-top:5px}.kv{font-size:12.5px;margin-top:6px}.kv code{background:#f5f7fa;border:1px solid var(--bd);border-radius:5px;padding:1px 6px;word-break:break-all}' +
    'pre{background:#0d1117;color:#c9d1d9;border-radius:7px;padding:10px 12px;font:11.5px/1.5 Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;margin:8px 0 0}' +
    '.ft{margin-top:34px;padding-top:12px;border-top:1px solid var(--bd);color:var(--soft);font-size:11.5px}.ft a{color:var(--acc)}' +
    '@media print{.wrap{padding:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit}}' +
    '@media(max-width:600px){.cards{grid-template-columns:repeat(2,1fr)}}';

  function reportBody(p) {
    var recos = sorted(p.recos), c = p.counts || {};
    var H = [];
    H.push('<div class="wrap">');
    H.push('<div class="hd"><small>Technical SEO report · ' + esc(fmtDate(p.date)) + '</small>' +
      '<h1>' + esc(host(p.url)) + '</h1><div class="u">' + esc(p.url) + '</div></div>');
    H.push('<div class="cards">' +
      '<div class="c"><b>' + (c.total || recos.length) + '</b><span>Improvements</span></div>' +
      '<div class="c h"><b>' + (c.high || 0) + '</b><span>High priority</span></div>' +
      '<div class="c m"><b>' + (c.med || 0) + '</b><span>Medium</span></div>' +
      '<div class="c l"><b>' + (c.low || 0) + '</b><span>Low</span></div></div>');
    if (p.pageType && p.pageType.type) {
      H.push('<div class="note">Page type: <b>' + esc(p.pageType.type) + '</b>' + (p.pageType.why ? ' — ' + esc(p.pageType.why) : '') + '</div>');
    }
    if (p.hist && (p.hist.fixed.length || p.hist.added.length)) {
      H.push('<div class="note g">Since the last check on ' + esc(fmtDate(p.hist.prevTs)) + ': <b>' + p.hist.fixed.length +
        ' fixed</b>, <b>' + p.hist.added.length + ' new</b>.</div>');
    }
    if (recos.length) {
      H.push('<h2>Summary</h2>');
      groupByTheme(recos).forEach(function (g) {
        H.push('<div class="th"><b>' + esc(g.theme.label) + '</b> (' + g.items.length + ') — ' + esc(g.theme.plain) + '</div>');
      });
      H.push('<h2>Action plan</h2>');
      recos.forEach(function (r, i) {
        H.push('<div class="it ' + esc(r.sev) + '"><div class="t"><span class="sev ' + esc(r.sev) + '">' + (PLABEL[r.sev] || 'Medium') + '</span>' +
          '<b>' + (i + 1) + '. ' + esc(r.title) + '</b>' + (r.source ? '<span class="src">' + esc(r.source) + '</span>' : '') + '</div>' +
          (r.detail ? '<div class="d">' + esc(r.detail) + '</div>' : '') +
          (r.current != null ? '<div class="kv">Now: <code>' + esc(r.current) + '</code></div>' : '') +
          (r.recommended != null ? '<div class="kv">Use: <code>' + esc(r.recommended) + '</code></div>' : '') +
          (r.code ? '<pre>' + esc(r.code) + '</pre>' : '') + '</div>');
      });
    } else {
      H.push('<div class="note g">No issues found on this page. ✔</div>');
    }
    H.push('<div class="ft">Generated with SEO Sidekick, a free Chrome extension by ' +
      '<a href="https://www.buildwithsiddesh.com/">BuildWithSiddesh</a>. All checks ran locally in the browser.</div>');
    H.push('</div>');
    return H.join('');
  }
  function reportHtml(p) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>SEO report — ' + esc(host(p.url)) + '</title><style>' + REPORT_CSS + '</style></head><body>' +
      reportBody(p) + '</body></html>';
  }

  window.SEO_HANDOFF = {
    THEMES: THEMES, themeOf: themeOf, groupByTheme: groupByTheme,
    clientEmail: clientEmail, devTickets: devTickets, acceptance: acceptance,
    ticketsMarkdown: ticketsMarkdown, ticketsJiraCsv: ticketsJiraCsv,
    reportBody: reportBody, reportHtml: reportHtml, REPORT_CSS: REPORT_CSS
  };
})();
