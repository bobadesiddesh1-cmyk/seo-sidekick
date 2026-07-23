/**
 * popup/tabs/preview.js — Module 5 UI (Pixel-Width SERP Snippet Preview)
 * Registers window.SEO_TABS.preview = { init }.
 *
 * Auto-populates title + meta from the active tab, renders a pixel-accurate mock
 * SERP card in Shadow DOM, and shows live pixel + char width with truncation
 * markers (desktop + mobile for the description).
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var state = { ctx: null, snippet: null, shadow: null, loaded: false };

  function init(ctx) {
    state.ctx = ctx;
    var titleEl = ctx.qs('#preview-title');
    var descEl = ctx.qs('#preview-desc');

    titleEl.addEventListener('input', function () { update(ctx); });
    descEl.addEventListener('input', function () { update(ctx); });

    ctx.qs('#preview-copy-title').addEventListener('click', function () {
      copy(titleEl.value, ctx.qs('#preview-copy-title'));
    });
    ctx.qs('#preview-copy-desc').addEventListener('click', function () {
      copy(descEl.value, ctx.qs('#preview-copy-desc'));
    });

    buildShadow(ctx);
    if (!state.loaded) loadSnippet(ctx);
    else update(ctx);
  }

  async function loadSnippet(ctx) {
    state.loaded = true;
    var resp = await ctx.send({ type: 'read-snippet' });
    if (resp && resp.ok && resp.data) {
      state.snippet = resp.data;
      ctx.qs('#preview-title').value = resp.data.title || '';
      ctx.qs('#preview-desc').value = resp.data.description || '';
    }
    update(ctx);
  }

  function buildShadow(ctx) {
    var mount = ctx.qs('#preview-mount');
    if (mount.shadowRoot) { state.shadow = mount.shadowRoot; return; }
    var shadow = mount.attachShadow ? mount.attachShadow({ mode: 'open' }) : null;
    if (!shadow) return;
    state.shadow = shadow;
    shadow.innerHTML =
      '<style>' +
      ':host{all:initial;}' +
      '.card{font-family:arial,sans-serif;background:#fff;color:#202124;' +
      'border:1px solid #dadce0;border-radius:8px;padding:12px 14px;max-width:600px;}' +
      '.top{display:flex;align-items:center;gap:8px;margin-bottom:2px;}' +
      '.fav{width:26px;height:26px;border-radius:50%;background:#e8eaed;' +
      'display:flex;align-items:center;justify-content:center;overflow:hidden;}' +
      '.fav img{width:18px;height:18px;}' +
      '.fav .dot{width:12px;height:12px;border-radius:50%;background:#5f6368;}' +
      '.site{line-height:1.2;}' +
      '.site .name{font-size:14px;color:#202124;}' +
      '.site .url{font-size:12px;color:#4d5156;}' +
      '.title{color:#1a0dab;font-size:20px;line-height:1.3;margin:2px 0 3px;cursor:pointer;}' +
      '.title:hover{text-decoration:underline;}' +
      '.desc{color:#4d5156;font-size:14px;line-height:1.4;}' +
      '.trunc{color:#4d5156;}' +
      '@media (prefers-color-scheme: dark){' +
      '.card{background:#1f2430;border-color:#39404f;color:#e6e9ef;}' +
      '.site .name{color:#e6e9ef;}.site .url{color:#9aa3b2;}' +
      '.title{color:#8ab4f8;}.desc,.trunc{color:#bdc1c6;}' +
      '.fav{background:#39404f;}.fav .dot{background:#9aa3b2;}}' +
      '</style>' +
      '<div class="card">' +
      '<div class="top"><div class="fav" id="fav"><span class="dot"></span></div>' +
      '<div class="site"><div class="name" id="site-name">Example site</div>' +
      '<div class="url" id="site-url">https://example.com</div></div></div>' +
      '<div class="title" id="serp-title">Title preview</div>' +
      '<div class="desc" id="serp-desc">Description preview</div>' +
      '</div>';
  }

  function update(ctx) {
    var titleRaw = ctx.qs('#preview-title').value || '';
    var descRaw = ctx.qs('#preview-desc').value || '';
    var PX = window.SEO_PIXEL;

    // --- Title bar (desktop limit) ---
    var titlePx = PX.titleWidth(titleRaw);
    var titleLimit = PX.LIMITS.titleDesktopPx;
    setBar(ctx, '#preview-title-bar', '#preview-title-mark', titlePx, titleLimit, titleRaw, PX.TITLE_FONT);
    ctx.qs('#preview-title-meta').textContent =
      titlePx + 'px / ' + titleLimit + 'px · ' + titleRaw.length + ' chars';

    // --- Description bar (desktop + mobile guides) ---
    var descPx = PX.descWidth(descRaw);
    var descLimit = PX.LIMITS.descDesktopPx;
    setBar(ctx, '#preview-desc-bar', '#preview-desc-mark', descPx, descLimit, descRaw, PX.DESC_FONT);
    ctx.qs('#preview-desc-meta').textContent =
      descPx + 'px · desktop ' + descLimit + 'px / mobile ' + PX.LIMITS.descMobilePx +
      'px · ' + descRaw.length + ' chars';

    renderCard(ctx, titleRaw, descRaw);
  }

  function setBar(ctx, barSel, markSel, px, limit, text, font) {
    var bar = ctx.qs(barSel);
    var pct = Math.min(100, Math.round((px / limit) * 100));
    bar.style.width = pct + '%';
    var color = 'var(--ok)';
    if (px > limit) color = 'var(--bad)';
    else if (px > limit * 0.9) color = 'var(--warn)';
    bar.style.background = color;

    // Truncation marker: position where Google would cut (only if over limit).
    var mark = ctx.qs(markSel);
    if (px > limit) {
      mark.style.display = 'block';
      mark.style.left = '100%';
      mark.style.transform = 'translateX(-1px)';
    } else {
      mark.style.display = 'none';
    }
  }

  function renderCard(ctx, title, desc) {
    if (!state.shadow) return;
    var PX = window.SEO_PIXEL;
    var s = state.snippet || {};
    var host = s.host || 'example.com';
    var url = s.url || 'https://example.com';

    var nameEl = state.shadow.getElementById('site-name');
    var urlEl = state.shadow.getElementById('site-url');
    var titleEl = state.shadow.getElementById('serp-title');
    var descEl = state.shadow.getElementById('serp-desc');
    var favEl = state.shadow.getElementById('fav');

    if (nameEl) nameEl.textContent = prettyHost(host);
    if (urlEl) urlEl.textContent = breadcrumb(url);

    // Favicon.
    if (favEl && s.favicon) {
      favEl.innerHTML = '';
      var img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () { favEl.innerHTML = '<span class="dot"></span>'; };
      img.src = s.favicon;
      favEl.appendChild(img);
    }

    // Title truncation at desktop pixel limit.
    var tTrunc = PX.truncateToWidth(title || '(no title)', PX.LIMITS.titleDesktopPx, PX.TITLE_FONT);
    if (titleEl) {
      titleEl.textContent = tTrunc.text + (tTrunc.truncated ? ' …' : '');
    }

    // Description truncation at desktop pixel limit.
    var dTrunc = PX.truncateToWidth(desc || '(no description)', PX.LIMITS.descDesktopPx, PX.DESC_FONT);
    if (descEl) {
      descEl.textContent = dTrunc.text + (dTrunc.truncated ? ' …' : '');
    }
  }

  function prettyHost(h) {
    return String(h || '').replace(/^www\./, '');
  }

  function breadcrumb(u) {
    try {
      var url = new URL(u);
      var parts = url.pathname.split('/').filter(Boolean).slice(0, 3);
      var crumb = prettyHost(url.hostname);
      if (parts.length) crumb += ' › ' + parts.join(' › ');
      return crumb;
    } catch (e) { return u; }
  }

  function copy(text, btn) {
    var original = btn.textContent;
    function done(ok) {
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      setTimeout(function () { btn.textContent = original; }, 1400);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
      } else { fallback(); }
    } catch (e) { fallback(); }

    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e2) { done(false); }
    }
  }

  window.SEO_TABS.preview = { init: init };
})();
