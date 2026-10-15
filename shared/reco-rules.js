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
  function intel() { return (typeof window !== 'undefined' && window.SEO_INTEL) || null; }
  function canonFindings(url, canonical) {
    var I = intel();
    if (!I) return [];
    return I.canonicalAssess(url, canonical).findings;
  }
  function px(kind, text) {
    try { var P = window.SEO_PIXEL; return P ? (kind === 'title' ? P.titleWidth(text) : P.descWidth(text)) : 0; } catch (e) { return 0; }
  }
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

  // meta robots noindex, judged in context (shared by On-Page and Tech).
  function noindexRecos(url, robots) {
    var I = intel(), cx = (I && I.urlContext(url)) || {}, recos = [];
    if (/noindex/i.test(robots || '')) {
      var why = I ? I.noindexExpected(url) : '';
      if (cx.isPaginated) recos.push({ sev: 'med', title: 'Paginated page is set to noindex',
        detail: 'Google recommends letting paginated pages be indexed. A long-standing noindex can make Google crawl them less, so items only linked from deeper pages are found more slowly. Prefer index with a self-referencing canonical.',
        current: robots, recommended: 'index,follow', code: '<meta name="robots" content="index,follow">', codeName: 'robots-meta.html' });
      else if (!why) recos.push({ sev: 'high', title: 'Page is set to noindex',
        detail: 'The meta robots tag contains noindex, so this page will not appear in search. That is right for thank-you, account or thin utility pages. If this page should rank, remove noindex.',
        current: robots, recommended: 'index,follow', code: '<meta name="robots" content="index,follow">', codeName: 'robots-meta.html' });
    }
    return recos;
  }

  // ---- On-Page ------------------------------------------------------------
  function onpage(d) {
    if (!d) return [];
    var I = intel();
    var recos = [];
    var t = d.title || {}, md = d.metaDescription || {}, hc = d.headingCounts || {}, im = d.images || {};
    var cx = (I && I.urlContext(d.url)) || {};
    // Search results, cart/account pages and deep paginated pages don't need
    // snippet polish: they shouldn't be landing pages in search.
    var lowValue = cx.isSearch || cx.isUtility || cx.isPaginated;

    if (!t.length) recos.push({ sev: 'high', title: 'Add a page <title>',
      detail: 'This page has no title tag. The title is the main headline of your search result and one of the strongest on-page relevance signals.',
      code: '<title>Primary keyword — Brand</title>', codeName: 'title.html', ai: 'titleWrite' });
    else if (!lowValue) {
      var tw = px('title', t.text), tLimit = 580;
      if (tw ? tw > tLimit : t.length > 65) recos.push({ sev: 'low', title: 'Title may be cut off in search results',
        detail: 'The title is ' + t.length + ' characters' + (tw ? ' (about ' + Math.round(tw) + 'px)' : '') + '. Google shows roughly 580px (about 55–60 characters) on desktop and adds “…” after that. Length is not a ranking factor, so this only matters if the important words come late: put the main keyword and offer first.',
        current: t.text, ai: 'titleShorten' });
      else if (t.length < 15) recos.push({ sev: 'low', title: 'Expand the title',
        detail: 'The title is only ' + t.length + ' characters. A more descriptive title (main keyword plus brand) helps searchers and search engines understand the page.', current: t.text, ai: 'titleWrite' });
    }
    if (!lowValue) {
      if (!md.length) recos.push({ sev: 'med', title: 'Add a meta description',
        detail: 'There is no meta description, so Google will build a snippet from page text. Google often rewrites descriptions anyway, but a clear, specific one usually earns more clicks. It is not a ranking factor.',
        code: '<meta name="description" content="A specific 120–155 character summary of what this page offers.">', codeName: 'meta-description.html', ai: 'metaDescription' });
      else {
        var dw = px('desc', md.text);
        if (dw ? dw > 920 : md.length > 160) recos.push({ sev: 'low', title: 'Meta description may be cut off',
          detail: 'It is ' + md.length + ' characters' + (dw ? ' (about ' + Math.round(dw) + 'px)' : '') + '. Google shows roughly 920px (about 155–160 characters) on desktop and less on mobile, so make sure the key message comes first.', current: md.text, ai: 'metaDescription' });
        else if (md.length < 50) recos.push({ sev: 'low', title: 'Make the meta description more descriptive',
          detail: 'It is only ' + md.length + ' characters. Google is more likely to replace a very short description with its own snippet.', current: md.text, ai: 'metaDescription' });
      }
    }
    if ((hc.h1 || 0) === 0) recos.push({ sev: 'med', title: 'Add an H1 heading',
      detail: 'No H1 was found. A clear main heading helps visitors, screen readers and search engines understand what the page is about.', code: '<h1>Your main page heading</h1>', codeName: 'h1.html', ai: 'h1' });
    else if ((hc.h1 || 0) > 1) recos.push({ sev: 'low', title: 'Consider a single H1',
      detail: 'Found ' + hc.h1 + ' H1 tags. Google handles multiple H1s fine, so this is not a ranking problem, but one clear main heading is better for accessibility and makes the page structure easier to follow.' });

    var noindex = /noindex/i.test(d.robots || '');
    var cf = canonFindings(d.url, d.canonical);
    var conflict = noindex && I && d.canonical && I.canonicalAssess(d.url, d.canonical).status === 'different';
    if (!conflict) noindexRecos(d.url, d.robots).forEach(function (r) { recos.push(r); });
    if (conflict) recos.push({ sev: 'med', title: 'Don’t combine noindex with a canonical to another page',
      detail: 'This page is noindex and also canonicalises to another URL. The two signals conflict: a canonical says “index that page instead”, a noindex says “drop this one”. Use the canonical alone for duplicates, or noindex alone for pages that should stay out of search.' });
    else if (!(noindex && cf.length && cf[0].title === 'Add a canonical tag')) cf.forEach(function (f) { recos.push(f); });
    if (cx.isSearch && !noindex) recos.push({ sev: 'low', title: 'Keep internal search results out of the index',
      detail: 'This looks like an internal search results page. Google advises against letting these get indexed: add noindex, or disallow the search path in robots.txt, so crawl budget goes to real pages.',
      code: '<meta name="robots" content="noindex,follow">', codeName: 'robots-meta.html' });

    if ((im.missingAlt || 0) > 0 && !cx.isUtility) recos.push({ sev: 'med', title: 'Add alt text to images',
      detail: im.missingAlt + ' image(s) have no alt attribute. Describe each meaningful image so it can rank in image search and be read by screen readers; use alt="" for decorative images.', ai: 'altText' });
    if (!d.viewport) recos.push({ sev: 'med', title: 'Add a responsive viewport',
      detail: 'No viewport meta tag. Google indexes the mobile version of pages, so the page needs to render properly on phones.',
      code: '<meta name="viewport" content="width=device-width, initial-scale=1">', codeName: 'viewport.html' });
    if (!d.lang) recos.push({ sev: 'low', title: 'Set the page language',
      detail: 'The <html> tag has no lang attribute. It helps screen readers and browsers; search engines detect language from the content itself.', code: '<html lang="en">', codeName: 'lang.html' });
    var og = d.openGraph || {};
    if (!lowValue && (!og['og:title'] || !og['og:image'])) recos.push({ sev: 'low', title: 'Add Open Graph tags',
      detail: 'Missing og:title/og:image. They control how links look when shared on social and messaging apps. Not a ranking factor.',
      code: '<meta property="og:title" content="Page title">\n<meta property="og:description" content="Short description">\n<meta property="og:image" content="https://example.com/share-1200x630.jpg">', codeName: 'open-graph.html', ai: 'openGraph' });
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
    var I = intel(), cx = (I && I.urlContext(d.url)) || {};
    var expected = I ? I.noindexExpected(d.url) : '';
    var assess = I ? I.canonicalAssess(d.url, canonical) : { status: canonical ? (canonMatches ? 'self' : 'different') : 'missing', findings: [] };
    noindexRecos(d.url, metaRobots).forEach(function (r) { recos.push(r); });
    if (/noindex/i.test(xRobots) && !/noindex/i.test(metaRobots) && !expected) recos.push({ sev: 'high', title: 'Page is set to noindex (X-Robots-Tag header)',
      detail: 'The X-Robots-Tag response header contains noindex, so this page will not appear in search. If it should rank, remove the header in your server or CDN configuration.', current: xRobots });
    if (robotsBlocked && !expected && !cx.isSearch) recos.push({ sev: 'high', title: 'robots.txt blocks Googlebot from this page',
      detail: 'robots.txt disallows crawling ' + path + ' for Googlebot, so Google can’t read the page (it may still index the bare URL from links). Allow it if this page should rank. To keep a page out of search, use noindex instead of a robots.txt block.',
      code: 'User-agent: Googlebot\nAllow: ' + path, codeName: 'robots-allow.txt' });
    canonFindings(d.url, canonical).forEach(function (f) { recos.push(f); });
    targetFindings(canonical, assess, d.canonicalTarget).forEach(function (f) { recos.push(f); });
    if (!sm2) recos.push({ sev: 'med', title: 'Publish an XML sitemap',
      detail: 'No readable sitemap was found. Create one and declare it in robots.txt so Google can discover your URLs.',
      code: 'Sitemap: ' + origin + '/sitemap.xml', codeName: 'robots-sitemap.txt' });
    else if (!sm2.isIndex) {
      // Only indexable pages that are their own canonical belong in a sitemap.
      var indexable = !/noindex/i.test(metaRobots + ' ' + xRobots) && !robotsBlocked && !cx.isSearch && !cx.isUtility &&
        (assess.status === 'self' || assess.status === 'consolidated' || assess.status === 'missing');
      var target = canonical && assess.status !== 'missing' ? canonical : (I ? I.preferredUrl(d.url) : self);
      var present = sm2.locs.some(function (l) { return I ? I.sameUrl(l, target) : norm(l) === norm(target); });
      if (indexable && !present) recos.push({ sev: 'low', title: 'Add this URL to your sitemap',
        detail: 'The page’s canonical URL was not found in the sitemap at ' + (d.sitemap && d.sitemap.finalUrl || 'the declared location') + '. Listing every indexable page helps Google discover and recrawl it.',
        current: 'not in sitemap', recommended: target });
    }
    if (h.redirected && h.finalUrl && norm(h.finalUrl) !== norm(d.url)) recos.push({ sev: 'low', title: 'Link to the final URL directly',
      detail: 'This URL redirects. Update internal links to point at the final URL to save a redirect hop.', current: d.url, recommended: h.finalUrl });
    return recos;
  }

  // Follow the canonical: it must point at a live, indexable page that is its
  // own canonical, or search engines may ignore it.
  function targetFindings(canonical, assess, t) {
    if (!canonical || !t || assess.status === 'self' || assess.status === 'missing') return [];
    var out = [], body = String(t.body || '');
    if (!t.status || t.status >= 400) {
      out.push({ sev: 'high', title: 'Canonical points to a URL that ' + (t.status ? 'returns HTTP ' + t.status : 'does not respond'),
        detail: 'Search engines ignore a canonical whose target is broken, so this page may be indexed under an unintended URL, or not at all. Point the canonical at a live page.',
        current: canonical });
      return out;
    }
    var I = intel();
    if (t.redirected && t.finalUrl && !(I ? I.sameUrl(t.finalUrl, canonical) : norm(t.finalUrl) === norm(canonical))) out.push({ sev: 'med', title: 'Canonical points to a URL that redirects',
      detail: 'The canonical target redirects to another URL. Canonicals should name the final URL directly, otherwise search engines have to resolve a chain and may pick a different version.',
      current: canonical, recommended: t.finalUrl, code: '<link rel="canonical" href="' + t.finalUrl + '">', codeName: 'canonical.html' });
    var xr = (t.headers && t.headers['x-robots-tag']) || '';
    var metaNoindex = /<meta[^>]+name=["']?(robots|googlebot)["']?[^>]*content=["'][^"']*noindex/i.test(body) ||
      /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]*name=["']?(robots|googlebot)/i.test(body);
    if (/noindex/i.test(xr) || metaNoindex) out.push({ sev: 'high', title: 'Canonical points to a page that is set to noindex',
      detail: 'The canonical target asks not to be indexed. Search engines then have no indexable version of this content. Remove noindex from the target, or point the canonical somewhere indexable.',
      current: canonical });
    var m = body.match(/<link[^>]+rel=["']?canonical["']?[^>]*href=["']([^"']+)["']/i) || body.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']?canonical/i);
    if (m && I) {
      var second = m[1];
      try { second = new URL(second, t.finalUrl || canonical).href; } catch (e) {}
      var st = I.canonicalAssess(t.finalUrl || canonical, second).status;
      if (st === 'different' || st === 'issue') out.push({ sev: 'med', title: 'Canonical chain: the target canonicalises elsewhere',
        detail: 'The page this canonical points to names a different canonical (' + second + '). Search engines may not follow chains, so point straight at the final preferred URL.',
        current: canonical, recommended: second, code: '<link rel="canonical" href="' + second + '">', codeName: 'canonical.html' });
    }
    return out;
  }

  // ---- AI / GEO -----------------------------------------------------------
  // Which content signals matter depends on the kind of page: an author byline
  // or cited sources make sense on an article, not on a category or cart page.
  var AI_SIGNALS = [
    { rx: /heading structure/i, key: 'headings', task: '', title: 'Break the content into clear sections' },
    { rx: /question-style headings/i, key: 'questions', task: 'questionHeadings', title: 'Phrase some headings as the questions people ask' },
    { rx: /lists or tables/i, key: 'lists', task: '', title: 'Add a list or comparison table', productTitle: 'Add a specification table' },
    { rx: /tl;?dr|key takeaways|summary/i, key: 'summary', task: 'tldr', title: 'Add a short summary near the top' },
    { rx: /faq or howto schema/i, key: 'faqschema', task: '', title: '' },
    { rx: /author byline/i, key: 'author', task: '', title: 'Show who wrote it (author byline)' },
    { rx: /published\/updated date/i, key: 'date', task: '', title: 'Show a published or updated date' },
    { rx: /cites external sources/i, key: 'sources', task: '', title: 'Cite authoritative sources' },
    { rx: /stats \/ numbers/i, key: 'stats', task: '', title: 'Include specific figures and data' },
    { rx: /scannable paragraphs/i, key: 'paragraphs', task: 'simplify', title: 'Shorten long paragraphs' }
  ];
  // sev per page type; missing key = not relevant for that page type.
  var AI_RELEVANCE = {
    article: { headings: 'med', questions: 'low', lists: 'low', summary: 'med', author: 'med', date: 'med', sources: 'low', stats: 'low', paragraphs: 'low' },
    other: { headings: 'low', questions: 'low', lists: 'low', summary: 'low', paragraphs: 'low' },
    product: { lists: 'low', questions: 'low' },
    category: {}, home: {}, search: {}, utility: {}
  };
  var AI_CONTEXT = {
    article: '', other: '',
    product: 'On product pages, a specification table and answers to common buyer questions are what AI assistants quote.'
  };
  // Crawlers that fetch pages to answer and cite in AI search, versus crawlers
  // that only collect training data. Blocking the second group is a legitimate
  // business choice and doesn't remove a site from AI answers.
  var AI_SEARCH_BOTS = [['OAI-SearchBot', 'ChatGPT search'], ['ChatGPT-User', 'ChatGPT browsing'], ['PerplexityBot', 'Perplexity'],
    ['Claude-SearchBot', 'Claude search'], ['Claude-User', 'Claude browsing']];
  var AI_TRAINING_BOTS = [['GPTBot', 'OpenAI training'], ['ClaudeBot', 'Anthropic training'], ['Google-Extended', 'Gemini training'],
    ['CCBot', 'Common Crawl'], ['Applebot-Extended', 'Apple AI training']];

  function ai(d) {
    if (!d) return [];
    var recos = [], c = d.content || {}, path = d.path || pathOf(d.url);
    var I = intel();
    var type = d.pageType || (I ? I.pageType({ url: d.url, schemaTypes: d.schemaTypes || [] }) : 'other');
    var rel = AI_RELEVANCE[type] || AI_RELEVANCE.other;
    (c.extractability && c.extractability.signals || []).forEach(function (s) {
      if (s.ok) return;
      var sig = null;
      AI_SIGNALS.forEach(function (m) { if (!sig && m.rx.test(s.label || '')) sig = m; });
      if (!sig || !rel[sig.key]) return;
      var r = { sev: rel[sig.key], title: (type === 'product' && sig.productTitle) || sig.title || s.label,
        detail: (s.hint || 'Improve this so AI answer engines can extract and quote the page.') + (AI_CONTEXT[type] ? ' ' + AI_CONTEXT[type] : '') };
      if (sig.task) r.ai = sig.task;
      recos.push(r);
    });
    if (d.robots && d.robots.body && d.robots.status >= 200 && d.robots.status < 400) {
      var parsed = parseRobots(d.robots.body);
      if (robotsAllows(parsed.groups, 'googlebot', path)) {
        var bSearch = AI_SEARCH_BOTS.filter(function (b) { return !robotsAllows(parsed.groups, b[0], path); });
        var bTrain = AI_TRAINING_BOTS.filter(function (b) { return !robotsAllows(parsed.groups, b[0], path); });
        var names = function (l) { return l.map(function (b) { return b[0] + ' (' + b[1] + ')'; }).join(', '); };
        if (bSearch.length) recos.push({ sev: 'med', title: 'AI search crawlers are blocked in robots.txt',
          detail: 'Blocked: ' + names(bSearch) + '. These crawlers fetch pages to answer questions and cite sources in AI search, so blocking them keeps this page out of those answers. Allow them if you want to be cited.',
          code: bSearch.map(function (b) { return 'User-agent: ' + b[0] + '\nAllow: /'; }).join('\n\n'), codeName: 'robots-ai-search-allow.txt' });
        if (bTrain.length) recos.push({ sev: 'low', title: 'AI training crawlers are blocked in robots.txt',
          detail: 'Blocked: ' + names(bTrain) + '. These only collect training data. Blocking them is a reasonable business choice and does not stop AI search tools from citing you. Google-Extended does not affect Google Search or AI Overviews. No action needed unless you want your content used for training.' });
      }
    }
    var r = c.readability;
    if (r && r.grade > 12 && (type === 'article' || type === 'other')) recos.push({ sev: 'low', title: 'Simplify the writing',
      detail: 'Reading grade level is ' + r.grade + '. Shorter sentences and plain words make passages easier for readers and AI tools to quote.', ai: 'simplify' });
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
      // FAQ / HowTo no longer produce rich results for most sites.
      var limited = r.type === 'FAQPage' || r.type === 'HowTo';
      out.push({ sev: r.severity === 'required' && !limited ? 'high' : 'low',
        title: 'Improve ' + r.label + ' schema' + (r.name ? ' — ' + r.name : ''),
        detail: bits.join(' + ') + ' field(s) added. Copy the corrected JSON-LD below and replace any placeholders.' +
          (limited ? (r.type === 'HowTo' ? ' Google no longer shows How-to rich results, so this is low priority.' : ' Google shows FAQ rich results only for well-known government and health sites, so this is low priority for most sites.') : ''),
        code: '<script type="application/ld+json">\n' + r.fixedJson + '\n<\/script>',
        codeLabel: 'Show corrected JSON-LD', codeName: ('schema-fixed-' + (r.type || 'block')).replace(/[^\w.\-]+/g, '_') + '.html' });
    });
    (sd.gaps || []).forEach(function (g) {
      var r = { sev: g.severity === 'high' ? 'med' : 'low', title: g.title, detail: g.why };
      if (g.id === 'faq' || g.templateKey === 'FAQPage') r.ai = 'faqSchema';
      out.push(r);
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
    else if (a.changed.canonical && !(intel() && intel().sameUrl(d.raw.canonical, d.rendered.canonical))) recos.push({ sev: 'high', title: 'Canonical is rewritten by JavaScript',
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

  // ---- Content behind clicks -------------------------------------------------
  // d = output of content/click-scan.js: { items, counts, pagination }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function examples(items, kind) {
    return items.filter(function (i) { return i.kind === kind; }).slice(0, 3)
      .map(function (i) { return '“' + i.text + '”'; }).join(', ');
  }
  function clicks(d) {
    if (!d || !d.items) return [];
    var c = d.counts || {}, recos = [];
    if (c.loadmore) {
      if (d.pagination) recos.push({ sev: 'low', title: 'A "Load more" button is used, but crawlable pagination also exists',
        detail: 'Crawlers can still reach the next pages through the normal pagination links, so this is fine. Make sure every page of results has its own URL.' });
      else recos.push({ sev: 'high', title: 'Content is behind a "Load more" button',
        detail: 'Search engines and AI crawlers don’t click buttons, so anything that loads after ' + (examples(d.items, 'loadmore') || '“Load more”') +
          ' is invisible to them, and there are no pagination links to follow instead. Keep the button for people, but make it a real link to the next page.',
        current: '<button> with no URL', recommended: '<a href="?page=2"> crawlable pagination',
        code: '<!-- A real link crawlers can follow; JavaScript upgrades it for people -->\n' +
          '<a href="/category?page=2" class="load-more" data-load-more>Load more</a>\n\n' +
          '<script>\n' +
          '  document.querySelector(\'[data-load-more]\').addEventListener(\'click\', async (e) => {\n' +
          '    e.preventDefault();\n' +
          '    const next = e.currentTarget.href;\n' +
          '    // fetch(next), append the items, then point href at the following page\n' +
          '    // and history.pushState({}, \'\', next) so each batch has its own URL.\n' +
          '  });\n' +
          '</script>',
        codeLabel: 'Show crawlable "Load more" pattern', codeName: 'load-more-pagination.html', codeMime: 'text/html' });
    }
    if (c['lazy-toggle']) recos.push({ sev: 'med', title: plural(c['lazy-toggle'], 'accordion section') + (c['lazy-toggle'] === 1 ? ' loads its' : ' load their') + ' content only on click',
      detail: 'These expanders are empty until someone opens them, so the content is fetched on click (' + examples(d.items, 'lazy-toggle') +
        '). Crawlers never open them. Put the content in the HTML and just hide it; collapsed content in the HTML is indexed.',
      code: '<details>\n  <summary>Question or section title</summary>\n  <p>The full answer is in the HTML — only its visibility toggles.</p>\n</details>',
      codeLabel: 'Show crawlable accordion', codeName: 'accordion.html', codeMime: 'text/html' });
    if (c['lazy-tab']) recos.push({ sev: 'med', title: plural(c['lazy-tab'], 'tab panel') + (c['lazy-tab'] === 1 ? ' is' : ' are') + ' empty until clicked',
      detail: 'Only the first tab’s content exists in the page; the others (' + examples(d.items, 'lazy-tab') +
        ') load when clicked, so crawlers only ever see one tab. Render every panel in the HTML and hide the inactive ones.',
      code: '<div role="tablist">\n  <button role="tab" aria-selected="true" aria-controls="p1">Details</button>\n  <button role="tab" aria-selected="false" aria-controls="p2">Reviews</button>\n</div>\n' +
        '<div id="p1" role="tabpanel">…details…</div>\n<div id="p2" role="tabpanel" hidden>…reviews, already in the HTML…</div>',
      codeLabel: 'Show crawlable tabs', codeName: 'tabs.html', codeMime: 'text/html' });
    if (c['js-link']) recos.push({ sev: 'med', title: plural(c['js-link'], 'link') + ' crawlers can’t follow',
      detail: 'These navigate with JavaScript instead of a real href (' + examples(d.items, 'js-link') +
        '). Google only follows <a href="…"> links, so the pages behind them are not discovered this way.',
      current: '<a onclick="…"> / href="#"', recommended: '<a href="/real-url">',
      code: '<!-- Before -->\n<span onclick="location.href=\'/pricing\'">Pricing</span>\n\n<!-- After -->\n<a href="/pricing">Pricing</a>',
      codeLabel: 'Show crawlable link', codeName: 'crawlable-link.html', codeMime: 'text/html' });
    var hj = d.items.filter(function (i) { return i.kind === 'hidden-js'; });
    var hjWords = hj.reduce(function (n, i) { return n + (i.words || 0); }, 0);
    if (hj.length && hjWords >= 20) recos.push({ sev: hjWords >= 150 ? 'med' : 'low',
      title: plural(hj.length, 'collapsed section') + ' behind a click ' + (hj.length === 1 ? 'is' : 'are') + ' missing from the server HTML',
      detail: 'The content is in the page, but it was added by JavaScript (about ' + hjWords + ' words, e.g. ' + examples(d.items, 'hidden-js') +
        '). Google can index it after rendering; AI crawlers that read only the server HTML will not see it.',
      current: 'added by JavaScript', recommended: 'in the server HTML, collapsed' });
    return recos;
  }

  // ---- Crawler view: Googlebot & AI bots vs browser -----------------------------
  // d = output of shared/botview.js: { url, results:[{key,label,kind,status,…,m}] }
  var IP_NOTE = 'SEO Sidekick sends the crawler’s User-Agent but not its IP address, and some firewalls verify bots by IP — confirm with Google Search Console’s URL Inspection (or your CDN’s bot settings) before changing anything.';
  function botview(d) {
    if (!d || !d.results) return [];
    var base = d.results.filter(function (r) { return r.key === 'browser'; })[0];
    if (!base || !(base.status >= 200 && base.status < 400) || base.challenge) return [];
    var bots = d.results.filter(function (r) { return r.key !== 'browser'; });
    var recos = [];
    function names(list) { return list.map(function (r) { return r.label; }).join(', '); }
    function codes(list) {
      var u = {};
      list.forEach(function (r) { u[r.challenge ? 'challenge page' : (r.status ? 'HTTP ' + r.status : 'no response')] = 1; });
      return Object.keys(u).join(' / ');
    }
    function blocked(r) { return r.challenge || !r.status || r.status >= 400; }

    var bSearch = bots.filter(function (r) { return r.kind === 'search' && blocked(r); });
    var bAi = bots.filter(function (r) { return r.kind === 'ai' && blocked(r); });
    if (bSearch.length) recos.push({ sev: 'high', title: 'Page is blocked for ' + names(bSearch) + ' (' + codes(bSearch) + ')',
      detail: 'Your browser gets HTTP ' + base.status + ', but a request as ' + names(bSearch) + ' is refused. If the real crawler is blocked too, this page can drop out of search. ' + IP_NOTE,
      current: codes(bSearch), recommended: 'HTTP 200 with the full page' });
    if (bAi.length) recos.push({ sev: bAi.length >= 3 ? 'high' : 'med', title: 'Page is blocked for AI crawlers: ' + names(bAi),
      detail: 'Requests as ' + names(bAi) + ' get ' + codes(bAi) + ' while browsers get HTTP ' + base.status +
        '. This usually comes from a CDN or firewall setting such as “Block AI bots”. If you want to be cited in ChatGPT, Claude or Perplexity answers, allow these crawlers. ' + IP_NOTE,
      current: codes(bAi), recommended: 'allow the AI crawlers you want to be cited by' });

    var ok = bots.filter(function (r) { return !blocked(r); });
    function hasNoindex(r) { return /noindex/i.test(r.xRobots || '') || /noindex/i.test((r.m && r.m.robots) || ''); }
    if (!hasNoindex(base)) {
      var ni = ok.filter(hasNoindex);
      if (ni.length) recos.push({ sev: 'high', title: 'Crawlers are served "noindex": ' + names(ni),
        detail: 'Browsers get an indexable page, but ' + names(ni) + (ni.length === 1 ? ' receives' : ' receive') + ' a noindex directive (X-Robots-Tag header or meta robots), so the page will not be indexed there.',
        current: ni[0].xRobots || (ni[0].m && ni[0].m.robots) || 'noindex', recommended: 'no noindex for crawlers' });
    }
    function sameUrl(a, b) { try { var x = new URL(a), y = new URL(b); return x.host === y.host && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, ''); } catch (e) { return a === b; } }
    var rd = ok.filter(function (r) { return r.finalUrl && base.finalUrl && !sameUrl(r.finalUrl, base.finalUrl); });
    if (rd.length) recos.push({ sev: 'med', title: 'Crawler view: redirected to a different URL (' + names(rd) + ')',
      detail: 'These crawlers end up on a different page than people do. Unless it is a deliberate language/region redirect, serve crawlers the same URL.',
      current: rd[0].finalUrl, recommended: base.finalUrl });

    var bw = base.m && base.m.words ? base.m.words.body : 0;
    if (bw >= 50) {
      var less = ok.filter(function (r) { return r.m && r.m.words && sameUrl(r.finalUrl || '', base.finalUrl || '') && r.m.words.body < bw * 0.7; });
      if (less.length) {
        var worst = less.reduce(function (a, r) { return r.m.words.body < a.m.words.body ? r : a; });
        var pct = Math.round((1 - worst.m.words.body / bw) * 100);
        recos.push({ sev: 'med', title: 'Crawler view: ' + names(less) + ' get less content than visitors',
          detail: worst.label + ' receives about ' + pct + '% fewer words (' + worst.m.words.body + ' vs ' + bw + '). Serving crawlers a cut-down page can look like cloaking and hides content from them.',
          current: worst.m.words.body + ' words for ' + worst.label, recommended: bw + ' words, same as visitors' });
      }
      var more = ok.filter(function (r) { return r.m && r.m.words && r.m.words.body > Math.max(bw * 1.3, bw + 80); });
      if (more.length) recos.push({ sev: 'low', title: 'Crawler view: pre-rendered HTML is served to crawlers (dynamic rendering)',
        detail: names(more) + ' get a fuller HTML page than browsers. Google treats dynamic rendering as a workaround rather than a long-term solution; server-side rendering for everyone is simpler and avoids the two versions drifting apart.' });
    }
    if (base.m) {
      var tdiff = ok.filter(function (r) { return r.m && r.m.title && base.m.title && r.m.title !== base.m.title; });
      if (tdiff.length) recos.push({ sev: 'med', title: 'Crawler view: different title served to ' + names(tdiff),
        detail: 'Crawlers and visitors get different <title> tags. Keep them identical so search results match the page.',
        current: tdiff[0].m.title, recommended: base.m.title });
      var cdiff = ok.filter(function (r) { return r.m && r.m.canonical && base.m.canonical && r.m.canonical !== base.m.canonical &&
        !(intel() && intel().sameUrl(r.m.canonical, base.m.canonical)); });
      if (cdiff.length) recos.push({ sev: 'high', title: 'Crawler view: different canonical served to ' + names(cdiff),
        detail: 'The canonical URL changes depending on who asks. Crawlers will consolidate signals to the URL they are given.',
        current: cdiff[0].m.canonical, recommended: base.m.canonical });
    }
    return recos;
  }

  window.SEO_RECO_RULES = {
    onpage: onpage, tech: tech, ai: ai, hreflang: hreflang, links: links, schema: schema,
    render: render, clicks: clicks, botview: botview,
    _util: { selfUrl: selfUrl, originOf: originOf, pathOf: pathOf, renderAnalyze: renderAnalyze }
  };
})();
