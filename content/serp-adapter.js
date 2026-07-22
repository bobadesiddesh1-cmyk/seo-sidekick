/**
 * content/serp-adapter.js — Module 4 SERP detection + location badge
 *
 * Runs as a persistent content script on the two registered Google SERP hosts.
 * Handles other Google TLDs gracefully IF this ever runs there (defensive).
 *
 * Two fallback strategies for query detection:
 *   Strategy A: parse the `q` URL parameter (canonical, works on results pages).
 *   Strategy B: read the value of the main search <textarea|input> in the DOM
 *               (covers instant/JS-updated states where the URL lags).
 *
 * Location detection: presence of gl / uule / near params in the current URL
 * means results are being served for a spoofed location -> show a badge.
 *
 * Exposes global SEO_SERP = { getQuery, detectLocation, mountBadge }.
 * Depends on SEO_LOCATIONS (shared/locations.js, loaded before this file).
 */
(function (root) {
  'use strict';

  function isGoogleSearch() {
    try {
      return /(^|\.)google\.[a-z.]+$/i.test(location.hostname) &&
        /\/search/.test(location.pathname);
    } catch (e) { return false; }
  }

  // ---- Query detection (2 strategies) -------------------------------------
  function getQueryFromUrl() {
    try {
      var p = new URLSearchParams(location.search);
      var q = p.get('q');
      return q ? q.trim() : '';
    } catch (e) { return ''; }
  }

  function getQueryFromDom() {
    try {
      var sel = [
        'textarea[name="q"]',
        'input[name="q"]',
        'textarea[aria-label]',
        'input[aria-label][type="text"]'
      ];
      for (var i = 0; i < sel.length; i++) {
        var el = document.querySelector(sel[i]);
        if (el && typeof el.value === 'string' && el.value.trim()) {
          return el.value.trim();
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function getQuery() {
    return getQueryFromUrl() || getQueryFromDom() || '';
  }

  // ---- Location detection --------------------------------------------------
  function detectLocation() {
    try {
      var p = new URLSearchParams(location.search);
      var gl = p.get('gl');
      var hl = p.get('hl');
      var uule = p.get('uule');
      var near = p.get('near');
      if (!gl && !uule && !near) return null;

      // Try to map to a friendly label from the shipped list via gl match.
      var label = '';
      if (root.SEO_LOCATIONS && root.SEO_LOCATIONS.LIST && gl) {
        var match = root.SEO_LOCATIONS.LIST.filter(function (l) { return l.gl === gl; });
        // Prefer a city entry if uule present, else the country entry.
        if (match.length) {
          label = match[0].label;
          if (uule && match.length > 1) {
            // pick the first city-style (has comma) if any
            var city = match.filter(function (m) { return /,/.test(m.canonical); })[0];
            if (city) label = city.label;
          }
        }
      }
      if (!label) {
        if (near) label = near;
        else if (gl) label = gl.toUpperCase();
        else label = 'Custom location';
      }
      return { label: label, gl: gl || '', hl: hl || '', uule: uule || '', near: near || '' };
    } catch (e) { return null; }
  }

  // ---- Badge (Shadow DOM, top-right) --------------------------------------
  var BADGE_ID = 'seo-sidekick-serp-badge';

  function mountBadge(loc) {
    try {
      if (!loc) return;
      var existing = document.getElementById(BADGE_ID);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      var host = document.createElement('div');
      host.id = BADGE_ID;
      host.style.position = 'fixed';
      host.style.top = '12px';
      host.style.right = '12px';
      host.style.zIndex = '2147483647';
      host.style.all = 'initial';
      var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
      if (!shadow) return;

      var prefersDark = false;
      try { prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
      catch (e) {}
      var bg = prefersDark ? '#0f766e' : '#0d9488';

      shadow.innerHTML =
        '<style>' +
        ':host{all:initial;}' +
        '.badge{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
        'display:flex;align-items:center;gap:7px;background:' + bg + ';color:#fff;' +
        'font-size:12px;font-weight:600;padding:7px 11px;border-radius:20px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.28);cursor:default;}' +
        '.dot{width:8px;height:8px;border-radius:50%;background:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,.28);}' +
        '.x{margin-left:4px;cursor:pointer;opacity:.85;font-weight:700;}' +
        '.x:hover{opacity:1;}' +
        '</style>' +
        '<div class="badge"><span class="dot"></span>' +
        '<span>Viewing as: ' + escapeHtml(loc.label) + '</span>' +
        '<span class="x" title="Hide">×</span></div>';

      (document.body || document.documentElement).appendChild(host);
      var x = shadow.querySelector('.x');
      if (x) x.addEventListener('click', function () {
        try { host.parentNode.removeChild(host); } catch (e) {}
      });
    } catch (e) { /* silent */ }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var api = {
    isGoogleSearch: isGoogleSearch,
    getQuery: getQuery,
    getQueryFromUrl: getQueryFromUrl,
    getQueryFromDom: getQueryFromDom,
    detectLocation: detectLocation,
    mountBadge: mountBadge
  };
  root.SEO_SERP = api;
})(typeof window !== 'undefined' ? window : this);
