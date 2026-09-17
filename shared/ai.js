/**
 * shared/ai.js — on-device AI layer (Chrome built-in Gemini Nano).
 *
 * Everything runs locally in the browser: no API key, no server, no cost, and
 * the "nothing leaves your browser" promise stays literally true.
 *
 * The rule engine still decides WHAT is broken and how severe it is — the model
 * is only ever asked to write the copy for one specific, already-diagnosed
 * issue. Small focused prompts, not "analyse this page".
 *
 * Generated output is then re-checked by the same deterministic rules that
 * found the issue (length limits, JSON validity), so bad output is caught
 * rather than shipped.
 *
 * Exposes window.SEO_AI:
 *   availability()            -> 'available'|'downloadable'|'downloading'|'unavailable'|'unsupported'
 *   run(taskName, ctx, opts)  -> { variants:[{text, ok, note}], raw }
 *   setEngine(fn)             -> override the model (used by tests)
 *   TASKS                     -> task definitions
 */
(function () {
  'use strict';

  var engine = null;     // test/alternate engine: async (promptText) => string
  var session = null;
  var cachedAvail = null;

  // The built-in API has shipped under a few shapes; probe each.
  function resolveApi() {
    try {
      if (typeof LanguageModel !== 'undefined' && LanguageModel && LanguageModel.create) return LanguageModel;
    } catch (e) {}
    try { if (self.ai && self.ai.languageModel) return self.ai.languageModel; } catch (e) {}
    try { if (self.ai && self.ai.assistant) return self.ai.assistant; } catch (e) {}
    return null;
  }

  function normalizeAvail(v) {
    if (v === 'readily' || v === 'available') return 'available';
    if (v === 'after-download' || v === 'downloadable') return 'downloadable';
    if (v === 'downloading') return 'downloading';
    return 'unavailable';
  }

  async function availability(force) {
    if (engine) return 'available';
    if (cachedAvail && !force) return cachedAvail;
    var api = resolveApi();
    if (!api) { cachedAvail = 'unsupported'; return cachedAvail; }
    try {
      var v;
      if (api.availability) v = await api.availability();
      else if (api.capabilities) { var c = await api.capabilities(); v = c && (c.available || c.availability); }
      cachedAvail = normalizeAvail(v);
    } catch (e) { cachedAvail = 'unavailable'; }
    return cachedAvail;
  }

  async function getSession() {
    if (session) return session;
    var api = resolveApi();
    if (!api) throw new Error('On-device AI is not available in this browser.');
    session = await api.create({
      initialPrompts: [{
        role: 'system',
        content: 'You are a concise technical SEO copywriter. Follow the requested output format exactly. Never add preamble, commentary, quotes or markdown fences.'
      }]
    });
    return session;
  }

  async function ask(promptText) {
    if (engine) return await engine(promptText);
    var s = await getSession();
    return await s.prompt(promptText);
  }

  function setEngine(fn) { engine = fn; cachedAvail = fn ? 'available' : null; session = null; }

  // ---- prompt helpers -----------------------------------------------------
  function pageBlock(c, opts) {
    opts = opts || {};
    var L = [];
    L.push('PAGE URL: ' + (c.url || ''));
    if (c.title) L.push('CURRENT TITLE: ' + c.title);
    if (opts.withMeta && c.metaDescription) L.push('CURRENT META DESCRIPTION: ' + c.metaDescription);
    if (c.h1) L.push('H1: ' + c.h1);
    if (opts.withHeadings && c.headings && c.headings.length) {
      L.push('HEADINGS: ' + c.headings.slice(0, 12).map(function (h) { return 'H' + h.level + ' ' + h.text; }).join(' | '));
    }
    if (c.excerpt) L.push('CONTENT: ' + c.excerpt.slice(0, opts.excerpt || 900));
    return L.join('\n');
  }

  // Small models are far more reliable with numbered lines than with JSON.
  function parseNumbered(out) {
    return String(out || '')
      .split(/\r?\n/)
      .map(function (l) { return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim(); })
      .map(function (l) { return l.replace(/^["'“”]+|["'“”]+$/g, '').trim(); })
      .filter(function (l) { return l.length > 0 && !/^(here are|sure|certainly|option)/i.test(l); });
  }
  function parseFirstLine(out) {
    var p = parseNumbered(out);
    return p.length ? [p[0]] : [];
  }
  function parseJsonish(out) {
    var s = String(out || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function lenCheck(min, max) {
    return function (t) {
      if (t.length < min) return { ok: false, note: t.length + ' chars — too short (aim ' + min + '–' + max + ')' };
      if (t.length > max) return { ok: false, note: t.length + ' chars — too long (aim ' + min + '–' + max + ')' };
      return { ok: true, note: t.length + ' chars' };
    };
  }

  // ---- task definitions ---------------------------------------------------
  var TASKS = {
    metaDescription: {
      label: 'Write meta descriptions',
      build: function (c) {
        return pageBlock(c, { withMeta: true }) +
          '\n\nWrite 3 alternative meta descriptions for this page.\n' +
          'Rules: each between 120 and 155 characters; plain sentence case; include the main topic naturally; no quotes; no numbering.\n' +
          'Output exactly 3 lines, one description per line, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(70, 160), max: 3
    },
    titleShorten: {
      label: 'Write shorter titles',
      build: function (c) {
        return pageBlock(c, {}) +
          '\n\nThe title above is too long. Write 3 shorter alternatives, each UNDER 60 characters, keeping the main keyword and meaning.\n' +
          'Output exactly 3 lines, one title per line, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(15, 60), max: 3
    },
    titleWrite: {
      label: 'Write page titles',
      build: function (c) {
        return pageBlock(c, { withHeadings: true }) +
          '\n\nThis page has no usable title tag. Write 3 SEO title tags for it, each 40–60 characters, describing the page accurately.\n' +
          'Output exactly 3 lines, one title per line, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(15, 60), max: 3
    },
    h1: {
      label: 'Write an H1',
      build: function (c) {
        return pageBlock(c, { withHeadings: true }) +
          '\n\nThis page has no H1. Write 3 candidate H1 headings that describe the main topic.\n' +
          'Output exactly 3 lines, one heading per line, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(10, 110), max: 3
    },
    tldr: {
      label: 'Write a TL;DR',
      build: function (c) {
        return pageBlock(c, { excerpt: 1200 }) +
          '\n\nWrite a "Key takeaways" summary of this page as 3 short bullet sentences a reader could scan in 10 seconds. ' +
          'Each bullet under 140 characters, factual, drawn only from the content above.\n' +
          'Output exactly 3 lines, one bullet per line, no bullet characters, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(20, 160), max: 3
    },
    questionHeadings: {
      label: 'Rewrite headings as questions',
      build: function (c) {
        var hs = (c.headings || []).filter(function (h) { return h.level >= 2 && !/\?\s*$/.test(h.text); })
          .slice(0, 6).map(function (h) { return h.text; });
        return 'PAGE TOPIC: ' + (c.h1 || c.title || '') +
          '\n\nHEADINGS:\n' + hs.map(function (h, i) { return (i + 1) + '. ' + h; }).join('\n') +
          '\n\nRewrite each heading above as the natural question a user would search for, keeping the same meaning. ' +
          'AI answer engines quote question-shaped headings.\n' +
          'Output one rewritten question per line, in the same order, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(10, 120), max: 6
    },
    simplify: {
      label: 'Simplify the hardest paragraph',
      build: function (c) {
        return 'PARAGRAPH:\n' + (c.longestParagraph || c.excerpt || '').slice(0, 700) +
          '\n\nRewrite the paragraph above at roughly a grade-9 reading level: shorter sentences, plain words, active voice. ' +
          'Keep every fact. Do not add new information.\n' +
          'Output only the rewritten paragraph.';
      },
      parse: function (o) { return [String(o || '').trim()]; }, verify: lenCheck(40, 1200), max: 1
    },
    openGraph: {
      label: 'Write Open Graph tags',
      build: function (c) {
        return pageBlock(c, { withMeta: true }) +
          '\n\nWrite social sharing text for this page.\n' +
          'Line 1: og:title, under 60 characters.\nLine 2: og:description, 100–150 characters.\n' +
          'Output exactly 2 lines, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(15, 160), max: 2
    },
    altText: {
      label: 'Write image alt text',
      build: function (c) {
        var imgs = (c.images || []).slice(0, 8);
        return 'PAGE TOPIC: ' + (c.h1 || c.title || '') +
          '\n\nIMAGES (filename — nearby text):\n' +
          imgs.map(function (im, i) { return (i + 1) + '. ' + (im.filename || '(no filename)') + ' — ' + (im.nearby || '(no caption)'); }).join('\n') +
          '\n\nWrite descriptive alt text for each image above, under 125 characters each, describing what the image shows. ' +
          'Do not start with "image of" or "picture of".\n' +
          'Output one alt text per line, in the same order, nothing else.';
      },
      parse: parseNumbered, verify: lenCheck(5, 125), max: 8
    },
    faqSchema: {
      label: 'Build FAQPage JSON-LD',
      build: function (c) {
        var pairs = (c.qaPairs || []).slice(0, 6);
        return 'QUESTIONS AND ANSWERS FOUND ON THE PAGE:\n' +
          pairs.map(function (p, i) { return (i + 1) + '. Q: ' + p.q + '\n   A: ' + p.a; }).join('\n') +
          '\n\nUsing ONLY the questions and answers above, output a schema.org FAQPage JSON-LD object. ' +
          'Shape: {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"...","acceptedAnswer":{"@type":"Answer","text":"..."}}]}\n' +
          'Output raw JSON only — no markdown fences, no commentary.';
      },
      parse: function (o) {
        var j = parseJsonish(o);
        return j ? [JSON.stringify(j, null, 2)] : [];
      },
      verify: function (t) {
        try {
          var j = JSON.parse(t);
          if (j['@type'] !== 'FAQPage') return { ok: false, note: 'not a FAQPage' };
          var me = j.mainEntity;
          if (!me || !me.length) return { ok: false, note: 'no questions' };
          var bad = me.some(function (Q) { return !Q || !Q.name || !Q.acceptedAnswer || !Q.acceptedAnswer.text; });
          if (bad) return { ok: false, note: 'a question is missing name or answer text' };
          return { ok: true, note: me.length + ' questions · valid FAQPage' };
        } catch (e) { return { ok: false, note: 'invalid JSON' }; }
      },
      max: 1, code: true
    },
    schemaDescription: {
      label: 'Write a schema description',
      build: function (c) {
        return pageBlock(c, {}) +
          '\n\nWrite one plain-text description of this page suitable for the schema.org "description" property. ' +
          '120–200 characters, factual, no marketing language.\nOutput one line only.';
      },
      parse: parseFirstLine, verify: lenCheck(60, 260), max: 1
    },

    // ---- intelligence over the whole issue list -----------------------------
    pageType: {
      label: 'Classify page type',
      build: function (c) {
        return pageBlock(c, { withHeadings: true, excerpt: 700 }) +
          '\n\nClassify this page as exactly one of: article, product, category, homepage, localbusiness, contact, other.\n' +
          'Output JSON only: {"type":"...","confidence":"high|medium|low","why":"one short sentence"}';
      },
      parse: function (o) { var j = parseJsonish(o); return j ? [JSON.stringify(j)] : []; },
      verify: function () { return { ok: true, note: '' }; }, max: 1, json: true
    },
    cluster: {
      label: 'Explain the root cause',
      build: function (c) {
        return 'A technical SEO audit of ' + (c.url || 'a page') + ' found these issues, grouped by theme:\n\n' +
          (c.clusterText || '') +
          '\n\nFor each theme, write ONE sentence naming the single upstream change that would resolve that whole group. ' +
          'Be concrete and technical. Output one sentence per theme, in the same order, nothing else.';
      },
      parse: parseNumbered, verify: function () { return { ok: true, note: '' }; }, max: 8
    }
  };

  async function run(taskName, ctx, opts) {
    opts = opts || {};
    var task = TASKS[taskName];
    if (!task) throw new Error('Unknown AI task: ' + taskName);
    var promptText = task.build(ctx || {});
    var raw = await ask(promptText);
    var items = (task.parse(raw) || []).slice(0, task.max || 3);
    var variants = items.map(function (t) {
      var v = task.verify ? task.verify(t) : { ok: true, note: '' };
      return { text: t, ok: !!v.ok, note: v.note || '' };
    });
    return { variants: variants, raw: raw, task: taskName, isCode: !!task.code, isJson: !!task.json };
  }

  window.SEO_AI = {
    availability: availability,
    run: run,
    setEngine: setEngine,
    TASKS: TASKS,
    _resolveApi: resolveApi
  };
})();
