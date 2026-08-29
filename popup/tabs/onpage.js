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

    // ---- Recommendations (this tab as a recommendation engine) ----
    if (window.SEO_RECO && window.SEO_RECO_RULES) {
      wrap.appendChild(window.SEO_RECO.section(ctx, 'Recommendations',
        'Prioritised on-page fixes for this page — each with copy-paste code.',
        window.SEO_RECO_RULES.onpage(d),
        { empty: '✓ On-page basics look solid — no issues found.' }));
    }

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

    // ---- Headings (full outline) ----
    var hc = d.headingCounts || {};
    var hgrid = el('div', { class: 'op-hgrid' });
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function (t) {
      var n = hc[t] || 0;
      var warn = (t === 'h1' && n !== 1);
      hgrid.appendChild(el('div', { class: 'op-hcell' + (warn ? ' warn' : '') }, [
        el('div', { class: 'n', text: String(n) }),
        el('div', { class: 'l', text: t.toUpperCase() })
      ]));
    });
    var hsec = section(ctx, 'Headings outline', [hgrid]);
    if (hc.h1 !== 1) {
      hsec.appendChild(el('div', { class: 'op-note ' + (hc.h1 === 0 ? 'bad' : 'warn'),
        text: hc.h1 === 0 ? 'No H1 found — every page should have exactly one H1.'
                          : 'Found ' + hc.h1 + ' H1 tags — a page should have exactly one.' }));
    }
    // Full outline in document order, indented by level, skipped levels flagged.
    var outline = d.headingOutline || [];
    if (!outline.length) {
      hsec.appendChild(el('div', { class: 'op-note', text: 'No headings found on this page.' }));
    } else {
      var tree = el('div', { class: 'hd-tree' });
      outline.forEach(function (h) {
        var row = el('div', { class: 'hd-row' + (h.skipped ? ' skipped' : ''), style: 'padding-left:' + ((h.level - 1) * 16) + 'px;' }, [
          el('span', { class: 'hd-tag l' + h.level, text: 'H' + h.level }),
          el('span', { class: 'hd-text', text: h.text })
        ]);
        tree.appendChild(row);
        if (h.skipped) tree.appendChild(el('div', { class: 'op-note warn', style: 'padding-left:' + ((h.level - 1) * 16) + 'px;',
          text: '⚠ level skipped (jumps to H' + h.level + ')' }));
      });
      hsec.appendChild(tree);
    }
    wrap.appendChild(hsec);

    // ---- Links (with full inventory) ----
    wrap.appendChild(renderLinks(ctx, d.links || {}));

    // ---- Images (with full inventory) ----
    wrap.appendChild(renderImages(ctx, d.images || {}));

    // ---- Indexability / canonical ----
    var idxRows = [];
    // Canonical: show the URL actually in the tag AND the URL that should be
    // there (this page's own URL) whenever it's missing or points elsewhere.
    var selfUrl = selfCanonical(d.url);
    idxRows.push(keyVal(ctx, 'Canonical (current)', d.canonical || '(none)',
      d.canonical ? (d.canonicalMatchesUrl ? 'ok' : 'warn') : 'warn'));
    if (!d.canonical || !d.canonicalMatchesUrl) {
      idxRows.push(keyVal(ctx, 'Canonical (recommended)', selfUrl, 'ok'));
    } else {
      idxRows.push(keyVal(ctx, 'Canonical', 'self-referencing ✓', 'ok'));
    }
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

    wrap.appendChild(renderStructuredData(ctx, d.structuredData));
  }

  // ---- Links inventory ----
  function renderLinks(ctx, lk) {
    var el = ctx.el;
    var list = lk.list || [];
    var sec = section(ctx, 'Links', [
      el('div', { class: 'op-inline' }, [
        stat(ctx, lk.total, 'total'),
        stat(ctx, lk.unique, 'unique'),
        stat(ctx, lk.internal, 'internal'),
        stat(ctx, lk.external, 'external'),
        stat(ctx, lk.nofollow, 'nofollow', lk.nofollow ? 'warn' : '')
      ])
    ]);

    // Export buttons.
    var exportRow = el('div', { class: 'row', style: 'margin:8px 0 4px;' }, [
      miniBtn(ctx, 'Export all links', function () { exportLinks(ctx, list, 'all'); }),
      miniBtn(ctx, 'Export links w/o anchor', function () { exportLinks(ctx, list, 'incomplete'); })
    ]);
    sec.appendChild(exportRow);

    if (lk.truncated) sec.appendChild(el('div', { class: 'op-note', text: 'List capped at ' + list.length + ' links.' }));

    // Filter tabs (Internal / External) + list.
    var state2 = { filter: 'internal' };
    var tabs = el('div', { class: 'sub-tabs' });
    var listWrap = el('div', { class: 'inv-list' });
    function draw() {
      listWrap.innerHTML = '';
      var items = list.filter(function (l) { return l.type === state2.filter; });
      if (!items.length) { listWrap.appendChild(el('div', { class: 'op-note', text: 'No ' + state2.filter + ' links.' })); return; }
      items.slice(0, 200).forEach(function (l) {
        var row = el('div', { class: 'inv-row', title: l.href });
        row.appendChild(el('a', { class: 'inv-href', href: l.href, target: '_blank', rel: 'noreferrer', text: l.display || l.href }));
        row.appendChild(el('div', { class: 'inv-sub' + (l.hasAnchor ? '' : ' warn') },
          [document.createTextNode(l.anchor || '(no anchor text)')]));
        if (l.nofollow) row.appendChild(el('span', { class: 'pill pill-warn', text: 'nofollow' }));
        listWrap.appendChild(row);
      });
      if (items.length > 200) listWrap.appendChild(el('div', { class: 'op-note', text: '…and ' + (items.length - 200) + ' more (use export for the full list).' }));
    }
    [['internal', 'Internal'], ['external', 'External']].forEach(function (f) {
      var b = el('button', { class: 'sub-tab' + (state2.filter === f[0] ? ' active' : ''), text: f[1] });
      b.addEventListener('click', function () {
        state2.filter = f[0];
        ctx.qsa('.sub-tab', tabs).forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        draw();
      });
      tabs.appendChild(b);
    });
    sec.appendChild(tabs);
    sec.appendChild(listWrap);
    draw();
    return sec;
  }

  function exportLinks(ctx, list, mode) {
    var rows = [['Type', 'URL', 'Anchor text', 'Nofollow']];
    list.forEach(function (l) {
      if (mode === 'incomplete' && l.hasAnchor) return;
      rows.push([l.type, l.href, l.anchor, l.nofollow ? 'yes' : 'no']);
    });
    var host = hostOf(ctx);
    window.SEO_CSV.download('seo-sidekick-links-' + mode + '-' + host + '.csv', window.SEO_CSV.toCsv(rows));
  }

  // ---- Images inventory ----
  function renderImages(ctx, im) {
    var el = ctx.el;
    var list = im.list || [];
    var sec = section(ctx, 'Images', [
      el('div', { class: 'op-inline' }, [
        stat(ctx, im.total, 'images'),
        stat(ctx, im.missingAlt, 'without alt', im.missingAlt ? 'bad' : 'ok'),
        stat(ctx, im.emptyAlt, 'empty alt', im.emptyAlt ? 'warn' : ''),
        stat(ctx, im.withoutTitle, 'without title', im.withoutTitle ? 'warn' : 'ok')
      ])
    ]);

    var exportRow = el('div', { class: 'row', style: 'margin:8px 0 4px;' }, [
      miniBtn(ctx, 'Export all images', function () { exportImages(ctx, list, 'all'); }),
      miniBtn(ctx, 'Export incomplete', function () { exportImages(ctx, list, 'incomplete'); })
    ]);
    sec.appendChild(exportRow);

    if (im.truncated) sec.appendChild(el('div', { class: 'op-note', text: 'List capped at ' + list.length + ' images.' }));

    var state2 = { filter: 'noalt' };
    var tabs = el('div', { class: 'sub-tabs' });
    var listWrap = el('div', { class: 'inv-list' });
    function draw() {
      listWrap.innerHTML = '';
      var items = list.filter(function (im2) {
        return state2.filter === 'noalt' ? !im2.hasAlt : im2.hasAlt;
      });
      if (!items.length) { listWrap.appendChild(el('div', { class: 'op-note', text: 'None.' })); return; }
      items.slice(0, 150).forEach(function (img) {
        var row = el('div', { class: 'inv-row img-row', title: img.src });
        var thumb = el('img', { class: 'inv-thumb', loading: 'lazy', referrerpolicy: 'no-referrer' });
        thumb.src = img.src;
        thumb.onerror = function () { thumb.style.visibility = 'hidden'; };
        row.appendChild(thumb);
        var meta = el('div', { class: 'inv-imgmeta' }, [
          el('a', { class: 'inv-href', href: img.src, target: '_blank', rel: 'noreferrer', text: img.src }),
          el('div', { class: 'inv-sub' }, [
            el('span', { class: 'pill ' + (img.hasAlt ? 'pill-ok' : 'pill-bad'), text: img.hasAlt ? 'alt' : 'no alt' }),
            document.createTextNode(' '),
            el('span', { class: 'pill ' + (img.hasTitle ? 'pill-ok' : 'pill-int'), text: img.hasTitle ? 'title' : 'no title' }),
            img.hasAlt ? document.createTextNode('  ' + (img.alt || '')) : null
          ])
        ]);
        row.appendChild(meta);
        listWrap.appendChild(row);
      });
      if (items.length > 150) listWrap.appendChild(el('div', { class: 'op-note', text: '…and ' + (items.length - 150) + ' more (use export for the full list).' }));
    }
    [['noalt', 'Without alt'], ['withalt', 'With alt']].forEach(function (f) {
      var b = el('button', { class: 'sub-tab' + (state2.filter === f[0] ? ' active' : ''), text: f[1] });
      b.addEventListener('click', function () {
        state2.filter = f[0];
        ctx.qsa('.sub-tab', tabs).forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        draw();
      });
      tabs.appendChild(b);
    });
    sec.appendChild(tabs);
    sec.appendChild(listWrap);
    draw();
    return sec;
  }

  function exportImages(ctx, list, mode) {
    var rows = [['Image URL', 'Alt', 'Has alt', 'Title', 'Has title']];
    list.forEach(function (img) {
      var complete = img.hasAlt && img.hasTitle;
      if (mode === 'incomplete' && complete) return;
      rows.push([img.src, img.alt == null ? '' : img.alt, img.hasAlt ? 'yes' : 'no', img.title || '', img.hasTitle ? 'yes' : 'no']);
    });
    var host = hostOf(ctx);
    window.SEO_CSV.download('seo-sidekick-images-' + mode + '-' + host + '.csv', window.SEO_CSV.toCsv(rows));
  }

  function hostOf(ctx) {
    try { return new URL(ctx.activeTab.url).hostname; } catch (e) { return 'page'; }
  }
  function miniBtn(ctx, label, onClick) {
    var b = ctx.el('button', { class: 'btn btn-ghost mini-btn', text: label });
    b.addEventListener('click', onClick);
    return b;
  }

  function renderStructuredData(ctx, sd) {
    var el = ctx.el;
    sd = sd || { formats: [], jsonLd: { itemCount: 0, blocks: [], types: [], invalid: 0 }, microdata: { count: 0, types: [] }, rdfa: { count: 0, types: [] } };
    var sec = section(ctx, 'Structured data (schema.org)', []);

    // Format summary line.
    var formatsLine = el('div', { class: 'op-kv' });
    formatsLine.appendChild(el('span', { class: 'op-k', text: 'Formats found' }));
    formatsLine.appendChild(el('span', {
      class: 'op-v ' + (sd.formats.length ? 'c-ok' : 'c-warn'),
      text: sd.formats.length ? sd.formats.join(', ') : '(none detected)'
    }));
    sec.appendChild(formatsLine);

    if (!sd.formats.length) {
      sec.appendChild(el('div', { class: 'op-note warn',
        text: 'No JSON-LD, Microdata or RDFa found. Structured data helps Google show rich results.' }));
      return sec;
    }

    var jl = sd.jsonLd || {};
    // JSON-LD blocks — each with its type(s), warnings, and a DOWNLOAD icon that
    // saves that block's raw JSON as a .json file.
    if (jl.blockCount) {
      sec.appendChild(el('div', { class: 'op-title', style: 'margin-top:8px;',
        text: 'JSON-LD · ' + (jl.blockCount || 0) + ' block(s)' + (jl.invalid ? ' · ' + jl.invalid + ' invalid' : '') }));
      (jl.scripts || []).forEach(function (b, i) {
        var bad = !b.valid || (b.warnings && b.warnings.length);
        var card = el('div', { class: 'sd-item' + (bad ? ' warn' : '') });
        var typeLabel = !b.valid ? '⚠ invalid block' : (b.types.join(', ') || '(no @type)');
        var dl = el('button', {
          class: 'sd-dl', title: 'Download this schema block (.json)',
          'aria-label': 'Download schema block'
        });
        dl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="M7 11l5 5 5-5"></path><path d="M4 21h16"></path></svg>';
        (function (block, idx) {
          dl.addEventListener('click', function () {
            var text = block.valid && block.pretty ? block.pretty : block.raw;
            var name = 'schema-' + (block.types[0] || 'block') + '-' + (idx + 1) + '.json';
            window.SEO_CSV.downloadText(name.replace(/[^\w.\-]+/g, '_'), text, 'application/json');
          });
        })(b, i);
        card.appendChild(el('div', { class: 'sd-head' }, [
          el('span', { class: 'sd-type', text: typeLabel }), dl
        ]));
        (b.warnings || []).forEach(function (w) {
          card.appendChild(el('div', { class: 'sd-warn', text: '⚠ ' + w }));
        });
        if (b.valid && (!b.warnings || !b.warnings.length)) {
          card.appendChild(el('div', { class: 'sd-ok', text: '✓ valid · has recommended properties' }));
        }
        sec.appendChild(card);
      });
      // Export ALL schema blocks in one file.
      if ((jl.scripts || []).length) {
        sec.appendChild(miniBtn(ctx, 'Export all schema (.json)', function () {
          var all = (jl.scripts || []).map(function (b, i) {
            return '/* Block ' + (i + 1) + ' — ' + (b.types.join(', ') || 'n/a') + (b.valid ? '' : ' (INVALID)') + ' */\n' +
              (b.valid && b.pretty ? b.pretty : b.raw);
          }).join('\n\n');
          window.SEO_CSV.downloadText('schema-all-' + hostOf(ctx) + '.json', all, 'application/json');
        }));
      }
    }

    // Microdata + RDFa summaries.
    if (sd.microdata && sd.microdata.count) {
      sec.appendChild(keyVal(ctx, 'Microdata items', sd.microdata.count +
        (sd.microdata.types.length ? '  (' + sd.microdata.types.join(', ') + ')' : ''), 'ok'));
    }
    if (sd.rdfa && sd.rdfa.count) {
      sec.appendChild(keyVal(ctx, 'RDFa items', sd.rdfa.count +
        (sd.rdfa.types.length ? '  (' + sd.rdfa.types.join(', ') + ')' : ''), 'ok'));
    }
    return sec;
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
    var sd = d.structuredData || {};
    rows.push(['Structured data formats', (sd.formats || []).join(' | ')]);
    rows.push(['JSON-LD types', ((sd.jsonLd && sd.jsonLd.types) || []).join(' | ')]);
    rows.push(['JSON-LD items', (sd.jsonLd && sd.jsonLd.itemCount) || 0]);
    rows.push(['JSON-LD invalid blocks', (sd.jsonLd && sd.jsonLd.invalid) || 0]);
    rows.push(['Microdata items', (sd.microdata && sd.microdata.count) || 0]);
    rows.push(['Microdata types', ((sd.microdata && sd.microdata.types) || []).join(' | ')]);
    rows.push(['RDFa items', (sd.rdfa && sd.rdfa.count) || 0]);
    rows.push(['RDFa types', ((sd.rdfa && sd.rdfa.types) || []).join(' | ')]);
    // Schema validation warnings (missing recommended properties, invalid JSON).
    var sdWarn = [];
    ((sd.jsonLd && sd.jsonLd.scripts) || []).forEach(function (b) {
      (b.warnings || []).forEach(function (w) { sdWarn.push(w); });
    });
    rows.push(['Schema warnings', sdWarn.join(' | ')]);
    Object.keys(d.openGraph || {}).forEach(function (k) { rows.push([k, d.openGraph[k]]); });
    Object.keys(d.twitter || {}).forEach(function (k) { rows.push([k, d.twitter[k]]); });

    var host = '';
    try { host = new URL(d.url).hostname; } catch (e) { host = 'page'; }
    window.SEO_CSV.download('seo-sidekick-onpage-' + host + '.csv', window.SEO_CSV.toCsv(rows));
  }

  // Recommendation logic lives in shared/reco-rules.js (SEO_RECO_RULES.onpage).
  // This local helper is only for the Indexability display (current vs recommended).
  function selfCanonical(u) {
    try { var x = new URL(u); x.hash = ''; return x.href; } catch (e) { return u || ''; }
  }

  window.SEO_TABS.onpage = { init: init };
})();
