/**
 * content/highlighter.js — Module 3 (Dofollow/Nofollow Highlighter)
 *
 * Injected on demand into the active tab. Idempotent: defines a single global
 * controller __SEO_highlighter with enable/disable/counts/isOn. State lives in
 * the page's isolated world and persists while the page is loaded (per-tab).
 *
 * Encoding (outline reads as two axes):
 *   color = follow status  -> green = dofollow, red = nofollow/sponsored/ugc
 *   style = scope          -> solid = internal, dashed = external
 *
 * Non-destructive: adds ONE <style> element + classes on <a>. Disabling removes
 * both; the DOM is otherwise untouched. All DOM ops are try/catch, silent fail.
 * A draggable, dismissible legend is rendered in Shadow DOM so host styles never
 * leak in or out.
 */
(function () {
  'use strict';

  if (self.__SEO_highlighter && self.__SEO_highlighter.__installed) {
    return; // already installed this page load
  }

  var STYLE_ID = 'seo-sidekick-highlight-style';
  var LEGEND_HOST_ID = 'seo-sidekick-legend-host';
  var CLASS = {
    base: 'seo-sk-link',
    dofollow: 'seo-sk-dofollow',
    nofollow: 'seo-sk-nofollow',
    internal: 'seo-sk-internal',
    external: 'seo-sk-external'
  };

  var state = {
    on: false,
    observer: null,
    debounceTimer: null,
    counts: { total: 0, dofollow: 0, nofollow: 0, internal: 0, external: 0 },
    legendHost: null
  };

  var pageHost = location.hostname;

  function isNofollow(a) {
    var rel = (a.getAttribute('rel') || '').toLowerCase();
    if (!rel) return false;
    return /(^|\s)(nofollow|sponsored|ugc)(\s|$)/.test(rel);
  }

  function isInternal(a) {
    try {
      var abs = new URL(a.getAttribute('href'), location.href);
      return abs.hostname === pageHost;
    } catch (e) { return true; }
  }

  function injectStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var css = [
        '.' + CLASS.base + '{outline-offset:1px !important;}',
        '.' + CLASS.dofollow + '{outline-color:#16a34a !important;}',
        '.' + CLASS.nofollow + '{outline-color:#dc2626 !important;}',
        '.' + CLASS.internal + '{outline-width:2px !important;outline-style:solid !important;}',
        '.' + CLASS.external + '{outline-width:2px !important;outline-style:dashed !important;}'
      ].join('\n');
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* silent */ }
  }

  function removeStyle() {
    try {
      var s = document.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    } catch (e) { /* silent */ }
  }

  function tagLinks() {
    var counts = { total: 0, dofollow: 0, nofollow: 0, internal: 0, external: 0 };
    var links;
    try { links = document.querySelectorAll('a[href]'); }
    catch (e) { links = []; }
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href');
      if (!href) continue;
      var t = href.trim().toLowerCase();
      if (t.indexOf('javascript:') === 0 || t.charAt(0) === '#' ||
          t.indexOf('mailto:') === 0 || t.indexOf('tel:') === 0) {
        continue;
      }
      try {
        a.classList.add(CLASS.base);
        var nof = isNofollow(a);
        var internal = isInternal(a);
        a.classList.toggle(CLASS.nofollow, nof);
        a.classList.toggle(CLASS.dofollow, !nof);
        a.classList.toggle(CLASS.internal, internal);
        a.classList.toggle(CLASS.external, !internal);
        counts.total++;
        if (nof) counts.nofollow++; else counts.dofollow++;
        if (internal) counts.internal++; else counts.external++;
      } catch (e) { /* silent per-element */ }
    }
    state.counts = counts;
    updateLegendCounts();
    return counts;
  }

  function untagLinks() {
    try {
      var links = document.querySelectorAll('.' + CLASS.base);
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        a.classList.remove(CLASS.base, CLASS.dofollow, CLASS.nofollow,
          CLASS.internal, CLASS.external);
        if (a.getAttribute('class') === '') a.removeAttribute('class');
      }
    } catch (e) { /* silent */ }
  }

  // ---- Legend (Shadow DOM, draggable, dismissible) ------------------------
  function buildLegend() {
    try {
      if (document.getElementById(LEGEND_HOST_ID)) return;
      var host = document.createElement('div');
      host.id = LEGEND_HOST_ID;
      host.style.position = 'fixed';
      host.style.top = '16px';
      host.style.right = '16px';
      host.style.zIndex = '2147483647';
      host.style.all = 'initial';
      var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
      if (!shadow) return;

      var prefersDark = false;
      try { prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
      catch (e) { prefersDark = false; }
      var bg = prefersDark ? '#1f2430' : '#ffffff';
      var fg = prefersDark ? '#e6e9ef' : '#1a1d24';
      var border = prefersDark ? '#39404f' : '#d8dbe2';
      var sub = prefersDark ? '#9aa3b2' : '#5b6473';

      shadow.innerHTML =
        '<style>' +
        ':host{all:initial;}' +
        '.box{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;' +
        'background:' + bg + ';color:' + fg + ';border:1px solid ' + border + ';' +
        'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);width:222px;overflow:hidden;}' +
        '.hd{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;' +
        'cursor:move;background:linear-gradient(90deg,#0d9488,#0891b2);color:#fff;font-weight:600;user-select:none;}' +
        '.hd span{font-size:12px;}' +
        '.x{cursor:pointer;font-size:15px;line-height:1;padding:0 2px;opacity:.9;}' +
        '.x:hover{opacity:1;}' +
        '.body{padding:10px;}' +
        '.row{display:flex;align-items:center;gap:8px;margin:7px 0;}' +
        '.sw{width:26px;height:14px;border-radius:3px;flex:0 0 auto;background:transparent;}' +
        '.g-solid{border:2px solid #16a34a;}' +
        '.g-dash{border:2px dashed #16a34a;}' +
        '.r-solid{border:2px solid #dc2626;}' +
        '.r-dash{border:2px dashed #dc2626;}' +
        '.lbl{color:' + fg + ';}' +
        '.sub{color:' + sub + ';font-size:11px;margin-top:2px;}' +
        '.counts{border-top:1px solid ' + border + ';padding:8px 10px;font-size:11px;color:' + sub + ';}' +
        '.counts b{color:' + fg + ';}' +
        '</style>' +
        '<div class="box">' +
        '<div class="hd" part="hd"><span>SEO Sidekick — Links</span><span class="x" title="Dismiss">×</span></div>' +
        '<div class="body">' +
        '<div class="row"><span class="sw g-solid"></span><span class="lbl">Internal · dofollow</span></div>' +
        '<div class="row"><span class="sw g-dash"></span><span class="lbl">External · dofollow</span></div>' +
        '<div class="row"><span class="sw r-solid"></span><span class="lbl">Internal · nofollow</span></div>' +
        '<div class="row"><span class="sw r-dash"></span><span class="lbl">External · nofollow</span></div>' +
        '<div class="sub">Green = dofollow, Red = nofollow/sponsored/ugc · Solid = internal, Dashed = external</div>' +
        '</div>' +
        '<div class="counts" id="counts">Scanning…</div>' +
        '</div>';

      (document.body || document.documentElement).appendChild(host);
      state.legendHost = host;

      // Dismiss.
      var x = shadow.querySelector('.x');
      if (x) x.addEventListener('click', function () { removeLegend(); });

      // Drag.
      var hd = shadow.querySelector('.hd');
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      if (hd) {
        hd.addEventListener('mousedown', function (e) {
          dragging = true;
          var rect = host.getBoundingClientRect();
          ox = rect.left; oy = rect.top;
          sx = e.clientX; sy = e.clientY;
          host.style.right = 'auto';
          host.style.left = ox + 'px';
          host.style.top = oy + 'px';
          e.preventDefault();
        });
        window.addEventListener('mousemove', function (e) {
          if (!dragging) return;
          host.style.left = (ox + e.clientX - sx) + 'px';
          host.style.top = (oy + e.clientY - sy) + 'px';
        });
        window.addEventListener('mouseup', function () { dragging = false; });
      }
      updateLegendCounts();
    } catch (e) { /* silent */ }
  }

  function updateLegendCounts() {
    try {
      var host = state.legendHost || document.getElementById(LEGEND_HOST_ID);
      if (!host || !host.shadowRoot) return;
      var el = host.shadowRoot.getElementById('counts');
      if (!el) return;
      var c = state.counts;
      el.innerHTML = 'Total <b>' + c.total + '</b> · dofollow <b>' + c.dofollow +
        '</b> · nofollow <b>' + c.nofollow + '</b><br>internal <b>' + c.internal +
        '</b> · external <b>' + c.external + '</b>';
    } catch (e) { /* silent */ }
  }

  function removeLegend() {
    try {
      var host = state.legendHost || document.getElementById(LEGEND_HOST_ID);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      state.legendHost = null;
    } catch (e) { /* silent */ }
  }

  // ---- MutationObserver (debounced) ---------------------------------------
  function startObserver() {
    try {
      if (state.observer) return;
      state.observer = new MutationObserver(function () {
        if (!state.on) return;
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(function () {
          if (state.on) tagLinks();
        }, 400);
      });
      state.observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['href', 'rel']
      });
    } catch (e) { /* silent */ }
  }

  function stopObserver() {
    try {
      if (state.observer) { state.observer.disconnect(); state.observer = null; }
      if (state.debounceTimer) { clearTimeout(state.debounceTimer); state.debounceTimer = null; }
    } catch (e) { /* silent */ }
  }

  // ---- Public controller ---------------------------------------------------
  self.__SEO_highlighter = {
    __installed: true,
    enable: function () {
      try {
        state.on = true;
        injectStyle();
        buildLegend();
        var c = tagLinks();
        startObserver();
        return { on: true, counts: c };
      } catch (e) {
        return { on: state.on, counts: state.counts, error: String(e) };
      }
    },
    disable: function () {
      try {
        state.on = false;
        stopObserver();
        untagLinks();
        removeStyle();
        removeLegend();
        return { on: false, counts: state.counts };
      } catch (e) {
        return { on: state.on, counts: state.counts, error: String(e) };
      }
    },
    toggle: function () {
      return state.on ? this.disable() : this.enable();
    },
    counts: function () {
      if (state.on) tagLinks();
      return { on: state.on, counts: state.counts };
    },
    isOn: function () { return { on: state.on, counts: state.counts }; }
  };
})();
