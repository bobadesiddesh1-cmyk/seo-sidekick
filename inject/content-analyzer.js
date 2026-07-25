/**
 * inject/content-analyzer.js — Content intelligence + GEO extractability
 *
 * Self-contained. Assigns __SEO_runContentAnalyzer to a global. Analyzes the
 * page's MAIN content (same content-root logic as the on-page analyzer) and
 * returns:
 *   - extractability: an AI/GEO "quotability" score (0-100) + signals. These are
 *     the structural things LLMs/AI Overviews reward: answer-first structure,
 *     question headings, lists/tables, FAQ/HowTo schema, author + dates, stats,
 *     short paragraphs.
 *   - keywords: top unigrams / bigrams / trigrams (stopword-filtered) with counts
 *     and density, plus whether the top terms appear in title / H1 / meta.
 *   - readability: Flesch Reading Ease + grade level, avg sentence length,
 *     estimated passive-voice usage.
 *
 * Everything is read from the live DOM — no network. try/catch throughout.
 */
(function () {
  'use strict';

  self.__SEO_runContentAnalyzer = function () {
    // ---- helpers ------------------------------------------------------------
    function qa(sel, root) {
      try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
      catch (e) { return []; }
    }
    function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
    function textOf(el) { try { return (el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } }
    function visible(el) {
      try {
        var s = window.getComputedStyle(el); if (!s) return true;
        return !(s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') === 0);
      } catch (e) { return true; }
    }
    function tokens(str) {
      if (!str) return [];
      try { return (String(str).toLowerCase().match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)) || []; }
      catch (e) { return (String(str).toLowerCase().match(/[a-z0-9]+/g)) || []; }
    }

    var STOP = {};
    ('a an and are as at be but by for if in into is it no not of on or such that the their ' +
     'then there these they this to was will with i you he she we they them his her our your my me ' +
     'from up down out over under again further once here when where why how all any both each few ' +
     'more most other some can just also which who whom what been has have had do does did being were ' +
     'about above below off than too very s t don should now would could may might must shall its ' +
     'they’re it’s i’m you’re we’re that’s http https www com')
      .split(' ').forEach(function (w) { STOP[w] = 1; });

    // ---- content root (main/article/body) ----------------------------------
    var BOILER = /(^|[-_\s])(nav|menu|sidebar|footer|header|masthead|breadcrumb|comment|cookie|consent|banner|promo|advert|widget|share|social|related|newsletter|subscribe|modal|popup|toolbar|search|login)([-_\s]|$)/i;
    function isBoiler(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'nav' || tag === 'header' || tag === 'footer' || tag === 'aside' || tag === 'form') return true;
      var ci = ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || ''));
      return BOILER.test(ci) && !/article|post|content|entry|main|story/i.test(ci);
    }
    function inBoiler(el, stop) {
      var n = el;
      while (n && n !== stop && n.nodeType === 1) { if (isBoiler(n)) return true; n = n.parentElement; }
      return false;
    }
    var root = q('main') || q('[role="main"]');
    if (!root) {
      var best = null, bestLen = 0;
      qa('article, section, div').slice(0, 1500).forEach(function (c) {
        if (isBoiler(c)) return;
        var ps = qa('p', c), len = 0;
        ps.forEach(function (p) { if (!inBoiler(p, c)) { var t = textOf(p); if (t.length >= 20) len += t.length; } });
        if (c.tagName.toLowerCase() === 'article') len *= 1.15;
        if (len > bestLen) { bestLen = len; best = c; }
      });
      root = best;
    }
    if (!root) root = document.body || document.documentElement;

    // ---- gather content text + blocks --------------------------------------
    var paras = [];
    qa('p, li', root).forEach(function (p) {
      if (!visible(p) || inBoiler(p, root)) return;
      var t = textOf(p);
      if (t) paras.push(t);
    });
    var contentText = paras.join(' ');
    var contentTokens = tokens(contentText);
    var totalWords = contentTokens.length;

    // ---- keyword density: unigrams / bigrams / trigrams --------------------
    function ngrams(arr, n) {
      var map = {}, i, g, k, parts;
      for (i = 0; i + n <= arr.length; i++) {
        parts = arr.slice(i, i + n);
        if (n === 1 && (STOP[parts[0]] || parts[0].length < 3)) continue;
        if (n > 1) {
          // skip phrases that are entirely stopwords or start/end with one
          if (STOP[parts[0]] || STOP[parts[n - 1]]) continue;
        }
        k = parts.join(' ');
        map[k] = (map[k] || 0) + 1;
      }
      return Object.keys(map).map(function (key) {
        return { term: key, count: map[key], density: totalWords ? +(map[key] / totalWords * 100).toFixed(2) : 0 };
      }).sort(function (a, b) { return b.count - a.count; });
    }
    var unigrams = ngrams(contentTokens, 1).slice(0, 15);
    var bigrams = ngrams(contentTokens, 2).slice(0, 10);
    var trigrams = ngrams(contentTokens, 3).slice(0, 8);

    // Do the top terms appear in title / H1 / meta description?
    var titleT = tokens(textOf(q('title')));
    var h1El = q('h1'); var h1T = tokens(h1El ? textOf(h1El) : '');
    var descEl = q('meta[name="description"]'); var descT = tokens(descEl ? (descEl.getAttribute('content') || '') : '');
    function inArr(term, arr) { return arr.indexOf(term.split(' ')[0]) !== -1; }
    var topTerm = unigrams[0] ? unigrams[0].term : '';
    var placement = topTerm ? {
      term: topTerm,
      inTitle: inArr(topTerm, titleT),
      inH1: inArr(topTerm, h1T),
      inMeta: inArr(topTerm, descT)
    } : null;

    // ---- readability (Flesch) ----------------------------------------------
    function countSyllables(word) {
      word = word.toLowerCase().replace(/[^a-z]/g, '');
      if (!word) return 0;
      if (word.length <= 3) return 1;
      word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
      var m = word.match(/[aeiouy]{1,2}/g);
      return m ? m.length : 1;
    }
    var sentences = (contentText.match(/[^.!?]+[.!?]+/g) || []);
    var sentenceCount = Math.max(1, sentences.length);
    var wordCountR = Math.max(1, totalWords);
    var syllables = 0;
    contentTokens.forEach(function (w) { syllables += countSyllables(w); });
    var wps = wordCountR / sentenceCount;
    var spw = syllables / wordCountR;
    var flesch = Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10;
    var grade = Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10;
    // Rough passive-voice detection.
    var passiveMatches = (contentText.match(/\b(?:was|were|been|be|is|are|being)\s+\w+(?:ed|en)\b/gi) || []).length;

    function fleschLabel(f) {
      if (f >= 70) return 'Easy';
      if (f >= 50) return 'Fairly hard';
      if (f >= 30) return 'Hard';
      return 'Very hard';
    }

    // ---- GEO / AI extractability signals -----------------------------------
    var headings = qa('h1, h2, h3, h4, h5, h6', root).filter(function (h) { return visible(h) && !inBoiler(h, root); });
    var headingTexts = headings.map(textOf).filter(Boolean);
    var questionHeads = headingTexts.filter(function (t) {
      return /\?$/.test(t) || /^(how|what|why|when|who|where|which|is|are|can|do|does|should)\b/i.test(t);
    });
    var lists = qa('ul, ol', root).filter(function (l) { return visible(l) && !inBoiler(l, root); });
    var tables = qa('table', root).filter(function (t) { return visible(t) && !inBoiler(t, root); });
    var hasSummary = headingTexts.some(function (t) { return /\b(tl;?dr|summary|key takeaways|in short|at a glance|overview)\b/i.test(t); });

    // AI-relevant schema (FAQPage / HowTo / QAPage / Article author).
    var schemaFlags = { faq: false, howto: false, article: false, hasAuthor: false };
    qa('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var data = JSON.parse(s.textContent || '');
        JSON.stringify(data, function (k, v) {
          if (k === '@type') {
            var arr = Array.isArray(v) ? v : [v];
            arr.forEach(function (t) {
              t = String(t);
              if (/FAQPage/i.test(t)) schemaFlags.faq = true;
              if (/HowTo/i.test(t)) schemaFlags.howto = true;
              if (/(Article|BlogPosting|NewsArticle)/i.test(t)) schemaFlags.article = true;
            });
          }
          if (k === 'author' && v) schemaFlags.hasAuthor = true;
          return v;
        });
      } catch (e) {}
    });

    // Author / date signals in the DOM.
    var hasAuthor = schemaFlags.hasAuthor || !!q('[rel="author"], [itemprop="author"], .author, .byline, meta[name="author"]');
    var hasDate = !!q('time[datetime], [itemprop="datePublished"], meta[property="article:published_time"], meta[name="date"]');

    // Outbound (external) links = potential citations.
    var pageHost = location.hostname;
    var outbound = 0;
    qa('a[href]', root).forEach(function (a) {
      try { if (new URL(a.getAttribute('href'), location.href).hostname !== pageHost) outbound++; } catch (e) {}
    });

    // Stats / numbers density (numbers, %, $).
    var statHits = (contentText.match(/\b\d+(?:[.,]\d+)?%?\b|\$\d/g) || []).length;
    var avgParaWords = paras.length ? Math.round(totalWords / paras.length) : 0;

    // Score (weighted). Each signal contributes points toward 100.
    var signals = [];
    function sig(ok, label, pts, hint) { signals.push({ ok: !!ok, label: label, points: pts, hint: hint }); return ok ? pts : 0; }
    var score = 0, maxScore = 0;
    function add(ok, label, pts, hint) { maxScore += pts; score += sig(ok, label, pts, hint); }

    add(headings.length >= 3, 'Clear heading structure (3+ headings)', 12, 'Add descriptive H2/H3 sections.');
    add(questionHeads.length >= 1, 'Question-style headings (AEO)', 14, 'Phrase some headings as the questions users ask.');
    add(lists.length >= 1 || tables.length >= 1, 'Lists or tables present', 12, 'Add a list or comparison table — AI answers quote these.');
    add(hasSummary, 'TL;DR / summary / key takeaways', 12, 'Add a short summary or “Key takeaways” block near the top.');
    add(schemaFlags.faq || schemaFlags.howto, 'FAQ or HowTo schema', 14, 'Add FAQPage or HowTo structured data.');
    add(hasAuthor, 'Author byline (E-E-A-T)', 8, 'Show a clear author with credentials.');
    add(hasDate, 'Published/updated date', 6, 'Expose a visible published or updated date.');
    add(outbound >= 2, 'Cites external sources', 8, 'Link to 2+ authoritative sources.');
    add(statHits >= 3, 'Concrete stats / numbers', 8, 'Include specific figures and data points.');
    add(avgParaWords > 0 && avgParaWords <= 80, 'Short, scannable paragraphs', 6, 'Keep paragraphs under ~80 words.');

    var scorePct = maxScore ? Math.round(score / maxScore * 100) : 0;
    var grade100 = scorePct >= 80 ? 'A' : scorePct >= 65 ? 'B' : scorePct >= 50 ? 'C' : scorePct >= 35 ? 'D' : 'F';

    return {
      contentWords: totalWords,
      extractability: {
        score: scorePct,
        grade: grade100,
        signals: signals,
        detail: {
          headings: headings.length,
          questionHeadings: questionHeads.length,
          lists: lists.length,
          tables: tables.length,
          outboundLinks: outbound,
          statHits: statHits,
          avgParaWords: avgParaWords
        }
      },
      keywords: {
        unigrams: unigrams,
        bigrams: bigrams,
        trigrams: trigrams,
        placement: placement
      },
      readability: {
        flesch: flesch,
        fleschLabel: fleschLabel(flesch),
        grade: grade,
        avgSentenceWords: Math.round(wps * 10) / 10,
        sentences: sentenceCount,
        passiveApprox: passiveMatches
      }
    };
  };
})();
