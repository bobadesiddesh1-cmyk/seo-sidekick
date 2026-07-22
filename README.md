# SEO Sidekick — Free On-Page & SERP Toolkit

The free **SEO Minion replacement**. Six daily SEO checks in one toolbar icon:
broken links, on-page element analysis with word count, hreflang validation,
dofollow/nofollow highlighting, SERP location spoofing, and live pixel-width
title/meta preview.

**Zero account · zero paywall · zero data collected.** Everything runs on your
device. The only network requests the extension ever makes are the link/hreflang
checks *you* explicitly trigger and opening a Google search tab when you change
SERP location. No analytics, no telemetry, no remote config, no sign-in.

---

## Install (load unpacked)

1. Clone or download this folder.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `seo-sidekick/` folder.
5. Pin **SEO Sidekick** to your toolbar. Click the icon on any page.

No build step. No npm. No bundler. It loads exactly as-is.

---

## The six modules

Open the popup and switch between six tabs. Tab switching is instant — results
are cached in memory for the life of the popup session and never re-fetched on
switch.

### 1 · Links — Broken Link Checker
Click **Scan this page for broken links**. The extension collects every
same-document `<a href>` (relative URLs resolved, duplicates removed, and
`mailto:`/`tel:`/`javascript:`/`#`-only anchors skipped), caps at 300 links in
DOM order (truncation is noted in the UI), and checks each one:

- **HEAD first**, falling back to **GET for same-origin** links when HEAD is
  rejected or blocked. Cross-origin links that a server won't expose via CORS are
  probed with a no-cors request and labelled **"Unknown (CORS) — open manually"**
  rather than guessed.
- **6 concurrent requests**, the rest queued; **8s timeout** each via
  `AbortController`; one bad URL never hangs the batch (`Promise.allSettled`).
- **Classification:** 2xx = OK (hidden by default), 3xx / `response.redirected` =
  Redirect (final destination shown; a second hop is detected and labelled
  "2+ redirect hops"), 4xx/5xx/timeout/network error = Broken (red).
- Results table sorts broken-first, shows status, anchor (truncated to 60 chars),
  URL, and internal/external type. **Click any row** to open the URL in a new tab.
  **Export CSV** writes every checked link (RFC-4180 quoted, UTF-8 BOM for Excel).

### 6 · On-Page — On-Page Elements Analyzer
Runs **automatically** when you open the popup. Reads the current page's on-page
SEO elements directly from the DOM and reports them at a glance:

- **Word count** — the headline figure is the count of words inside the page's
  `<body>` **`<p>` (paragraph) tags only**, so navigation, menus, sidebars,
  scripts, and boilerplate don't inflate it. Hidden paragraphs (`display:none` /
  `visibility:hidden`) are skipped. Secondary references are also shown: number of
  paragraphs, heading words, estimated reading time (~200 wpm), and an "all body
  text" count (the whole `<body>` minus `script`/`style`/`noscript`/`template`/
  `svg`/`iframe`). Tokenization uses Unicode letter/number matching, so accented
  and non-Latin scripts count correctly and contractions/hyphenated terms count
  as a single word.
- **Title** and **meta description** with character lengths (color-coded against
  common length guidance).
- **Headings** — H1–H6 counts in a grid, with the H1/H2 text listed and a warning
  if there isn't exactly one H1.
- **Images** — total, with-alt, missing `alt` attribute, and empty `alt`.
- **Links** — total, internal, external, nofollow.
- **Indexability** — canonical (with a self-match indicator), meta robots
  (flags `noindex`), viewport, `lang`, and charset.
- **Social tags** — `og:title` / `og:description` / `og:image` and
  `twitter:card` presence.
- **Structured data** — number of JSON-LD blocks and the `@type`s detected.
- **Export CSV** writes every metric for the page.

### 2 · Hreflang — Hreflang Validator
Runs **automatically** when you open the popup (no button). It reads the current
page's `<link rel="alternate" hreflang="…">` tags directly from the DOM and
validates:

- **(a)** the language value against a real **184-entry ISO 639-1 list** (plus a
  2-letter ISO 3166-1 region shape and the literal `x-default`) — real membership,
  not just regex shape;
- **(b)** the href is an absolute URL;
- **(c)** **reciprocity** — each target's HTML is fetched and checked for a
  hreflang tag pointing *back* to this page ("missing return tag" if not);
- **(d)** the page has a **self-referencing** hreflang tag;
- **(e)** **duplicate** hreflang values across tags.

Each tag gets ✓/✗ per check and a plain-English issue description. A page with no
hreflang tags shows a clean **"No hreflang tags found"** empty state — not an
error. Cross-origin targets that block CORS are reported as "CORS — unverified"
(a soft warning, since the tag may still be correct — we just can't read the
remote HTML from the browser).

### 3 · Highlight — Dofollow/Nofollow Highlighter
Flip the toggle to outline every link on the page. The outline reads on **two
axes** so you interpret color + style together:

| | Internal (solid) | External (dashed) |
|---|---|---|
| **Dofollow** (green) | solid green | dashed green |
| **Nofollow** (red) | solid red | dashed red |

`nofollow` covers `rel` containing `nofollow`, `sponsored`, or `ugc`. Styling is a
**single injected stylesheet + classes** (never per-element inline styles) for
performance, and toggling off removes the style and classes so the page is
visually identical to the original — non-destructive, no DOM wrapping.

A draggable, dismissible **legend** (Shadow DOM, dark-mode aware) floats on the
page, and **live counts** (total / dofollow / nofollow / internal / external)
update in the popup and legend as you scroll or the DOM changes
(MutationObserver, debounced 400ms).

### 4 · Location — SERP Location Changer
Pick from **30 shipped locations** (countries + major cities) or type any custom
location. Enter a query (auto-prefilled from the current Google SERP tab if you're
on one) and click **Search as location** — a new tab opens Google's results for
that location. On the results page a **"Viewing as: [Location]"** badge (Shadow
DOM, top-right) appears whenever a location parameter is detected, so spoofed
results are never mistaken for your real default location. Your **last 10**
searches are saved and click-to-rerun.

**uule vs gl/hl — what we ship and why.** Google supports several ways to bias
search results toward a location:

- **`gl` + `hl`** — country geolocation + interface/results language. Simple,
  documented, and *always* changes results at the country level.
- **`uule`** — a base64-style encoding of a *canonical location name* that can
  reach city-level precision. Its construction is
  `w+CAIQICI` + a single length character + a base64 encoding of the canonical
  name (e.g. `"New York,New York,United States"`). Google honours it when the
  canonical name matches its internal geo table, but it is undocumented and can be
  silently ignored for names it doesn't recognize.

**This extension ships BOTH.** Every search URL carries `uule` (built from the
location's canonical name) *and* `gl`/`hl`, plus `pws=0` to reduce
personalization. That way you get city-level precision when Google accepts the
`uule`, and a guaranteed country/language shift from `gl`/`hl` as the reliable
fallback — you always get a working location change, never a stub. See
`shared/locations.js` for the builder and `DECISIONS.md` for the full rationale.

### 5 · Preview — Pixel-Width SERP Snippet Preview
Auto-populates the current tab's `<title>` and `meta[name=description]`, both
live-editable. As you type it renders a **pixel-accurate mock Google result card**
(Shadow DOM, favicon + URL breadcrumb + title + description, dark-mode aware) and
shows:

- **Pixel width** (primary) via a hidden canvas + `measureText()`, with **char
  count** as a secondary reference.
- A **live width bar**: green under the limit, amber near it (≥90%), red over,
  with a marker at the truncation point.
- **Title** limit ≈ 580px (desktop). **Description** shows **both** desktop
  (≈920px) and mobile (≈680px) truncation guides. The mock card truncates the
  text exactly where the pixel limit falls and inserts a `…`.
- **Copy** buttons for the edited title and meta.

> **Font note (approximation).** Google's exact SERP font stack isn't public. We
> approximate it with `20px arial` (title) and `14px arial` (description) via
> canvas `measureText()`. Widths are very close but treat them as guidance, not
> a pixel-perfect guarantee — this is documented in `DECISIONS.md`.

---

## Privacy

The single reason this exists: the incumbent put its free tier behind a paywall.
SEO Sidekick collects **nothing**. It has no account system, no server, no
analytics, and makes **no** network request except:

1. the link-check / hreflang-target fetches you explicitly trigger, and
2. opening a Google search tab when you change SERP location.

Permissions requested: `storage` (local history + preferences only), `activeTab`
and `scripting` (to inject the on-demand tools when you click a button). The only
persistent content script runs on Google search result pages, purely for the
"Viewing as" badge and reading the current query.

---

## Acceptance tests (walkthrough)

1. **Loads clean.** Load unpacked → open the popup on any normal page and on a
   `google.com/search?q=…` page → no console errors.
2. **Module 1.** Open a page with a known 404 link and a working link → Scan →
   the 404 is flagged red, the working link is hidden (counted as OK), CSV export
   downloads with correct quoting. On a page with a redirecting link the redirect
   destination (and 2+ hop label where applicable) is shown.
3. **Module 2.** On a page whose alternates are missing a return tag → the tag is
   flagged with a plain-English message. On a page with no hreflang tags → clean
   "No hreflang tags found" empty state, not an error.
4. **Module 3.** Toggle on → internal/external and dofollow/nofollow links are
   visually distinguishable by outline color + style, counts update live as you
   scroll → toggle off → the page looks identical to the original.
5. **Module 4.** Pick a non-default location (e.g. "Tokyo, Japan") + a query →
   Search as location → a new Google tab opens for that location and the
   "Viewing as: Tokyo, Japan" badge appears on the results page.
6. **Module 5.** Type a long title → the pixel bar goes amber then red at the
   correct truncation point, the mock card updates live and truncates with `…`,
   and the copy buttons work.
7. **Module 6.** Open the popup on a content page → the On-Page tab shows a word
   count driven by the page's `<p>` text (nav/menu/script text excluded), correct
   H1–H6 counts, image alt stats, canonical/robots, and JSON-LD types; CSV export
   downloads every metric.
8. **Tabs.** All six tabs switch instantly with no re-scan.

---

## File structure

```
seo-sidekick/
├── manifest.json                 MV3 manifest (storage, activeTab, scripting)
├── background.js                 service worker — scripting-injection orchestration
├── content/
│   ├── serp-adapter.js           Google SERP query/location-badge detection (2 strategies)
│   ├── highlighter.js            Module 3 — link highlight styling + legend
│   └── main.js                   content-script entry on SERP hosts
├── inject/
│   ├── link-checker.js           Module 1 — self-contained injected function
│   ├── hreflang-checker.js       Module 2 — self-contained injected function
│   ├── onpage-analyzer.js        Module 6 — on-page elements + word count
│   └── snippet-reader.js         Module 5 — reads title/meta from active tab
├── popup/
│   ├── popup.html / popup.css / popup.js   5-tab shell + router
│   └── tabs/                     links.js, onpage.js, hreflang.js, highlight.js, location.js, preview.js
├── shared/
│   ├── storage.js                chrome.storage.local promise wrapper + history
│   ├── csv.js                    RFC-4180 CSV builder + download
│   ├── iso-languages.js          full 184-entry ISO 639-1 list + validator
│   ├── locations.js              30 locations + uule builder + search-URL builder
│   └── pixel-measure.js          canvas measureText helpers
├── icons/                        16 / 32 / 48 / 128 PNGs
├── DECISIONS.md                  engineering decisions & defaults
└── README.md
```

---

## Chrome Web Store listing draft

**Title:** SEO Sidekick — Free On-Page & SERP Toolkit

**Summary (132 chars):**
> Free, no account, no data collected. Broken links, hreflang, dofollow/nofollow, SERP location & pixel snippet preview in one click.

**Description:**
> **Free, no account, no data collected — the SEO Minion replacement.**
>
> SEO Sidekick puts five daily on-page and SERP checks behind one toolbar icon,
> with nothing to sign up for and nothing tracked. Everything runs locally in your
> browser.
>
> • **Broken Link Checker** — scan up to 300 links, HEAD-first with smart CORS
>   handling, redirect-chain detection, sortable results, one-click CSV export.
> • **Hreflang Validator** — real ISO 639-1 code validation, self-reference and
>   duplicate detection, and return-tag reciprocity checks with plain-English fixes.
> • **Dofollow/Nofollow Highlighter** — outline every link by follow status and
>   internal/external scope, with live counts and a draggable legend.
> • **SERP Location Changer** — search Google as any of 30 locations (or a custom
>   one) using uule + gl/hl, with a "Viewing as" badge and a rerun history.
> • **Pixel-Width Snippet Preview** — pixel-accurate title/meta widths with
>   desktop + mobile truncation points and a live Google-style preview card.
>
> No analytics. No telemetry. No sign-in. The only requests it makes are the link
> checks you trigger and the Google searches you run. Built for SEO professionals
> who lost their free on-page toolkit and want it back — free, for good.
