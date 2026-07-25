/**
 * shared/csv.js
 * Minimal, correct CSV builder + browser download trigger.
 * Handles quoting/escaping per RFC 4180: fields containing comma, quote, CR or
 * LF are wrapped in double quotes and inner quotes are doubled.
 *
 * Exposes global SEO_CSV = { toCsv(rows), download(filename, csvText) }.
 */
(function (root) {
  'use strict';

  function escapeField(value) {
    if (value == null) value = '';
    var s = String(value);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * @param {Array<Array<*>>} rows  array of rows, each an array of cell values.
   * @returns {string} CSV text with CRLF line endings.
   */
  function toCsv(rows) {
    if (!Array.isArray(rows)) return '';
    return rows.map(function (row) {
      return (row || []).map(escapeField).join(',');
    }).join('\r\n');
  }

  /**
   * Trigger a download of csvText as filename. Uses a Blob + object URL.
   * Prefixes a UTF-8 BOM so Excel reads accented characters correctly.
   */
  function download(filename, csvText) {
    try {
      var blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'export.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generic text/blob download (JSON, TXT, etc.).
   */
  function downloadText(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'download.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  var api = { toCsv: toCsv, download: download, downloadText: downloadText, escapeField: escapeField };
  root.SEO_CSV = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
