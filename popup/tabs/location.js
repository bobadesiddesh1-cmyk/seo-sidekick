/**
 * popup/tabs/location.js — Module 4 UI (SERP Location Changer)
 * Registers window.SEO_TABS.location = { init }.
 *
 * Populates the location dropdown from shared/locations.js, prefills the query
 * from the active SERP tab (if any), opens a new Google tab for the chosen
 * location, and keeps a click-to-rerun history (last 10) in chrome.storage.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { ctx: null, built: false };

  function init(ctx) {
    state.ctx = ctx;
    if (!state.built) {
      buildDropdown(ctx);
      state.built = true;
    }
    ctx.qs('#location-search').addEventListener('click', function () { doSearch(ctx); });
    ctx.qs('#location-query').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSearch(ctx);
    });
    prefillQuery(ctx);
    renderHistory(ctx);
  }

  function buildDropdown(ctx) {
    var sel = ctx.qs('#location-select');
    sel.innerHTML = '';
    var list = (window.SEO_LOCATIONS && window.SEO_LOCATIONS.LIST) || [];
    list.forEach(function (loc, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = loc.label + '  (' + loc.gl + '/' + loc.hl + ')';
      sel.appendChild(opt);
    });
  }

  async function prefillQuery(ctx) {
    // If the active tab is a Google SERP, ask its content script for the query.
    var tab = ctx.activeTab;
    if (!tab || !tab.url || !/google\.[a-z.]+\/search/i.test(tab.url)) return;
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'serp:getQuery' }, function (resp) {
        if (chrome.runtime && chrome.runtime.lastError) return;
        if (resp && resp.ok && resp.query) {
          var q = ctx.qs('#location-query');
          if (!q.value) q.value = resp.query;
        }
      });
    } catch (e) { /* silent */ }
  }

  function resolveLocation(ctx) {
    var custom = ctx.qs('#location-custom').value.trim();
    if (custom) {
      // Build a location object from free text; use canonical = text.
      return { label: custom, canonical: custom, gl: '', hl: '' };
    }
    var sel = ctx.qs('#location-select');
    var idx = parseInt(sel.value, 10);
    var list = (window.SEO_LOCATIONS && window.SEO_LOCATIONS.LIST) || [];
    return list[idx] || list[0];
  }

  async function doSearch(ctx) {
    var query = ctx.qs('#location-query').value.trim();
    var status = ctx.qs('#location-status');
    if (!query) {
      status.className = 'status err';
      status.textContent = 'Enter a search query first.';
      return;
    }
    var loc = resolveLocation(ctx);
    if (!loc) {
      status.className = 'status err';
      status.textContent = 'Pick a location.';
      return;
    }

    var url = window.SEO_LOCATIONS.buildSearchUrl({ query: query, location: loc });
    status.className = 'status';
    status.textContent = 'Opening Google as ' + loc.label + '…';

    try { chrome.tabs.create({ url: url }); } catch (e) {}

    // Save to history.
    try {
      await window.SEO_STORE.pushHistory({
        query: query, label: loc.label,
        canonical: loc.canonical || loc.label, gl: loc.gl || '', hl: loc.hl || '',
        ts: Date.now()
      });
      renderHistory(ctx);
    } catch (e) { /* silent */ }
  }

  async function renderHistory(ctx) {
    var wrap = ctx.qs('#location-history');
    wrap.innerHTML = '';
    var list = [];
    try { list = await window.SEO_STORE.getHistory(); } catch (e) { list = []; }
    if (!list.length) {
      wrap.appendChild(ctx.el('div', { class: 'empty-note', text: 'No searches yet.' }));
      return;
    }
    list.forEach(function (h) {
      var row = ctx.el('div', { class: 'hist-row', title: 'Re-run this search' }, [
        ctx.el('span', { class: 'hist-q', text: h.query }),
        ctx.el('span', { class: 'hist-l', text: h.label })
      ]);
      row.addEventListener('click', function () {
        var loc = { label: h.label, canonical: h.canonical || h.label, gl: h.gl || '', hl: h.hl || '' };
        var url = window.SEO_LOCATIONS.buildSearchUrl({ query: h.query, location: loc });
        try { chrome.tabs.create({ url: url }); } catch (e) {}
      });
      wrap.appendChild(row);
    });
  }

  window.SEO_TABS.location = { init: init };
})();
