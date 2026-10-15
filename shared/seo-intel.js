/**
 * shared/seo-intel.js — SEO judgement for URLs, canonicals and page context.
 *
 * The rules engine used to compare URLs literally, which produced advice an
 * SEO would reject (e.g. "point the canonical at ?page_no=1&page_size=12"
 * when canonicalising that URL to the clean collection URL is correct).
 * This module encodes how search engines actually treat URLs:
 *
 *   classifyParam(name, value, path) -> 'tracking' | 'session' | 'pagination' |
 *        'view' | 'filter' | 'search' | 'variant' | 'content' | 'unknown'
 *   urlContext(url)        -> { path, params[], isPaginated, pageNum, isSearch,
 *                               isUtility, isFiltered, isHome, ... }
 *   preferredUrl(url)      -> the URL this page should normally canonicalise to
 *                             (tracking / session / sort / filter / view params
 *                             and page 1 removed; real content params kept)
 *   canonicalAssess(pageUrl, canonical) -> { status, explain, findings[] }
 *        status: 'missing' | 'self' | 'consolidated' | 'different' | 'issue'
 *        findings: reco objects (sev, title, detail, current, recommended, code)
 *   pageType({ url, schemaTypes, hasPrice, hasBuy }) ->
 *        'home' | 'product' | 'category' | 'article' | 'search' | 'utility' | 'other'
 *   noindexExpected(url)   -> reason string when noindex is normal for this URL
 *   sameUrl(a, b)          -> equal ignoring fragment, trailing slash, host case,
 *                             default port and parameter order
 *
 * Pure, dependency-free; works in the panel, the site-audit page and Node.
 */
(function (root) {
  'use strict';

  var RX = {
    tracking: /^(utm_[a-z0-9_]+|gclid|gclsrc|gbraid|wbraid|dclid|fbclid|msclkid|yclid|igshid|twclid|ttclid|li_fat_id|epik|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|__hstc|__hssc|__hsfp|hsctatracking|mkt_tok|trk|trkid|trackingid|s_kwcid|ef_id|irclickid|clickid|click_id|affiliate|aff|aff_id|affid|affiliate_id|partner|partnerid|ref|ref_src|ref_url|referrer|referral|source|src|cmp|campaign|campaignid|campaign_id|adgroupid|adid|ad_id|creative|matchtype|network|placement|srsltid|spm|scm|share|shared|si|fb_action_ids|fb_action_types|fb_source|soc_src|soc_trk|cjevent|cjdata|ranmid|raneaid|ransiteid|zanpid|pk_[a-z]+|mtm_[a-z]+|piwik_[a-z]+|icid|intcmp|int_cmp|_branch_match_id|oly_enc_id|oly_anon_id|vero_id|vero_conv|wickedid|sc_cid|cm_mmc|cm_sp|cm_re)$/i,
    session: /^(sid|sessionid|session_id|session|phpsessid|jsessionid|aspsessionid\w*|cfid|cftoken|zenid|oscsid|nonce|_nonce|cache|cachebuster|cb|_|timestamp|ts|rand|random|nocache)$/i,
    pagination: /^(page|pg|p|paged|pagenum|page_?num(ber)?|page_?no|pageno|pagenumber|page_?index|pageindex|currentpage|current_page|pagina|seite|offset|start|startindex|start_index|from|skip)$/i,
    view: /^(page_?size|pagesize|per_?page|perpage|items_?per_?page|limit|rows|show|view|view_?mode|viewmode|layout|display|grid|list|mode|page_?type|pagetype|sort|sort_?by|sortby|sort_?order|sortorder|sorting|order|order_?by|orderby|dir|direction|ordering|currency|density|columns|cols|product_list_limit|product_list_order|product_list_mode)$/i,
    filter: /^(filter|filters|f|fq|facet|facets|refine|refinement|refinements|color|colour|size|brand|brands|price|price_?min|price_?max|min_?price|max_?price|pmin|pmax|price_?range|rating|ratings|availability|in_?stock|instock|stock|material|style|width|fit|gender|range|discount|offer|deal|condition|seller|features|attr|attribute|tag|tags)$/i,
    search: /^(q|query|search|s|keyword|keywords|k|term|terms|searchterm|search_term|search_query|text)$/i,
    variant: /^(variant|variation|variant_?id|variation_?id|sku|option|options|selected|swatch|colorway)$/i,
    content: /^(id|pid|product_?id|productid|item|item_?id|itemid|article|article_?id|post|post_?id|postid|cat_?id|catid|category_?id|slug|lang|hl|locale|country|region|language)$/i
  };
  var IGNORABLE = { tracking: 1, session: 1, view: 1, filter: 1, search: 1, variant: 1 };
  var CLASS_LABEL = {
    tracking: 'tracking', session: 'session / cache-buster', pagination: 'pagination', view: 'sorting / display',
    filter: 'filter', search: 'search query', variant: 'product variant', content: 'content-selecting', unknown: 'unrecognised'
  };
  var UTILITY_RX = /\/(cart|basket|bag|checkout|my-?account|account|login|log-in|signin|sign-in|signup|sign-up|register|wishlist|password|orders?|thank-?you|thanks|confirmation|logout|compare|track-order|order-status)(\/|\.|$)/i;
  var SEARCH_PATH_RX = /\/(search|results|catalogsearch|find)(\/|\.|$)/i;
  var STAGING_HOST_RX = /(^|\.)(localhost|127\.0\.0\.1|0\.0\.0\.0)$|^(dev|develop|development|stage|staging|stg|test|testing|qa|uat|preprod|pre-prod|beta|sandbox|local|demo)[.-]|\.(local|test|internal|invalid|localhost)$|(^|\.)(vercel\.app|netlify\.app|herokuapp\.com|pages\.dev|ngrok\.io|ngrok-free\.app|myshopify\.com|wpengine\.com|wpenginepowered\.com|azurewebsites\.net|web\.app|firebaseapp\.com|github\.io)$|^\d+\.\d+\.\d+\.\d+$/i;

  // ---- parsing ---------------------------------------------------------------
  function parse(u, base) {
    try {
      var x = base ? new URL(u, base) : new URL(u);
      var host = x.hostname.toLowerCase();
      var params = [];
      x.searchParams.forEach(function (v, k) { params.push([k, v]); });
      var path = x.pathname || '/';
      try { path = decodeURI(path); } catch (e) {}
      return { url: x, href: x.href, protocol: x.protocol, host: host, hostNoWww: host.replace(/^www\./, ''),
        port: x.port, path: path, params: params, hash: x.hash };
    } catch (e) { return null; }
  }
  function pathKey(p) { var s = String(p || '/'); return s.length > 1 ? s.replace(/\/+$/, '') : s; }

  function classifyParam(name, value, path) {
    var k = String(name || '');
    var v = String(value == null ? '' : value);
    var bare = k.replace(/\[.*$/, '');
    if (/\[/.test(k) && /^(filter|f|attr|attributes|facet)/i.test(bare)) return 'filter';
    if (/^(filter_|f_|pa_|attr_|facet_)/i.test(k)) return 'filter';
    if (RX.tracking.test(k)) return 'tracking';
    if (RX.session.test(k)) return 'session';
    // WordPress ?p=123 on the root selects a post; ?page=about selects a page.
    if (/^(p|page)$/i.test(k) && (pathKey(path) === '/' || /\/index\.php$/i.test(path))) {
      if (k.toLowerCase() === 'p' || !/^\d+$/.test(v)) return 'content';
    }
    if (RX.pagination.test(k)) return /^\d*$/.test(v) ? 'pagination' : 'unknown';
    if (RX.view.test(k)) return 'view';
    if (RX.search.test(k)) return 'search';
    if (RX.variant.test(k)) return 'variant';
    if (RX.filter.test(k)) return 'filter';
    if (RX.content.test(k)) return 'content';
    return 'unknown';
  }
  function pageNumOf(name, value) {
    var n = parseInt(value, 10);
    if (/^(offset|start|startindex|start_index|from|skip)$/i.test(name)) return (!value || n === 0) ? 1 : 2;
    if (isNaN(n)) return 1;
    return n <= 0 ? 1 : n;   // page=0 is the first page on zero-indexed sites
  }

  function urlContext(u) {
    var P = parse(u);
    if (!P) return null;
    var ctx = { path: P.path, params: [], isPaginated: false, pageNum: 1, isSearch: false, isFiltered: false,
      isSorted: false, hasTracking: false, isUtility: UTILITY_RX.test(P.path), isHome: false };
    P.params.forEach(function (kv) {
      var cls = classifyParam(kv[0], kv[1], P.path);
      ctx.params.push({ k: kv[0], v: kv[1], cls: cls });
      if (cls === 'pagination') { ctx.pageNum = Math.max(ctx.pageNum, pageNumOf(kv[0], kv[1])); }
      if (cls === 'search' && kv[1]) ctx.isSearch = true;
      if (cls === 'filter') ctx.isFiltered = true;
      if (cls === 'view') ctx.isSorted = true;
      if (cls === 'tracking' || cls === 'session') ctx.hasTracking = true;
    });
    var pm = P.path.match(/\/(?:page|p)\/(\d+)\/?$/i);
    if (pm) ctx.pageNum = Math.max(ctx.pageNum, parseInt(pm[1], 10) || 1);
    ctx.isPaginated = ctx.pageNum > 1;
    if (SEARCH_PATH_RX.test(P.path) && ctx.params.some(function (p) { return p.cls === 'search'; })) ctx.isSearch = true;
    ctx.isHome = /^\/(index\.\w+|home|default\.\w+)?$/i.test(pathKey(P.path)) &&
      !ctx.params.some(function (p) { return p.cls === 'content'; });
    return ctx;
  }

  // The URL a page should normally declare as canonical: drop parameters that
  // don't change the main content, keep pagination beyond page 1 and anything
  // that selects different content (or that we can't classify).
  function preferredUrl(u) {
    var P = parse(u);
    if (!P) return u || '';
    var keep = [];
    P.params.forEach(function (kv) {
      var cls = classifyParam(kv[0], kv[1], P.path);
      if (IGNORABLE[cls]) return;
      if (cls === 'pagination' && pageNumOf(kv[0], kv[1]) <= 1) return;
      keep.push(kv);
    });
    var x = new URL(P.href);
    x.hash = '';
    x.search = '';
    keep.forEach(function (kv) { x.searchParams.append(kv[0], kv[1]); });
    return x.href;
  }

  function sortedQuery(params) {
    return params.map(function (kv) { return kv[0] + '=' + kv[1]; }).sort().join('&');
  }
  function sameUrl(a, b) {
    var A = parse(a), B = parse(b);
    if (!A || !B) return String(a || '') === String(b || '');
    return A.protocol === B.protocol && A.host === B.host && A.port === B.port &&
      pathKey(A.path) === pathKey(B.path) && sortedQuery(A.params) === sortedQuery(B.params);
  }

  function canonicalTag(u) { return '<link rel="canonical" href="' + u + '">'; }
  function finding(sev, title, detail, current, recommended, extra) {
    var f = { sev: sev, title: title, detail: detail };
    if (current != null) f.current = current;
    if (recommended != null) {
      f.recommended = recommended;
      if (/^https?:\/\//i.test(recommended)) { f.code = canonicalTag(recommended); f.codeName = 'canonical.html'; }
    }
    if (extra) for (var k in extra) f[k] = extra[k];
    return f;
  }
  function paramList(list) {
    return list.map(function (p) { return p.k + (p.v ? '=' + p.v : '') + ' (' + CLASS_LABEL[p.cls] + ')'; }).join(', ');
  }

  // ---- canonical assessment ----------------------------------------------------
  function canonicalAssess(pageUrl, canonical) {
    var preferred = preferredUrl(pageUrl);
    if (!canonical) {
      var cx = urlContext(pageUrl) || {};
      return { status: 'missing', explain: 'No canonical tag.', preferred: preferred,
        findings: [finding(cx.isSearch || cx.isUtility ? 'low' : 'med', 'Add a canonical tag',
          'There is no canonical tag. Declare the preferred URL so links and signals to its variants (tracking, sorting or filter parameters) consolidate in one place.' +
          (preferred !== pageUrl.replace(/#.*$/, '') ? ' The preferred URL drops parameters that don’t change the content.' : ''),
          '(none)', preferred)] };
    }
    var P = parse(pageUrl), C = parse(canonical, pageUrl);
    if (!P) return { status: 'self', explain: '', findings: [] };
    if (!C) return { status: 'issue', explain: 'The canonical URL is not valid.', findings: [
      finding('high', 'Canonical URL is not valid', 'The canonical tag does not contain a valid URL, so search engines will ignore it.', canonical, preferred)] };

    var findings = [], notes = [];
    if (!/^https?:\/\//i.test(String(canonical).trim())) {
      notes.push('relative URL');
      findings.push(finding('low', 'Use an absolute canonical URL',
        'The canonical is a relative URL. Google resolves it, but an absolute https:// URL avoids mistakes on alternate hosts and protocols.',
        canonical, C.href));
    }

    // Other host?
    if (C.hostNoWww !== P.hostNoWww) {
      if (STAGING_HOST_RX.test(C.host) && !STAGING_HOST_RX.test(P.host)) {
        findings.unshift(finding('high', 'Canonical points to a staging or development domain',
          'The canonical sends search engines to ' + C.host + ', which looks like a staging, preview or platform domain. This usually happens when a build copies settings from a test environment, and it can drop the live page from search.',
          C.href, preferred));
        return { status: 'issue', explain: 'Points to a staging/dev domain.', findings: findings };
      }
      findings.unshift(finding('med', 'Canonical points to another domain',
        'Search engines will treat ' + C.hostNoWww + ' as the original and usually index that page instead of this one. That is correct for syndicated or republished content. If this page should rank on its own, make the canonical self-referencing.',
        C.href, preferred, { recommendedLabel: 'If unique' }));
      return { status: 'different', explain: 'Cross-domain canonical to ' + C.hostNoWww + '.', findings: findings };
    }
    if (P.protocol === 'https:' && C.protocol === 'http:') {
      var https = new URL(C.href); https.protocol = 'https:';
      findings.unshift(finding('high', 'Canonical points to the insecure http:// version',
        'This page is served over https but its canonical names the http:// URL. Search engines prefer https, and pointing the canonical at http sends mixed signals. Use the https version.',
        C.href, https.href));
      return { status: 'issue', explain: 'Canonical uses http://.', findings: findings };
    }
    if (C.host !== P.host) notes.push(C.host.indexOf('www.') === 0 ? 'www host' : 'non-www host');

    var pk = pathKey(P.path), ck = pathKey(C.path);
    if (pk !== ck) {
      if (pk.toLowerCase() === ck.toLowerCase()) notes.push('letter case');
      else {
        var pageCtx = urlContext(pageUrl) || {};
        var pagMatch = P.path.match(/^(.*?)\/(?:page|p)\/(\d+)\/?$/i);
        var isAltVersion = /\/(amp|print)(\/|$)|\.amp(\.html)?$/i.test(P.path);
        var isIndexAlias = /^\/(index\.\w+|home|default\.\w+)$/i.test(pk) && ck === '/';
        if (isIndexAlias || isAltVersion) {
          notes.push(isAltVersion ? 'AMP/print version' : 'index alias');
        } else if (pagMatch && pathKey(pagMatch[1] || '/') === ck) {
          var n = parseInt(pagMatch[2], 10);
          if (n > 1) {
            findings.unshift(finding('med', 'Paginated page ' + n + ' canonicalises to page 1',
              'Each page in a paginated series should normally canonicalise to itself. Pointing page ' + n + ' at page 1 tells search engines to ignore it, so items that only appear on deeper pages can be missed. Keep this only if every item is also linked from somewhere crawlable, such as a view-all page.',
              C.href, preferred));
            return { status: 'issue', explain: 'Page ' + n + ' → page 1.', findings: findings };
          }
          notes.push('page 1 alias');
        } else if (ck === '/' && !pageCtx.isHome) {
          findings.unshift(finding('high', 'Canonical points to the homepage',
            'This inner page names the homepage as its canonical. Search engines may then drop this page from results in favour of the homepage. This is a common template bug: every page should name its own URL unless it is a true duplicate.',
            C.href, preferred));
          return { status: 'issue', explain: 'Inner page → homepage.', findings: findings };
        } else {
          findings.unshift(finding('med', 'Canonical points to a different page',
            'Search engines will treat this page as a duplicate of ' + C.path + ' and usually index that URL instead. That is correct for duplicates and variants (for example a product colour, or the same item in two categories). If this page has its own content that should rank, make the canonical self-referencing.',
            C.href, preferred, { recommendedLabel: 'If unique' }));
          return { status: 'different', explain: 'Different page: ' + C.path, findings: findings };
        }
      }
    } else if (P.path !== C.path) notes.push('trailing slash');

    // Same page: compare query parameters.
    var pMap = {}, cMap = {};
    P.params.forEach(function (kv) { pMap[kv[0]] = kv[1]; });
    C.params.forEach(function (kv) { cMap[kv[0]] = kv[1]; });
    var dropped = [], added = [];
    P.params.forEach(function (kv) {
      if (!(kv[0] in cMap) || cMap[kv[0]] !== kv[1]) dropped.push({ k: kv[0], v: kv[1], cls: classifyParam(kv[0], kv[1], P.path) });
    });
    C.params.forEach(function (kv) {
      if (!(kv[0] in pMap) || pMap[kv[0]] !== kv[1]) added.push({ k: kv[0], v: kv[1], cls: classifyParam(kv[0], kv[1], C.path) });
    });
    // A parameter whose value merely changed is reported once, as dropped.
    added = added.filter(function (a) { return !(a.k in pMap); });

    var droppedFine = [], droppedPag = [], droppedContent = [], droppedUnknown = [];
    dropped.forEach(function (p) {
      if (IGNORABLE[p.cls]) droppedFine.push(p);
      else if (p.cls === 'pagination') (pageNumOf(p.k, p.v) <= 1 ? droppedFine : droppedPag).push(p);
      else if (p.cls === 'content') droppedContent.push(p);
      else droppedUnknown.push(p);
    });
    var addedTracking = added.filter(function (p) { return p.cls === 'tracking' || p.cls === 'session'; });
    var addedParamish = added.filter(function (p) {
      return p.cls === 'view' || p.cls === 'filter' || p.cls === 'search' || p.cls === 'variant' ||
        (p.cls === 'pagination' && pageNumOf(p.k, p.v) <= 1);
    });
    var addedLaterPage = added.filter(function (p) { return p.cls === 'pagination' && pageNumOf(p.k, p.v) > 1; });
    var addedOther = added.filter(function (p) { return p.cls === 'content' || p.cls === 'unknown'; });

    if (droppedPag.length) {
      var pn = pageNumOf(droppedPag[0].k, droppedPag[0].v);
      findings.push(finding('med', 'Paginated page ' + pn + ' canonicalises to page 1',
        'Each page in a paginated series should normally canonicalise to itself (' + droppedPag[0].k + '=' + droppedPag[0].v + ' included). Pointing it at the first page tells search engines to ignore it, so items that only appear on deeper pages can be missed. Keep this only if every item is also linked from somewhere crawlable, such as a view-all page.',
        C.href, preferred));
    }
    if (droppedContent.length) findings.push(finding('med', 'Canonical drops a parameter that selects content',
      'The canonical removes ' + paramList(droppedContent) + '. Parameters like this usually pick a different product, post or language, so the canonical may be pointing at the wrong page. Check that ' + C.href + ' shows the same main content as this URL.',
      C.href, preferred, { recommendedLabel: 'If different' }));
    if (droppedUnknown.length) findings.push(finding('low', 'Check the parameters the canonical drops',
      'The canonical removes ' + paramList(droppedUnknown) + '. That is correct if ' + (droppedUnknown.length > 1 ? 'they only change' : 'it only changes') + ' tracking, sorting or display. If ' + (droppedUnknown.length > 1 ? 'they select' : 'it selects') + ' different content, the canonical should keep ' + (droppedUnknown.length > 1 ? 'them' : 'it') + '.',
      C.href, null));
    if (addedTracking.length) findings.push(finding('med', 'Canonical contains tracking or session parameters',
      'The canonical URL includes ' + paramList(addedTracking) + '. Canonicals should name the clean URL, otherwise every visit can register a different "preferred" URL.',
      C.href, preferredUrl(C.href)));
    if (addedParamish.length) findings.push(finding('med', 'Canonical points to a parameterised version of this page',
      'The canonical adds ' + paramList(addedParamish) + ', which only change sorting, filtering or display. Point it at the clean URL so that is the version that gets indexed.',
      C.href, preferredUrl(C.href)));
    if (addedLaterPage.length) findings.push(finding('med', 'Canonical points to a later page in the series',
      'The canonical adds ' + paramList(addedLaterPage) + ', pointing this page at a different page of the series. Use this page’s own URL.',
      C.href, preferred));
    if (addedOther.length) findings.push(finding('low', 'Canonical adds parameters this URL doesn’t have',
      'The canonical includes ' + paramList(addedOther) + '. Make sure that URL shows the same main content as this page.',
      C.href, null));

    if (findings.some(function (f) { return f.sev === 'high' || f.sev === 'med'; })) {
      return { status: 'issue', explain: findings[0].title, findings: findings };
    }
    var explainBits = [];
    if (droppedFine.length) explainBits.push('ignores ' + paramList(droppedFine));
    if (notes.length) explainBits.push('normalises ' + notes.join(', '));
    if (!explainBits.length && !findings.length) return { status: 'self', explain: 'Self-referencing.', findings: [] };
    return {
      status: dropped.length || notes.length ? 'consolidated' : 'self',
      explain: 'Points to the clean URL for this page (' + explainBits.join('; ') + '). This is correct.',
      findings: findings
    };
  }

  // ---- page type (deterministic) --------------------------------------------
  function pageType(o) {
    o = o || {};
    var ctx = urlContext(o.url || '') || {};
    var types = (o.schemaTypes || []).map(function (t) { return String(t); });
    function has(list) { return list.some(function (t) { return types.indexOf(t) !== -1; }); }
    if (ctx.isUtility) return 'utility';
    if (ctx.isSearch) return 'search';
    if (has(['Product', 'ProductGroup'])) return 'product';
    if (has(['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report', 'ScholarlyArticle'])) return 'article';
    if (has(['CollectionPage', 'ItemList', 'OfferCatalog', 'SearchResultsPage'])) return 'category';
    if (ctx.isHome) return 'home';
    var p = (ctx.path || '').toLowerCase();
    if (/\/(blog|news|articles?|guides?|insights?|stories|learn|resources|magazine|journal|posts?|knowledge|academy|how-to|tips)(\/|$)/.test(p) && p.split('/').filter(Boolean).length >= 2) return 'article';
    if (/\/(products?|p|dp|item|items|pd|sku)\/[^/]+/.test(p) || (o.hasPrice && o.hasBuy)) return 'product';
    if (/\/(collections?|category|categories|c|shop|catalog|catalogue|department|departments|range|browse|plp|deals|offers|brands?)(\/|$)/.test(p)) return 'category';
    return 'other';
  }

  // Why a noindex on this URL is normal (empty string when it isn't).
  function noindexExpected(u) {
    var c = urlContext(u);
    if (!c) return '';
    if (c.isUtility) return 'account, cart and checkout pages are normally kept out of search';
    if (c.isSearch) return 'internal search results are normally kept out of search';
    if (c.isFiltered || c.isSorted) return 'filtered and sorted variations are often kept out of search';
    if (c.params.some(function (p) { return p.cls === 'session'; })) return 'session URLs are normally kept out of search';
    return '';
  }

  var api = {
    classifyParam: classifyParam, urlContext: urlContext, preferredUrl: preferredUrl,
    canonicalAssess: canonicalAssess, pageType: pageType, noindexExpected: noindexExpected,
    sameUrl: sameUrl, CLASS_LABEL: CLASS_LABEL
  };
  root.SEO_INTEL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
