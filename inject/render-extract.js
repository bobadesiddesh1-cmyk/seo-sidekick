/**
 * inject/render-extract.js — SSR vs CSR comparison engine (shared extractor).
 *
 * Defines ONE metric extractor that works on any Document, so the same code
 * measures both sides of the comparison and the diff is apples-to-apples:
 *
 *   1) The RENDERED DOM — this file is injected into the page and called with
 *      the live `document` (after JavaScript has run).
 *   2) The RAW HTML — this file is ALSO loaded by the side panel, where it is
 *      called with a DOMParser document built from the server's HTML response.
 *      DOMParser never executes scripts, so that is exactly what a
 *      non-rendering crawler sees.
 *
 * Because it must run against a DOMParser document (no layout, no computed
 * style, no location), the extractor derives everything from the Document it is
 * given plus a baseUrl argument. It never throws.
 */
(function () {
  'use strict';

  function countWords(str) {
    if (!str) return 0;
    var s = String(str);
    try {
      var m = s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
      return m ? m.length : 0;
    } catch (e) {
      var m2 = s.match(/[A-Za-z0-9À-ɏ]+(?:['’\-][A-Za-z0-9À-ɏ]+)*/g);
      return m2 ? m2.length : 0;
    }
  }

  self.__SEO_extractRenderMetrics = function (doc, baseUrl) {
    function qa(sel) {
      try { return Array.prototype.slice.call(doc.querySelectorAll(sel)); }
      catch (e) { return []; }
    }
    function q(sel) { try { return doc.querySelector(sel); } catch (e) { return null; } }
    function txt(el) {
      try { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
      catch (e) { return ''; }
    }
    function attr(el, n) { try { return el ? (el.getAttribute(n) || '') : ''; } catch (e) { return ''; } }
    function metaC(sel) { var el = q(sel); return el ? attr(el, 'content').trim() : ''; }

    var host = '';
    try { host = new URL(baseUrl).hostname; } catch (e) {}

    // ---- head / SEO primitives ---------------------------------------------
    var title = txt(q('title'));
    var metaDesc = metaC('meta[name="description"]');
    var canonEl = q('link[rel="canonical"]');
    var canonical = canonEl ? attr(canonEl, 'href') : '';
    var robots = metaC('meta[name="robots"]');

    // ---- headings -----------------------------------------------------------
    var headingCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    var h1s = [];
    qa('h1, h2, h3, h4, h5, h6').forEach(function (el) {
      var lvl = 'h' + el.tagName.charAt(1);
      if (headingCounts[lvl] !== undefined) headingCounts[lvl]++;
      if (lvl === 'h1') { var t = txt(el); if (t) h1s.push(t.slice(0, 120)); }
    });
    var headingTotal = 0;
    Object.keys(headingCounts).forEach(function (k) { headingTotal += headingCounts[k]; });

    // ---- text volume (identical method on both sides) ----------------------
    // No visibility filtering: a DOMParser document has no layout, so applying
    // the same naive count to both sides keeps the comparison fair.
    var bodyWords = 0, paraWords = 0, paraCount = 0;
    try {
      var body = doc.body;
      if (body) {
        var clone = body.cloneNode(true);
        var strip = clone.querySelectorAll('script,style,noscript,template,svg,iframe');
        Array.prototype.forEach.call(strip, function (n) {
          if (n && n.parentNode) n.parentNode.removeChild(n);
        });
        bodyWords = countWords(clone.textContent || '');
        var ps = clone.querySelectorAll('p');
        for (var i = 0; i < ps.length; i++) {
          var pt = (ps[i].textContent || '').trim();
          if (!pt) continue;
          paraCount++;
          paraWords += countWords(pt);
        }
      }
    } catch (e) {}

    // ---- links --------------------------------------------------------------
    var linkTotal = 0, linkInternal = 0, linkExternal = 0, seen = {}, linkUnique = 0;
    qa('a[href]').forEach(function (a) {
      var href = attr(a, 'href');
      if (!href) return;
      var t = href.trim().toLowerCase();
      if (t.charAt(0) === '#' || t.indexOf('javascript:') === 0 ||
          t.indexOf('mailto:') === 0 || t.indexOf('tel:') === 0) return;
      linkTotal++;
      var abs = href, internal = true;
      try { var u = new URL(href, baseUrl); abs = u.href; internal = (u.hostname === host); } catch (e) {}
      if (internal) linkInternal++; else linkExternal++;
      if (!seen[abs]) { seen[abs] = 1; linkUnique++; }
    });

    // ---- images -------------------------------------------------------------
    var imgs = qa('img');
    var imgWithAlt = 0;
    imgs.forEach(function (im) {
      var a = im.getAttribute ? im.getAttribute('alt') : null;
      if (a !== null && String(a).trim() !== '') imgWithAlt++;
    });

    // ---- structured data ----------------------------------------------------
    var ldBlocks = 0, ldTypes = [], ldItems = 0;
    qa('script[type="application/ld+json"]').forEach(function (s) {
      var raw = (s.textContent || '').trim();
      if (!raw) return;
      ldBlocks++;
      var data;
      try { data = JSON.parse(raw); } catch (e) { return; }
      (function walk(node, depth) {
        if (depth > 6 || !node) return;
        if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
        if (typeof node !== 'object') return;
        if (node['@graph']) walk(node['@graph'], depth + 1);
        var t = node['@type'];
        if (t) {
          ldItems++;
          (Array.isArray(t) ? t : [t]).forEach(function (x) {
            if (typeof x !== 'string') return;
            var nm = x.replace(/\/$/, '');
            var cut = Math.max(nm.lastIndexOf('/'), nm.lastIndexOf('#'));
            nm = cut >= 0 ? nm.slice(cut + 1) : nm;
            if (nm && ldTypes.indexOf(nm) === -1) ldTypes.push(nm);
          });
        }
        Object.keys(node).forEach(function (k) {
          if (k.charAt(0) === '@') return;
          var v = node[k];
          if (v && typeof v === 'object') walk(v, depth + 1);
        });
      })(data, 0);
    });

    // ---- social -------------------------------------------------------------
    var og = {
      title: metaC('meta[property="og:title"]'),
      description: metaC('meta[property="og:description"]'),
      image: metaC('meta[property="og:image"]')
    };

    // ---- framework fingerprints (diagnostic) --------------------------------
    var fw = [];
    function mark(name) { if (fw.indexOf(name) === -1) fw.push(name); }
    if (q('script#__NEXT_DATA__') || q('#__next')) mark('Next.js');
    if (q('#__nuxt') || q('#__NUXT__')) mark('Nuxt');
    if (q('[data-reactroot]')) mark('React');
    if (q('[ng-version]')) mark('Angular');
    if (q('[data-server-rendered]')) mark('Vue (SSR)');
    if (q('astro-island')) mark('Astro');
    if (q('[data-svelte-h]') || q('#svelte')) mark('Svelte');
    if (q('#root') && !fw.length) mark('SPA (#root)');
    if (q('#app') && !fw.length) mark('SPA (#app)');
    try {
      var inline = qa('script:not([src])').slice(0, 40).map(function (s) { return (s.textContent || '').slice(0, 400); }).join(' ');
      if (/__NUXT__/.test(inline)) mark('Nuxt');
      if (/__NEXT_DATA__/.test(inline)) mark('Next.js');
      if (/window\.__INITIAL_STATE__/.test(inline)) mark('SPA hydration');
    } catch (e) {}

    var domNodes = 0;
    try { domNodes = doc.getElementsByTagName('*').length; } catch (e) {}

    return {
      title: title, titleLength: title.length,
      metaDescription: metaDesc,
      canonical: canonical,
      robots: robots,
      h1: h1s, headingCounts: headingCounts, headingTotal: headingTotal,
      words: { body: bodyWords, paragraphs: paraWords, paragraphCount: paraCount },
      links: { total: linkTotal, internal: linkInternal, external: linkExternal, unique: linkUnique },
      images: { total: imgs.length, withAlt: imgWithAlt },
      jsonLd: { blocks: ldBlocks, types: ldTypes, items: ldItems },
      openGraph: og,
      frameworks: fw,
      domNodes: domNodes
    };
  };

  // Wrapper used when this file is injected into a live page.
  self.__SEO_extractRendered = function () {
    try { return self.__SEO_extractRenderMetrics(document, location.href); }
    catch (e) { return null; }
  };
})();
