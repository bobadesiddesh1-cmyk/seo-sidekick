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
 *   'highlight'       -> Module 3  (content/highlighter.js) action: on|off|toggle|counts|state
 */
'use strict';

// --- Injected wrapper callers (run in the page, not the worker) -------------
function callLinkChecker() { return self.__SEO_runLinkChecker(); }
function callHreflangChecker() { return self.__SEO_runHreflangChecker(); }
function callSnippetReader() { return self.__SEO_readSnippet(); }
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
          await injectFile(tab.id, 'inject/link-checker.js');
          var links = await callInPage(tab.id, callLinkChecker);
          sendResponse({ ok: true, data: links });
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
