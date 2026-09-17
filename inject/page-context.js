/**
 * inject/page-context.js — compact page context for on-device AI prompts.
 *
 * Gemini Nano has a small context window, so we never send the whole page.
 * This returns a curated extract: the SEO primitives, the heading outline, a
 * lead excerpt of the main content, any question-shaped headings, and the
 * images that are missing alt text (with nearby text to describe them from).
 *
 * Self-contained; assigns __SEO_pageContext. Never throws.
 */
(function () {
  'use strict';

  self.__SEO_pageContext = function () {
    function qa(sel) {
      try { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
      catch (e) { return []; }
    }
    function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
    function txt(el) {
      try { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
      catch (e) { return ''; }
    }
    function metaC(sel) { var el = q(sel); return el ? (el.getAttribute('content') || '').trim() : ''; }

    // --- main content root (same heuristic family as the on-page analyzer) ---
    var root = null;
    try { root = q('main') || q('[role="main"]') || q('article'); } catch (e) {}
    if (!root) {
      var best = null, bestLen = 0;
      qa('div, section').slice(0, 600).forEach(function (el) {
        var ps = el.getElementsByTagName('p');
        if (!ps.length) return;
        var len = 0;
        for (var i = 0; i < ps.length; i++) len += (ps[i].textContent || '').length;
        if (len > bestLen) { bestLen = len; best = el; }
      });
      root = best;
    }
    if (!root) root = document.body;

    // --- lead excerpt (~1400 chars of real prose) ---------------------------
    var excerpt = '', paras = [];
    try {
      var ps = root.getElementsByTagName('p');
      for (var i = 0; i < ps.length && excerpt.length < 1400; i++) {
        var t = txt(ps[i]);
        if (t.length < 40) continue;
        paras.push(t);
        excerpt += (excerpt ? ' ' : '') + t;
      }
      if (excerpt.length > 1400) excerpt = excerpt.slice(0, 1400) + '…';
    } catch (e) {}

    // --- longest paragraph (the one worth simplifying) ----------------------
    var longest = '';
    paras.forEach(function (p) { if (p.length > longest.length) longest = p; });
    if (longest.length > 700) longest = longest.slice(0, 700) + '…';

    // --- headings ------------------------------------------------------------
    var headings = [], questions = [];
    qa('h1, h2, h3').slice(0, 40).forEach(function (el) {
      var t = txt(el);
      if (!t) return;
      var lvl = parseInt(el.tagName.charAt(1), 10);
      if (headings.length < 25) headings.push({ level: lvl, text: t.slice(0, 120) });
      if (/\?\s*$/.test(t)) questions.push(t.slice(0, 160));
    });

    // --- existing Q&A pairs (for FAQPage generation) ------------------------
    var qa_pairs = [];
    try {
      qa('details').slice(0, 15).forEach(function (d) {
        var s = d.querySelector('summary');
        if (!s) return;
        var question = txt(s);
        var clone = d.cloneNode(true);
        var sm = clone.querySelector('summary');
        if (sm && sm.parentNode) sm.parentNode.removeChild(sm);
        var answer = txt(clone);
        if (question && answer) qa_pairs.push({ q: question.slice(0, 160), a: answer.slice(0, 400) });
      });
      if (!qa_pairs.length) {
        qa('h2, h3').forEach(function (h) {
          if (qa_pairs.length >= 10) return;
          var t = txt(h);
          if (!/\?\s*$/.test(t)) return;
          var a = '', n = h.nextElementSibling, guard = 0;
          while (n && guard++ < 3) {
            if (/^(P|UL|OL|DIV)$/.test(n.tagName)) { a = txt(n); break; }
            n = n.nextElementSibling;
          }
          if (t && a) qa_pairs.push({ q: t.slice(0, 160), a: a.slice(0, 400) });
        });
      }
    } catch (e) {}

    // --- images missing alt, with nearby text to describe them from ---------
    var images = [];
    try {
      qa('img').forEach(function (im) {
        if (images.length >= 12) return;
        var alt = im.getAttribute('alt');
        if (alt !== null && String(alt).trim() !== '') return;
        var src = im.currentSrc || im.getAttribute('src') || im.getAttribute('data-src') || '';
        var file = '';
        try { file = decodeURIComponent(src.split('?')[0].split('/').pop() || ''); } catch (e) { file = ''; }
        var near = '';
        try {
          var fig = im.closest ? im.closest('figure') : null;
          var cap = fig ? fig.querySelector('figcaption') : null;
          near = cap ? txt(cap) : txt(im.parentElement).slice(0, 200);
        } catch (e) {}
        images.push({ src: src.slice(0, 300), filename: file.slice(0, 120), nearby: near.slice(0, 200) });
      });
    } catch (e) {}

    var h1El = q('h1');
    return {
      url: location.href,
      host: location.hostname,
      lang: (document.documentElement && document.documentElement.getAttribute('lang')) || '',
      title: (document.title || '').slice(0, 300),
      metaDescription: metaC('meta[name="description"]').slice(0, 400),
      h1: txt(h1El).slice(0, 200),
      headings: headings,
      questionHeadings: questions.slice(0, 10),
      qaPairs: qa_pairs,
      excerpt: excerpt,
      longestParagraph: longest,
      images: images
    };
  };
})();
