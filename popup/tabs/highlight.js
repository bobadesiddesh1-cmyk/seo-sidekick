/**
 * popup/tabs/highlight.js — Module 3 UI (Dofollow/Nofollow Highlighter)
 * Registers window.SEO_TABS.highlight = { init }.
 *
 * The toggle reflects the live per-tab state read from the page. Turning it on
 * injects/enables the highlighter; off disables it. Counts refresh while on.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { ctx: null, on: false, pollTimer: null };

  function init(ctx) {
    state.ctx = ctx;
    var toggle = ctx.qs('#highlight-toggle');
    toggle.addEventListener('change', function () {
      if (toggle.checked) enable(ctx); else disable(ctx);
    });
    // Sync toggle with current page state on open.
    syncState(ctx);
  }

  async function syncState(ctx) {
    var resp = await ctx.send({ type: 'highlight', action: 'state' });
    if (resp && resp.ok && resp.data) {
      state.on = !!resp.data.on;
      ctx.qs('#highlight-toggle').checked = state.on;
      renderCounts(ctx, resp.data.counts);
      if (state.on) startPolling(ctx);
    }
  }

  async function enable(ctx) {
    setStatus(ctx, 'Highlighting links', false);
    var resp = await ctx.send({ type: 'highlight', action: 'on' });
    if (!resp || !resp.ok) {
      setStatus(ctx, (resp && resp.error) ? resp.error : 'Could not highlight.', true);
      ctx.qs('#highlight-toggle').checked = false;
      return;
    }
    state.on = true;
    setStatus(ctx, '', false);
    renderCounts(ctx, resp.data && resp.data.counts);
    startPolling(ctx);
  }

  async function disable(ctx) {
    stopPolling();
    var resp = await ctx.send({ type: 'highlight', action: 'off' });
    state.on = false;
    setStatus(ctx, '', false);
    if (resp && resp.ok && resp.data) renderCounts(ctx, resp.data.counts);
    ctx.qs('#highlight-counts').classList.add('hidden');
  }

  function startPolling(ctx) {
    stopPolling();
    state.pollTimer = setInterval(async function () {
      if (!state.on) { stopPolling(); return; }
      var resp = await ctx.send({ type: 'highlight', action: 'counts' });
      if (resp && resp.ok && resp.data) {
        if (!resp.data.on) { state.on = false; ctx.qs('#highlight-toggle').checked = false; stopPolling(); }
        renderCounts(ctx, resp.data.counts);
      }
    }, 1500);
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  function renderCounts(ctx, c) {
    if (!c) return;
    var grid = ctx.qs('#highlight-counts');
    grid.classList.toggle('hidden', !state.on);
    if (!state.on) return;
    grid.innerHTML = '';
    var cells = [
      ['Total', c.total], ['Dofollow', c.dofollow], ['Nofollow', c.nofollow],
      ['Internal', c.internal], ['External', c.external]
    ];
    cells.forEach(function (pair) {
      var cell = ctx.el('div', { class: 'count-cell' }, [
        ctx.el('div', { class: 'n', text: String(pair[1] == null ? 0 : pair[1]) }),
        ctx.el('div', { class: 'l', text: pair[0] })
      ]);
      grid.appendChild(cell);
    });
  }

  function setStatus(ctx, text, isErr) {
    var s = ctx.qs('#highlight-status');
    s.className = 'status' + (isErr ? ' err' : (text ? ' busy' : ''));
    s.textContent = text;
  }

  window.SEO_TABS.highlight = { init: init };
})();
