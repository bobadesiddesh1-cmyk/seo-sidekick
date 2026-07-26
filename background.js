/**
 * background.js — MV3 service worker. Scripting-injection orchestration.
 *
 * The popup sends messages here; we inject the self-contained module files into
 * the active tab and invoke their globals, returning results to the popup. This
 * keeps all chrome.scripting calls in one place and out of the popup UI code.
 *
 * NOTE: We pass real function references to executeScript.func (never eval /
 * new Function — MV3 service-worker CSP forbids those). Each wrapper is a tiny
 * closure that just calls the global the injected file defined; executeScript
 * serializes it, runs it in the page's isolated world, and awaits any promise.
 *
 * Message types:
 *   'scan-links'      -> Module 1  (inject/link-checker.js)
 *   'check-hreflang'  -> Module 2  (inject/hreflang-checker.js)
 *   'read-snippet'    -> Module 5  (inject/snippet-reader.js)
 *   'analyze-onpage'  -> Module 6  (inject/onpage-analyzer.js)
 *   'analyze-content' -> Module 8  (inject/content-analyzer.js) — GEO + content intel
 *   'fetch-resource'  -> network fetch (robots.txt/llms.txt/sitemap/headers), no tab
 *   'highlight'       -> Module 3  (content/highlighter.js) action: on|off|toggle|counts|state
 */
'use strict';

// Clicking the toolbar icon opens the docked side panel (big, page stays visible)
// instead of a small popup. setPanelBehavior persists; we set it on install and
// on every service-worker start for safety.
function enableSidePanel() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
    }
  } catch (e) { /* older Chrome — side panel unavailable */ }
}
enableSidePanel();
try { chrome.runtime.onInstalled.addListener(enableSidePanel); } catch (e) {}
try { chrome.runtime.onStartup.addListener(enableSidePanel); } catch (e) {}
// Fallback: if openPanelOnActionClick didn't take effect, an action click still
// fires here (a user gesture) so we open the panel manually.
try {
  chrome.action.onClicked.addListener(function (tab) {
    try {
      if (tab && tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId });
      else if (tab && tab.id != null) chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) { /* ignore */ }
  });
} catch (e) {}

// --- Injected wrapper callers (run in the page, not the worker) -------------
function callCollectLinks() { return self.__SEO_collectLinks(); }
function callHreflangChecker() { return self.__SEO_runHreflangChecker(); }
function callSnippetReader() { return self.__SEO_readSnippet(); }
function callOnpageAnalyzer() { return self.__SEO_runOnpageAnalyzer(); }
function callContentAnalyzer() { return self.__SEO_runContentAnalyzer(); }
function callHighlightEnable() { return self.__SEO_highlighter.enable(); }
function callHighlightDisable() { return self.__SEO_highlighter.disable(); }
function callHighlightToggle() { return self.__SEO_highlighter.toggle(); }
function callHighlightCounts() { return self.__SEO_highlighter.counts(); }
function callHighlightState() { return self.__SEO_highlighter.isOn(); }

async function injectFile(tabId, file) {
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: [file] });
}

async function callInPage(tabId, fn) {
  var res = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: fn });
  return res && res[0] ? res[0].result : null;
}

async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

// Fetch an arbitrary resource (robots.txt, llms.txt, sitemap, the page itself)
// from the worker — host_permissions bypass CORS so we can read status, headers
// and body. Used by the AI and Tech tabs. 15s timeout; never throws.
async function fetchResource(url, method) {
  var controller = new AbortController();
  var t = setTimeout(function () { controller.abort(); }, 15000);
  try {
    var resp = await fetch(url, {
      method: method || 'GET', redirect: 'follow',
      credentials: 'omit', signal: controller.signal
    });
    clearTimeout(t);
    var headers = {};
    try { resp.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; }); } catch (e) {}
    var body = '';
    if ((method || 'GET') !== 'HEAD') {
      try { body = await resp.text(); } catch (e) { body = ''; }
    }
    return {
      ok: resp.ok, status: resp.status, headers: headers,
      finalUrl: resp.url || url, redirected: !!resp.redirected,
      body: body.length > 600000 ? body.slice(0, 600000) : body
    };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: 0, headers: {}, finalUrl: url, redirected: false,
      body: '', error: (e && e.name === 'AbortError') ? 'timeout' : 'unreachable' };
  }
}

// ---------------------------------------------------------------------------
// Broken-link checking — runs HERE in the service worker, which has host
// permissions and therefore bypasses CORS. This is the key to checking external
// links for real (a page-context fetch would be CORS-blocked and could only
// report "Unknown"). Concurrency 6, 8s timeout, allSettled-safe.
// ---------------------------------------------------------------------------
var LINK_CONCURRENCY = 6;
var LINK_TIMEOUT_MS = 8000;

function timedFetch(url, opts) {
  var controller = new AbortController();
  var t = setTimeout(function () { controller.abort(); }, LINK_TIMEOUT_MS);
  opts = opts || {};
  opts.signal = controller.signal;
  opts.redirect = 'follow';
  if (!('credentials' in opts)) opts.credentials = 'omit'; // check as an anonymous visitor
  return fetch(url, opts).then(function (r) { clearTimeout(t); return r; })
    .catch(function (err) { clearTimeout(t); throw err; });
}

function classifyResponse(result, resp) {
  var s = resp.status;
  result.status = s;
  result.finalUrl = resp.url || '';
  if (resp.redirected && result.finalUrl && result.finalUrl !== result.url) {
    result.state = 'redirect';
    result.redirectHops = 1;
    result.label = 'Redirect ' + s + ' → ' + result.finalUrl;
  } else if (s >= 200 && s < 300) {
    result.state = 'ok';
    result.label = 'OK ' + s;
  } else if (s >= 300 && s < 400) {
    result.state = 'redirect';
    result.redirectHops = 1;
    result.label = 'Redirect ' + s + (result.finalUrl ? ' → ' + result.finalUrl : '');
  } else if (s >= 400) {
    result.state = 'broken';
    result.label = 'Broken — HTTP ' + s;
  } else {
    result.state = 'unknown';
    result.label = 'Status ' + s;
  }
}

async function probeSecondHop(result) {
  // The first fetch (redirect:'follow') collapsed the whole chain to finalUrl.
  // Re-request the settled URL once; if IT still redirects, it was a multi-hop
  // chain. Never a false positive — only escalates on an observed 2nd redirect.
  try {
    var settled = result.finalUrl || result.url;
    if (!settled) return;
    var r2 = await timedFetch(settled, { method: 'HEAD' });
    if (r2.redirected && r2.url && r2.url !== settled) {
      result.redirectHops = 2;
      result.finalUrl = r2.url;
      result.label = '2+ redirect hops → ' + r2.url;
    }
  } catch (e) { /* keep single-hop label */ }
}

async function checkOneLink(item) {
  var result = {
    url: item.url, anchor: item.anchor, type: item.type,
    status: null, state: 'unknown', label: '', finalUrl: '', redirectHops: 0
  };
  // HEAD first (cheap). Fall back to GET if the server rejects HEAD or errors.
  try {
    var head = await timedFetch(item.url, { method: 'HEAD' });
    classifyResponse(result, head);
    if (result.status === 405 || result.status === 501 || result.status === 403) {
      // Some servers refuse HEAD — confirm with GET before trusting it.
      try {
        var g = await timedFetch(item.url, { method: 'GET' });
        classifyResponse(result, g);
      } catch (e2) { /* keep HEAD result */ }
    }
    if (result.state === 'redirect') await probeSecondHop(result);
    return result;
  } catch (headErr) {
    // HEAD failed outright (network/DNS/timeout/mixed-content) — try GET once.
    try {
      var resp = await timedFetch(item.url, { method: 'GET' });
      classifyResponse(result, resp);
      if (result.state === 'redirect') await probeSecondHop(result);
      return result;
    } catch (getErr) {
      result.state = 'broken';
      result.status = 0;
      result.label = (getErr && getErr.name === 'AbortError')
        ? 'Broken — timeout (8s)' : 'Broken — unreachable';
      return result;
    }
  }
}

async function checkLinksInBackground(links) {
  var results = new Array(links.length);
  var next = 0;
  async function worker() {
    while (true) {
      var idx = next++;
      if (idx >= links.length) return;
      try { results[idx] = await checkOneLink(links[idx]); }
      catch (e) {
        results[idx] = {
          url: links[idx].url, anchor: links[idx].anchor, type: links[idx].type,
          status: 0, state: 'broken', label: 'Broken — unexpected error',
          finalUrl: '', redirectHops: 0
        };
      }
    }
  }
  var pool = [];
  for (var w = 0; w < Math.min(LINK_CONCURRENCY, links.length); w++) pool.push(worker());
  await Promise.allSettled(pool);
  return results;
}

function canInject(tab) {
  if (!tab || !tab.url) return false;
  if (/^https?:\/\//i.test(tab.url) || /^file:\/\//i.test(tab.url)) return true;
  return false;
}

var HIGHLIGHT_FUNCS = {
  on: callHighlightEnable,
  off: callHighlightDisable,
  toggle: callHighlightToggle,
  counts: callHighlightCounts,
  state: callHighlightState
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  (async function () {
    try {
      // Network-only messages: no tab injection needed.
      if (msg.type === 'fetch-resource') {
        var r = await fetchResource(msg.url, msg.method);
        sendResponse({ ok: true, data: r });
        return;
      }

      var tab = (msg.tabId ? { id: msg.tabId, url: msg.tabUrl } : await getActiveTab());
      if (!tab || !tab.id) { sendResponse({ ok: false, error: 'No active tab.' }); return; }
      if (!canInject(tab)) {
        sendResponse({
          ok: false,
          error: 'This page can’t be scanned (browser or extension page). Open a normal website tab.'
        });
        return;
      }

      switch (msg.type) {
        case 'scan-links': {
          // 1) Collect links from the page DOM (content-script world).
          await injectFile(tab.id, 'inject/link-checker.js');
          var collected = await callInPage(tab.id, callCollectLinks);
          if (!collected || !collected.links) {
            sendResponse({ ok: false, error: 'Could not read links from this page.' });
            return;
          }
          // 2) Check them HERE in the worker (host permissions bypass CORS).
          var checked = await checkLinksInBackground(collected.links);
          sendResponse({ ok: true, data: {
            links: checked,
            truncated: collected.truncated,
            total: collected.total,
            checked: checked.length
          } });
          return;
        }
        case 'check-hreflang': {
          await injectFile(tab.id, 'inject/hreflang-checker.js');
          var hre = await callInPage(tab.id, callHreflangChecker);
          sendResponse({ ok: true, data: hre });
          return;
        }
        case 'read-snippet': {
          await injectFile(tab.id, 'inject/snippet-reader.js');
          var snip = await callInPage(tab.id, callSnippetReader);
          sendResponse({ ok: true, data: snip });
          return;
        }
        case 'analyze-onpage': {
          await injectFile(tab.id, 'inject/onpage-analyzer.js');
          var onpage = await callInPage(tab.id, callOnpageAnalyzer);
          sendResponse({ ok: true, data: onpage });
          return;
        }
        case 'analyze-content': {
          await injectFile(tab.id, 'inject/content-analyzer.js');
          var content = await callInPage(tab.id, callContentAnalyzer);
          sendResponse({ ok: true, data: content });
          return;
        }
        case 'highlight': {
          var action = msg.action || 'toggle';
          var fn = HIGHLIGHT_FUNCS[action] || callHighlightToggle;
          await injectFile(tab.id, 'content/highlighter.js');
          var r = await callInPage(tab.id, fn);
          sendResponse({ ok: true, data: r });
          return;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type: ' + msg.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) ? err.message : String(err) });
    }
  })();

  return true; // keep the message channel open for the async response
});
