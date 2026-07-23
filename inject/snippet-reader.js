/**
 * inject/snippet-reader.js — Module 5 helper (reads title/meta from active tab)
 *
 * Self-contained. Assigns __SEO_readSnippet to a global. References nothing from
 * outer scope. Returns the page's title, meta description, URL parts, and a
 * best-effort favicon href so the popup can render an accurate SERP mock.
 */
(function () {
  'use strict';

  self.__SEO_readSnippet = function () {
    function metaContent(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        try {
          var el = document.querySelector(selectors[i]);
          if (el) {
            var c = el.getAttribute('content');
            if (c && c.trim()) return c.trim();
          }
        } catch (e) { /* ignore */ }
      }
      return '';
    }

    var title = '';
    try {
      title = (document.title || '').trim();
      if (!title) {
        var og = document.querySelector('meta[property="og:title"]');
        if (og) title = (og.getAttribute('content') || '').trim();
      }
      if (!title) {
        var h1 = document.querySelector('h1');
        if (h1) title = (h1.textContent || '').trim();
      }
    } catch (e) { title = ''; }

    var description = metaContent([
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]'
    ]);

    var url = location.href;
    var host = location.hostname;
    var path = location.pathname;

    // Favicon best-effort (used only as a visual hint; popup falls back to a dot).
    var favicon = '';
    try {
      var iconEl = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
      if (iconEl && iconEl.getAttribute('href')) {
        favicon = new URL(iconEl.getAttribute('href'), location.href).href;
      } else {
        favicon = location.origin + '/favicon.ico';
      }
    } catch (e) { favicon = ''; }

    return {
      title: title,
      description: description,
      url: url,
      host: host,
      path: path,
      favicon: favicon
    };
  };
})();
