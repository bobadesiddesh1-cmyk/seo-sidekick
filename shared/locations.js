/**
 * shared/locations.js
 * 30 shipped SERP locations + a uule builder + a Google-search-URL builder.
 *
 * Each location carries:
 *   - label:     human-readable name shown in the UI
 *   - canonical: Google canonical location name (for uule construction)
 *   - gl:        country code (Google "gl" geolocation param) — reliable fallback
 *   - hl:        interface/results language (Google "hl" param)
 *
 * uule construction (Google's documented scheme for a plain canonical name):
 *   plaintext = "w+CAIQICI" + <length-char> + <canonical name>
 *   where <length-char> is a single character whose code encodes the byte
 *   length of the canonical name using Google's alphabet offset, then the whole
 *   string is what Google expects in the &uule= param. In practice Google also
 *   accepts a base64 form. We ship the widely-used, verified construction:
 *     uule = "w+CAIQICI" + lengthChar(name) + base64ish(name)
 *   See DECISIONS.md / README for the full rationale and why we ALSO send gl/hl.
 *
 * Exposes global SEO_LOCATIONS = { LIST, buildUule, buildSearchUrl }.
 */
(function (root) {
  'use strict';

  var LIST = [
    // --- Countries ---
    { label: 'United States', canonical: 'United States', gl: 'us', hl: 'en' },
    { label: 'United Kingdom', canonical: 'United Kingdom', gl: 'gb', hl: 'en' },
    { label: 'Canada', canonical: 'Canada', gl: 'ca', hl: 'en' },
    { label: 'Australia', canonical: 'Australia', gl: 'au', hl: 'en' },
    { label: 'India', canonical: 'India', gl: 'in', hl: 'en' },
    { label: 'Germany', canonical: 'Germany', gl: 'de', hl: 'de' },
    { label: 'France', canonical: 'France', gl: 'fr', hl: 'fr' },
    { label: 'Spain', canonical: 'Spain', gl: 'es', hl: 'es' },
    { label: 'Italy', canonical: 'Italy', gl: 'it', hl: 'it' },
    { label: 'Netherlands', canonical: 'Netherlands', gl: 'nl', hl: 'nl' },
    { label: 'Brazil', canonical: 'Brazil', gl: 'br', hl: 'pt' },
    { label: 'Mexico', canonical: 'Mexico', gl: 'mx', hl: 'es' },
    { label: 'Japan', canonical: 'Japan', gl: 'jp', hl: 'ja' },
    { label: 'United Arab Emirates', canonical: 'United Arab Emirates', gl: 'ae', hl: 'en' },
    { label: 'Singapore', canonical: 'Singapore', gl: 'sg', hl: 'en' },

    // --- Major cities (canonical names Google recognizes for uule) ---
    { label: 'New York, NY, USA', canonical: 'New York,New York,United States', gl: 'us', hl: 'en' },
    { label: 'Los Angeles, CA, USA', canonical: 'Los Angeles,California,United States', gl: 'us', hl: 'en' },
    { label: 'Chicago, IL, USA', canonical: 'Chicago,Illinois,United States', gl: 'us', hl: 'en' },
    { label: 'London, UK', canonical: 'London,England,United Kingdom', gl: 'gb', hl: 'en' },
    { label: 'Manchester, UK', canonical: 'Manchester,England,United Kingdom', gl: 'gb', hl: 'en' },
    { label: 'Toronto, Canada', canonical: 'Toronto,Ontario,Canada', gl: 'ca', hl: 'en' },
    { label: 'Sydney, Australia', canonical: 'Sydney,New South Wales,Australia', gl: 'au', hl: 'en' },
    { label: 'Mumbai, India', canonical: 'Mumbai,Maharashtra,India', gl: 'in', hl: 'en' },
    { label: 'Bengaluru, India', canonical: 'Bengaluru,Karnataka,India', gl: 'in', hl: 'en' },
    { label: 'Delhi, India', canonical: 'Delhi,India', gl: 'in', hl: 'en' },
    { label: 'Berlin, Germany', canonical: 'Berlin,Germany', gl: 'de', hl: 'de' },
    { label: 'Paris, France', canonical: 'Paris,Ile-de-France,France', gl: 'fr', hl: 'fr' },
    { label: 'Dubai, UAE', canonical: 'Dubai,Dubai,United Arab Emirates', gl: 'ae', hl: 'en' },
    { label: 'Sao Paulo, Brazil', canonical: 'Sao Paulo,State of Sao Paulo,Brazil', gl: 'br', hl: 'pt' },
    { label: 'Tokyo, Japan', canonical: 'Tokyo,Japan', gl: 'jp', hl: 'ja' }
  ];

  /**
   * Base64-encode a UTF-8 string in a way that works in both window (btoa) and
   * service-worker/content contexts. btoa requires latin1; we UTF-8 encode
   * first so non-ASCII canonical names survive.
   */
  function b64(str) {
    try {
      // Encode UTF-8 -> latin1 string for btoa.
      var utf8 = unescape(encodeURIComponent(str));
      if (typeof btoa === 'function') return btoa(utf8);
    } catch (e) { /* fall through */ }
    // Manual base64 fallback (no atob/btoa available).
    return manualB64(str);
  }

  function manualB64(str) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var utf8 = unescape(encodeURIComponent(str));
    var out = '';
    var i = 0;
    while (i < utf8.length) {
      var c1 = utf8.charCodeAt(i++) & 0xff;
      var c2 = utf8.charCodeAt(i++) & 0xff;
      var c3 = utf8.charCodeAt(i++) & 0xff;
      var e1 = c1 >> 2;
      var e2 = ((c1 & 3) << 4) | (c2 >> 4);
      var e3 = ((c2 & 15) << 2) | (c3 >> 6);
      var e4 = c3 & 63;
      if (isNaN(c2)) { e3 = 64; e4 = 64; }
      else if (isNaN(c3)) { e4 = 64; }
      out += chars.charAt(e1) + chars.charAt(e2) +
        (e3 === 64 ? '=' : chars.charAt(e3)) +
        (e4 === 64 ? '=' : chars.charAt(e4));
    }
    return out;
  }

  /**
   * Google's single "length character" alphabet. The character at index N in
   * this table represents a canonical-name byte length of N. This is the
   * documented uule length-encoding table used by SEO tooling.
   */
  var LEN_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function lengthChar(n) {
    if (n >= 0 && n < LEN_ALPHABET.length) return LEN_ALPHABET.charAt(n);
    // For names longer than 63 bytes this simple single-char scheme can't
    // encode the length; we clamp and still ship gl/hl so results change.
    return LEN_ALPHABET.charAt(LEN_ALPHABET.length - 1);
  }

  /**
   * Build a uule value from a canonical location name.
   * Format: "w+CAIQICI" + lengthChar(byteLen) + base64(name)
   * @param {string} canonical
   * @returns {string} uule param value (URL-safe enough for encodeURIComponent)
   */
  function buildUule(canonical) {
    if (!canonical) return '';
    var name = String(canonical);
    var byteLen = unescape(encodeURIComponent(name)).length; // UTF-8 byte length
    return 'w+CAIQICI' + lengthChar(byteLen) + b64(name);
  }

  /**
   * Build a full Google search URL for a query at a location.
   * Ships uule AND gl/hl for maximum reliability (see DECISIONS.md).
   * @param {Object} opts
   * @param {string} opts.query
   * @param {Object} opts.location  a LIST entry OR {canonical,gl,hl,label}
   * @param {string} [opts.host]    google host, default www.google.com
   * @returns {string}
   */
  function buildSearchUrl(opts) {
    opts = opts || {};
    var query = opts.query || '';
    var loc = opts.location || {};
    var host = opts.host || 'www.google.com';
    var params = [];
    params.push('q=' + encodeURIComponent(query));
    if (loc.gl) params.push('gl=' + encodeURIComponent(loc.gl));
    if (loc.hl) params.push('hl=' + encodeURIComponent(loc.hl));
    var canonical = loc.canonical || loc.label;
    if (canonical) {
      var uule = buildUule(canonical);
      if (uule) params.push('uule=' + encodeURIComponent(uule));
    }
    // pws=0 asks Google not to personalize based on prior activity.
    params.push('pws=0');
    return 'https://' + host + '/search?' + params.join('&');
  }

  var api = {
    LIST: LIST,
    buildUule: buildUule,
    buildSearchUrl: buildSearchUrl
  };

  root.SEO_LOCATIONS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
