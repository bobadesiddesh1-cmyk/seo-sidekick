/**
 * shared/storage.js
 * Thin promise wrapper over chrome.storage.local for popup + content scripts.
 * All data stays on-device. No sync, no remote, no telemetry.
 *
 * Exposes global SEO_STORE = { get, set, getHistory, pushHistory }.
 */
(function (root) {
  'use strict';

  function get(key, fallback) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([key], function (res) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(fallback);
            return;
          }
          resolve(res && key in res ? res[key] : fallback);
        });
      } catch (e) {
        resolve(fallback);
      }
    });
  }

  function set(key, value) {
    return new Promise(function (resolve) {
      try {
        var obj = {};
        obj[key] = value;
        chrome.storage.local.set(obj, function () { resolve(true); });
      } catch (e) {
        resolve(false);
      }
    });
  }

  var HISTORY_KEY = 'seo_location_history';
  var HISTORY_MAX = 10;

  function getHistory() {
    return get(HISTORY_KEY, []).then(function (h) {
      return Array.isArray(h) ? h : [];
    });
  }

  /**
   * Push a {query, label, gl, hl, canonical, ts} entry, newest first, dedup by
   * query+label, cap at 10.
   */
  function pushHistory(entry) {
    return getHistory().then(function (list) {
      var key = (entry.query || '') + '|' + (entry.label || '');
      list = list.filter(function (e) {
        return ((e.query || '') + '|' + (e.label || '')) !== key;
      });
      list.unshift(entry);
      if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
      return set(HISTORY_KEY, list).then(function () { return list; });
    });
  }

  var api = {
    get: get,
    set: set,
    getHistory: getHistory,
    pushHistory: pushHistory,
    HISTORY_KEY: HISTORY_KEY
  };
  root.SEO_STORE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
