/**
 * shared/recos.js — cross-tool recommendation engine (UI layer).
 *
 * A shared renderer used by every tab so recommendations look and behave the
 * same everywhere: a prioritised list of fix cards, each with a severity, a
 * plain-language explanation, an optional "Now → Use" before/after (e.g. the
 * current vs recommended canonical URL), and optional copy/downloadable fix code.
 *
 * Exposes window.SEO_RECO = { card, section }.
 *   card(ctx, reco)                     -> a single recommendation card element
 *   section(ctx, title, subtitle, list, opts) -> a titled section with a count
 *
 * reco = {
 *   sev: 'high'|'med'|'low',
 *   title: string,
 *   detail?: string,
 *   current?: string,        // "Now" value (e.g. the current canonical URL)
 *   recommended?: string,    // "Use" value (e.g. the URL that should be there)
 *   code?: string,           // copy/downloadable fix snippet
 *   codeLabel?: string,      // <summary> text (default "Show fix code")
 *   codeName?: string,       // download filename
 *   codeMime?: string        // download mime (default text/plain)
 * }
 */
(function () {
  'use strict';
  var ORDER = { high: 0, med: 1, low: 2 };
  var LABEL = { high: 'High', med: 'Medium', low: 'Low' };

  function copyText(t) {
    try { navigator.clipboard.writeText(t); }
    catch (e) {
      try {
        var ta = document.createElement('textarea');
        ta.value = t; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch (e2) {}
    }
  }
  function flash(btn, msg) {
    try {
      var s = btn.querySelector('span'); if (!s) return;
      var o = s.textContent; s.textContent = msg;
      setTimeout(function () { s.textContent = o; }, 1200);
    } catch (e) {}
  }
  function btn(ctx, label, onClick) {
    var b = ctx.el('button', { class: 'sd-btn' });
    b.innerHTML = '<span>' + ctx.escapeHtml(label) + '</span>';
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }

  function card(ctx, r) {
    var el = ctx.el;
    var sev = r.sev || 'med';
    var c = el('div', { class: 'reco reco-' + sev });
    var head = el('div', { class: 'reco-head' }, [
      el('span', { class: 'reco-sev ' + sev, text: LABEL[sev] || 'Medium' }),
      el('div', { class: 'reco-t', text: r.title })
    ]);
    if (r.source) head.appendChild(el('span', { class: 'reco-src', text: r.source }));
    c.appendChild(head);
    if (r.detail) c.appendChild(el('div', { class: 'reco-detail', text: r.detail }));

    if (r.current != null || r.recommended != null) {
      var d = el('div', { class: 'reco-delta' });
      if (r.current != null) d.appendChild(el('div', { class: 'reco-line' }, [
        el('span', { class: 'reco-lab cur', text: 'Now' }),
        el('code', { class: 'reco-val', text: String(r.current) })
      ]));
      if (r.recommended != null) d.appendChild(el('div', { class: 'reco-line' }, [
        el('span', { class: 'reco-lab rec', text: 'Use' }),
        el('code', { class: 'reco-val ok', text: String(r.recommended) })
      ]));
      c.appendChild(d);
    }

    if (r.code) {
      var box = el('details', { class: 'reco-code' });
      box.appendChild(el('summary', { text: r.codeLabel || 'Show fix code' }));
      var actions = el('div', { class: 'reco-actions' }, [
        btn(ctx, 'Copy', function (b) { copyText(r.code); flash(b, 'Copied ✓'); })
      ]);
      if (r.codeName) actions.appendChild(btn(ctx, 'Download', function () {
        window.SEO_CSV.downloadText(r.codeName, r.code, r.codeMime || 'text/plain');
      }));
      box.appendChild(actions);
      box.appendChild(el('pre', { class: 'reco-pre', text: r.code }));
      c.appendChild(box);
    }
    return c;
  }

  function section(ctx, title, subtitle, list, opts) {
    opts = opts || {};
    var el = ctx.el;
    list = (list || []).slice().sort(function (a, b) {
      return (ORDER[a.sev] == null ? 1 : ORDER[a.sev]) - (ORDER[b.sev] == null ? 1 : ORDER[b.sev]);
    });
    var sec = el('div', { class: 'reco-section' });
    var head = el('div', { class: 'reco-shead' }, [
      el('h3', { class: 'reco-stitle', text: title }),
      el('span', { class: 'reco-count' + (list.length ? '' : ' zero'), text: String(list.length) })
    ]);
    sec.appendChild(head);
    if (subtitle) sec.appendChild(el('p', { class: 'reco-ssub', text: subtitle }));
    if (!list.length) {
      sec.appendChild(el('div', { class: 'reco-empty', text: opts.empty || '✓ No issues found here — nice work.' }));
      return sec;
    }
    list.forEach(function (r) { sec.appendChild(card(ctx, r)); });
    return sec;
  }

  window.SEO_RECO = { card: card, section: section };
})();
