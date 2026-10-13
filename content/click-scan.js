/**
 * content/click-scan.js — finds content that only loads when someone clicks.
 *
 * Search engines and AI crawlers do not click, scroll or type. This scanner
 * looks at the live page for the patterns that hide content behind a click:
 *
 *   loadmore     "Load more" / "Show more" controls that are buttons (not links),
 *                so the next batch of items has no crawlable URL
 *   lazy-toggle  accordions / expanders (aria-expanded="false") whose content
 *                area is missing or empty until clicked — fetched on demand
 *   lazy-tab     tabs whose panel is missing or empty until the tab is clicked
 *   js-link      things that navigate on click but have no real href
 *                (<a> without href, href="#"/"javascript:", role="link", onclick)
 *   hidden-js    collapsed content that IS in the DOM, but was added by
 *                JavaScript (not in the server HTML) — invisible to AI crawlers
 *   hidden-ok    collapsed content that is in the server HTML: fine, indexed
 *
 * Every flagged element gets data-seo-click-id so the panel can scroll to it,
 * and outline(true) draws boxes around them. clear() removes everything.
 *
 * Idempotent: defines __SEO_clickScan once per page load.
 */
(function () {
  'use strict';
  if (self.__SEO_clickScan && self.__SEO_clickScan.__installed) return;

  var IDATTR = 'data-seo-click-id';
  var KATTR = 'data-seo-click';
  var FLASH = 'data-seo-click-flash';
  var STYLE_ID = 'seo-sidekick-click-style';
  var MORE_RE = /^(\+\s*)?(load|show|view|see|display|get)\s+(\d+\s+)?(more|all|next|older|additional)\b|^more\s+(results|products|items|posts|articles|reviews|comments)\b|^(next|older)\s+(page|posts|results)\b|^show\s+\d+\s+more\b|^(read|see)\s+all\s+\d*\s*(reviews|comments)\b/i;
  var PAGINATION_RE = /([?&](page|p|pg|offset|start)=\d+)|\/page\/\d+|\/p\/\d+\/?$/i;
  var MAX_ITEMS = 80;

  var state = { outlined: false, seq: 0 };

  function norm(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
  function low(s) { return norm(s).toLowerCase(); }
  function visible(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch (e) { return false; }
  }
  function label(el) {
    var t = norm(el.innerText || el.textContent || '');
    if (!t) t = norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '');
    return t.length > 90 ? t.slice(0, 89) + '…' : t;
  }
  function tagOf(el) {
    var t = el.tagName.toLowerCase();
    var role = el.getAttribute('role');
    return role && t !== 'button' ? t + '[role=' + role + ']' : t;
  }
  function mark(el, kind) {
    var id = el.getAttribute(IDATTR);
    if (!id) { id = 'c' + (++state.seq); el.setAttribute(IDATTR, id); }
    el.setAttribute(KATTR, kind);
    return id;
  }
  function own(el) {
    return !!(el.closest && el.closest('#seo-sidekick-render-legend, #seo-sidekick-hl-legend'));
  }

  // Server-HTML text index, so we can tell collapsed-but-present content that
  // the server sent (fine) from content JavaScript added (AI crawlers miss it).
  function rawText(raw) {
    if (!raw) return null;
    try {
      var doc = new DOMParser().parseFromString(raw, 'text/html');
      if (!doc || !doc.body) return null;
      doc.body.querySelectorAll('script,style,noscript,template').forEach(function (n) { n.remove(); });
      return ' ' + low(doc.body.textContent) + ' ';
    } catch (e) { return null; }
  }
  function inRaw(rt, text) {
    if (!rt) return null;
    var t = low(text);
    if (t.length < 12) return null;
    return rt.indexOf(t.slice(0, 80)) !== -1;
  }

  function targetsOf(el) {
    var ids = String(el.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
    var hrefT = el.getAttribute('href') || el.getAttribute('data-target') || el.getAttribute('data-bs-target') || '';
    if (!ids.length && /^#[\w-]+$/.test(hrefT)) ids = [hrefT.slice(1)];
    return ids;
  }
  function contentOf(ids) {
    var found = 0, text = '';
    ids.forEach(function (id) {
      var t = document.getElementById(id);
      if (t) { found++; text += ' ' + (t.textContent || ''); }
    });
    return { found: found, text: norm(text) };
  }

  function scan(raw) {
    clearMarks();
    var rt = rawText(raw);
    var items = [];
    var seen = new Set();
    function push(el, kind, extra) {
      if (seen.has(el) || items.length >= MAX_ITEMS) return;
      seen.add(el);
      var it = { id: mark(el, kind), kind: kind, tag: tagOf(el), text: label(el) || '(no text)' };
      if (extra) for (var k in extra) it[k] = extra[k];
      items.push(it);
    }

    // 1) Load more / show more that are not crawlable links.
    document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"], div[onclick], span[onclick]').forEach(function (el) {
      if (own(el) || !visible(el)) return;
      var t = label(el);
      if (!t || t.length > 60 || !MORE_RE.test(t)) return;
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || '';
        if (href && href !== '#' && !/^javascript:/i.test(href)) return; // a real URL: crawlable
      }
      push(el, 'loadmore');
    });

    // 2) Accordions / expanders and 3) tabs.
    document.querySelectorAll('[aria-expanded="false"], [role="tab"][aria-selected="false"]').forEach(function (el) {
      if (own(el) || !visible(el) || seen.has(el)) return;
      // Menus and pop-ups are navigation chrome, not content.
      if (el.getAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') return;
      if (el.closest('nav, header, [role="navigation"], [role="menubar"], [role="menu"]')) return;
      var isTab = el.getAttribute('role') === 'tab';
      var ids = targetsOf(el);
      var c = contentOf(ids);
      var lazy = ids.length > 0 && (c.found === 0 || c.text.length < 3);
      if (!ids.length) {
        // No declared target: look at the immediate sibling region.
        var sib = el.nextElementSibling;
        if (!sib && el.parentElement) sib = el.parentElement.nextElementSibling;
        if (sib && !isTab) { c = { found: 1, text: norm(sib.textContent || '') }; lazy = c.text.length < 3; }
        else return;
      }
      if (lazy) { push(el, isTab ? 'lazy-tab' : 'lazy-toggle'); return; }
      var present = inRaw(rt, c.text);
      if (present === false) push(el, 'hidden-js', { words: c.text.split(' ').length });
      else if (present === true) push(el, 'hidden-ok', { words: c.text.split(' ').length });
    });
    // Native <details> that are closed: the content is in the DOM.
    document.querySelectorAll('details:not([open]) > summary').forEach(function (s) {
      if (own(s) || !visible(s) || seen.has(s)) return;
      var d = s.parentElement, t = norm(d.textContent || '').slice(norm(s.textContent || '').length);
      var present = inRaw(rt, t);
      if (present === false) push(s, 'hidden-js', { words: t.split(' ').length });
      else if (present === true) push(s, 'hidden-ok', { words: t.split(' ').length });
    });

    // 4) Links crawlers can't follow.
    document.querySelectorAll('a:not([href]), a[href="#"], a[href^="javascript:" i], [role="link"]:not(a), [onclick*="location"], [onclick*="window.open"]').forEach(function (el) {
      if (own(el) || !visible(el) || seen.has(el)) return;
      if (el.closest('[' + KATTR + ']')) return;
      if (el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') ||
          /^(tab|button|menuitem|option|switch)$/.test(el.getAttribute('role') || '')) return;
      var t = label(el);
      if (!t || t.length < 2) return;
      if (el.tagName === 'A' && !el.hasAttribute('href') && !el.hasAttribute('onclick') &&
          !/cursor:\s*pointer/.test(el.getAttribute('style') || '') && getComputedStyle(el).cursor !== 'pointer') return; // an anchor target, not a link
      push(el, 'js-link');
    });

    var pagination = false;
    try {
      pagination = !!document.querySelector('link[rel="next"], a[rel="next"]') ||
        Array.prototype.some.call(document.querySelectorAll('a[href]'), function (a) {
          return PAGINATION_RE.test(a.getAttribute('href') || '');
        });
    } catch (e) {}

    var counts = {};
    items.forEach(function (i) { counts[i.kind] = (counts[i.kind] || 0) + 1; });
    if (state.outlined) applyOutline(true);
    return { items: items, counts: counts, pagination: pagination, rawChecked: !!rt, truncated: items.length >= MAX_ITEMS };
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      'html[data-seo-click-on] [' + KATTR + ']:not([' + KATTR + '="hidden-ok"]){outline:2px solid #ea580c !important;outline-offset:2px !important;}' +
      'html[data-seo-click-on] [' + KATTR + '="hidden-ok"]{outline:1.5px dashed #16a34a !important;outline-offset:2px !important;}' +
      '[' + FLASH + ']{outline:3px solid #ea580c !important;outline-offset:3px !important;box-shadow:0 0 0 6px rgba(234,88,12,.25) !important;transition:box-shadow .2s;}';
    (document.head || document.documentElement).appendChild(s);
  }
  function applyOutline(on) {
    state.outlined = !!on;
    if (on) { injectStyle(); document.documentElement.setAttribute('data-seo-click-on', ''); }
    else document.documentElement.removeAttribute('data-seo-click-on');
    return state.outlined;
  }
  function focus(id) {
    var el = document.querySelector('[' + IDATTR + '="' + String(id).replace(/"/g, '') + '"]');
    if (!el) return false;
    injectStyle();
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { el.scrollIntoView(); }
    el.setAttribute(FLASH, '');
    setTimeout(function () { el.removeAttribute(FLASH); }, 1800);
    return true;
  }
  function clearMarks() {
    document.querySelectorAll('[' + IDATTR + ']').forEach(function (el) {
      el.removeAttribute(IDATTR); el.removeAttribute(KATTR); el.removeAttribute(FLASH);
    });
  }
  function clear() {
    applyOutline(false);
    clearMarks();
    var s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    return true;
  }

  self.__SEO_clickScan = {
    __installed: true,
    scan: scan,
    outline: applyOutline,
    focus: focus,
    clear: clear,
    state: function () { return { outlined: state.outlined }; }
  };
})();
