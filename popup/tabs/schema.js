/**
 * popup/tabs/schema.js — dedicated Schema tab UI.
 * Auto-runs once on popup open. Registers window.SEO_TABS.schema = { init }.
 *
 * Four capabilities, in one place:
 *   A) Rich-result eligibility — detected types → Google rich results, REQUIRED
 *      vs recommended props, eligible / blocked with the exact missing fields.
 *   B) JSON inspector + @id graph — collapsible pretty JSON per block, an entity
 *      graph built from @id references, and broken-reference detection.
 *   C) Gap detector + templates — page features missing schema, each with a
 *      copy-paste JSON-LD template.
 *   D) Validation + deep links — errors/warnings + "Test in Google Rich Results"
 *      and "Schema.org Validator" buttons.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { data: null, running: false, ran: false, ctx: null };

  // Copy-paste JSON-LD templates for the gap detector (placeholders in {{ }}).
  var TEMPLATES = {
    BreadcrumbList: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com/" },
        { "@type": "ListItem", "position": 2, "name": "Category", "item": "https://example.com/category/" },
        { "@type": "ListItem", "position": 3, "name": "This Page", "item": "https://example.com/category/this-page/" }
      ]
    },
    FAQPage: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "Your question here?",
          "acceptedAnswer": { "@type": "Answer", "text": "The full answer, in plain text or basic HTML." } },
        { "@type": "Question", "name": "A second question?",
          "acceptedAnswer": { "@type": "Answer", "text": "Its answer." } }
      ]
    },
    Article: {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "Article headline (max ~110 chars)",
      "image": ["https://example.com/photo.jpg"],
      "datePublished": "2024-01-01T08:00:00+00:00",
      "dateModified": "2024-01-02T10:00:00+00:00",
      "author": { "@type": "Person", "name": "Author Name", "url": "https://example.com/author" },
      "publisher": { "@type": "Organization", "name": "Site Name",
        "logo": { "@type": "ImageObject", "url": "https://example.com/logo.png" } }
    },
    Product: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Product name",
      "image": ["https://example.com/product.jpg"],
      "description": "Short product description.",
      "brand": { "@type": "Brand", "name": "Brand" },
      "sku": "SKU-123",
      "offers": { "@type": "Offer", "price": "29.99", "priceCurrency": "USD",
        "availability": "https://schema.org/InStock", "url": "https://example.com/product" },
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.5", "reviewCount": "120" }
    },
    VideoObject: {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      "name": "Video title",
      "description": "What the video is about.",
      "thumbnailUrl": ["https://example.com/thumb.jpg"],
      "uploadDate": "2024-01-01T08:00:00+00:00",
      "duration": "PT1M30S",
      "contentUrl": "https://example.com/video.mp4",
      "embedUrl": "https://example.com/embed/123"
    },
    Organization: {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Company name",
      "url": "https://example.com",
      "logo": "https://example.com/logo.png",
      "sameAs": [
        "https://twitter.com/yourhandle",
        "https://www.linkedin.com/company/yourcompany"
      ]
    },
    WebSite: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "url": "https://example.com/",
      "potentialAction": {
        "@type": "SearchAction",
        "target": { "@type": "EntryPoint", "urlTemplate": "https://example.com/search?q={search_term_string}" },
        "query-input": "required name=search_term_string"
      }
    }
  };

  function init(ctx) {
    state.ctx = ctx;
    if (!state.ran) run(ctx, false);
    else if (state.data) render(ctx, state.data);
  }

  async function run(ctx, force) {
    if (state.running) return;
    if (state.ran && !force && state.data) { render(ctx, state.data); return; }
    state.running = true;
    state.ran = true;

    var status = ctx.qs('#schema-status');
    status.className = 'status busy';
    status.textContent = 'Analyzing structured data';
    ctx.qs('#schema-results').innerHTML = '';

    var resp = await ctx.send({ type: 'analyze-schema' });
    state.running = false;

    if (!resp || !resp.ok) {
      status.className = 'status err';
      status.textContent = (resp && resp.error) ? resp.error : 'Schema analysis failed.';
      return;
    }
    status.className = 'status';
    status.textContent = '';
    state.data = resp.data;
    render(ctx, resp.data);
  }

  function render(ctx, d) {
    var wrap = ctx.qs('#schema-results');
    wrap.innerHTML = '';
    if (!d) return;
    var el = ctx.el;
    var c = d.counts || {};

    // ---- Scorecards + deep-link actions ----
    wrap.appendChild(scorecards(ctx, d));
    wrap.appendChild(deepLinks(ctx, d));

    if (!d.formats.length) {
      wrap.appendChild(el('div', { class: 'sc-empty' }, [
        el('div', { class: 'sc-empty-i', html: infoSvg() }),
        el('div', {}, [
          el('div', { class: 'sc-empty-t', text: 'No structured data on this page' }),
          el('div', { class: 'sc-empty-s', text: 'No JSON-LD, Microdata or RDFa was found. The gap detector below suggests markup you could add.' })
        ])
      ]));
    }

    // A) Rich-result eligibility.
    wrap.appendChild(renderEligibility(ctx, d));
    // C) Gap detector + templates.
    wrap.appendChild(renderGaps(ctx, d));
    // B) Inspector + graph.
    wrap.appendChild(renderGraph(ctx, d));
    wrap.appendChild(renderInspector(ctx, d));
    // D) Validation.
    wrap.appendChild(renderValidation(ctx, d));
  }

  // ---- Scorecards --------------------------------------------------------
  function scorecards(ctx, d) {
    var el = ctx.el, c = d.counts || {};
    var grid = el('div', { class: 'sc-grid' });
    function card(num, label, tone) {
      return el('div', { class: 'sc-card ' + (tone || '') }, [
        el('div', { class: 'sc-num', text: String(num) }),
        el('div', { class: 'sc-lbl', text: label })
      ]);
    }
    grid.appendChild(card(c.eligible || 0, 'rich-result eligible', (c.eligible ? 'good' : 'muted')));
    grid.appendChild(card(c.blocked || 0, 'blocked (missing fields)', (c.blocked ? 'warn' : 'muted')));
    grid.appendChild(card(c.gaps || 0, 'opportunities', (c.gaps ? 'warn' : 'good')));
    grid.appendChild(card(c.errors || 0, 'errors', (c.errors ? 'bad' : 'good')));
    grid.appendChild(card(c.entities || 0, 'entities', 'muted'));
    grid.appendChild(card((d.formats || []).length ? d.formats.join(' · ') : '—', 'formats', 'muted'));
    return grid;
  }

  function deepLinks(ctx, d) {
    var el = ctx.el;
    var row = el('div', { class: 'sd-actions' });
    var testUrl = 'https://search.google.com/test/rich-results?url=' + encodeURIComponent(d.url || '');
    var valUrl = 'https://validator.schema.org/#url=' + encodeURIComponent(d.url || '');
    row.appendChild(linkBtn(ctx, 'Test in Google Rich Results', testUrl, googleSvg()));
    row.appendChild(linkBtn(ctx, 'Schema.org Validator', valUrl, checkSvg()));
    row.appendChild(actionBtn(ctx, 'Re-analyze', function () { run(ctx, true); }, refreshSvg()));
    if ((d.blocks || []).length) {
      row.appendChild(actionBtn(ctx, 'Export all JSON-LD', function () {
        var all = (d.blocks || []).map(function (b, i) {
          return '/* Block ' + (i + 1) + ' — ' + ((b.types || []).join(', ') || 'n/a') + (b.valid ? '' : ' (INVALID)') + ' */\n' +
            (b.valid && b.pretty ? b.pretty : b.raw);
        }).join('\n\n');
        window.SEO_CSV.downloadText('schema-all-' + hostOf(d) + '.json', all, 'application/json');
      }, downloadSvg()));
    }
    return row;
  }

  // ---- A) Rich-result eligibility ----------------------------------------
  function renderEligibility(ctx, d) {
    var el = ctx.el;
    var sec = block(ctx, 'Rich-result eligibility', 'Detected types mapped to Google rich results.');
    var list = d.eligibility || [];
    if (!list.length) {
      sec.appendChild(el('div', { class: 'sd-note', text: 'No rich-result eligible types detected on this page.' }));
      return sec;
    }
    list.forEach(function (e) {
      var card = el('div', { class: 'elig-card ' + (e.eligible ? 'ok' : 'blocked') });
      var head = el('div', { class: 'elig-head' }, [
        el('span', { class: 'elig-badge ' + (e.eligible ? 'ok' : 'blocked'),
          html: (e.eligible ? checkSvg() : xSvg()) }),
        el('div', { class: 'elig-titles' }, [
          el('div', { class: 'elig-t', text: e.label + (e.name ? ' — ' + e.name : '') }),
          el('div', { class: 'elig-s', text: e.eligible ? 'Eligible for rich results' : 'Blocked — ' + e.missingRequired.length + ' required field' + (e.missingRequired.length === 1 ? '' : 's') + ' missing' })
        ]),
        el('span', { class: 'elig-type', text: e.type })
      ]);
      card.appendChild(head);

      // Required props.
      var reqWrap = el('div', { class: 'prop-row' });
      reqWrap.appendChild(el('span', { class: 'prop-lab', text: 'Required' }));
      var reqChips = el('div', { class: 'prop-chips' });
      e.required.forEach(function (r) {
        reqChips.appendChild(el('span', { class: 'chip ' + (r.present ? 'chip-ok' : 'chip-bad'),
          html: (r.present ? tickSvg() : crossSvg()) + '<span>' + esc(ctx, r.name) + '</span>' }));
      });
      reqWrap.appendChild(reqChips);
      card.appendChild(reqWrap);

      // Recommended props.
      if (e.recommended && e.recommended.length) {
        var recWrap = el('div', { class: 'prop-row' });
        recWrap.appendChild(el('span', { class: 'prop-lab', text: 'Recommended' }));
        var recChips = el('div', { class: 'prop-chips' });
        e.recommended.forEach(function (r) {
          recChips.appendChild(el('span', { class: 'chip ' + (r.present ? 'chip-ok' : 'chip-warn'),
            html: (r.present ? tickSvg() : dashSvg()) + '<span>' + esc(ctx, r.name) + '</span>' }));
        });
        recWrap.appendChild(recChips);
        card.appendChild(recWrap);
      }
      sec.appendChild(card);
    });
    return sec;
  }

  // ---- C) Gap detector + templates ---------------------------------------
  function renderGaps(ctx, d) {
    var el = ctx.el;
    var sec = block(ctx, 'Schema opportunities', 'Page features that could carry structured data but don’t.');
    var gaps = d.gaps || [];
    if (!gaps.length) {
      sec.appendChild(el('div', { class: 'sd-note ok', text: '✓ No obvious gaps — the page features we detect already have matching schema.' }));
      return sec;
    }
    gaps.forEach(function (g) {
      var card = el('div', { class: 'gap-card sev-' + (g.severity || 'low') });
      card.appendChild(el('div', { class: 'gap-head' }, [
        el('span', { class: 'gap-sev', text: (g.severity === 'high' ? 'High' : g.severity === 'med' ? 'Medium' : 'Low') }),
        el('div', { class: 'gap-t', text: g.title })
      ]));
      card.appendChild(el('div', { class: 'gap-why', text: g.why }));
      var tpl = TEMPLATES[g.templateKey];
      if (tpl) {
        var pre = el('pre', { class: 'gap-code', text: JSON.stringify(tpl, null, 2) });
        var actions = el('div', { class: 'gap-actions' }, [
          actionBtn(ctx, 'Copy template', function () {
            copyText(scriptWrap(tpl));
            flash(ctx, this, 'Copied ✓');
          }, copySvg()),
          actionBtn(ctx, 'Download .json', function () {
            window.SEO_CSV.downloadText('schema-template-' + g.templateKey + '.json', scriptWrap(tpl), 'application/json');
          }, downloadSvg())
        ]);
        var box = el('details', { class: 'gap-tpl' });
        box.appendChild(el('summary', { text: 'Copy-paste JSON-LD template' }));
        box.appendChild(actions);
        box.appendChild(pre);
        card.appendChild(box);
      }
      sec.appendChild(card);
    });
    return sec;
  }

  function scriptWrap(obj) {
    return '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n<\/script>';
  }

  // ---- B) @id entity graph -----------------------------------------------
  function renderGraph(ctx, d) {
    var el = ctx.el;
    var g = d.graph || { nodes: [], edges: [], brokenRefs: [] };
    var sec = block(ctx, 'Entity graph (@id)', 'How the structured-data entities reference each other.');
    if (!g.nodes.length) {
      sec.appendChild(el('div', { class: 'sd-note', text: 'No JSON-LD entities to graph.' }));
      return sec;
    }
    if (g.brokenRefs && g.brokenRefs.length) {
      sec.appendChild(el('div', { class: 'sd-note bad',
        text: '⚠ ' + g.brokenRefs.length + ' broken @id reference' + (g.brokenRefs.length === 1 ? '' : 's') + ' — a node points to an @id not defined on this page.' }));
    }
    // Node list with in/out reference chips.
    var byIdx = {};
    g.nodes.forEach(function (n) { byIdx[n.idx] = n; });
    var incoming = {};
    (g.edges || []).forEach(function (e) { incoming[e.to] = (incoming[e.to] || 0) + 1; });
    var listWrap = el('div', { class: 'graph-list' });
    g.nodes.forEach(function (n) {
      var outs = (g.edges || []).filter(function (e) { return e.from === n.idx; });
      var node = el('div', { class: 'gnode' });
      node.appendChild(el('div', { class: 'gnode-head' }, [
        el('span', { class: 'gnode-type', text: n.label }),
        n.atId ? el('code', { class: 'gnode-id', text: shortId(n.atId) }) : el('span', { class: 'gnode-anon', text: '(no @id)' }),
        el('span', { class: 'gnode-blk', text: 'block ' + (n.block + 1) })
      ]));
      if (incoming[n.idx]) node.appendChild(el('div', { class: 'gnode-ref in', text: '← referenced by ' + incoming[n.idx] + ' node' + (incoming[n.idx] === 1 ? '' : 's') }));
      outs.forEach(function (e) {
        var tgt = byIdx[e.to];
        node.appendChild(el('div', { class: 'gnode-ref out', text: '→ ' + (tgt ? tgt.label : '?') + '  ' + shortId(e.id) }));
      });
      listWrap.appendChild(node);
    });
    sec.appendChild(listWrap);
    (g.brokenRefs || []).forEach(function (b) {
      sec.appendChild(el('div', { class: 'gbroken', text: b.fromType + ' → broken @id: ' + b.id }));
    });
    return sec;
  }

  // ---- B) JSON inspector -------------------------------------------------
  function renderInspector(ctx, d) {
    var el = ctx.el;
    var sec = block(ctx, 'JSON-LD inspector', 'Every JSON-LD block, formatted and syntax-highlighted.');
    var blocks = d.blocks || [];
    if (!blocks.length) {
      sec.appendChild(el('div', { class: 'sd-note', text: 'No JSON-LD blocks on this page.' }));
      return sec;
    }
    blocks.forEach(function (b, i) {
      var det = el('details', { class: 'insp' + (b.valid ? '' : ' invalid') });
      if (i === 0 && b.valid) det.setAttribute('open', '');
      var sum = el('summary', {}, [
        el('span', { class: 'insp-badge ' + (b.valid ? 'ok' : 'bad'), text: b.valid ? 'valid' : 'invalid' }),
        el('span', { class: 'insp-types', text: (b.types && b.types.length ? b.types.join(', ') : '(no @type)') }),
        el('span', { class: 'insp-n', text: 'Block ' + (i + 1) })
      ]);
      det.appendChild(sum);
      if (!b.valid) {
        det.appendChild(el('div', { class: 'sd-note bad', text: '⚠ ' + (b.error || 'Invalid JSON') }));
      }
      var actions = el('div', { class: 'insp-actions' }, [
        actionBtn(ctx, 'Copy', function () {
          copyText(b.valid && b.pretty ? b.pretty : b.raw);
          flash(ctx, this, 'Copied ✓');
        }, copySvg()),
        actionBtn(ctx, 'Download', function () {
          var name = 'schema-' + ((b.types && b.types[0]) || 'block') + '-' + (i + 1) + '.json';
          window.SEO_CSV.downloadText(name.replace(/[^\w.\-]+/g, '_'), (b.valid && b.pretty ? b.pretty : b.raw), 'application/json');
        }, downloadSvg())
      ]);
      det.appendChild(actions);
      var pre = el('pre', { class: 'insp-code' });
      pre.innerHTML = highlightJson(b.valid && b.pretty ? b.pretty : b.raw);
      det.appendChild(pre);
      sec.appendChild(det);
    });
    // Microdata / RDFa summary.
    if (d.microdata && d.microdata.count) {
      sec.appendChild(el('div', { class: 'sd-note', text: 'Microdata: ' + d.microdata.count + ' item(s)' + (d.microdata.types.length ? ' — ' + d.microdata.types.join(', ') : '') }));
    }
    if (d.rdfa && d.rdfa.count) {
      sec.appendChild(el('div', { class: 'sd-note', text: 'RDFa: ' + d.rdfa.count + ' node(s)' + (d.rdfa.types.length ? ' — ' + d.rdfa.types.join(', ') : '') }));
    }
    return sec;
  }

  // ---- D) Validation -----------------------------------------------------
  function renderValidation(ctx, d) {
    var el = ctx.el;
    var v = d.validation || [];
    var sec = block(ctx, 'Validation', 'Deeper checks beyond “does it parse”.');
    if (!v.length) {
      sec.appendChild(el('div', { class: 'sd-note ok', text: '✓ No validation issues found.' }));
      return sec;
    }
    var order = { error: 0, warn: 1, info: 2 };
    v.slice().sort(function (a, b) { return (order[a.level] || 3) - (order[b.level] || 3); })
      .forEach(function (item) {
        sec.appendChild(el('div', { class: 'val-row ' + item.level }, [
          el('span', { class: 'val-tag ' + item.level, text: item.level === 'error' ? 'ERROR' : item.level === 'warn' ? 'WARN' : 'INFO' }),
          el('span', { class: 'val-msg', text: item.msg })
        ]));
      });
    return sec;
  }

  // ---- JSON syntax highlighter (safe: escapes first, then wraps tokens) ---
  function highlightJson(src) {
    var s = String(src == null ? '' : src)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Strings (keys vs values), numbers, booleans, null.
    s = s.replace(/"(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?/g, function (m, _g, colon) {
      var cls = colon ? 'j-key' : 'j-str';
      return '<span class="' + cls + '">' + m.replace(/\s*:$/, '') + '</span>' + (colon ? ':' : '');
    });
    s = s.replace(/\b(true|false)\b/g, '<span class="j-bool">$1</span>');
    s = s.replace(/\bnull\b/g, '<span class="j-null">null</span>');
    s = s.replace(/(:\s*)(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g, '$1<span class="j-num">$2</span>');
    return s;
  }

  // ---- small builders ----------------------------------------------------
  function block(ctx, title, sub) {
    var sec = ctx.el('div', { class: 'sd-block' });
    sec.appendChild(ctx.el('div', { class: 'sd-block-head' }, [
      ctx.el('h3', { class: 'sd-block-t', text: title }),
      sub ? ctx.el('p', { class: 'sd-block-s', text: sub }) : null
    ]));
    return sec;
  }
  function linkBtn(ctx, label, href, svg) {
    var a = ctx.el('a', { class: 'sd-btn', href: href, target: '_blank', rel: 'noopener noreferrer' });
    a.innerHTML = svg + '<span>' + esc(ctx, label) + '</span>';
    return a;
  }
  function actionBtn(ctx, label, onClick, svg) {
    var b = ctx.el('button', { class: 'sd-btn' });
    b.innerHTML = (svg || '') + '<span>' + esc(ctx, label) + '</span>';
    b.addEventListener('click', onClick);
    return b;
  }
  function flash(ctx, btnEl, msg) {
    try {
      var span = btnEl.querySelector('span');
      if (!span) return;
      var old = span.textContent;
      span.textContent = msg;
      setTimeout(function () { span.textContent = old; }, 1200);
    } catch (e) {}
  }
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
  function shortId(id) {
    if (!id) return '';
    if (id.length <= 42) return id;
    return id.slice(0, 20) + '…' + id.slice(-18);
  }
  function hostOf(d) { try { return new URL(d.url).hostname; } catch (e) { return 'page'; } }
  function esc(ctx, s) { return ctx.escapeHtml(s); }

  // ---- inline SVGs -------------------------------------------------------
  function checkSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>'; }
  function xSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>'; }
  function tickSvg() { return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>'; }
  function crossSvg() { return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>'; }
  function dashSvg() { return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path></svg>'; }
  function copySvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'; }
  function downloadSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="M7 11l5 5 5-5"></path><path d="M4 21h16"></path></svg>'; }
  function refreshSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"></path><path d="M21 3v5h-5"></path></svg>'; }
  function googleSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>'; }
  function infoSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4M12 8h.01"></path></svg>'; }

  window.SEO_TABS.schema = { init: init };
})();
