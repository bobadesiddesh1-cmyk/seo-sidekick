/**
 * popup/tabs/onpage.js — Module 6 UI (On-Page Elements Analyzer)
 * Auto-runs once on popup open. Registers window.SEO_TABS.onpage = { init }.
 *
 * Shows the page's on-page SEO elements and a word count whose PRIMARY figure is
 * the body's <p> paragraph text (nav/menu/script noise excluded), with body-text
 * and heading word counts as secondary references.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { data: null, running: false, ran: false, ctx: null };

  // Rough guidance limits used only for color hints.
  var TITLE_MAX = 60;   // chars
  var DESC_MIN = 70, DESC_MAX = 160;

  function init(ctx) {
    state.ctx = ctx;
    var rescan = ctx.qs('#onpage-rescan');
    var exportBtn = ctx.qs('#onpage-export');
    if (rescan) rescan.addEventListener('click', function () { run(ctx, true); });
    if (exportBtn) exportBtn.addEventListener('click', function () { exportCsv(ctx); });
    if (!state.ran) run(ctx, false);
    else if (state.data) render(ctx, state.data);
  }

  async function run(ctx, force) {
    if (state.running) return;
    if (state.ran && !force && state.data) { render(ctx, state.data); return; }
    state.running = true;
    state.ran = true;

    var status = ctx.qs('#onpage-status');
    status.className = 'status busy';
    status.textContent = 'Analyzing on-page elements';
    ctx.qs('#onpage-results').innerHTML = '';

    var resp = await ctx.send({ type: 'analyze-onpage' });
    state.running = false;

    if (!resp || !resp.ok) {
      status.className = 'status err';
      status.textContent = (resp && resp.error) ? resp.error : 'Analysis failed.';
      return;
    }
    status.className = 'status';
    status.textContent = '';
    state.data = resp.data;
    ctx.qs('#onpage-export').disabled = false;
    render(ctx, resp.data);
  }

  function render(ctx, d) {
    var wrap = ctx.qs('#onpage-results');
    wrap.innerHTML = '';
    if (!d) return;
    var el = ctx.el, esc = ctx.escapeHtml;

    // ---- Word count card ----
    var wc = d.wordCount || {};
    var card = el('div', { class: 'op-wordcard' });
    card.innerHTML =
      '<div class="op-wc-main"><span class="op-wc-num">' + (wc.paragraphs || 0) + '</span>' +
      '<span class="op-wc-lbl">words of main content</span></div>' +
      '<div class="op-wc-sub">' +
      '<span><b>' + (wc.paragraphElements || 0) + '</b> paragraphs</span>' +
      '<span><b>' + (wc.readingTimeMin || 1) + '</b> min read</span>' +
      '<span><b>' + (wc.headings || 0) + '</b> heading words</span>' +
      '<span><b>' + (wc.bodyText || 0) + '</b> whole page</span>' +
      '</div>' +
      '<div class="op-wc-note">Counted from ' + esc(wc.contentRoot || 'the page') +
      ', excluding nav, header, footer &amp; sidebars.</div>';
    wrap.appendChild(card);

    // ---- Title ----
    var titleLen = d.title.length;
    var titleColor = titleLen === 0 ? 'bad' : (titleLen > TITLE_MAX ? 'warn' : 'ok');
    wrap.appendChild(section(ctx, 'Title', [
      valueRow(ctx, d.title.text || '(missing)', badge(ctx, titleLen + ' chars', titleColor))
    ]));

    // ---- Meta description ----
    var dl = d.metaDescription.length;
    var descColor = dl === 0 ? 'bad' : (dl < DESC_MIN || dl > DESC_MAX ? 'warn' : 'ok');
    wrap.appendChild(section(ctx, 'Meta description', [
      valueRow(ctx, d.metaDescription.text || '(missing)', badge(ctx, dl + ' chars', descColor))
    ]));

    // ---- Headings ----
    var hc = d.headingCounts || {};
    var hgrid = el('div', { class: 'op-hgrid' });
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function (t) {
      var n = hc[t] || 0;
      var warn = (t === 'h1' && n !== 1);
      var cell = el('div', { class: 'op-hcell' + (warn ? ' warn' : '') }, [
        el('div', { class: 'n', text: String(n) }),
        el('div', { class: 'l', text: t.toUpperCase() })
      ]);
      hgrid.appendChild(cell);
    });
    var hsec = section(ctx, 'Headings', [hgrid]);
    if (hc.h1 !== 1) {
      hsec.appendChild(el('div', { class: 'op-note ' + (hc.h1 === 0 ? 'bad' : 'warn'),
        text: hc.h1 === 0 ? 'No H1 found — every page should have exactly one H1.'
                          : 'Found ' + hc.h1 + ' H1 tags — a page should have exactly one.' }));
    }
    // list H1 + H2 text
    (d.headings.h1 || []).forEach(function (t) {
      hsec.appendChild(el('div', { class: 'op-hitem' }, [ badge(ctx, 'H1', 'int'), document.createTextNode(' ' + t) ]));
    });
    (d.headings.h2 || []).slice(0, 12).forEach(function (t) {
      hsec.appendChild(el('div', { class: 'op-hitem' }, [ badge(ctx, 'H2', 'int'), document.createTextNode(' ' + t) ]));
    });
    if ((d.headings.h2 || []).length > 12) {
      hsec.appendChild(el('div', { class: 'op-note', text: '…and ' + (d.headings.h2.length - 12) + ' more H2s' }));
    }
    wrap.appendChild(hsec);

    // ---- Images ----
    var im = d.images || {};
    var imgRows = el('div', { class: 'op-inline' }, [
      stat(ctx, im.total, 'images'),
      stat(ctx, im.withAlt, 'with alt', im.withAlt ? 'ok' : ''),
      stat(ctx, im.missingAlt, 'no alt attr', im.missingAlt ? 'bad' : 'ok'),
      stat(ctx, im.emptyAlt, 'empty alt', im.emptyAlt ? 'warn' : '')
    ]);
    wrap.appendChild(section(ctx, 'Images', [imgRows]));

    // ---- Links ----
    var lk = d.links || {};
    var linkRows = el('div', { class: 'op-inline' }, [
      stat(ctx, lk.total, 'links'),
      stat(ctx, lk.internal, 'internal'),
      stat(ctx, lk.external, 'external'),
      stat(ctx, lk.nofollow, 'nofollow')
    ]);
    wrap.appendChild(section(ctx, 'Links', [linkRows]));

    // ---- Indexability / canonical ----
    var idxRows = [];
    idxRows.push(keyVal(ctx, 'Canonical', d.canonical
      ? (d.canonical + (d.canonicalMatchesUrl ? '  ✓ self' : '  ⚠ differs from URL'))
      : '(none)', d.canonical ? (d.canonicalMatchesUrl ? 'ok' : 'warn') : 'warn'));
    idxRows.push(keyVal(ctx, 'Meta robots', d.robots || '(default: index,follow)',
      /noindex/i.test(d.robots || '') ? 'bad' : 'ok'));
    idxRows.push(keyVal(ctx, 'Viewport', d.viewport || '(missing)', d.viewport ? 'ok' : 'warn'));
    idxRows.push(keyVal(ctx, 'Lang', d.lang || '(not set)', d.lang ? 'ok' : 'warn'));
    idxRows.push(keyVal(ctx, 'Charset', d.charset || '(unknown)', 'int'));
    wrap.appendChild(section(ctx, 'Indexability', idxRows));

    // ---- Social / structured ----
    var og = d.openGraph || {};
    var tw = d.twitter || {};
    var socialRows = [];
    socialRows.push(keyVal(ctx, 'og:title', og['og:title'] || '(missing)', og['og:title'] ? 'ok' : 'warn'));
    socialRows.push(keyVal(ctx, 'og:description', og['og:description'] || '(missing)', og['og:description'] ? 'ok' : 'warn'));
    socialRows.push(keyVal(ctx, 'og:image', og['og:image'] || '(missing)', og['og:image'] ? 'ok' : 'warn'));
    socialRows.push(keyVal(ctx, 'twitter:card', tw['twitter:card'] || '(missing)', tw['twitter:card'] ? 'ok' : 'int'));
    wrap.appendChild(section(ctx, 'Social tags', socialRows));

    var jl = d.jsonLd || { count: 0, types: [] };
    wrap.appendChild(section(ctx, 'Structured data (JSON-LD)', [
      keyVal(ctx, 'Schema blocks', String(jl.count), jl.count ? 'ok' : 'warn'),
      keyVal(ctx, 'Types', jl.types.length ? jl.types.join(', ') : '(none detected)', jl.types.length ? 'ok' : 'int')
    ]));
  }

  // ---- small UI builders ----
  function section(ctx, title, children) {
    var sec = ctx.el('div', { class: 'op-section' });
    sec.appendChild(ctx.el('div', { class: 'op-title', text: title }));
    (children || []).forEach(function (c) { if (c) sec.appendChild(c); });
    return sec;
  }
  function valueRow(ctx, value, right) {
    var row = ctx.el('div', { class: 'op-valrow' });
    row.appendChild(ctx.el('div', { class: 'op-val', text: value }));
    if (right) row.appendChild(right);
    return row;
  }
  function keyVal(ctx, key, val, color) {
    var row = ctx.el('div', { class: 'op-kv' });
    row.appendChild(ctx.el('span', { class: 'op-k', text: key }));
    row.appendChild(ctx.el('span', { class: 'op-v ' + (color ? 'c-' + color : ''), text: val }));
    return row;
  }
  function badge(ctx, textStr, color) {
    var cls = 'pill ' + ({ ok: 'pill-ok', bad: 'pill-bad', warn: 'pill-warn', int: 'pill-int', unknown: 'pill-unknown' }[color] || 'pill-int');
    return ctx.el('span', { class: cls, text: textStr });
  }
  function stat(ctx, num, label, color) {
    return ctx.el('div', { class: 'op-stat' + (color ? ' ' + color : '') }, [
      ctx.el('span', { class: 'op-stat-n', text: String(num == null ? 0 : num) }),
      ctx.el('span', { class: 'op-stat-l', text: label })
    ]);
  }

  function exportCsv(ctx) {
    var d = state.data;
    if (!d) return;
    var wc = d.wordCount || {}, im = d.images || {}, lk = d.links || {}, hc = d.headingCounts || {};
    var rows = [['Element', 'Value']];
    rows.push(['URL', d.url]);
    rows.push(['Title', d.title.text]);
    rows.push(['Title length (chars)', d.title.length]);
    rows.push(['Meta description', d.metaDescription.text]);
    rows.push(['Meta description length (chars)', d.metaDescription.length]);
    rows.push(['Word count (p body text)', wc.paragraphs]);
    rows.push(['Paragraph elements', wc.paragraphElements]);
    rows.push(['Heading words', wc.headings]);
    rows.push(['All body words', wc.bodyText]);
    rows.push(['Reading time (min)', wc.readingTimeMin]);
    rows.push(['H1', hc.h1]); rows.push(['H2', hc.h2]); rows.push(['H3', hc.h3]);
    rows.push(['H4', hc.h4]); rows.push(['H5', hc.h5]); rows.push(['H6', hc.h6]);
    rows.push(['Images total', im.total]);
    rows.push(['Images missing alt', im.missingAlt]);
    rows.push(['Images empty alt', im.emptyAlt]);
    rows.push(['Links total', lk.total]);
    rows.push(['Links internal', lk.internal]);
    rows.push(['Links external', lk.external]);
    rows.push(['Links nofollow', lk.nofollow]);
    rows.push(['Canonical', d.canonical]);
    rows.push(['Meta robots', d.robots]);
    rows.push(['Viewport', d.viewport]);
    rows.push(['Lang', d.lang]);
    rows.push(['Charset', d.charset]);
    rows.push(['JSON-LD types', (d.jsonLd && d.jsonLd.types || []).join(' | ')]);
    Object.keys(d.openGraph || {}).forEach(function (k) { rows.push([k, d.openGraph[k]]); });
    Object.keys(d.twitter || {}).forEach(function (k) { rows.push([k, d.twitter[k]]); });

    var host = '';
    try { host = new URL(d.url).hostname; } catch (e) { host = 'page'; }
    window.SEO_CSV.download('seo-sidekick-onpage-' + host + '.csv', window.SEO_CSV.toCsv(rows));
  }

  window.SEO_TABS.onpage = { init: init };
})();
