/**
 * report/report.js — renders the shareable client report.
 *
 * The Fixes tab stores the audit under `seo_report:<id>` and opens
 * report.html?id=<id>. This page renders it with the same template used for
 * the downloadable HTML (shared/handoff.js), so what you see is what you send.
 * "Save as PDF" is the browser's print dialog (the toolbar is hidden in print).
 */
(function () {
  'use strict';

  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'page'; } }

  async function main() {
    var HO = window.SEO_HANDOFF;
    var root = document.getElementById('report');
    var id = new URLSearchParams(location.search).get('id') || '';
    var p = id ? await window.SEO_STORE.get('seo_report:' + id, null) : null;
    if (!p || !HO) {
      root.innerHTML = '<div class="empty">This report is no longer available. Open the Fixes tab in SEO Sidekick and click “Client report” again.</div>';
      document.getElementById('dl').disabled = true;
      document.getElementById('pdf').disabled = true;
      return;
    }
    var style = document.createElement('style');
    style.textContent = HO.REPORT_CSS;
    document.head.appendChild(style);
    root.innerHTML = HO.reportBody(p);   // every value is escaped by reportBody
    document.title = 'SEO report — ' + host(p.url);

    document.getElementById('pdf').addEventListener('click', function () { window.print(); });
    document.getElementById('dl').addEventListener('click', function () {
      var day = new Date(p.date || Date.now()).toISOString().slice(0, 10);
      window.SEO_CSV.downloadText('seo-report-' + host(p.url) + '-' + day + '.html', HO.reportHtml(p), 'text/html');
    });
  }
  main();
})();
