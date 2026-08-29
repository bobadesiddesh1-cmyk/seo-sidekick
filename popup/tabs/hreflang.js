/**
 * popup/tabs/hreflang.js — Module 2 UI (Hreflang Validator)
 * Auto-runs once on popup open. Registers window.SEO_TABS.hreflang = { init }.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { data: null, running: false, ctx: null, ran: false };

  function init(ctx) {
    state.ctx = ctx;
    var rescan = ctx.qs('#hreflang-rescan');
    if (rescan) rescan.addEventListener('click', function () { run(ctx, true); });
    if (!state.ran) run(ctx, false); // auto-run on open
    else if (state.data) render(ctx, state.data);
  }

  async function run(ctx, force) {
    if (state.running) return;
    if (state.ran && !force && state.data) { render(ctx, state.data); return; }
    state.running = true;
    state.ran = true;

    var status = ctx.qs('#hreflang-status');
    status.className = 'status busy';
    status.textContent = 'Reading hreflang tags and checking reciprocity';
    ctx.qs('#hreflang-results').innerHTML = '';
    ctx.qs('#hreflang-page').classList.add('hidden');

    var resp = await ctx.send({ type: 'check-hreflang' });
    state.running = false;

    if (!resp || !resp.ok) {
      status.className = 'status err';
      status.textContent = (resp && resp.error) ? resp.error : 'Check failed.';
      return;
    }
    status.className = 'status';
    status.textContent = '';
    state.data = resp.data;
    render(ctx, resp.data);
  }

  function render(ctx, data) {
    var page = ctx.qs('#hreflang-page');
    var wrap = ctx.qs('#hreflang-results');
    wrap.innerHTML = '';

    if (!data) return;

    if (data.empty) {
      page.classList.add('hidden');
      wrap.appendChild(ctx.el('div', { class: 'empty-note',
        text: 'No hreflang tags found on this page.' }));
      return;
    }

    var tags = data.tags || [];
    var passCount = tags.filter(function (t) { return t.pass; }).length;
    var issueCount = tags.length - passCount;

    page.classList.remove('hidden');
    var pageHtml = 'Found <b>' + tags.length + '</b> hreflang tag(s) · <b>' +
      passCount + '</b> clean · <b>' + issueCount + '</b> with issues<br>' +
      'Self-reference: ' + (data.hasSelfReference
        ? '<span class="pill pill-ok">present</span>'
        : '<span class="pill pill-bad">missing</span>');
    if (data.pageIssues && data.pageIssues.length) {
      pageHtml += '<br>' + data.pageIssues.map(ctx.escapeHtml).join('<br>');
    }
    page.innerHTML = pageHtml;

    // ---- Recommendations ----
    if (window.SEO_RECO && window.SEO_RECO_RULES) {
      wrap.appendChild(window.SEO_RECO.section(ctx, 'Recommendations',
        'Fix these hreflang issues to keep international targeting valid.',
        window.SEO_RECO_RULES.hreflang(data),
        { empty: '✓ Hreflang looks valid — no issues found.' }));
    }

    tags.forEach(function (t) {
      var card = ctx.el('div', { class: 'hf-card ' + (t.pass ? 'ok' : 'bad') });

      var recipPill = reciprocityPill(t.reciprocity);
      var top = ctx.el('div', { class: 'hf-top' }, [
        ctx.el('span', { class: 'hf-code', text: t.hreflang || '(empty)' }),
        ctx.el('span', { class: 'pill ' + recipPill.cls, text: recipPill.label })
      ]);
      card.appendChild(top);

      var href = ctx.el('div', { class: 'hf-href', text: t.absUrl || t.href || '(no href)' });
      card.appendChild(href);

      // Per-check ticks.
      var checks = ctx.el('div', { class: 'muted', style: 'margin:2px 0 4px;font-size:11px;' });
      checks.innerHTML =
        tick(t.valueValid) + ' language code &nbsp; ' +
        tick(t.absoluteOk) + ' absolute URL &nbsp; ' +
        tick(!t.duplicate) + ' unique &nbsp; ' +
        tick(t.reciprocity === 'ok' || t.reciprocity === 'self') + ' return tag';
      card.appendChild(checks);

      if (t.issues && t.issues.length) {
        t.issues.forEach(function (iss) {
          card.appendChild(ctx.el('div', { class: 'hf-issue' }, [
            ctx.el('span', { text: '✗' }),
            ctx.el('span', { text: iss })
          ]));
        });
      } else {
        card.appendChild(ctx.el('div', { class: 'hf-pass', text: '✓ All checks passed' }));
      }

      if (t.reciprocity === 'cors') {
        card.appendChild(ctx.el('div', { class: 'muted', style: 'font-size:10.5px;margin-top:3px;',
          text: 'Note: ' + t.reciprocityDetail }));
      }

      wrap.appendChild(card);
    });
  }

  function tick(ok) { return ok ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✗</span>'; }

  function reciprocityPill(status) {
    switch (status) {
      case 'ok': return { cls: 'pill-ok', label: 'return tag ✓' };
      case 'self': return { cls: 'pill-int', label: 'self' };
      case 'missing': return { cls: 'pill-bad', label: 'no return tag' };
      case 'cors': return { cls: 'pill-unknown', label: 'CORS — unverified' };
      case 'unreachable': return { cls: 'pill-bad', label: 'unreachable' };
      case 'timeout': return { cls: 'pill-warn', label: 'timeout' };
      default: return { cls: 'pill-int', label: status || 'n/a' };
    }
  }

  window.SEO_TABS.hreflang = { init: init };
})();
