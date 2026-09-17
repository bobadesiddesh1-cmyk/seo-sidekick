/**
 * shared/reco-rules.js — the recommendation RULES (logic layer).
 *
 * Pure functions that turn analyzer output into recommendation objects (the
 * shape consumed by shared/recos.js). Centralised here so every tab AND the
 * consolidated "Fixes" tab compute the same recommendations from one place.
 *
 * window.SEO_RECO_RULES = {
 *   onpage(onpageData) -> [reco]
 *   tech({onpage, headers, robots, sitemap, url, path}) -> [reco]
 *   ai({content, robots, llms, url, path}) -> [reco]
 *   hreflang(hreflangData) -> [reco]
 *   links(scanData) -> [reco]
 *   schema(schemaData) -> [reco]
 * }
 */
(function () {
  'use strict';

  function selfUrl(u) { try { var x = new URL(u); x.hash = ''; return x.href; } catch (e) { return u || ''; } }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
  function pathOf(u) { try { return new URL(u).pathname || '/'; } catch (e) { return '/'; } }
  function norm(u) { try { var x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch (e) { return (u || '').replace(/#.*$/, '').replace(/\/$/, ''); } }

  // ---- robots.txt / sitemap parsing (self-contained) ----------------------
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
  function robotsAllows(groups, ua, path) {
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
  function parseSitemap(xml) {
    if (!xml) return null;
    var isIndex = /<sitemapindex[\s>]/i.test(xml);
    var locs = (xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).map(function (s) { return s.replace(/<\/?loc>/gi, '').trim(); });
    return { isIndex: isIndex, count: locs.length, locs: locs };
  }

  // ---- On-Page ------------------------------------------------------------
  function onpage(d) {
    if (!d) return [];
    var recos = [], self = selfUrl(d.url);
    var t = d.title || {}, md = d.metaDescription || {}, hc = d.headingCounts || {}, im = d.images || {};
    if (!t.length) recos.push({ sev: 'high', title: 'Add a page <title>',
      detail: 'This page has no title tag — the single strongest on-page ranking signal.',
      code: '<title>Primary keyword — Brand</title>', codeName: 'title.html' });
    else if (t.length > 60) recos.push({ sev: 'med', title: 'Shorten the title',
      detail: 'The title is ' + t.length + ' characters; keep it ~50–60 so Google doesn’t truncate it.', current: t.text });
    else if (t.length < 15) recos.push({ sev: 'low', title: 'Expand the title',
      detail: 'The title is only ' + t.length + ' characters — add your primary keyword and brand.', current: t.text });
    if (!md.length) recos.push({ sev: 'high', title: 'Add a meta description',
      detail: 'No meta description — write a 70–160 character summary with your key term to lift click-through.',
      code: '<meta name="description" content="A compelling 150–160 character summary that includes your primary keyword.">', codeName: 'meta-description.html' });
    else if (md.length > 160) recos.push({ sev: 'med', title: 'Trim the meta description',
      detail: 'It’s ' + md.length + ' characters; keep it ≤160 so it isn’t cut off in search.', current: md.text });
    else if (md.length < 70) recos.push({ sev: 'low', title: 'Lengthen the meta description',
      detail: 'It’s only ' + md.length + ' characters; 70–160 gives Google more to show.', current: md.text });
    if ((hc.h1 || 0) === 0) recos.push({ sev: 'high', title: 'Add exactly one H1',
      detail: 'No H1 found — every page needs one clear top-level heading.', code: '<h1>Your main page heading</h1>', codeName: 'h1.html' });
    else if ((hc.h1 || 0) > 1) recos.push({ sev: 'med', title: 'Use a single H1',
      detail: 'Found ' + hc.h1 + ' H1 tags; keep one H1 and demote the rest to H2/H3.' });
    if (/noindex/i.test(d.robots || '')) recos.push({ sev: 'high', title: 'Remove “noindex” if unintended',
      detail: 'The meta robots tag contains noindex, so this page won’t be indexed.',
      current: d.robots, recommended: 'index,follow', code: '<meta name="robots" content="index,follow">', codeName: 'robots-meta.html' });
    if (!d.canonical) recos.push({ sev: 'med', title: 'Add a self-referencing canonical',
      detail: 'No canonical tag. Add one pointing to this page’s preferred URL to consolidate ranking signals.',
      current: '(none)', recommended: self, code: '<link rel="canonical" href="' + self + '">', codeName: 'canonical.html' });
    else if (!d.canonicalMatchesUrl) recos.push({ sev: 'med', title: 'Canonical points to a different URL',
      detail: 'This page canonicalises to another URL, so Google may index that one instead. If that’s intentional (a duplicate), leave it; otherwise point it at this page.',
      current: d.canonical, recommended: self, code: '<link rel="canonical" href="' + self + '">', codeName: 'canonical.html' });
    if ((im.missingAlt || 0) > 0) recos.push({ sev: 'med', title: 'Add alt text to images',
      detail: im.missingAlt + ' image(s) have no alt attribute. Describe each meaningful image (use alt="" for purely decorative ones).' });
    if (!d.viewport) recos.push({ sev: 'med', title: 'Add a responsive viewport',
      detail: 'No viewport meta tag — required for a mobile-friendly page.',
      code: '<meta name="viewport" content="width=device-width, initial-scale=1">', codeName: 'viewport.html' });
    if (!d.lang) recos.push({ sev: 'low', title: 'Set the page language',
      detail: 'The <html> tag has no lang attribute; set it for accessibility and international SEO.', code: '<html lang="en">', codeName: 'lang.html' });
    var og = d.openGraph || {};
    if (!og['og:title'] || !og['og:image']) recos.push({ sev: 'low', title: 'Add Open Graph tags',
      detail: 'Missing og:title/og:image — add them so shared links show a rich preview on social and chat apps.',
      code: '<meta property="og:title" content="Page title">\n<meta property="og:description" content="Short description">\n<meta property="og:image" content="https://example.com/share-1200x630.jpg">', codeName: 'open-graph.html' });
    return recos;
  }

  // ---- Tech / indexability ------------------------------------------------
  function tech(d) {
    if (!d) return [];
    var op = d.onpage || {}, h = d.headers || {}, hdr = h.headers || {};
    var self = selfUrl(d.url), origin = originOf(d.url), path = d.path || pathOf(d.url);
    var metaRobots = op.robots || '', xRobots = hdr['x-robots-tag'] || '';
    var canonical = op.canonical || '', canonMatches = op.canonicalMatchesUrl;
    var robotsParsed = d.robots && d.robots.body ? parseRobots(d.robots.body) : null;
    var robotsBlocked = false;
    if (robotsParsed && d.robots.status >= 200 && d.robots.status < 400) robotsBlocked = !robotsAllows(robotsParsed.groups, 'googlebot', path);
    var sm2 = d.sitemap && d.sitemap.status >= 200 && d.sitemap.status < 400 ? parseSitemap(d.sitemap.body) : null;

    var recos = [];
    if (h.status && (h.status < 200 || h.status >= 400)) recos.push({ sev: 'high', title: 'Fix the HTTP status',
      detail: 'The page returns HTTP ' + h.status + '. Google only indexes pages that return 200 OK.', current: 'HTTP ' + h.status, recommended: 'HTTP 200' });
    if (/noindex/i.test(metaRobots)) recos.push({ sev: 'high', title: 'Remove noindex (meta robots)',
      detail: 'Meta robots contains noindex — the page is being kept out of the index.', current: metaRobots, recommended: 'index,follow',
      code: '<meta name="robots" content="index,follow">', codeName: 'robots-meta.html' });
    if (/noindex/i.test(xRobots)) recos.push({ sev: 'high', title: 'Remove noindex (X-Robots-Tag)',
      detail: 'The X-Robots-Tag response header contains noindex. Update your server / CDN header config.', current: xRobots });
    if (robotsBlocked) recos.push({ sev: 'high', title: 'Allow Googlebot in robots.txt',
      detail: 'robots.txt disallows crawling ' + path + ' for Googlebot. Allow it if this page should be indexed.',
      code: 'User-agent: Googlebot\nAllow: ' + path, codeName: 'robots-allow.txt' });
    if (canonical && !canonMatches) recos.push({ sev: 'med', title: 'Canonical points to a different URL',
      detail: 'This page canonicalises to another URL, so Google may index that one instead. Point it here if that’s unintended.',
      current: canonical, recommended: self, code: '<link rel="canonical" href="' + self + '">', codeName: 'canonical.html' });
    else if (!canonical) recos.push({ sev: 'low', title: 'Add a self-referencing canonical',
      detail: 'No canonical tag was found. Add one pointing to this page’s preferred URL.',
      current: '(none)', recommended: self, code: '<link rel="canonical" href="' + self + '">', codeName: 'canonical.html' });
    if (!sm2) recos.push({ sev: 'med', title: 'Publish an XML sitemap',
      detail: 'No readable sitemap was found. Create one and declare it in robots.txt so Google can discover your URLs.',
      code: 'Sitemap: ' + origin + '/sitemap.xml', codeName: 'robots-sitemap.txt' });
    else if (!sm2.isIndex) {
      var present = sm2.locs.some(function (l) { return norm(l) === norm(d.url); });
      if (!present) recos.push({ sev: 'med', title: 'Add this URL to your sitemap',
        detail: 'This page wasn’t found in the sitemap. Add it so Google discovers and recrawls it faster.', current: 'not in sitemap', recommended: self });
    }
    if (h.redirected && h.finalUrl && norm(h.finalUrl) !== norm(d.url)) recos.push({ sev: 'low', title: 'Link to the final URL directly',
      detail: 'This URL redirects. Update internal links to point at the final URL to save a redirect hop.', current: d.url, recommended: h.finalUrl });
    return recos;
  }

  // ---- AI / GEO -----------------------------------------------------------
  function ai(d) {
    if (!d) return [];
    var recos = [], c = d.content || {}, path = d.path || pathOf(d.url);
    (c.extractability && c.extractability.signals || []).forEach(function (s) {
      if (!s.ok) recos.push({ sev: 'med', title: s.label, detail: s.hint || 'Improve this to be more extractable by AI answer engines.' });
    });
    if (d.robots && d.robots.body) {
      var parsed = parseRobots(d.robots.body);
      var important = [['GPTBot', 'ChatGPT'], ['OAI-SearchBot', 'ChatGPT Search'], ['ClaudeBot', 'Claude'], ['PerplexityBot', 'Perplexity'], ['Google-Extended', 'Gemini']];
      var blocked = important.filter(function (b) { return !robotsAllows(parsed.groups, b[0], path); });
      if (blocked.length) {
        var snip = blocked.map(function (b) { return 'User-agent: ' + b[0] + '\nAllow: /'; }).join('\n\n');
        recos.push({ sev: 'med', title: 'Allow key AI crawlers',
          detail: 'Blocked in robots.txt: ' + blocked.map(function (b) { return b[0] + ' (' + b[1] + ')'; }).join(', ') + '. Allow them so your content is eligible for citation in AI answers.',
          code: snip, codeName: 'robots-ai-allow.txt' });
      }
    }
    var r = c.readability;
    if (r && r.grade > 12) recos.push({ sev: 'low', title: 'Simplify the writing',
      detail: 'Reading grade level is ' + r.grade + '; aim for ≤12 so AI answers can extract clean, quotable sentences.' });
    var hasLlms = d.llms && d.llms.status >= 200 && d.llms.status < 400;
    if (!hasLlms) recos.push({ sev: 'low', title: 'Consider adding an llms.txt',
      detail: 'An llms.txt at your site root lets you point AI crawlers to your key content. Optional, but an easy win.' });
    return recos;
  }

  // ---- Hreflang -----------------------------------------------------------
  function hreflang(d) {
    if (!d || d.empty) return [];
    var recos = [], tags = d.tags || [];
    if (!d.hasSelfReference) recos.push({ sev: 'med', title: 'Add a self-referencing hreflang tag',
      detail: 'A page using hreflang must include a tag pointing to itself, with its own language/region and URL.' });
    var invalid = tags.filter(function (t) { return !t.valueValid; });
    if (invalid.length) recos.push({ sev: 'high', title: 'Fix invalid hreflang language codes',
      detail: invalid.length + ' value(s) aren’t valid: ' + invalid.map(function (t) { return t.hreflang || '(empty)'; }).slice(0, 6).join(', ') + '. Use ISO 639-1 language (optionally + ISO 3166-1 region), e.g. en, en-GB, or x-default.' });
    var notAbs = tags.filter(function (t) { return !t.absoluteOk; });
    if (notAbs.length) recos.push({ sev: 'med', title: 'Use absolute URLs in hreflang',
      detail: notAbs.length + ' hreflang href(s) are relative. Use full https:// URLs so search engines resolve them correctly.' });
    var dupes = tags.filter(function (t) { return t.duplicate; });
    if (dupes.length) recos.push({ sev: 'med', title: 'Remove duplicate hreflang entries',
      detail: dupes.length + ' duplicate locale value(s) found. Each language/region should appear once.' });
    var missingReturn = tags.filter(function (t) { return t.reciprocity === 'missing'; });
    if (missingReturn.length) recos.push({ sev: 'high', title: 'Fix missing hreflang return tags',
      detail: missingReturn.length + ' target page(s) don’t link back to this URL. hreflang must be reciprocal — each alternate must also point back here.' });
    var hasXdefault = tags.some(function (t) { return (t.hreflang || '').toLowerCase() === 'x-default'; });
    if (tags.length && !hasXdefault) recos.push({ sev: 'low', title: 'Add an x-default hreflang',
      detail: 'Add an x-default entry so users whose language you don’t target are sent to a sensible fallback page.',
      code: '<link rel="alternate" hreflang="x-default" href="https://example.com/">', codeName: 'hreflang-xdefault.html' });
    return recos;
  }

  // ---- Links --------------------------------------------------------------
  function links(d) {
    if (!d || !Array.isArray(d.links)) return [];
    var recos = [];
    var broken = d.links.filter(function (l) { return l.state === 'broken'; });
    var redirects = d.links.filter(function (l) { return l.state === 'redirect'; });
    if (broken.length) {
      var list = broken.slice(0, 10).map(function (l) { return (l.status ? ('HTTP ' + l.status) : 'dead') + '  ' + l.url; }).join('\n');
      if (broken.length > 10) list += '\n…and ' + (broken.length - 10) + ' more';
      recos.push({ sev: 'high', title: 'Fix ' + broken.length + ' broken link' + (broken.length > 1 ? 's' : ''),
        detail: 'These links return an error or don’t resolve. Update or remove them — broken links hurt UX and waste crawl budget.',
        code: list, codeLabel: 'Show broken links', codeName: 'broken-links.txt' });
    }
    if (redirects.length) recos.push({ sev: 'low', title: 'Update ' + redirects.length + ' redirecting link' + (redirects.length > 1 ? 's' : ''),
      detail: 'These links point to URLs that redirect. Link directly to the final URL to save a hop and preserve link equity.' });
    return recos;
  }

  // ---- Schema (from analyze-schema data) ----------------------------------
  function schema(sd) {
    if (!sd) return [];
    var out = [];
    (sd.recommendations || []).forEach(function (r) {
      var bits = [];
      if (r.requiredFixes) bits.push(r.requiredFixes + ' required');
      if (r.recommendedFixes) bits.push(r.recommendedFixes + ' recommended');
      out.push({ sev: r.severity === 'required' ? 'high' : 'low',
        title: 'Improve ' + r.label + ' schema' + (r.name ? ' — ' + r.name : ''),
        detail: bits.join(' + ') + ' field(s) added. Copy the corrected JSON-LD below and replace any placeholders.',
        code: '<script type="application/ld+json">\n' + r.fixedJson + '\n<\/script>',
        codeLabel: 'Show corrected JSON-LD', codeName: ('schema-fixed-' + (r.type || 'block')).replace(/[^\w.\-]+/g, '_') + '.html' });
    });
    (sd.gaps || []).forEach(function (g) {
      out.push({ sev: g.severity === 'high' ? 'med' : 'low', title: g.title, detail: g.why });
    });
    return out;
  }

  // ---- Rendering: SSR vs CSR ---------------------------------------------
  // Compares raw server HTML against the post-JavaScript DOM. Shared by the
  // Render tab (for its UI) and the rule below, so both agree.
  function renderAnalyze(raw, rendered) {
    if (!raw || !rendered) return null;
    function n(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
    var rawW = n(raw.words && raw.words.body), domW = n(rendered.words && rendered.words.body);
    var coverage = domW > 0 ? Math.max(0, Math.min(100, Math.round(rawW / domW * 100)))
                            : (rawW > 0 ? 100 : 0);

    var rawH1 = n(raw.headingCounts && raw.headingCounts.h1);
    var domH1 = n(rendered.headingCounts && rendered.headingCounts.h1);

    var missing = {
      title: !raw.title && !!rendered.title,
      metaDescription: !raw.metaDescription && !!rendered.metaDescription,
      canonical: !raw.canonical && !!rendered.canonical,
      h1: rawH1 === 0 && domH1 > 0,
      jsonLd: n(raw.jsonLd && raw.jsonLd.blocks) === 0 && n(rendered.jsonLd && rendered.jsonLd.blocks) > 0
    };
    var changed = {
      title: !!raw.title && !!rendered.title && raw.title !== rendered.title,
      canonical: !!raw.canonical && !!rendered.canonical && raw.canonical !== rendered.canonical
    };
    var criticalMissing = 0;
    Object.keys(missing).forEach(function (k) { if (missing[k]) criticalMissing++; });

    var deltas = {
      words: domW - rawW,
      links: n(rendered.links && rendered.links.total) - n(raw.links && raw.links.total),
      headings: n(rendered.headingTotal) - n(raw.headingTotal),
      images: n(rendered.images && rendered.images.total) - n(raw.images && raw.images.total),
      jsonLd: n(rendered.jsonLd && rendered.jsonLd.blocks) - n(raw.jsonLd && raw.jsonLd.blocks),
      domNodes: n(rendered.domNodes) - n(raw.domNodes)
    };

    var verdict, label, tone;
    if (coverage >= 85 && criticalMissing === 0) { verdict = 'ssr'; label = 'Server-rendered'; tone = 'ok'; }
    else if (coverage <= 30 || criticalMissing >= 3) { verdict = 'csr'; label = 'Client-rendered'; tone = 'bad'; }
    else { verdict = 'hybrid'; label = 'Hybrid rendering'; tone = 'warn'; }

    return {
      coverage: coverage, verdict: verdict, label: label, tone: tone,
      missing: missing, changed: changed, deltas: deltas,
      rawWords: rawW, domWords: domW, criticalMissing: criticalMissing
    };
  }

  // Most AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot…) do not execute
  // JavaScript at all. Googlebot does, but on a deferred second pass.
  var AI_NOTE = 'Googlebot does render JavaScript, but on a delayed second pass — and most AI crawlers (GPTBot, ClaudeBot, PerplexityBot) never run JS at all, so they only ever see the raw HTML.';

  function render(d) {
    var a = renderAnalyze(d && d.raw, d && d.rendered);
    if (!a) return [];
    var recos = [];

    if (a.missing.title) recos.push({ sev: 'high', title: 'Page title is added by JavaScript',
      detail: 'The <title> is missing from the raw HTML and only appears after JS runs. ' + AI_NOTE,
      current: '(no title in raw HTML)', recommended: d.rendered.title });
    else if (a.changed.title) recos.push({ sev: 'med', title: 'Title is rewritten by JavaScript',
      detail: 'The server sends one title and JavaScript replaces it. Crawlers may index the server version.',
      current: d.raw.title, recommended: d.rendered.title });

    if (a.missing.metaDescription) recos.push({ sev: 'high', title: 'Meta description is added by JavaScript',
      detail: 'No meta description in the raw HTML — non-rendering crawlers and most social/AI bots will never see it. Render it server-side.',
      current: '(none in raw HTML)', recommended: d.rendered.metaDescription });

    if (a.missing.canonical) recos.push({ sev: 'high', title: 'Canonical is injected by JavaScript',
      detail: 'The canonical link only exists after JS runs. Google may not honour a JS-injected canonical reliably — emit it in the server HTML.',
      current: '(none in raw HTML)', recommended: d.rendered.canonical });
    else if (a.changed.canonical) recos.push({ sev: 'high', title: 'Canonical is rewritten by JavaScript',
      detail: 'The server and the rendered page disagree on the canonical URL. Make them match.',
      current: d.raw.canonical, recommended: d.rendered.canonical });

    if (a.missing.h1) recos.push({ sev: 'high', title: 'H1 is rendered client-side',
      detail: 'No H1 in the raw HTML. Your main heading is invisible to any crawler that does not execute JavaScript.' });

    if (a.missing.jsonLd) recos.push({ sev: 'high', title: 'Structured data is injected by JavaScript',
      detail: 'All JSON-LD on this page is added after JS runs. Many structured-data consumers (and AI crawlers) parse raw HTML only, so your schema is invisible to them. Emit JSON-LD server-side.' });

    if (a.coverage < 50) recos.push({ sev: 'high', title: 'Most of the content needs JavaScript to appear',
      detail: 'Only ' + a.coverage + '% of the page text is in the raw HTML (' + a.rawWords + ' of ' + a.domWords + ' words). ' + AI_NOTE,
      current: a.coverage + '% server-rendered', recommended: 'Server-render or pre-render the main content' });
    else if (a.coverage < 85) recos.push({ sev: 'med', title: 'Part of the content needs JavaScript',
      detail: a.coverage + '% of the page text is in the raw HTML. The remainder only appears after JS — fine for Google, invisible to non-rendering AI crawlers.',
      current: a.coverage + '% server-rendered', recommended: '85%+ server-rendered' });

    if (a.deltas.links > 20) recos.push({ sev: 'med', title: 'Internal links are added by JavaScript',
      detail: a.deltas.links + ' links only exist after JS runs. Crawlers that do not render may never discover those pages — make key navigation real <a href> links in the server HTML.' });

    if (a.deltas.images > 5) recos.push({ sev: 'low', title: 'Images are loaded client-side',
      detail: a.deltas.images + ' images appear only after JS. Use real <img src> (with loading="lazy") so image search can find them.' });

    return recos;
  }

  window.SEO_RECO_RULES = {
    onpage: onpage, tech: tech, ai: ai, hreflang: hreflang, links: links, schema: schema,
    render: render,
    _util: { selfUrl: selfUrl, originOf: originOf, pathOf: pathOf, renderAnalyze: renderAnalyze }
  };
})();
