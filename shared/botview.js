/**
 * shared/botview.js — "Crawler view": fetch the page as Googlebot, Bingbot and
 * the main AI crawlers, and compare each response with what a normal browser
 * gets (status, redirects, X-Robots-Tag, and the HTML itself via the shared
 * extractor). Catches CDN/WAF bot blocking, noindex served only to bots,
 * bot-only redirects and content that differs between bots and people.
 *
 * Requests go out one at a time through the worker ('fetch-as'), which swaps
 * the User-Agent with a temporary declarativeNetRequest rule.
 *
 * Caveat shown in the UI: we can send a crawler's User-Agent, not its IP
 * address. Firewalls that verify bots by IP may treat this test differently
 * from the real crawler.
 *
 * Exposes window.SEO_BOTVIEW = { AGENTS, run }.
 */
(function () {
  'use strict';

  var AGENTS = [
    { key: 'browser', label: 'Your browser', kind: 'browser' },
    { key: 'googlebot', label: 'Googlebot', kind: 'search' },
    { key: 'bingbot', label: 'Bingbot', kind: 'search' },
    { key: 'gptbot', label: 'GPTBot', kind: 'ai', note: 'OpenAI training' },
    { key: 'oai-searchbot', label: 'OAI-SearchBot', kind: 'ai', note: 'ChatGPT search' },
    { key: 'claudebot', label: 'ClaudeBot', kind: 'ai', note: 'Anthropic' },
    { key: 'perplexitybot', label: 'PerplexityBot', kind: 'ai', note: 'Perplexity' }
  ];
  // Bot-challenge / block pages served with a 200 by some CDNs.
  var CHALLENGE_RE = /just a moment\.\.\.|attention required! \| cloudflare|cf-chl-|challenge-platform|captcha-delivery|px-captcha|access denied|request unsuccessful\. incapsula|pardon our interruption|are you a robot|verify you are human/i;

  function parse(body, url) {
    try {
      if (!body || !window.__SEO_extractRenderMetrics) return null;
      var doc = new DOMParser().parseFromString(body, 'text/html');
      return window.__SEO_extractRenderMetrics(doc, url);
    } catch (e) { return null; }
  }

  async function run(ctx, url, onProgress) {
    var out = [];
    for (var i = 0; i < AGENTS.length; i++) {
      var a = AGENTS[i];
      if (onProgress) onProgress(i, AGENTS.length, a);
      var resp = await ctx.send({ type: 'fetch-as', url: url, agent: a.key });
      var r = { key: a.key, label: a.label, kind: a.kind, note: a.note || '' };
      if (!resp || !resp.ok || !resp.data) {
        r.error = (resp && resp.error) || 'request failed';
        r.status = 0;
      } else {
        var d = resp.data;
        r.status = d.status || 0;
        r.error = d.error || '';
        r.finalUrl = d.finalUrl || url;
        r.redirected = !!d.redirected;
        r.xRobots = (d.headers && d.headers['x-robots-tag']) || '';
        r.bytes = (d.body || '').length;
        r.challenge = CHALLENGE_RE.test(String(d.body || '').slice(0, 20000));
        r.m = parse(d.body, r.finalUrl);
      }
      out.push(r);
    }
    return { url: url, ts: Date.now(), results: out };
  }

  window.SEO_BOTVIEW = { AGENTS: AGENTS, run: run };
})();
