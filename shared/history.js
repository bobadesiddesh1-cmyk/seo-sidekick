/**
 * shared/history.js — before/after audit history per URL (on-device only).
 *
 * Each Fixes-tab audit is saved as a small snapshot in chrome.storage.local, so
 * the next check of the same URL can say "since last check: 3 fixed, 1 new".
 *
 * Diffing is careful about what was actually checked: issues are only compared
 * for sources that ran in BOTH snapshots (e.g. a skipped broken-link scan never
 * reads as "all link issues fixed").
 *
 * Issue identity = the recommendation title with digits normalised ("Fix 3
 * broken links" and "Fix 5 broken links" are the same issue), so a count change
 * is not reported as fixed + new.
 *
 * Exposes window.SEO_HISTORY = { snapshot, list, record, diff, clear, issueKey }.
 */
(function () {
  'use strict';

  var PREFIX = 'seo_hist:';
  var INDEX = 'seo_hist_index';
  var MAX_SNAPS = 12;     // per URL
  var MAX_URLS = 300;     // LRU across URLs

  function store() { return window.SEO_STORE; }

  function keyFor(url) {
    try { var x = new URL(url); return PREFIX + x.origin + x.pathname + x.search; }
    catch (e) { return PREFIX + String(url || ''); }
  }
  function issueKey(r) {
    return String((r && r.title) || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function sourcesOf(issue) {
    return String(issue.source || '').split('·').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function snapshot(recos, meta) {
    meta = meta || {};
    var counts = { high: 0, med: 0, low: 0, total: 0 };
    var issues = (recos || []).map(function (r) {
      counts[r.sev] = (counts[r.sev] || 0) + 1; counts.total++;
      return { k: issueKey(r), title: r.title, sev: r.sev, source: r.source || '' };
    });
    var version = '';
    try { version = chrome.runtime.getManifest().version; } catch (e) {}
    return { ts: Date.now(), version: version, sources: (meta.sources || []).slice(), counts: counts, issues: issues };
  }

  async function list(url) {
    var s = store(); if (!s) return [];
    var v = await s.get(keyFor(url), []);
    return Array.isArray(v) ? v : [];
  }

  // Append a snapshot (or replace the latest one, when the same audit was
  // extended — e.g. a link scan or AI insight ran after the first save).
  async function record(url, snap, replaceLast) {
    var s = store(); if (!s) return [];
    var key = keyFor(url);
    var arr = await list(url);
    if (replaceLast && arr.length) arr[arr.length - 1] = snap; else arr.push(snap);
    if (arr.length > MAX_SNAPS) arr = arr.slice(arr.length - MAX_SNAPS);
    await s.set(key, arr);

    // LRU index of URLs, pruned so storage never grows without bound.
    var idx = await s.get(INDEX, []);
    if (!Array.isArray(idx)) idx = [];
    idx = idx.filter(function (k) { return k !== key; });
    idx.push(key);
    if (idx.length > MAX_URLS) {
      var drop = idx.slice(0, idx.length - MAX_URLS);
      idx = idx.slice(idx.length - MAX_URLS);
      try { chrome.storage.local.remove(drop); } catch (e) {}
    }
    await s.set(INDEX, idx);
    return arr;
  }

  function diff(prev, curr) {
    if (!prev || !curr) return null;
    var shared = (curr.sources || []).filter(function (x) { return (prev.sources || []).indexOf(x) !== -1; });
    function comparable(i) {
      var src = sourcesOf(i);
      return !src.length || src.some(function (x) { return shared.indexOf(x) !== -1; });
    }
    var p = prev.issues.filter(comparable), c = curr.issues.filter(comparable);
    var pk = {}, ck = {};
    p.forEach(function (i) { pk[i.k] = i; });
    c.forEach(function (i) { ck[i.k] = i; });
    var fixed = p.filter(function (i) { return !ck[i.k]; });
    var added = c.filter(function (i) { return !pk[i.k]; });
    var unchanged = c.filter(function (i) { return !!pk[i.k]; }).length;
    return { fixed: fixed, added: added, unchanged: unchanged, prevTs: prev.ts, prevTotal: prev.counts.total };
  }

  async function clear(url) {
    var key = keyFor(url);
    try { await new Promise(function (r) { chrome.storage.local.remove([key], r); }); } catch (e) {}
    var s = store();
    if (s) {
      var idx = await s.get(INDEX, []);
      if (Array.isArray(idx)) await s.set(INDEX, idx.filter(function (k) { return k !== key; }));
    }
  }

  window.SEO_HISTORY = { snapshot: snapshot, list: list, record: record, diff: diff, clear: clear, issueKey: issueKey };
})();
