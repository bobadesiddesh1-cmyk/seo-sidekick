/**
 * popup/tabs/links.js — Module 1 UI (Broken Link Checker)
 * Registers window.SEO_TABS.links = { init }.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { data: null, scanning: false, ctx: null };

  function init(ctx) {
    state.ctx = ctx;
    var scanBtn = ctx.qs('#links-scan');
    var exportBtn = ctx.qs('#links-export');

    scanBtn.addEventListener('click', function () { scan(ctx); });
    exportBtn.addEventListener('click', function () { exportCsv(ctx); });

    // If a scan already ran this session, keep showing it.
    if (state.data) render(ctx, state.data);
  }

  async function scan(ctx) {
    if (state.scanning) return;
    state.scanning = true;
    var status = ctx.qs('#links-status');
    var scanBtn = ctx.qs('#links-scan');
    status.className = 'status busy';
    status.textContent = 'Collecting and checking links';
    scanBtn.disabled = true;
    ctx.qs('#links-results').innerHTML = '';
    ctx.qs('#links-summary').classList.add('hidden');

    var resp = await ctx.send({ type: 'scan-links' });
    state.scanning = false;
    scanBtn.disabled = false;

    if (!resp || !resp.ok) {
      status.className = 'status err';
      status.textContent = (resp && resp.error) ? resp.error : 'Scan failed.';
      return;
    }
    status.className = 'status';
    status.textContent = '';
    state.data = resp.data;
    render(ctx, resp.data);
  }

  function render(ctx, data) {
    if (!data || !Array.isArray(data.links)) return;
    var links = data.links;

    var broken = links.filter(function (l) { return l.state === 'broken'; });
    var redirects = links.filter(function (l) { return l.state === 'redirect'; });
    var unknown = links.filter(function (l) { return l.state === 'unknown'; });
    var ok = links.filter(function (l) { return l.state === 'ok'; });

    var summary = ctx.qs('#links-summary');
    summary.classList.remove('hidden');
    summary.innerHTML =
      'Checked <b>' + data.checked + '</b> of <b>' + data.total + '</b> links' +
      (data.truncated ? ' <span class="pill pill-warn">capped at 300</span>' : '') +
      '<br><b>' + broken.length + '</b> broken · <b>' + redirects.length +
      '</b> redirects · <b>' + unknown.length + '</b> unknown · <b>' +
      ok.length + '</b> OK (hidden)';

    // Sort broken-first, then redirect, unknown, then OK (OK hidden by default).
    var order = { broken: 0, redirect: 1, unknown: 2, ok: 3 };
    var shown = broken.concat(redirects).concat(unknown)
      .sort(function (a, b) { return order[a.state] - order[b.state]; });

    ctx.qs('#links-export').disabled = links.length === 0;

    var wrap = ctx.qs('#links-results');
    wrap.innerHTML = '';

    // ---- Recommendations ----
    if (window.SEO_RECO && window.SEO_RECO_RULES) {
      wrap.appendChild(window.SEO_RECO.section(ctx, 'Recommendations',
        'Prioritised link fixes for this page.',
        window.SEO_RECO_RULES.links(data),
        { empty: '✓ No broken links or redirects to fix.' }));
    }

    if (shown.length === 0) {
      wrap.appendChild(ctx.el('div', { class: 'empty-note',
        text: 'No broken links or redirects found. ' +
              ok.length + ' link(s) returned OK.' }));
      return;
    }

    var table = ctx.el('table', { class: 'tbl' });
    var thead = ctx.el('thead', null, ctx.el('tr', null, [
      ctx.el('th', { text: 'Status' }),
      ctx.el('th', { text: 'Anchor' }),
      ctx.el('th', { text: 'URL' }),
      ctx.el('th', { text: 'Type' })
    ]));
    table.appendChild(thead);
    var tbody = ctx.el('tbody');

    shown.forEach(function (l) {
      var tr = ctx.el('tr', { class: 'clickable', title: 'Open in new tab' });
      tr.addEventListener('click', function () {
        try { chrome.tabs.create({ url: l.url }); } catch (e) {}
      });

      var pillClass = l.state === 'broken' ? 'pill-bad'
        : l.state === 'redirect' ? 'pill-warn'
        : l.state === 'unknown' ? 'pill-unknown' : 'pill-ok';

      var statusTd = ctx.el('td', null,
        ctx.el('span', { class: 'pill ' + pillClass, text: statusText(l) }));
      var anchorTd = ctx.el('td', { class: 'anchor-cell', text: l.anchor || '' });
      var urlTd = ctx.el('td', { class: 'url-cell' });
      urlTd.textContent = l.finalUrl && l.state === 'redirect'
        ? (l.url + '  →  ' + l.finalUrl) : l.url;
      var typeTd = ctx.el('td', null,
        ctx.el('span', { class: 'pill ' + (l.type === 'internal' ? 'pill-int' : 'pill-ext'),
          text: l.type }));

      tr.appendChild(statusTd);
      tr.appendChild(anchorTd);
      tr.appendChild(urlTd);
      tr.appendChild(typeTd);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function statusText(l) {
    if (l.state === 'broken') {
      return l.status && l.status >= 400 ? ('HTTP ' + l.status)
        : (l.label && /timeout/i.test(l.label) ? 'Timeout' : 'Broken');
    }
    if (l.state === 'redirect') {
      return l.redirectHops >= 2 ? '2+ hops' : (l.status ? ('Redirect ' + l.status) : 'Redirect');
    }
    if (l.state === 'unknown') return 'Unknown';
    return 'OK';
  }

  function exportCsv(ctx) {
    if (!state.data || !state.data.links) return;
    var rows = [['Status', 'HTTP', 'Anchor', 'URL', 'Final URL', 'Type', 'Detail']];
    state.data.links.forEach(function (l) {
      rows.push([
        l.state,
        l.status == null ? '' : l.status,
        l.anchor || '',
        l.url,
        l.finalUrl || '',
        l.type,
        l.label || ''
      ]);
    });
    var csv = window.SEO_CSV.toCsv(rows);
    var host = '';
    try { host = new URL(ctx.activeTab.url).hostname; } catch (e) { host = 'page'; }
    window.SEO_CSV.download('seo-sidekick-links-' + host + '.csv', csv);
  }

  window.SEO_TABS.links = { init: init };
})();
