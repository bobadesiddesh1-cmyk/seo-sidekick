/**
 * inject/onpage-analyzer.js — Module 6 (On-Page Elements Analyzer)
 *
 * Self-contained. Assigns __SEO_runOnpageAnalyzer to a global; references
 * nothing from outer scope so it is safe to inject via chrome.scripting.
 *
 * Reads the current page's on-page SEO elements directly from the DOM and
 * computes a content word count. Per the product requirement, the PRIMARY word
 * count is taken from the page's <body> restricted to <p> (paragraph) text, so
 * navigation, menus, scripts and boilerplate don't inflate it. A secondary
 * "all body text" count (body minus script/style/noscript/template) is also
 * returned for reference.
 *
 * All DOM access is wrapped in try/catch; the function never throws.
 */
(function () {
  'use strict';

  self.__SEO_runOnpageAnalyzer = function () {
    var pageHost = location.hostname;

    // ---- helpers ------------------------------------------------------------
    function attr(el, name) {
      try { return el ? (el.getAttribute(name) || '') : ''; } catch (e) { return ''; }
    }
    function text(el) {
      try { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
      catch (e) { return ''; }
    }
    function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
    function qa(sel) {
      try { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
      catch (e) { return []; }
    }
    function meta(nameOrProp, isProp) {
      var el = q('meta[' + (isProp ? 'property' : 'name') + '="' + nameOrProp + '"]');
      return el ? attr(el, 'content').trim() : '';
    }
    function visible(el) {
      try {
        if (!el) return false;
        var s = window.getComputedStyle(el);
        if (!s) return true;
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        if (parseFloat(s.opacity || '1') === 0) return false;
        return true;
      } catch (e) { return true; }
    }

    // Word tokenizer — Unicode letters/numbers, allowing internal apostrophes
    // and hyphens (so "don't" and "state-of-the-art" count as one word each).
    function countWords(str) {
      if (!str) return 0;
      var s = String(str);
      try {
        var m = s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
        return m ? m.length : 0;
      } catch (e) {
        // Environments without Unicode property escapes: ASCII-ish fallback.
        var m2 = s.match(/[A-Za-z0-9À-ɏ]+(?:['’\-][A-Za-z0-9À-ɏ]+)*/g);
        return m2 ? m2.length : 0;
      }
    }

    // ---- title / meta -------------------------------------------------------
    var titleText = text(q('title'));
    var metaDesc = meta('description', false);
    var canonicalEl = q('link[rel="canonical"]');
    var canonical = canonicalEl ? attr(canonicalEl, 'href') : '';
    var robots = meta('robots', false);
    var viewport = meta('viewport', false);
    var charset = '';
    try {
      var cs = q('meta[charset]');
      charset = cs ? attr(cs, 'charset') : (document.characterSet || '');
    } catch (e) { charset = ''; }
    var htmlLang = '';
    try { htmlLang = document.documentElement.getAttribute('lang') || ''; } catch (e) {}

    // ---- headings -----------------------------------------------------------
    var headings = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function (tag) {
      qa(tag).forEach(function (el) {
        if (!visible(el)) return;
        var t = text(el);
        if (t) headings[tag].push(t.length > 90 ? t.slice(0, 89) + '…' : t);
      });
    });
    var headingCounts = {};
    var headingWordTotal = 0;
    Object.keys(headings).forEach(function (k) {
      headingCounts[k] = headings[k].length;
      headings[k].forEach(function (t) { headingWordTotal += countWords(t); });
    });

    // ---- images -------------------------------------------------------------
    var imgs = qa('img');
    var imgMissingAlt = 0, imgEmptyAlt = 0, imgWithAlt = 0;
    imgs.forEach(function (im) {
      var a = im.getAttribute('alt');
      if (a === null) imgMissingAlt++;
      else if (a.trim() === '') imgEmptyAlt++;
      else imgWithAlt++;
    });

    // ---- links (quick counts) ----------------------------------------------
    var linkTotal = 0, linkInternal = 0, linkExternal = 0, linkNofollow = 0;
    qa('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href) return;
      var t = href.trim().toLowerCase();
      if (t.charAt(0) === '#' || t.indexOf('javascript:') === 0 ||
          t.indexOf('mailto:') === 0 || t.indexOf('tel:') === 0) return;
      linkTotal++;
      var internal = true;
      try { internal = new URL(href, location.href).hostname === pageHost; } catch (e) {}
      if (internal) linkInternal++; else linkExternal++;
      var rel = (a.getAttribute('rel') || '').toLowerCase();
      if (/(^|\s)(nofollow|sponsored|ugc)(\s|$)/.test(rel)) linkNofollow++;
    });

    // ---- Open Graph / Twitter ----------------------------------------------
    var og = {};
    qa('meta[property^="og:"]').forEach(function (m) {
      var p = attr(m, 'property'); var c = attr(m, 'content');
      if (p && c && !(p in og)) og[p] = c;
    });
    var twitter = {};
    qa('meta[name^="twitter:"]').forEach(function (m) {
      var n = attr(m, 'name'); var c = attr(m, 'content');
      if (n && c && !(n in twitter)) twitter[n] = c;
    });

    // ---- structured data (JSON-LD) -----------------------------------------
    var jsonLdTypes = [];
    qa('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var data = JSON.parse(s.textContent);
        collectTypes(data, jsonLdTypes);
      } catch (e) { /* invalid JSON-LD — ignore */ }
    });
    function collectTypes(node, out) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(function (n) { collectTypes(n, out); }); return; }
      if (typeof node === 'object') {
        var t = node['@type'];
        if (t) {
          (Array.isArray(t) ? t : [t]).forEach(function (x) {
            if (out.indexOf(x) === -1) out.push(x);
          });
        }
        if (node['@graph']) collectTypes(node['@graph'], out);
      }
    }

    // ---- WORD COUNT (MAIN CONTENT only) ------------------------------------
    // Goal: count the article/body copy, NOT the whole page (nav, header,
    // footer, sidebars, cookie banners, related-posts, etc.). Two steps:
    //   1) Pick a content root: <main>/[role=main]/<article> if present, else
    //      the block that holds the most paragraph text (a light Readability-
    //      style density pick), else <body>.
    //   2) Within that root, count words from visible <p> paragraphs whose
    //      ancestors are NOT boilerplate (nav/header/footer/aside/role/negative
    //      class or id patterns).

    // Elements/roles that are always boilerplate.
    var BOILER_TAGS = { nav: 1, header: 1, footer: 1, aside: 1, form: 1 };
    var BOILER_ROLES = {
      navigation: 1, banner: 1, contentinfo: 1, complementary: 1, search: 1,
      menu: 1, menubar: 1, dialog: 1, tablist: 1
    };
    // Negative class/id substrings (boilerplate) and positive ones (content).
    var NEG_RE = /(^|[-_\s])(nav|menu|sidebar|side-bar|footer|header|masthead|breadcrumb|pagination|pager|comment|disqus|cookie|consent|gdpr|banner|promo|advert|adsense|widget|share|social|related|recommend|subscribe|newsletter|signup|modal|popup|overlay|lightbox|toolbar|topbar|utility|skip|screen-reader|visually-hidden|sr-only|offcanvas|drawer|search|login|signin|account|cart|wishlist|tag-cloud|byline|author-box|copyright|legal|disclaimer|back-to-top|meta-|-meta|hero-nav|site-)([-_\s]|$)/i;
    var POS_RE = /(^|[-_\s])(article|articlebody|post|entry|content|main|story|blog|prose|body-copy|rich-text|markdown|page-content|entry-content|post-content|article-content|c-content)([-_\s]|$)/i;

    function elClassId(el) {
      var c = '';
      try { c = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || ''); }
      catch (e) { c = ''; }
      return c;
    }
    function isBoilerplate(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (BOILER_TAGS[tag]) return true;
      var role = '';
      try { role = (el.getAttribute('role') || '').toLowerCase(); } catch (e) {}
      if (role && BOILER_ROLES[role]) return true;
      var ci = elClassId(el);
      if (ci && NEG_RE.test(ci) && !POS_RE.test(ci)) return true;
      return false;
    }
    // Is el, or any ancestor up to (and excluding) stopAt, boilerplate?
    function inBoilerplate(el, stopAt) {
      var node = el;
      while (node && node !== stopAt && node.nodeType === 1) {
        if (isBoilerplate(node)) return true;
        node = node.parentElement;
      }
      return false;
    }

    // Step 1: choose the content root.
    var contentRoot = null;
    var contentRootLabel = '';
    try {
      contentRoot = document.querySelector('main') ||
        document.querySelector('[role="main"]');
      if (contentRoot) contentRootLabel = contentRoot.tagName.toLowerCase() === 'main' ? '<main>' : '[role=main]';
    } catch (e) { contentRoot = null; }

    if (!contentRoot) {
      // Pick the <article> (or any block) whose paragraphs hold the most text.
      var bestEl = null, bestScore = 0;
      try {
        var candidates = qa('article, [role="article"], section, div');
        // Limit work on huge pages.
        var scanned = 0;
        for (var ci2 = 0; ci2 < candidates.length && scanned < 1200; ci2++) {
          var cand = candidates[ci2];
          if (isBoilerplate(cand)) continue;
          var ps = cand.getElementsByTagName('p');
          if (!ps.length) continue;
          scanned++;
          var score = 0, deep = 0;
          for (var pi = 0; pi < ps.length; pi++) {
            var pp = ps[pi];
            if (inBoilerplate(pp, cand)) continue;
            var tt = (pp.textContent || '').trim();
            if (tt.length < 20) continue; // ignore tiny UI paragraphs
            score += tt.length;
            deep++;
          }
          // Prefer containers with real prose; a small nudge for <article>.
          if (cand.tagName.toLowerCase() === 'article') score = score * 1.15;
          if (deep >= 1 && score > bestScore) { bestScore = score; bestEl = cand; }
        }
      } catch (e) { bestEl = null; }
      if (bestEl) {
        contentRoot = bestEl;
        contentRootLabel = bestEl.tagName.toLowerCase() === 'article'
          ? '<article>' : 'main content block (detected)';
      }
    }
    if (!contentRoot) { contentRoot = document.body; contentRootLabel = '<body> (no main region found)'; }

    // Step 2: count words in content paragraphs within the root.
    var paragraphCount = 0;
    var paragraphWords = 0;
    try {
      var rootPs = contentRoot ? contentRoot.getElementsByTagName('p') : [];
      for (var ri = 0; ri < rootPs.length; ri++) {
        var p = rootPs[ri];
        if (!visible(p)) continue;
        if (inBoilerplate(p, contentRoot)) continue;
        var t = text(p);
        if (!t) continue;
        paragraphCount++;
        paragraphWords += countWords(t);
      }
    } catch (e) { /* leave zeros */ }

    // Secondary reference: ALL body text minus non-content nodes (the "whole
    // page" figure, shown small so the difference from main content is clear).
    var bodyWords = 0;
    try {
      var body = document.body;
      if (body) {
        var clone = body.cloneNode(true);
        var strip = clone.querySelectorAll(
          'script,style,noscript,template,svg,iframe,object,embed');
        Array.prototype.forEach.call(strip, function (n) {
          if (n && n.parentNode) n.parentNode.removeChild(n);
        });
        bodyWords = countWords(clone.textContent || '');
      }
    } catch (e) { bodyWords = 0; }

    // Reading time from main-content words at ~200 wpm (rounded up, min 1).
    var readingMin = Math.max(1, Math.ceil((paragraphWords || 0) / 200));

    return {
      url: location.href,
      host: pageHost,
      title: { text: titleText, length: titleText.length },
      metaDescription: { text: metaDesc, length: metaDesc.length },
      canonical: canonical,
      canonicalMatchesUrl: !!canonical && normalize(canonical) === normalize(location.href),
      robots: robots,
      viewport: viewport,
      charset: charset,
      lang: htmlLang,
      headings: headings,
      headingCounts: headingCounts,
      images: { total: imgs.length, missingAlt: imgMissingAlt, emptyAlt: imgEmptyAlt, withAlt: imgWithAlt },
      links: { total: linkTotal, internal: linkInternal, external: linkExternal, nofollow: linkNofollow },
      openGraph: og,
      twitter: twitter,
      jsonLd: { count: jsonLdTypes.length, types: jsonLdTypes },
      wordCount: {
        paragraphs: paragraphWords,        // PRIMARY — main-content <p> words
        paragraphElements: paragraphCount, // number of counted <p> elements
        headings: headingWordTotal,
        bodyText: bodyWords,               // secondary — whole page (all body text)
        readingTimeMin: readingMin,
        contentRoot: contentRootLabel      // where the main content was found
      }
    };

    function normalize(u) {
      try { var x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); }
      catch (e) { return (u || '').replace(/#.*$/, '').replace(/\/$/, ''); }
    }
  };
})();
