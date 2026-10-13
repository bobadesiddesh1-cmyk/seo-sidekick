/**
 * content/render-highlighter.js — live SSR vs CSR highlighting on the page.
 *
 * Injected on demand. Given the raw HTML the server returned, it outlines every
 * visible block on the live page that does NOT exist in that HTML — i.e. content
 * that only appears after JavaScript runs, which non-rendering crawlers (and
 * most AI bots) never see. Optionally outlines server-rendered blocks too.
 *
 * Matching (all against the raw HTML with <script>/<style>/<noscript>/<template>
 * stripped, so text that only lives inside a JSON blob does not count):
 *   - text blocks: exact text of any raw element, or (25+ chars) a substring of
 *     the raw page text;
 *   - links: by resolved href;   - images: by resolved src / srcset / filename.
 * Nested blocks are only outlined at the outermost level of the same kind, so a
 * client-rendered list doesn't become boxes inside boxes.
 *
 * Idempotent: defines __SEO_renderHL once per page load. Non-destructive: adds
 * one <style>, data-attributes and a Shadow-DOM legend; disable() removes all.
 */
(function () {
  'use strict';
  if (self.__SEO_renderHL && self.__SEO_renderHL.__installed) return;

  var STYLE_ID = 'seo-sidekick-render-style';
  var LEGEND_ID = 'seo-sidekick-render-legend';
  var ATTR = 'data-seo-render';
  var IDATTR = 'data-seo-render-id';
  var FLASH = 'data-seo-render-flash';
  var CANDIDATES = 'h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,blockquote,figcaption,summary,label,button,a[href],img';

  var state = { on: false, csr: 0, ssr: 0, items: [], showSsr: false };

  function norm(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function textOf(el) { try { return norm(el.textContent); } catch (e) { return ''; } }
  function abs(u) {
    if (!u) return '';
    try { var x = new URL(u, location.href); x.hash = ''; return x.href; } catch (e) { return ''; }
  }
  function fileOf(u) {
    try { return decodeURIComponent(String(u).split('#')[0].split('?')[0].split('/').pop() || '').toLowerCase(); }
    catch (e) { return ''; }
  }
  function visible(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0;
    } catch (e) { return false; }
  }

  // ---- index the server HTML ---------------------------------------------
  function buildIndex(raw) {
    var ix = { set: Object.create(null), full: ' ', hrefs: Object.create(null),
               imgs: Object.create(null), files: Object.create(null) };
    var doc;
    try { doc = new DOMParser().parseFromString(raw || '', 'text/html'); } catch (e) { return ix; }
    if (!doc) return ix;
    function addImg(u) { if (!u || /^data:/i.test(u)) return; ix.imgs[abs(u)] = 1; var f = fileOf(u); if (f) ix.files[f] = 1; }
    try {
      doc.querySelectorAll('a[href]').forEach(function (a) { var h = abs(a.getAttribute('href')); if (h) ix.hrefs[h] = 1; });
      doc.querySelectorAll('img, source').forEach(function (im) {
        ['src', 'data-src', 'data-lazy-src'].forEach(function (k) { addImg(im.getAttribute(k)); });
        String(im.getAttribute('srcset') || im.getAttribute('data-srcset') || '').split(',').forEach(function (p) {
          addImg(p.trim().split(/\s+/)[0]);
        });
      });
    } catch (e) {}
    try {
      if (doc.body) {
        var clone = doc.body.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,template').forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
        ix.full = ' ' + norm(clone.textContent) + ' ';
        var all = clone.getElementsByTagName('*');
        for (var i = 0; i < all.length && i < 25000; i++) {
          var t = norm(all[i].textContent);
          if (t && t.length <= 600) ix.set[t.slice(0, 160)] = 1;
        }
      }
    } catch (e) {}
    return ix;
  }

  // 'csr' | 'ssr' | null (unclassifiable: too little signal)
  function classify(el, ix) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      var s = el.getAttribute('src') || el.getAttribute('data-src') || '';
      var cur = el.currentSrc || '';
      if (!s && !cur) return null;
      if (/^data:/i.test(s) && !cur) return null;
      if ((s && ix.imgs[abs(s)]) || (cur && ix.imgs[abs(cur)])) return 'ssr';
      var f = fileOf(s || cur);
      if (f && ix.files[f]) return 'ssr';
      return 'csr';
    }
    if (tag === 'a') {
      var h = abs(el.getAttribute('href'));
      if (!h || /^(javascript|mailto|tel):/i.test(el.getAttribute('href') || '')) return null;
      return ix.hrefs[h] ? 'ssr' : 'csr';
    }
    var t = textOf(el);
    if (t.length < 4) return null;
    var key = t.slice(0, 160);
    if (ix.set[key]) return 'ssr';
    if (t.length >= 25 && ix.full.indexOf(key) !== -1) return 'ssr';
    if (t.length < 25 && ix.full.indexOf(' ' + key + ' ') !== -1) return 'ssr';
    return 'csr';
  }

  function snippet(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'img') return el.getAttribute('alt') || fileOf(el.getAttribute('src') || el.currentSrc || '') || '(image)';
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t && tag === 'a') t = el.getAttribute('href') || '';
    return t.length > 110 ? t.slice(0, 109) + '…' : t;
  }

  // ---- paint ---------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '[' + ATTR + '="csr"]{outline:2px solid #dc2626 !important;outline-offset:2px !important;' +
        'background-color:rgba(220,38,38,.09) !important;}' +
      'img[' + ATTR + '="csr"]{outline-width:3px !important;}' +
      '[' + ATTR + '="ssr"]{outline:1.5px dashed #16a34a !important;outline-offset:2px !important;}' +
      '[' + FLASH + ']{animation:seoRenderFlash .55s ease-in-out 4 !important;}' +
      '@keyframes seoRenderFlash{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}50%{box-shadow:0 0 0 7px rgba(220,38,38,.55)}}';
    (document.head || document.documentElement).appendChild(st);
  }

  function legend() {
    var old = document.getElementById(LEGEND_ID);
    if (old) old.parentNode.removeChild(old);
    var host = document.createElement('div');
    host.id = LEGEND_ID;
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML =
      '<style>' +
      '.b{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#12303a;background:#fff;' +
      'border:1px solid #e2e6ec;border-radius:12px;box-shadow:0 10px 30px rgba(18,48,58,.22);padding:12px 14px;width:280px;}' +
      '.h{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;margin-bottom:8px;}' +
      '.h span{flex:1}.x{cursor:pointer;border:none;background:none;font-size:16px;color:#5b6473;line-height:1;}' +
      '.r{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px;}' +
      '.d{width:12px;height:12px;border-radius:3px;flex:0 0 auto;}' +
      '.c{border:2px solid #dc2626;background:rgba(220,38,38,.12)}.s{border:1.5px dashed #16a34a}' +
      '.n{font-size:11px;color:#5b6473;margin-top:8px;}' +
      '.k{margin-top:10px;width:100%;cursor:pointer;border:1px solid #cfd5df;background:#fff;border-radius:8px;padding:6px;font:600 12px Arial,sans-serif;color:#0d9488;}' +
      '</style>' +
      '<div class="b"><div class="h"><span>SEO Sidekick · Rendering</span><button class="x" title="Close">×</button></div>' +
      '<div class="r"><span class="d c"></span><b>' + state.csr + '</b>&nbsp;block' + (state.csr === 1 ? '' : 's') + ' only appear after JavaScript</div>' +
      (state.showSsr ? '<div class="r"><span class="d s"></span><b>' + state.ssr + '</b>&nbsp;in the server HTML</div>' : '') +
      '<div class="n">Red areas are invisible to crawlers that don’t run JavaScript — including GPTBot, ClaudeBot and PerplexityBot.</div>' +
      '<button class="k">Hide highlights</button></div>';
    var close = function () { disable(); };
    root.querySelector('.x').addEventListener('click', close);
    root.querySelector('.k').addEventListener('click', close);
    (document.body || document.documentElement).appendChild(host);
  }

  function clearMarks() {
    try {
      document.querySelectorAll('[' + ATTR + '],[' + IDATTR + '],[' + FLASH + ']').forEach(function (el) {
        el.removeAttribute(ATTR); el.removeAttribute(IDATTR); el.removeAttribute(FLASH);
      });
    } catch (e) {}
  }

  // ---- API -----------------------------------------------------------------
  function enable(raw, opts) {
    opts = opts || {};
    clearMarks();
    var ix = buildIndex(raw);
    var cls = new Map();
    var cands = [];
    try { cands = Array.prototype.slice.call(document.querySelectorAll(CANDIDATES), 0, 5000); } catch (e) {}
    cands.forEach(function (el) {
      if (!visible(el)) return;
      var c = classify(el, ix);
      if (c) cls.set(el, c);
    });

    var csr = 0, ssr = 0, n = 0, items = [];
    cls.forEach(function (c, el) {
      // Only outline the outermost block of a kind: skip if the nearest
      // classified ancestor has the same classification.
      var p = el.parentElement;
      while (p && !cls.has(p)) p = p.parentElement;
      if (p && cls.get(p) === c) return;
      if (c === 'csr') {
        csr++;
        var id = String(n++);
        el.setAttribute(ATTR, 'csr');
        el.setAttribute(IDATTR, id);
        if (items.length < 400) items.push({ id: id, tag: el.tagName.toLowerCase(), text: snippet(el) });
      } else {
        ssr++;
        if (opts.showSsr) el.setAttribute(ATTR, 'ssr');
      }
    });

    state = { on: true, csr: csr, ssr: ssr, items: items, showSsr: !!opts.showSsr };
    injectStyle();
    legend();
    return state;
  }

  function disable() {
    clearMarks();
    var st = document.getElementById(STYLE_ID); if (st) st.parentNode.removeChild(st);
    var lg = document.getElementById(LEGEND_ID); if (lg) lg.parentNode.removeChild(lg);
    state = { on: false, csr: 0, ssr: 0, items: [], showSsr: false };
    return state;
  }

  function focus(id) {
    var el = document.querySelector('[' + IDATTR + '="' + String(id).replace(/[^0-9]/g, '') + '"]');
    if (!el) return false;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { el.scrollIntoView(); }
    el.removeAttribute(FLASH);
    void el.offsetWidth; // restart the animation
    el.setAttribute(FLASH, '1');
    setTimeout(function () { el.removeAttribute(FLASH); }, 2400);
    return true;
  }

  self.__SEO_renderHL = {
    __installed: true,
    enable: enable,
    disable: disable,
    focus: focus,
    state: function () { return state; }
  };
})();
