/**
 * inject/link-checker.js — Module 1 (Broken Link Checker)
 *
 * Self-contained. Assigns an async function to a global so background.js can
 * inject this file, then call the global via a second executeScript. The
 * function references NOTHING from outer scope — everything it needs is defined
 * inside it, so it is safe to serialize/inject.
 *
 * Runtime (in the page's isolated world):
 *   - Collect same-document <a href>, resolve relative URLs, dedupe, filter.
 *   - Cap at 300 (DOM order); report truncation.
 *   - Check each: HEAD first, GET fallback for same-origin; no-cors probe for
 *     cross-origin reachability. Concurrency 6, 8s timeout, allSettled-safe.
 *   - Classify OK / Redirect / Broken / Unknown(CORS). Detect a 2nd redirect hop.
 *   - Return { links: [...], truncated, total, checked }.
 */
(function () {
  'use strict';

  self.__SEO_runLinkChecker = async function () {
    var MAX_LINKS = 300;
    var CONCURRENCY = 6;
    var TIMEOUT_MS = 8000;

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

    // ---- Collect + normalize links ------------------------------------------
    var anchors, i;
    try { anchors = document.querySelectorAll('a[href]'); }
    catch (e) { anchors = []; }

    var seen = {};
    var collected = [];
    for (i = 0; i < anchors.length; i++) {
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

      // Pure in-page anchor (same doc, only hash differs) -> skip.
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
        type: sameOrigin(abs) ? 'internal' : (hostOf(abs) === pageHost ? 'internal' : 'external')
      });
    }

    var truncated = collected.length > MAX_LINKS;
    var total = collected.length;
    var work = collected.slice(0, MAX_LINKS);

    // ---- Fetch helpers ------------------------------------------------------
    function timedFetch(url, opts) {
      var controller = new AbortController();
      var t = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      opts = opts || {};
      opts.signal = controller.signal;
      opts.redirect = 'follow';
      return fetch(url, opts).then(function (r) {
        clearTimeout(t);
        return r;
      }).catch(function (err) {
        clearTimeout(t);
        throw err;
      });
    }

    // Check a single link; never throws.
    async function checkOne(item) {
      var url = item.url;
      var isSame = sameOrigin(url);
      var result = {
        url: url,
        anchor: item.anchor,
        type: item.type,
        status: null,
        state: 'unknown',       // ok | redirect | broken | unknown
        label: '',
        finalUrl: '',
        redirectHops: 0
      };

      // Try a normal HEAD first (readable status when same-origin or CORS-allowed).
      try {
        var head = await timedFetch(url, { method: 'HEAD' });
        applyResponse(result, head);
        // For redirects, probe the final URL once to detect a 2nd hop.
        if (result.state === 'redirect') {
          await probeSecondHop(result);
        }
        // Some servers reject HEAD (405) but the page is fine — retry GET.
        if (result.status === 405 || result.status === 501) {
          try {
            var g = await timedFetch(url, { method: 'GET' });
            applyResponse(result, g);
            if (result.state === 'redirect') await probeSecondHop(result);
          } catch (e2) { /* keep HEAD result */ }
        }
        return result;
      } catch (headErr) {
        // HEAD failed. Same-origin -> try GET (readable).
        if (isSame) {
          try {
            var resp = await timedFetch(url, { method: 'GET' });
            applyResponse(result, resp);
            if (result.state === 'redirect') await probeSecondHop(result);
            return result;
          } catch (getErr) {
            result.state = 'broken';
            result.label = classifyError(getErr);
            return result;
          }
        }
        // Cross-origin -> no-cors probe just to see if it's reachable at all.
        try {
          await timedFetch(url, { method: 'HEAD', mode: 'no-cors' });
          // Opaque success: host answered but status is unreadable.
          result.state = 'unknown';
          result.status = 0;
          result.label = 'Unknown — open manually (CORS)';
          return result;
        } catch (probeErr) {
          result.state = 'broken';
          result.label = classifyError(probeErr);
          return result;
        }
      }
    }

    function classifyError(err) {
      if (err && err.name === 'AbortError') return 'Broken — timeout (8s)';
      return 'Broken — network error';
    }

    function applyResponse(result, resp) {
      // Opaque (no-cors) responses report status 0 and type 'opaque'.
      if (resp.type === 'opaque') {
        result.status = 0;
        result.state = 'unknown';
        result.label = 'Unknown — open manually (CORS)';
        return;
      }
      var s = resp.status;
      result.status = s;
      result.finalUrl = resp.url || '';
      if (resp.redirected && result.finalUrl && result.finalUrl !== result.url) {
        result.state = 'redirect';
        result.redirectHops = 1;
        result.label = 'Redirect → ' + result.finalUrl;
      } else if (s >= 200 && s < 300) {
        result.state = 'ok';
        result.label = 'OK ' + s;
      } else if (s >= 300 && s < 400) {
        result.state = 'redirect';
        result.redirectHops = 1;
        result.label = 'Redirect ' + s + (result.finalUrl ? ' → ' + result.finalUrl : '');
      } else if (s >= 400) {
        result.state = 'broken';
        result.label = 'Broken — HTTP ' + s;
      } else {
        result.state = 'unknown';
        result.label = 'Unknown — status ' + s;
      }
    }

    async function probeSecondHop(result) {
      // The first fetch used redirect:'follow', which collapses an ENTIRE chain
      // to its settled URL — and fetch() never exposes intermediate Location
      // headers (a redirect:'manual' response is an opaque-redirect with no
      // readable headers, even same-origin). So true hop-COUNTING is impossible
      // in the browser. What we CAN do without false positives: re-request the
      // settled destination once; if IT still reports a redirect, the original
      // was a multi-hop chain (e.g. http→https→canonical that only fully
      // resolves on a second request). Best-effort, timeout-bounded, and only
      // escalates on an actually-observed second redirect.
      try {
        var settled = result.finalUrl || result.url;
        if (!settled) return;
        var r2 = await timedFetch(settled, { method: 'HEAD' });
        if (r2.type === 'opaque') return; // cross-origin, unreadable — leave as-is
        if (r2.redirected && r2.url && r2.url !== settled) {
          result.redirectHops = 2;
          result.finalUrl = r2.url;
          result.label = '2+ redirect hops → ' + r2.url;
        }
      } catch (e) { /* keep single-hop label */ }
    }

    // ---- Concurrency pool (6 in flight, FIFO queue) -------------------------
    var results = new Array(work.length);
    var next = 0;

    async function worker() {
      while (true) {
        var idx = next++;
        if (idx >= work.length) return;
        try {
          results[idx] = await checkOne(work[idx]);
        } catch (e) {
          results[idx] = {
            url: work[idx].url, anchor: work[idx].anchor, type: work[idx].type,
            status: null, state: 'broken', label: 'Broken — unexpected error',
            finalUrl: '', redirectHops: 0
          };
        }
      }
    }

    var pool = [];
    for (var w = 0; w < Math.min(CONCURRENCY, work.length); w++) pool.push(worker());
    await Promise.allSettled(pool);

    return {
      links: results,
      truncated: truncated,
      total: total,
      checked: work.length
    };
  };
})();
