/**
 * inject/hreflang-checker.js — Module 2 (Hreflang Validator)
 *
 * Self-contained. Assigns __SEO_runHreflangChecker to a global. References
 * nothing from outer scope. Ships its own ISO 639-1 list inline (so it stays
 * self-contained when injected — cannot rely on shared/iso-languages.js being
 * present in the page world).
 *
 * Checks per tag:
 *   (a) hreflang value is a valid language code / language-REGION / x-default
 *   (b) href is absolute
 *   (c) reciprocity: fetch each target's HTML and confirm it links back here
 *   (d) page has a self-referencing hreflang tag
 *   (e) duplicate hreflang values
 *
 * Concurrency 6, timeout 8s, allSettled-safe. Returns structured results.
 */
(function () {
  'use strict';

  self.__SEO_runHreflangChecker = async function () {
    var CONCURRENCY = 6;
    var TIMEOUT_MS = 8000;

    // ---- Inline ISO 639-1 (184 codes) ---------------------------------------
    var CODES = ('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ' +
      'ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo ' +
      'fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is ' +
      'it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo ' +
      'lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc ' +
      'oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn ' +
      'so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur ' +
      'uz ve vi vo wa wo xh yi yo za zh zu').split(' ');
    var LANG = {};
    for (var ci = 0; ci < CODES.length; ci++) LANG[CODES[ci]] = true;
    var REGION_RE = /^[A-Z]{2}$/;

    function validateHreflangValue(value) {
      if (value == null) return { valid: false, reason: 'empty hreflang value' };
      var raw = String(value).trim();
      if (!raw) return { valid: false, reason: 'empty hreflang value' };
      if (raw.toLowerCase() === 'x-default') {
        return { valid: true, reason: 'x-default fallback marker' };
      }
      var parts = raw.split('-');
      var lang = (parts[0] || '').toLowerCase();
      if (!LANG[lang]) {
        return { valid: false, reason: '"' + parts[0] + '" is not a valid ISO 639-1 language code' };
      }
      if (parts.length === 1) return { valid: true, reason: 'valid language code' };
      if (parts.length === 2) {
        var region = parts[1].toUpperCase();
        if (!REGION_RE.test(region)) {
          return { valid: false, reason: '"' + parts[1] + '" is not a valid 2-letter region code' };
        }
        return { valid: true, reason: 'valid language-region code' };
      }
      return { valid: false, reason: 'too many subtags (expected lang or lang-REGION)' };
    }

    function normUrl(u) {
      try {
        var url = new URL(u);
        url.hash = '';
        var s = url.href;
        return s.replace(/\/$/, ''); // ignore trailing slash for comparison
      } catch (e) { return (u || '').replace(/#.*$/, '').replace(/\/$/, ''); }
    }

    var pageUrlNorm = normUrl(location.href);

    // ---- Collect tags -------------------------------------------------------
    var tags = [];
    try {
      var links = document.querySelectorAll('link[rel~="alternate"][hreflang]');
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        var hv = el.getAttribute('hreflang') || '';
        var href = el.getAttribute('href') || '';
        var abs = '';
        var absolute = false;
        try { abs = new URL(href, location.href).href; absolute = /^https?:\/\//i.test(href) || /^\/\//.test(href); }
        catch (e) { abs = ''; }
        tags.push({ hreflang: hv, href: href, absUrl: abs, declaredAbsolute: absolute });
      }
    } catch (e) { /* leave tags empty */ }

    if (tags.length === 0) {
      return { empty: true, tags: [], pageUrl: location.href, issues: [] };
    }

    // ---- Duplicate detection (e) --------------------------------------------
    var valueCounts = {};
    tags.forEach(function (t) {
      var k = (t.hreflang || '').toLowerCase();
      valueCounts[k] = (valueCounts[k] || 0) + 1;
    });

    // ---- Self-reference detection (d) ---------------------------------------
    var hasSelf = tags.some(function (t) { return normUrl(t.absUrl) === pageUrlNorm; });

    // ---- Fetch helper (reciprocity) -----------------------------------------
    function timedFetch(url, opts) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      opts = opts || {};
      opts.signal = controller.signal;
      return fetch(url, opts).then(function (r) { clearTimeout(timer); return r; })
        .catch(function (err) { clearTimeout(timer); throw err; });
    }

    // Does remote HTML contain a hreflang link back to this page?
    async function checkReciprocity(targetUrl) {
      if (!targetUrl) return { status: 'invalid', detail: 'no target URL' };
      if (normUrl(targetUrl) === pageUrlNorm) {
        return { status: 'self', detail: 'self reference' };
      }
      try {
        var resp = await timedFetch(targetUrl, { method: 'GET' });
        if (resp.type === 'opaque') {
          return { status: 'cors', detail: 'Could not verify (CORS-restricted)' };
        }
        if (!resp.ok) {
          return { status: 'unreachable', detail: 'target returned HTTP ' + resp.status };
        }
        var html = await resp.text();
        // Find hreflang link tags in the fetched HTML and see if any points back.
        var found = false;
        var re = /<link\b[^>]*rel\s*=\s*["'][^"']*alternate[^"']*["'][^>]*>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
          var tag = m[0];
          if (!/hreflang\s*=/.test(tag)) continue;
          var hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
          if (!hrefMatch) continue;
          var backAbs;
          try { backAbs = new URL(hrefMatch[1], targetUrl).href; }
          catch (e) { continue; }
          if (normUrl(backAbs) === pageUrlNorm) { found = true; break; }
        }
        return found
          ? { status: 'ok', detail: 'links back to this page' }
          : { status: 'missing', detail: 'no return tag pointing to this page' };
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return { status: 'timeout', detail: 'timed out (8s)' };
        }
        // Cross-origin GET blocked by CORS commonly lands here.
        return { status: 'cors', detail: 'Could not verify (CORS-restricted or network error)' };
      }
    }

    // ---- Run reciprocity checks with concurrency 6 --------------------------
    var recip = new Array(tags.length);
    var next = 0;
    async function worker() {
      while (true) {
        var idx = next++;
        if (idx >= tags.length) return;
        recip[idx] = await checkReciprocity(tags[idx].absUrl);
      }
    }
    var pool = [];
    for (var w = 0; w < Math.min(CONCURRENCY, tags.length); w++) pool.push(worker());
    await Promise.allSettled(pool);

    // ---- Assemble results ---------------------------------------------------
    var out = tags.map(function (t, idx) {
      var valueCheck = validateHreflangValue(t.hreflang);
      var dup = valueCounts[(t.hreflang || '').toLowerCase()] > 1;
      var r = recip[idx] || { status: 'invalid', detail: 'not checked' };

      var issues = [];
      if (!valueCheck.valid) issues.push('Invalid hreflang value: ' + valueCheck.reason);
      if (!t.declaredAbsolute) issues.push('href should be an absolute URL (found "' + t.href + '")');
      if (dup) issues.push('Duplicate hreflang value "' + t.hreflang + '" appears on more than one tag');
      if (r.status === 'missing') {
        issues.push('"' + t.hreflang + '" points to ' + shortUrl(t.absUrl) +
          ' but that page has no return tag linking back to this page');
      } else if (r.status === 'unreachable') {
        issues.push('Target ' + shortUrl(t.absUrl) + ' ' + r.detail);
      } else if (r.status === 'timeout') {
        issues.push('Reciprocity check for ' + shortUrl(t.absUrl) + ' ' + r.detail);
      }

      return {
        hreflang: t.hreflang,
        href: t.href,
        absUrl: t.absUrl,
        valueValid: valueCheck.valid,
        valueReason: valueCheck.reason,
        absoluteOk: t.declaredAbsolute,
        duplicate: dup,
        reciprocity: r.status,        // ok|missing|self|cors|unreachable|timeout|invalid
        reciprocityDetail: r.detail,
        isSelf: normUrl(t.absUrl) === pageUrlNorm,
        issues: issues,
        pass: issues.length === 0
      };
    });

    function shortUrl(u) {
      if (!u) return '(none)';
      try {
        var url = new URL(u);
        var p = url.pathname.length > 30 ? url.pathname.slice(0, 29) + '…' : url.pathname;
        return url.hostname + p;
      } catch (e) { return u; }
    }

    var pageIssues = [];
    if (!hasSelf) {
      pageIssues.push('This page has no self-referencing hreflang tag — a page should list itself among its alternates.');
    }

    return {
      empty: false,
      pageUrl: location.href,
      hasSelfReference: hasSelf,
      tags: out,
      pageIssues: pageIssues
    };
  };
})();
