/**
 * popup/tabs/ai.js — Module 8 (AI Search / GEO readiness + content intelligence)
 * Registers window.SEO_TABS.ai = { init }.
 *
 * Three sections:
 *  1. AI bot access — fetches robots.txt and reports which AI crawlers are
 *     allowed/blocked (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, …),
 *     and whether an llms.txt exists.
 *  2. Extractability / GEO score — from the injected content analyzer.
 *  3. Content intelligence — keyword density (uni/bi/tri-grams) + readability.
 *
 * Runs on button click (fetches robots.txt); the content analysis is fast.
 */
(function () {
  'use strict';
  window.SEO_TABS = window.SEO_TABS || {};

  var AI_BOTS = [
    ['GPTBot', 'OpenAI (ChatGPT training/crawl)'],
    ['OAI-SearchBot', 'OpenAI (ChatGPT Search)'],
    ['ChatGPT-User', 'ChatGPT browsing'],
    ['ClaudeBot', 'Anthropic (Claude crawl)'],
    ['Claude-Web', 'Anthropic (Claude browsing)'],
    ['PerplexityBot', 'Perplexity'],
    ['Google-Extended', 'Google (Gemini/Vertex training)'],
    ['Applebot-Extended', 'Apple Intelligence'],
    ['CCBot', 'Common Crawl (feeds many LLMs)'],
    ['Bytespider', 'ByteDance / TikTok'],
    ['Amazonbot', 'Amazon'],
    ['Meta-ExternalAgent', 'Meta AI']
  ];

  var state = { ctx: null, running: false, data: null };

  function init(ctx) {
    state.ctx = ctx;
    ctx.qs('#ai-run').addEventListener('click', function () { run(ctx); });
    if (state.data) render(ctx, state.data);
  }

  function activeUrl(ctx) { return ctx.activeTab && ctx.activeTab.url ? ctx.activeTab.url : ''; }

  async function run(ctx) {
    if (state.running) return;
    var url = activeUrl(ctx);
    if (!/^https?:\/\//i.test(url)) {
      setStatus(ctx, 'Open a normal website tab to analyze.', true); return;
    }
    state.running = true;
    setStatus(ctx, 'Analyzing AI readiness', false);
    ctx.qs('#ai-run').disabled = true;
    ctx.qs('#ai-results').innerHTML = '';

    var origin = '';
    try { origin = new URL(url).origin; } catch (e) {}

    // Parallel: content analysis (inject) + robots.txt + llms.txt (network).
    var results = await Promise.all([
      ctx.send({ type: 'analyze-content' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/robots.txt' }),
      ctx.send({ type: 'fetch-resource', url: origin + '/llms.txt', method: 'HEAD' })
    ]);

    state.running = false;
    ctx.qs('#ai-run').disabled = false;

    var content = results[0] && results[0].ok ? results[0].data : null;
    var robots = results[1] && results[1].ok ? results[1].data : null;
    var llms = results[2] && results[2].ok ? results[2].data : null;

    if (!content && (!robots || robots.status === 0)) {
      setStatus(ctx, 'Could not analyze this page.', true);
      return;
    }
    setStatus(ctx, '', false);
    state.data = { content: content, robots: robots, llms: llms, url: url, path: pathOf(url) };
    render(ctx, state.data);
  }

  function pathOf(url) { try { return new URL(url).pathname || '/'; } catch (e) { return '/'; } }

  // Parse robots.txt into user-agent groups → rules.
  function parseRobots(txt) {
    var groups = []; // { agents:[], rules:[{allow, path}] }
    var cur = null, lastWasAgent = false;
    (txt || '').split(/\r?\n/).forEach(function (line) {
      line = line.replace(/#.*$/, '').trim();
      if (!line) return;
      var idx = line.indexOf(':'); if (idx < 0) return;
      var field = line.slice(0, idx).trim().toLowerCase();
      var value = line.slice(idx + 1).trim();
      if (field === 'user-agent') {
        if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
        cur.agents.push(value.toLowerCase());
        lastWasAgent = true;
      } else if (field === 'allow' || field === 'disallow') {
        if (!cur) { cur = { agents: ['*'], rules: [] }; groups.push(cur); }
        cur.rules.push({ allow: field === 'allow', path: value });
        lastWasAgent = false;
      } else { lastWasAgent = false; }
    });
    return groups;
  }

  // Decide if a path is allowed for a given user-agent token (basic robots.txt
  // semantics: most-specific UA group, then longest-matching rule; Allow wins
  // ties; an empty Disallow means "allow everything").
  function robotsAllows(groups, uaToken, path) {
    uaToken = uaToken.toLowerCase();
    var group = null;
    groups.forEach(function (g) { if (g.agents.indexOf(uaToken) !== -1) group = g; });
    if (!group) groups.forEach(function (g) { if (!group && g.agents.indexOf('*') !== -1) group = g; });
    if (!group) return { allowed: true };

    var best = null;
    group.rules.forEach(function (r) {
      if (r.path === '' && !r.allow) return;    // empty Disallow: allow all
      if (matchRule(r.path, path)) {
        if (!best || r.path.length > best.path.length ||
            (r.path.length === best.path.length && r.allow)) best = r;
      }
    });
    if (!best) return { allowed: true };
    return { allowed: best.allow };
  }

  // Match a robots path pattern (supports * wildcard and trailing $) against path.
  function matchRule(rule, path) {
    if (rule === '') return false;
    var hasEnd = rule.slice(-1) === '$';
    var body = hasEnd ? rule.slice(0, -1) : rule;
    var re = '^' + body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (hasEnd ? '$' : '');
    try { return new RegExp(re).test(path); }
    catch (e) { return path.indexOf(body.replace(/\*.*$/, '')) === 0; }
  }

  function render(ctx, d) {
    var el = ctx.el, esc = ctx.escapeHtml;
    var wrap = ctx.qs('#ai-results');
    wrap.innerHTML = '';

    // ---- Extractability score ----
    var c = d.content;
    if (c && c.extractability) {
      var ex = c.extractability;
      var card = el('div', { class: 'psi-scorecard' });
      card.innerHTML =
        '<div class="psi-score c-' + gradeColor(ex.score) + '">' + ex.score + '</div>' +
        '<div class="psi-score-lbl">AI extractability<br><span>grade ' + esc(ex.grade) + '</span></div>';
      wrap.appendChild(card);

      var sigSec = section(ctx, 'What AI answers reward', []);
      ex.signals.forEach(function (s) {
        var row = el('div', { class: 'ai-sig' }, [
          el('span', { class: 'ai-sig-ico c-' + (s.ok ? 'ok' : 'bad'), text: s.ok ? '✓' : '✗' }),
          el('span', { class: 'ai-sig-lbl', text: s.label }),
          el('span', { class: 'ai-sig-pts', text: '+' + s.points })
        ]);
        sigSec.appendChild(row);
        if (!s.ok && s.hint) sigSec.appendChild(el('div', { class: 'ai-hint', text: '→ ' + s.hint }));
      });
      wrap.appendChild(sigSec);
    }

    // ---- AI bot access ----
    var botSec = section(ctx, 'AI crawler access (robots.txt)', []);
    if (!d.robots || d.robots.status === 0) {
      botSec.appendChild(el('div', { class: 'op-note warn', text: 'Could not fetch robots.txt.' }));
    } else if (d.robots.status === 404) {
      botSec.appendChild(el('div', { class: 'op-note', text: 'No robots.txt (404) — all crawlers, including AI bots, are allowed by default.' }));
    } else {
      var groups = parseRobots(d.robots.body);
      var grid = el('div', { class: 'ai-bots' });
      AI_BOTS.forEach(function (b) {
        var v = robotsAllows(groups, b[0], d.path);
        grid.appendChild(el('div', { class: 'ai-bot' }, [
          el('span', { class: 'pill ' + (v.allowed ? 'pill-ok' : 'pill-bad'), text: v.allowed ? 'allowed' : 'blocked' }),
          el('span', { class: 'ai-bot-name', text: b[0], title: b[1] })
        ]));
      });
      botSec.appendChild(grid);
    }
    // llms.txt
    var hasLlms = d.llms && d.llms.status >= 200 && d.llms.status < 400;
    botSec.appendChild(keyVal(ctx, 'llms.txt', hasLlms ? 'present ✓' : 'not found',
      hasLlms ? 'ok' : 'int'));
    wrap.appendChild(botSec);

    // ---- Content intelligence ----
    if (c && c.keywords) {
      var kw = c.keywords;
      var kwSec = section(ctx, 'Keyword density (main content · ' + (c.contentWords || 0) + ' words)', []);
      if (kw.placement) {
        kwSec.appendChild(el('div', { class: 'op-note',
          html: 'Top term <b>“' + esc(kw.placement.term) + '”</b> — ' +
            tick(kw.placement.inTitle) + ' title ' + tick(kw.placement.inH1) + ' H1 ' +
            tick(kw.placement.inMeta) + ' meta' }));
      }
      kwSec.appendChild(kwTable(ctx, 'Top words', kw.unigrams));
      kwSec.appendChild(kwTable(ctx, 'Top 2-word phrases', kw.bigrams));
      kwSec.appendChild(kwTable(ctx, 'Top 3-word phrases', kw.trigrams));
      wrap.appendChild(kwSec);
    }

    // ---- Readability ----
    if (c && c.readability) {
      var r = c.readability;
      wrap.appendChild(section(ctx, 'Readability', [
        keyVal(ctx, 'Flesch reading ease', r.flesch + '  (' + r.fleschLabel + ')',
          r.flesch >= 50 ? 'ok' : 'warn'),
        keyVal(ctx, 'Grade level', String(r.grade), r.grade <= 10 ? 'ok' : 'warn'),
        keyVal(ctx, 'Avg sentence length', r.avgSentenceWords + ' words',
          r.avgSentenceWords <= 20 ? 'ok' : 'warn'),
        keyVal(ctx, 'Passive voice (approx)', String(r.passiveApprox), r.passiveApprox <= 5 ? 'ok' : 'warn')
      ]));
    }
  }

  // ---- UI builders ----
  function kwTable(ctx, title, rows) {
    var el = ctx.el;
    var box = el('div', { class: 'kw-box' });
    box.appendChild(el('div', { class: 'kw-title', text: title }));
    if (!rows || !rows.length) { box.appendChild(el('div', { class: 'op-note', text: '—' })); return box; }
    rows.forEach(function (r) {
      box.appendChild(el('div', { class: 'kw-row' }, [
        el('span', { class: 'kw-term', text: r.term }),
        el('span', { class: 'kw-count', text: r.count + '× · ' + r.density + '%' })
      ]));
    });
    return box;
  }
  function section(ctx, title, kids) {
    var sec = ctx.el('div', { class: 'op-section' });
    sec.appendChild(ctx.el('div', { class: 'op-title', text: title }));
    (kids || []).forEach(function (k) { if (k) sec.appendChild(k); });
    return sec;
  }
  function keyVal(ctx, k, v, color) {
    var row = ctx.el('div', { class: 'op-kv' });
    row.appendChild(ctx.el('span', { class: 'op-k', text: k }));
    row.appendChild(ctx.el('span', { class: 'op-v ' + (color ? 'c-' + color : ''), text: v }));
    return row;
  }
  function tick(ok) { return ok ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✗</span>'; }
  function gradeColor(pct) { return pct >= 65 ? 'ok' : pct >= 40 ? 'warn' : 'bad'; }
  function setStatus(ctx, text, isErr) {
    var s = ctx.qs('#ai-status');
    s.className = 'status' + (isErr ? ' err' : (text ? ' busy' : ''));
    s.textContent = text;
  }

  window.SEO_TABS.ai = { init: init };
})();
