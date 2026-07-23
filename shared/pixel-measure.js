/**
 * shared/pixel-measure.js
 * Canvas-based text width measurement approximating Google's SERP fonts.
 *
 * Google's exact SERP font stack isn't public; desktop titles render roughly as
 * 20px arial/Roboto and descriptions ~14px. We approximate with a hidden canvas
 * and measureText(). Documented as an approximation in DECISIONS.md / README.
 *
 * Exposes global SEO_PIXEL = {
 *   measure(text, font),
 *   titleWidth(text), descWidth(text),
 *   truncateToWidth(text, maxPx, font),  // returns {text, truncated, widthPx}
 *   LIMITS
 * }
 */
(function (root) {
  'use strict';

  var TITLE_FONT = '20px arial, sans-serif';
  var DESC_FONT = '14px arial, sans-serif';

  // Truncation limits (pixels for desktop; description also has a mobile point).
  var LIMITS = {
    titleDesktopPx: 580,
    descDesktopPx: 920,
    descMobilePx: 680,
    // Character guides SEOs still reference (secondary).
    titleChars: 60,
    descChars: 160
  };

  var _canvas = null;
  var _ctx = null;

  function ctx() {
    if (_ctx) return _ctx;
    try {
      // OffscreenCanvas in workers, <canvas> in document contexts.
      if (typeof OffscreenCanvas !== 'undefined') {
        _canvas = new OffscreenCanvas(10, 10);
        _ctx = _canvas.getContext('2d');
      } else if (typeof document !== 'undefined') {
        _canvas = document.createElement('canvas');
        _ctx = _canvas.getContext('2d');
      }
    } catch (e) {
      _ctx = null;
    }
    return _ctx;
  }

  /**
   * Measure rendered width of text in a given font.
   * Falls back to a character-count heuristic if canvas is unavailable.
   */
  function measure(text, font) {
    text = text == null ? '' : String(text);
    var c = ctx();
    if (c) {
      try {
        c.font = font;
        return Math.round(c.measureText(text).width);
      } catch (e) { /* fall through */ }
    }
    // Fallback: ~ average glyph width heuristic.
    var per = font === TITLE_FONT ? 10.5 : 7.4;
    return Math.round(text.length * per);
  }

  function titleWidth(text) { return measure(text, TITLE_FONT); }
  function descWidth(text) { return measure(text, DESC_FONT); }

  /**
   * Truncate text so its rendered width does not exceed maxPx. Appends nothing;
   * the caller decides how to show the ellipsis. Returns where the cut happens.
   * @returns {{text:string, truncated:boolean, widthPx:number, cutIndex:number}}
   */
  function truncateToWidth(text, maxPx, font) {
    text = text == null ? '' : String(text);
    var full = measure(text, font);
    if (full <= maxPx) {
      return { text: text, truncated: false, widthPx: full, cutIndex: text.length };
    }
    // Binary search the longest prefix that fits (leave room for an ellipsis).
    var ellipsisPx = measure('…', font);
    var target = Math.max(0, maxPx - ellipsisPx);
    var lo = 0, hi = text.length, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var w = measure(text.slice(0, mid), font);
      if (w <= target) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    // Prefer cutting on a word boundary if one is close behind.
    var cut = best;
    var slice = text.slice(0, best);
    var lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > best - 12 && lastSpace > 0) cut = lastSpace;
    var out = text.slice(0, cut).replace(/\s+$/, '');
    return {
      text: out,
      truncated: true,
      widthPx: measure(out, font),
      cutIndex: cut
    };
  }

  var api = {
    TITLE_FONT: TITLE_FONT,
    DESC_FONT: DESC_FONT,
    LIMITS: LIMITS,
    measure: measure,
    titleWidth: titleWidth,
    descWidth: descWidth,
    truncateToWidth: truncateToWidth
  };

  root.SEO_PIXEL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
