/**
 * content/main.js — content-script entry on Google SERP pages.
 *
 * Routes by module. Currently:
 *   - Mounts the "Viewing as: [Location]" badge when a spoofed-location param is
 *     present in the URL (Module 4).
 *   - Answers popup messages: 'serp:getQuery' (returns current query + location)
 *     so the SERP-Location tab can prefill the query from the active SERP tab.
 *
 * Defensive: everything wrapped in try/catch. Depends on SEO_SERP (serp-adapter).
 */
(function () {
  'use strict';

  function run() {
    try {
      if (!window.SEO_SERP) return;
      if (!window.SEO_SERP.isGoogleSearch()) return;
      var loc = window.SEO_SERP.detectLocation();
      if (loc) window.SEO_SERP.mountBadge(loc);
    } catch (e) { /* silent */ }
  }

  // Initial mount.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  // Google SERPs update via history navigation without full reload — re-check.
  try {
    var lastHref = location.href;
    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        run();
      }
    }, 1200);
  } catch (e) { /* silent */ }

  // Respond to popup queries.
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== 'serp:getQuery') return false;
      try {
        var q = window.SEO_SERP ? window.SEO_SERP.getQuery() : '';
        var loc = window.SEO_SERP ? window.SEO_SERP.detectLocation() : null;
        sendResponse({ ok: true, query: q, location: loc });
      } catch (e) {
        sendResponse({ ok: false, query: '', location: null });
      }
      return true;
    });
  } catch (e) { /* silent */ }
})();
