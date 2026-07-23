/**
 * inject/link-checker.js — Module 1 collector (Broken Link Checker)
 *
 * Self-contained. Assigns __SEO_collectLinks to a global. References NOTHING
 * from outer scope so it is safe to inject via chrome.scripting.
 *
 * IMPORTANT: this file only COLLECTS links from the DOM. It does NOT fetch them.
 * Under Manifest V3, fetches from a page/content-script world are subject to
 * CORS, so cross-origin links can't be verified here. The actual HTTP checks run
 * in the background service worker (which has host permissions and bypasses
 * CORS) — see background.js. This split is what makes external-link checking
 * actually work instead of returning "Unknown (CORS)" for everything.
 *
 * Returns { links: [{url, anchor, type}], truncated, total }.
 */
(function () {
  'use strict';

  self.__SEO_collectLinks = function () {
    var MAX_LINKS = 300;
    var pageOrigin = location.origin;
    var pageHost = location.hostname;

    function sameOrigin(u) {
      try { return new URL(u).origin === pageOrigin; } catch (e) { return false; }
    }
    function hostOf(u) {
      try { return new URL(u).hostname; } catch (e) { return ''; }
    }
    function truncate(s, n) {
      s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    var anchors;
    try { anchors = document.querySelectorAll('a[href]'); }
    catch (e) { anchors = []; }

    var seen = {};
    var collected = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var raw = a.getAttribute('href');
      if (!raw) continue;
      var trimmed = raw.trim();
      if (!trimmed) continue;
      var lower = trimmed.toLowerCase();
      if (lower.indexOf('mailto:') === 0) continue;
      if (lower.indexOf('tel:') === 0) continue;
      if (lower.indexOf('javascript:') === 0) continue;
      if (trimmed.charAt(0) === '#') continue;

      var abs;
      try { abs = new URL(trimmed, location.href).href; }
      catch (e) { continue; }

      // Skip pure in-page anchors (same doc, only hash differs).
      try {
        var u = new URL(abs);
        var cur = new URL(location.href);
        if (u.hash && u.origin === cur.origin && u.pathname === cur.pathname &&
            u.search === cur.search && trimmed.charAt(0) === '#') {
          continue;
        }
      } catch (e) { /* ignore */ }

      if (seen[abs]) continue;
      seen[abs] = true;

      collected.push({
        url: abs,
        anchor: truncate(a.textContent || a.getAttribute('aria-label') || '(no anchor text)', 60),
        type: (sameOrigin(abs) || hostOf(abs) === pageHost) ? 'internal' : 'external'
      });
    }

    var truncated = collected.length > MAX_LINKS;
    return {
      links: collected.slice(0, MAX_LINKS),
      truncated: truncated,
      total: collected.length
    };
  };
})();
