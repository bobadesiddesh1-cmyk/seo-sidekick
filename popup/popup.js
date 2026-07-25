/**
 * popup/popup.js — tab router + shared popup shell.
 *
 * - Switches tabs instantly (no re-fetch on switch; each tab caches its own
 *   results in module-level state for the life of this popup-open session).
 * - Provides a shared context object to every tab: active tab info, a promise
 *   wrapper around chrome.runtime.sendMessage, and small DOM helpers.
 * - Modules 2 (hreflang) and 5 (preview) auto-run once when the popup opens.
 */
(function () {
  'use strict';

  var ctx = {
    activeTab: null,          // {id, url, title}
    send: sendBg,
    qs: function (s, r) { return (r || document).querySelector(s); },
    qsa: function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); },
    el: makeEl,
    escapeHtml: escapeHtml
  };

  function sendBg(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (resp) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { ok: false, error: 'No response' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  function makeEl(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var TABS = {}; // name -> module (registered by tab files on window.SEO_TABS)
  var initialized = {};

  function registerTabs() {
    var reg = window.SEO_TABS || {};
    Object.keys(reg).forEach(function (name) { TABS[name] = reg[name]; });
  }

  function activate(name) {
    ctx.qsa('.tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ctx.qsa('.panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === name);
    });

    var mod = TABS[name];
    if (mod) {
      if (!initialized[name] && typeof mod.init === 'function') {
        initialized[name] = true;
        try { mod.init(ctx); } catch (e) { /* isolate tab failure */ }
      }
      if (typeof mod.onShow === 'function') {
        try { mod.onShow(ctx); } catch (e) { /* silent */ }
      }
    }
  }

  function wireTabs() {
    ctx.qsa('.tab').forEach(function (t) {
      t.addEventListener('click', function () { activate(t.getAttribute('data-tab')); });
    });
  }

  async function loadActiveTab() {
    try {
      var tabs = await new Promise(function (resolve) {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      ctx.activeTab = tabs && tabs[0] ? tabs[0] : null;
    } catch (e) { ctx.activeTab = null; }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    registerTabs();
    wireTabs();
    await loadActiveTab();

    // Initialize the default (links) tab, and eagerly init the auto-run tabs
    // (on-page + hreflang + preview) so they populate before the user clicks.
    activate('links');
    ['onpage', 'hreflang', 'preview'].forEach(function (n) {
      var mod = TABS[n];
      if (mod && !initialized[n] && typeof mod.init === 'function') {
        initialized[n] = true;
        try { mod.init(ctx); } catch (e) { /* silent */ }
      }
    });
    // Also init highlight + location + speed so their state (toggle, history,
    // API key, target URL) is ready before the user opens the tab.
    ['highlight', 'location', 'speed', 'ai', 'tech'].forEach(function (n) {
      var mod = TABS[n];
      if (mod && !initialized[n] && typeof mod.init === 'function') {
        initialized[n] = true;
        try { mod.init(ctx); } catch (e) { /* silent */ }
      }
    });
  });
})();
