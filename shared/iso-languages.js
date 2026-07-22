/**
 * shared/iso-languages.js
 * Full ISO 639-1 two-letter language code list (184 entries).
 * Used by Module 2 for real membership validation of hreflang language subtags.
 *
 * Exposes:
 *   - ISO_639_1: Set of valid lowercase 2-letter codes.
 *   - isValidHreflang(value): validates a full hreflang attribute value
 *       (language, language-REGION, or x-default) against the real code list.
 *
 * Works both as a classic script (window/globalThis global) and, defensively,
 * without module syntax so it can be injected via chrome.scripting if needed.
 */
(function (root) {
  'use strict';

  // ISO 639-1 alpha-2 codes — complete set (184 assigned codes).
  var CODES = [
    'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az',
    'ba', 'be', 'bg', 'bh', 'bi', 'bm', 'bn', 'bo', 'br', 'bs',
    'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy',
    'da', 'de', 'dv', 'dz',
    'ee', 'el', 'en', 'eo', 'es', 'et', 'eu',
    'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy',
    'ga', 'gd', 'gl', 'gn', 'gu', 'gv',
    'ha', 'he', 'hi', 'ho', 'hr', 'ht', 'hu', 'hy', 'hz',
    'ia', 'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is', 'it', 'iu',
    'ja', 'jv',
    'ka', 'kg', 'ki', 'kj', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku',
    'kv', 'kw', 'ky',
    'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lu', 'lv',
    'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my',
    'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny',
    'oc', 'oj', 'om', 'or', 'os',
    'pa', 'pi', 'pl', 'ps', 'pt',
    'qu',
    'rm', 'rn', 'ro', 'ru', 'rw',
    'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq',
    'sr', 'ss', 'st', 'su', 'sv', 'sw',
    'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt',
    'tw', 'ty',
    'ug', 'uk', 'ur', 'uz',
    've', 'vi', 'vo',
    'wa', 'wo',
    'xh',
    'yi', 'yo',
    'za', 'zh', 'zu'
  ];

  var ISO_639_1 = {};
  for (var i = 0; i < CODES.length; i++) {
    ISO_639_1[CODES[i]] = true;
  }

  // Region subtag: 2-letter ISO 3166-1 alpha-2 shape (we validate shape, not
  // full membership, because region misuse is rarer and the alpha-2 space is
  // large; language membership is the high-value check).
  var REGION_RE = /^[A-Z]{2}$/;

  /**
   * Validate a full hreflang attribute value.
   * Accepts: "en", "en-US", "es-419"? No — hreflang uses ISO 3166-1 alpha-2
   * regions, not UN M.49 numeric; "x-default" is the one allowed literal.
   * @param {string} value
   * @returns {{valid: boolean, reason: string}}
   */
  function isValidHreflang(value) {
    if (value == null) return { valid: false, reason: 'empty hreflang value' };
    var raw = String(value).trim();
    if (!raw) return { valid: false, reason: 'empty hreflang value' };

    if (raw.toLowerCase() === 'x-default') {
      return { valid: true, reason: 'x-default (valid fallback marker)' };
    }

    var parts = raw.split('-');
    var lang = (parts[0] || '').toLowerCase();

    if (!ISO_639_1[lang]) {
      return {
        valid: false,
        reason: '"' + parts[0] + '" is not a valid ISO 639-1 language code'
      };
    }

    if (parts.length === 1) {
      return { valid: true, reason: 'valid language code' };
    }

    if (parts.length === 2) {
      var region = parts[1].toUpperCase();
      if (!REGION_RE.test(region)) {
        return {
          valid: false,
          reason: '"' + parts[1] + '" is not a valid ISO 3166-1 region code (expected 2 letters)'
        };
      }
      return { valid: true, reason: 'valid language-region code' };
    }

    return {
      valid: false,
      reason: 'too many subtags — expected "lang" or "lang-REGION"'
    };
  }

  var api = { ISO_639_1: ISO_639_1, isValidHreflang: isValidHreflang, LANGUAGE_COUNT: CODES.length };

  // Expose on whatever global object is available.
  root.SEO_ISO_LANGUAGES = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
