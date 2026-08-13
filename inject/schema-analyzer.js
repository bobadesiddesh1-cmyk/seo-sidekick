/**
 * inject/schema-analyzer.js — Schema tab engine.
 *
 * Self-contained. Assigns __SEO_runSchemaAnalyzer to a global; references
 * nothing from outer scope so it is safe to inject via chrome.scripting.
 *
 * Produces a rich structured-data report for the dedicated Schema tab:
 *   A) Rich-result eligibility — detected schema.org types mapped to Google
 *      rich-result features, with REQUIRED vs recommended properties checked and
 *      the exact missing fields listed.
 *   B) Full inspector data — each JSON-LD block's raw + pretty JSON, plus an
 *      @id entity graph (nodes, edges) and broken-reference detection.
 *   C) Gap detection — page DOM features that look like they SHOULD carry schema
 *      but don't (breadcrumb nav w/o BreadcrumbList, FAQ layout w/o FAQPage, a
 *      byline/date w/o Article, a price/buy button w/o Product, video w/o
 *      VideoObject, a logo/org footer w/o Organization).
 *   D) Deeper validation — invalid JSON, missing/!schema.org @context, non-string
 *      @type, duplicate types, and value-type checks (dates, URLs, prices).
 *
 * All DOM/JSON access is wrapped in try/catch; the function never throws.
 */
(function () {
  'use strict';

  self.__SEO_runSchemaAnalyzer = function () {
    // ---- helpers ------------------------------------------------------------
    function qa(sel) {
      try { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
      catch (e) { return []; }
    }
    function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
    function txt(el) {
      try { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
      catch (e) { return ''; }
    }
    function cap(str, n) { str = String(str == null ? '' : str); return str.length > n ? str.slice(0, n) + '\n… (truncated)' : str; }

    function typeName(t) {
      if (Array.isArray(t)) return t.map(typeName).filter(Boolean);
      if (typeof t !== 'string') return '';
      var m = t.replace(/\/$/, '');
      var slash = m.lastIndexOf('/'), hash = m.lastIndexOf('#');
      var cut = Math.max(slash, hash);
      return cut >= 0 ? m.slice(cut + 1) : m;
    }
    function asTypeArray(t) {
      var n = typeName(t);
      return Array.isArray(n) ? n.filter(Boolean) : (n ? [n] : []);
    }
    function pushUnique(arr, v) {
      (Array.isArray(v) ? v : [v]).forEach(function (x) { if (x && arr.indexOf(x) === -1) arr.push(x); });
    }
    function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
    function has(node, key) {
      if (!isObj(node)) return false;
      var v = node[key];
      return v !== undefined && v !== null && v !== '' &&
        !(Array.isArray(v) && v.length === 0);
    }
    // A value can be a plain value, an object, or a reference ({"@id": "..."}).
    function firstOf(v) { return Array.isArray(v) ? v[0] : v; }
    function isRef(v) { return isObj(v) && v['@id'] && Object.keys(v).filter(function (k) { return k !== '@id'; }).length === 0; }

    function isISODate(v) {
      if (typeof v !== 'string') return false;
      if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/.test(v)) return true;
      return false;
    }
    function isUrlish(v) {
      if (typeof v !== 'string') return false;
      return /^https?:\/\//i.test(v) || v.charAt(0) === '/';
    }

    // ---- Google rich-result requirement table ------------------------------
    // req = must be present for eligibility; rec = strongly recommended.
    // docsKey drives a "Learn more" deep link in the UI.
    var RICH = {
      Article:        { label: 'Article',            req: ['headline', 'image'], rec: ['author', 'datePublished', 'dateModified', 'publisher'], docs: 'article' },
      NewsArticle:    { label: 'News Article',        req: ['headline', 'image'], rec: ['author', 'datePublished', 'dateModified', 'publisher'], docs: 'article' },
      BlogPosting:    { label: 'Blog Posting',        req: ['headline', 'image'], rec: ['author', 'datePublished', 'dateModified', 'publisher'], docs: 'article' },
      BreadcrumbList: { label: 'Breadcrumb',          req: ['itemListElement'], rec: [], docs: 'breadcrumb', special: 'breadcrumb' },
      Product:        { label: 'Product',             req: ['name', 'image'], rec: ['description', 'brand', 'sku', 'aggregateRating', 'review'], docs: 'product', special: 'product' },
      FAQPage:        { label: 'FAQ',                 req: ['mainEntity'], rec: [], docs: 'faqpage', special: 'faq' },
      QAPage:         { label: 'Q&A',                 req: ['mainEntity'], rec: [], docs: 'qapage' },
      Recipe:         { label: 'Recipe',              req: ['name', 'image'], rec: ['author', 'datePublished', 'description', 'recipeIngredient', 'recipeInstructions', 'aggregateRating', 'nutrition'], docs: 'recipe' },
      Event:          { label: 'Event',               req: ['name', 'startDate', 'location'], rec: ['endDate', 'eventStatus', 'offers', 'performer', 'image'], docs: 'event' },
      VideoObject:    { label: 'Video',               req: ['name', 'thumbnailUrl', 'uploadDate'], rec: ['description', 'duration', 'contentUrl', 'embedUrl'], docs: 'video' },
      Organization:   { label: 'Organization',        req: ['name', 'url'], rec: ['logo', 'sameAs', 'contactPoint'], docs: 'organization' },
      LocalBusiness:  { label: 'Local Business',      req: ['name', 'address'], rec: ['telephone', 'openingHours', 'geo', 'image', 'priceRange', 'url'], docs: 'local-business' },
      JobPosting:     { label: 'Job Posting',         req: ['title', 'description', 'datePosted', 'hiringOrganization'], rec: ['jobLocation', 'baseSalary', 'employmentType', 'validThrough'], docs: 'job-posting' },
      HowTo:          { label: 'How-to',              req: ['name', 'step'], rec: ['image', 'totalTime', 'tool', 'supply'], docs: 'how-to' },
      Review:         { label: 'Review snippet',      req: ['itemReviewed', 'reviewRating', 'author'], rec: ['datePublished', 'reviewBody', 'publisher'], docs: 'review-snippet' },
      AggregateRating:{ label: 'Aggregate rating',    req: ['ratingValue'], rec: ['reviewCount', 'ratingCount', 'bestRating'], docs: 'review-snippet' },
      SoftwareApplication: { label: 'Software App',   req: ['name'], rec: ['offers', 'aggregateRating', 'operatingSystem', 'applicationCategory'], docs: 'software-app' },
      WebSite:        { label: 'Sitelinks Searchbox', req: ['url'], rec: ['potentialAction'], docs: 'sitelinks-searchbox' }
    };
    // Types that carry meaning but aren't rich-result eligible on their own.
    var KNOWN_NONRICH = ['WebPage', 'WebSite', 'Person', 'ImageObject', 'Offer',
      'ListItem', 'Question', 'Answer', 'PostalAddress', 'SearchAction', 'Brand',
      'ItemList', 'CollectionPage', 'SiteNavigationElement'];

    // Deprecated / commonly-misused types worth flagging.
    var DEPRECATED = { CreativeWorkSeason: 1, ProductModel: 0 };

    // Special required-property evaluators (nested logic).
    function evalSpecial(kind, node, req) {
      // Returns array of {name, present, note} overriding/augmenting basic checks.
      if (kind === 'breadcrumb') {
        var items = node.itemListElement;
        var arr = Array.isArray(items) ? items : (items ? [items] : []);
        var ok = arr.length > 0 && arr.every(function (li) {
          return isObj(li) && (has(li, 'name') || (li.item && (has(li.item, 'name') || typeof li.item === 'string'))) && has(li, 'position');
        });
        return [{ name: 'itemListElement (each with name, item, position)', present: ok }];
      }
      if (kind === 'faq') {
        var me = node.mainEntity;
        var qs = Array.isArray(me) ? me : (me ? [me] : []);
        var okf = qs.length > 0 && qs.every(function (Q) {
          var ans = Q && (Q.acceptedAnswer || Q.suggestedAnswer);
          return isObj(Q) && has(Q, 'name') && ans && has(firstOf(ans), 'text');
        });
        return [{ name: 'mainEntity (Questions with name + acceptedAnswer.text)', present: okf }];
      }
      if (kind === 'product') {
        var out = [{ name: 'name', present: has(node, 'name') }, { name: 'image', present: has(node, 'image') }];
        var offers = firstOf(node.offers);
        var hasPrice = offers && (has(offers, 'price') || has(offers, 'lowPrice') || has(offers, 'priceSpecification'));
        var hasCur = offers && has(offers, 'priceCurrency');
        var hasReviewish = has(node, 'review') || has(node, 'aggregateRating');
        out.push({ name: 'offers.price + priceCurrency (or review/aggregateRating)',
          present: (hasPrice && hasCur) || hasReviewish });
        return out;
      }
      return null;
    }

    // ---- JSON-LD parse pass -------------------------------------------------
    var blocks = [];         // per <script> block for the inspector
    var entities = [];       // flattened nodes with @id / @type
    var idMap = {};          // @id -> entity index
    var allTypes = [];
    var validation = [];     // {level:'error'|'warn'|'info', msg}
    var invalidCount = 0;
    var seenTypeSig = {};

    function addEntity(node, blockIndex) {
      var types = asTypeArray(node['@type']);
      var atId = (typeof node['@id'] === 'string') ? node['@id'] : null;
      var propKeys = Object.keys(node).filter(function (k) { return k.charAt(0) !== '@'; });
      // Collect @id references made by this node (edges for the graph).
      var refs = [];
      (function scan(v, depth) {
        if (depth > 4 || v == null) return;
        if (Array.isArray(v)) { v.forEach(function (x) { scan(x, depth + 1); }); return; }
        if (isObj(v)) {
          if (typeof v['@id'] === 'string' && v !== node) pushUnique(refs, v['@id']);
          Object.keys(v).forEach(function (k) { if (k !== '@id') scan(v[k], depth + 1); });
        }
      })(node, 0);
      var idx = entities.length;
      var ent = {
        idx: idx, atId: atId, types: types, propKeys: propKeys,
        block: blockIndex, refs: refs, primaryType: types[0] || '(untyped)'
      };
      entities.push(ent);
      if (atId && idMap[atId] === undefined) idMap[atId] = idx;
      pushUnique(allTypes, types);
      return ent;
    }

    // Recursively find "typed" nodes inside a parsed block.
    function walk(node, blockIndex, ctxInherited) {
      if (!isObj(node)) {
        if (Array.isArray(node)) node.forEach(function (n) { walk(n, blockIndex, ctxInherited); });
        return;
      }
      var hasCtx = has(node, '@context') || ctxInherited;
      if (node['@graph']) {
        var g = node['@graph'];
        (Array.isArray(g) ? g : [g]).forEach(function (n) { walk(n, blockIndex, hasCtx); });
      }
      if (node['@type']) {
        var ent = addEntity(node, blockIndex);
        // @context presence check (only for top-of-tree typed nodes).
        if (!hasCtx && !ctxInherited) {
          validation.push({ level: 'warn', msg: ent.primaryType + ': no @context — add "@context":"https://schema.org"' });
        }
        // @type value sanity.
        var rawType = node['@type'];
        if (typeof rawType !== 'string' && !Array.isArray(rawType)) {
          validation.push({ level: 'error', msg: 'A node has a non-string @type value.' });
        }
        // Duplicate identical type signature (informational).
        ent.types.forEach(function (tp) {
          if (DEPRECATED[tp]) validation.push({ level: 'warn', msg: tp + ' is deprecated / discouraged by schema.org.' });
        });
        var sig = ent.types.slice().sort().join('+');
        if (sig) { if (seenTypeSig[sig]) seenTypeSig[sig]++; else seenTypeSig[sig] = 1; }
        // Value-type checks on well-known props.
        ['datePublished', 'dateModified', 'uploadDate', 'startDate', 'endDate', 'datePosted', 'validThrough'].forEach(function (dp) {
          if (has(node, dp) && !isISODate(String(firstOf(node[dp])))) {
            validation.push({ level: 'warn', msg: ent.primaryType + '.' + dp + ' is not an ISO 8601 date ("' + String(firstOf(node[dp])).slice(0, 40) + '").' });
          }
        });
        ['url', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'logo'].forEach(function (up) {
          var val = firstOf(node[up]);
          if (has(node, up) && typeof val === 'string' && !isUrlish(val)) {
            validation.push({ level: 'warn', msg: ent.primaryType + '.' + up + ' does not look like a URL.' });
          }
        });
      }
      // Recurse into nested typed objects (mainEntity, itemListElement, etc.)
      // so the graph and type list capture embedded entities too.
      Object.keys(node).forEach(function (k) {
        if (k === '@type' || k === '@context' || k === '@graph' || k === '@id') return;
        var v = node[k];
        if (Array.isArray(v)) v.forEach(function (x) { if (isObj(x) && x['@type']) walk(x, blockIndex, hasCtx); });
        else if (isObj(v) && v['@type']) walk(v, blockIndex, hasCtx);
      });
    }

    var scripts = qa('script[type="application/ld+json"]');
    scripts.forEach(function (s, i) {
      var raw = (s.textContent || '').trim();
      if (!raw) return;
      var data;
      try { data = JSON.parse(raw); }
      catch (e) {
        invalidCount++;
        blocks.push({ index: blocks.length, raw: cap(raw, 60000), pretty: '', valid: false,
          error: (e && e.message) ? String(e.message).slice(0, 200) : 'JSON parse error', types: [] });
        validation.push({ level: 'error', msg: 'Block ' + (blocks.length) + ': invalid JSON — ' + ((e && e.message) || 'parse error') });
        return;
      }
      var bIndex = blocks.length;
      var before = entities.length;
      (Array.isArray(data) ? data : [data]).forEach(function (n) { walk(n, bIndex, false); });
      var pretty = raw;
      try { pretty = JSON.stringify(data, null, 2); } catch (e) {}
      var bTypes = [];
      entities.slice(before).forEach(function (ent) { pushUnique(bTypes, ent.types); });
      blocks.push({ index: bIndex, raw: cap(raw, 60000), pretty: cap(pretty, 60000), valid: true, error: '', types: bTypes });
    });

    // Duplicate-type signal.
    Object.keys(seenTypeSig).forEach(function (sig) {
      if (seenTypeSig[sig] > 1 && sig) {
        validation.push({ level: 'info', msg: sig.replace(/\+/g, ' + ') + ' appears ' + seenTypeSig[sig] + ' times across the page.' });
      }
    });

    // ---- @id graph + broken references -------------------------------------
    var graphNodes = entities.map(function (e) {
      return { idx: e.idx, atId: e.atId, label: e.primaryType, types: e.types, block: e.block, refCount: e.refs.length };
    });
    var brokenRefs = [];
    var edges = [];
    entities.forEach(function (e) {
      e.refs.forEach(function (rid) {
        if (idMap[rid] !== undefined) edges.push({ from: e.idx, to: idMap[rid], id: rid });
        else {
          brokenRefs.push({ from: e.idx, fromType: e.primaryType, id: rid });
          validation.push({ level: 'error', msg: e.primaryType + ' references @id "' + rid + '" which is not defined on this page.' });
        }
      });
    });

    // ---- Rich-result eligibility -------------------------------------------
    // Evaluate each entity whose primary/any type is in the RICH table.
    var eligibility = [];
    entities.forEach(function (e) {
      // Find the raw node again? We only kept propKeys; re-resolve by re-walking
      // is costly, so evaluate against the live node captured on the entity.
    });
    // Re-run eligibility with access to the actual parsed nodes: capture during walk.
    // (entities lost their node ref to keep payload small; recompute here from a
    // second light pass storing nodes.)
    // -- Simpler: redo a targeted pass collecting nodes for RICH types only.
    var richNodes = [];
    (function collectRich() {
      function visit(node, depth) {
        if (depth > 8 || node == null) return;
        if (Array.isArray(node)) { node.forEach(function (n) { visit(n, depth + 1); }); return; }
        if (!isObj(node)) return;
        if (node['@graph']) visit(node['@graph'], depth + 1);
        var ts = asTypeArray(node['@type']);
        var hit = ts.filter(function (t) { return RICH[t]; });
        if (hit.length) richNodes.push({ node: node, types: ts, hit: hit });
        Object.keys(node).forEach(function (k) {
          if (k.charAt(0) === '@') return;
          visit(node[k], depth + 1);
        });
      }
      scripts.forEach(function (s) {
        var raw = (s.textContent || '').trim();
        if (!raw) return;
        try { visit(JSON.parse(raw), 0); } catch (e) {}
      });
    })();

    var eligSeen = {};
    richNodes.forEach(function (rn) {
      rn.hit.forEach(function (tp) {
        var spec = RICH[tp];
        var key = tp + '|' + (rn.node['@id'] || '') + '|' + (rn.node.name || rn.node.headline || rn.node.title || '');
        if (eligSeen[key]) return; eligSeen[key] = true;
        var required = [], recommended = [];
        var special = spec.special ? evalSpecial(spec.special, rn.node, spec.req) : null;
        if (special) required = special;
        else spec.req.forEach(function (p) { required.push({ name: p, present: has(rn.node, p) }); });
        spec.rec.forEach(function (p) { recommended.push({ name: p, present: has(rn.node, p) }); });
        var missingReq = required.filter(function (r) { return !r.present; }).map(function (r) { return r.name; });
        eligibility.push({
          type: tp, label: spec.label, docs: spec.docs,
          name: String(rn.node.name || rn.node.headline || rn.node.title || '').slice(0, 80),
          required: required, recommended: recommended,
          eligible: missingReq.length === 0, missingRequired: missingReq,
          missingRecommended: recommended.filter(function (r) { return !r.present; }).map(function (r) { return r.name; })
        });
      });
    });

    // ---- Microdata / RDFa ---------------------------------------------------
    var microTypes = [];
    var microItems = qa('[itemscope]');
    microItems.forEach(function (el) {
      var it = el.getAttribute('itemtype') || '';
      if (it) pushUnique(microTypes, asTypeArray(it.split(/\s+/)));
    });
    var rdfaTypes = [];
    var rdfaNodes = qa('[typeof]');
    rdfaNodes.forEach(function (el) {
      var tof = el.getAttribute('typeof') || '';
      if (tof) pushUnique(rdfaTypes, asTypeArray(tof.split(/\s+/)));
    });

    // ---- Gap detection (DOM features that should carry schema) -------------
    // Each gap: {id, title, why, templateKey, severity}. The UI supplies the
    // copy-paste JSON-LD template for templateKey.
    var gaps = [];
    function hasType(t) { return allTypes.indexOf(t) !== -1; }
    function hasAnyType(list) { return list.some(hasType); }

    // Breadcrumb nav present but no BreadcrumbList.
    var breadcrumbEl = q('[aria-label*="breadcrumb" i], [class*="breadcrumb" i], nav[class*="crumb" i], ol[class*="breadcrumb" i], .breadcrumbs, [itemtype*="BreadcrumbList"]');
    if (breadcrumbEl && !hasType('BreadcrumbList')) {
      gaps.push({ id: 'breadcrumb', title: 'Breadcrumb navigation without BreadcrumbList schema',
        why: 'A breadcrumb trail is on the page but no BreadcrumbList structured data was found. Adding it can produce breadcrumb rich results in Google.',
        templateKey: 'BreadcrumbList', severity: 'high' });
    }

    // FAQ-like layout but no FAQPage.
    var detailsPairs = qa('details > summary').length;
    var dtdd = qa('dl dt').length;
    var qHeadings = qa('h2, h3, h4').filter(function (h) { return /\?\s*$/.test(txt(h)); }).length;
    var faqSignal = detailsPairs >= 3 || dtdd >= 3 || qHeadings >= 3;
    if (faqSignal && !hasType('FAQPage') && !hasType('QAPage')) {
      gaps.push({ id: 'faq', title: 'FAQ-style content without FAQPage schema',
        why: 'The page has a question/answer layout (' +
          (detailsPairs >= 3 ? detailsPairs + ' expandable items' : dtdd >= 3 ? dtdd + ' definition items' : qHeadings + ' question headings') +
          ') but no FAQPage markup. FAQPage can show expandable Q&A directly in search.',
        templateKey: 'FAQPage', severity: 'high' });
    }

    // Article byline / date but no Article type.
    var bylineEl = q('[rel="author"], [class*="byline" i], [class*="author" i], [itemprop="author"], address[class*="author" i]');
    var timeEl = q('time[datetime], [itemprop="datePublished"], [property="article:published_time"], meta[property="article:published_time"]');
    var articleEl = q('article');
    var longish = (txt(articleEl || document.body) || '').length > 1200;
    if ((bylineEl || timeEl) && articleEl && longish && !hasAnyType(['Article', 'NewsArticle', 'BlogPosting'])) {
      gaps.push({ id: 'article', title: 'Article content without Article schema',
        why: 'This page looks like an article (byline/date + <article> body) but has no Article, NewsArticle or BlogPosting markup.',
        templateKey: 'Article', severity: 'med' });
    }

    // Price / buy button but no Product.
    var priceEl = q('[itemprop="price"], [class*="price" i], [data-price], meta[property="product:price:amount"]');
    var buyEl = q('[class*="add-to-cart" i], [id*="add-to-cart" i], button[name*="add" i], [class*="buy-now" i], [class*="addtocart" i]');
    if (priceEl && buyEl && !hasType('Product')) {
      gaps.push({ id: 'product', title: 'Product page without Product schema',
        why: 'A price and an add-to-cart / buy control are present but there is no Product structured data. Product markup enables price, availability and rating snippets.',
        templateKey: 'Product', severity: 'high' });
    }

    // Video embed but no VideoObject.
    var videoEl = q('video, iframe[src*="youtube.com" i], iframe[src*="youtube-nocookie.com" i], iframe[src*="vimeo.com" i], iframe[src*="player." i]');
    if (videoEl && !hasType('VideoObject')) {
      gaps.push({ id: 'video', title: 'Embedded video without VideoObject schema',
        why: 'A video is embedded but no VideoObject markup was found. VideoObject lets the clip appear as a video result with thumbnail and key moments.',
        templateKey: 'VideoObject', severity: 'med' });
    }

    // Site logo / org footer but no Organization / WebSite.
    var logoEl = q('img[class*="logo" i], img[alt*="logo" i], [class*="site-logo" i], header img[src*="logo" i]');
    if (logoEl && !hasAnyType(['Organization', 'LocalBusiness', 'Corporation', 'NewsMediaOrganization'])) {
      gaps.push({ id: 'organization', title: 'No Organization schema for this site',
        why: 'The site has a logo/branding but no Organization markup. Organization (with a logo and sameAs profiles) helps Google build a knowledge panel and use your logo.',
        templateKey: 'Organization', severity: 'low' });
    }
    // Sitelinks search box (WebSite + SearchAction) for sites with an on-site search.
    var searchEl = q('input[type="search"], form[role="search"], [class*="search-form" i] input');
    if (searchEl && !hasType('WebSite')) {
      gaps.push({ id: 'website', title: 'On-site search without WebSite / Sitelinks Searchbox schema',
        why: 'The page has a search box but no WebSite markup with a potentialAction. Adding it can enable a search box directly in Google’s sitelinks.',
        templateKey: 'WebSite', severity: 'low' });
    }

    // ---- Summary counts -----------------------------------------------------
    var formats = [];
    if (blocks.length) formats.push('JSON-LD');
    if (microItems.length) formats.push('Microdata');
    if (rdfaNodes.length || q('[vocab]')) formats.push('RDFa');

    var eligibleCount = eligibility.filter(function (e) { return e.eligible; }).length;
    var blockedCount = eligibility.length - eligibleCount;
    var errorCount = validation.filter(function (v) { return v.level === 'error'; }).length;
    var warnCount = validation.filter(function (v) { return v.level === 'warn'; }).length;

    return {
      url: location.href,
      host: location.hostname,
      formats: formats,
      counts: {
        blocks: blocks.length, invalidBlocks: invalidCount,
        entities: entities.length, types: allTypes.length,
        eligible: eligibleCount, blocked: blockedCount,
        gaps: gaps.length, errors: errorCount, warnings: warnCount,
        microdata: microItems.length, rdfa: rdfaNodes.length
      },
      allTypes: allTypes,
      blocks: blocks,
      eligibility: eligibility,
      graph: { nodes: graphNodes, edges: edges, brokenRefs: brokenRefs },
      gaps: gaps,
      validation: validation.slice(0, 200),
      microdata: { count: microItems.length, types: microTypes },
      rdfa: { count: rdfaNodes.length, types: rdfaTypes }
    };
  };
})();
