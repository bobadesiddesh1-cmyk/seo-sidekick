# DECISIONS.md — SEO Sidekick

Engineering decisions made during the build. Where the spec left a choice open,
the default chosen is recorded here with a one-line rationale.

## Architecture

- **Manifest V3, vanilla JS, no build step.** Loads unpacked exactly as-is. No
  bundler, no transpile, no npm. Every file is hand-authored and self-contained.
- **On-demand injection for Modules 1/2/3/5.** These run only when the user
  clicks a popup button, so there is no persistent all-sites content script.
  They are injected via `chrome.scripting.executeScript` scoped to `activeTab`.
  This keeps the extension quiet on every page you visit and minimizes the
  permission surface.
- **Persistent content script only on Google SERP hosts** (`www.google.com/search*`,
  `www.google.co.in/search*`). This is required for Module 4's live badge and
  query detection. Other Google TLDs are handled gracefully by the adapter when
  a location parameter is present, but only the two registered hosts get the
  auto-injected content script (MV3 requires hosts be declared in the manifest).

## Module 1 — Broken Link Checker

- **Fetches run in the background service worker, not the page.** MV3
  content-script/page fetches are subject to CORS, so cross-origin links could
  only ever be reported as "Unknown (CORS)" — which made the checker useless for
  external links (the exact bug this fixes). The injected script now only
  *collects* links from the DOM; the service worker (which has `host_permissions`)
  performs the fetches and **bypasses CORS**, returning real statuses for external
  links too. This is why the manifest requests `host_permissions: ["*://*/*"]`.
- **HEAD-first, GET fallback.** HEAD is cheap; when a server rejects it
  (405/403/501) or it errors, we retry with GET and reclassify. Requests use
  `credentials: 'omit'` so links are checked anonymously (how a crawler sees them).
- **Concurrency = 6, timeout = 8s, cap = 300 links.** Fixed pool of 6 workers
  drains a FIFO queue. Each request has its own `AbortController` with an 8s
  timer. 300-link cap is first-300-in-DOM-order; truncation is surfaced in the UI.
- **Redirect chain depth = 2.** We detect one extra hop past the first redirect
  by re-fetching the final URL once. Beyond that we label "2+ redirect hops"
  rather than following an unbounded chain (avoids loops and runaway fetches).
- **OK (2xx) links are hidden by default** to keep the table focused on problems,
  matching the acceptance test. A count of hidden OK links is shown.

## Module 2 — Hreflang Validator

- **Full 184-entry ISO 639-1 list shipped inline** (`shared/iso-languages.js`),
  used for real membership validation, not just regex shape. Region subtag is
  validated as a 2-letter ISO 3166-1 shape (regex), plus the literal `x-default`.
- **Reciprocity check fetches each target's HTML via GET** with the same
  concurrency/timeout rules as Module 1. Cross-origin targets that block CORS
  are reported as **"Could not verify (CORS)"** — a soft warning, not a hard fail,
  because the tag may still be correct; we simply cannot read the remote HTML.

## Module 3 — Dofollow/Nofollow Highlighter

- **Single injected stylesheet + classes, never inline per-element styles.** One
  `<style>` rule set keyed on classes we add to each `<a>`. Toggling off removes
  the style element and the classes — the DOM is otherwise untouched.
- **`rel` tokens treated as nofollow:** `nofollow`, `sponsored`, `ugc`.
- **Outline encodes two axes:** color = follow status (green dofollow / red
  nofollow), style = scope (solid internal / dashed external).
- **MutationObserver debounced at 400ms** to refresh counts and re-tag new links
  without thrashing on dynamic pages.

## Module 4 — SERP Location Changer

- **Chosen mechanism: `gl` + `hl` + `uule`.** We ship BOTH. We build a correct
  `uule` parameter (base64 of the canonical-name string, Google's documented
  `w+CAIQICI<lenchar><canonical name>` construction) AND append `gl`/`hl`. `uule`
  gives city-level precision when Google honours it; `gl`/`hl` is the reliable
  country/language fallback that always changes results. Shipping both maximizes
  the chance the SERP actually reflects the chosen location. See README for the
  full uule construction explanation.
- **30 shipped locations** (`shared/locations.js`): a mix of countries and major
  cities across continents, each with `canonical` (for uule), `gl`, `hl`, and a
  human label. A free-text custom-location input builds a uule on the fly.
- **History = last 10** location searches (query + location), stored in
  `chrome.storage.local`, click-to-rerun.

## Module 5 — Pixel-Width SERP Snippet Preview

- **Canvas `measureText` with Arial approximation.** Google's exact SERP font
  (`arial, sans-serif` desktop) is approximated as `20px arial` (title) and
  `14px arial` (description). This is documented as an approximation because
  Google's rendering stack (Roboto/Arial fallback, subpixel hinting) is not
  publicly specified. Pixel width is the primary metric; character count is shown
  as a secondary reference.
- **Truncation thresholds:** title ≈ 580px desktop, description ≈ 920px desktop /
  ≈ 680px mobile shown as both. Amber band starts at 90% of the limit.

## Module 6 — On-Page Elements Analyzer

- **Word count = main content, not the whole page.** The first version counted
  every `<p>` in `<body>`, which still swept in nav/header/footer/sidebar
  paragraphs and inflated the number. It now runs a two-step main-content
  extraction: (1) pick a content root — `<main>`, `[role=main]`, or `<article>`;
  if none exists, score candidate blocks by how much paragraph text they hold
  (a light Readability-style density pick) and take the winner; else fall back to
  `<body>`. (2) Count visible `<p>` words within that root, excluding boilerplate
  — the tags `nav/header/footer/aside/form`, ARIA landmark roles, and elements
  whose class/id match a negative pattern (nav, menu, sidebar, footer, header,
  breadcrumb, comment, cookie/consent, share/social, related, newsletter, etc.)
  unless they also match a positive content pattern (article/post/content/entry/
  main/story/…). Hidden paragraphs are skipped. The detected region is surfaced in
  the UI, and a secondary "whole page" count (body minus script/style/etc., on a
  detached clone so the live DOM is never mutated) is shown for contrast.
- **Tokenizer uses Unicode property escapes** (`\p{L}`/`\p{N}` with the `u` flag)
  so accented and non-Latin scripts count correctly; internal apostrophes and
  hyphens keep contractions and hyphenated compounds as single words. An ASCII-ish
  fallback regex covers the rare engine without Unicode escapes.
- **Reads the DOM, no fetch.** Everything (title, meta, canonical, robots,
  headings, images/alt, links, OG/Twitter, JSON-LD `@type`s) is read from the
  live document — no network requests. Runs as a self-contained injected function
  like Modules 1/2/5, invoked from `background.js`.

## Module 7 — PageSpeed Insights

- **Uses Google's public PSI API (`pagespeedonline/v5`).** Building a Lighthouse
  runner into the extension is impractical; PSI returns the same Lighthouse
  scores + Core Web Vitals plus real-user CrUX field data in one call. We request
  the `performance`, `accessibility`, `best-practices` and `seo` categories.
- **Fetched from the popup, not the background.** The call is user-initiated and
  the result is shown in the popup; `host_permissions` already allows the
  cross-origin request. `credentials:'omit'` and a 60s `AbortController` timeout.
  Results are cached per strategy for the popup session so toggling Mobile/Desktop
  doesn't refetch.
- **Optional API key, stored locally.** Keyless works for occasional checks;
  heavy users can paste a Google API key (kept in `chrome.storage.local`) to raise
  the quota. A 429/quota response shows an actionable hint pointing at the field.
- **Privacy trade-off, made explicit.** This is the only feature that contacts a
  third party: the tested URL is sent to Google's PSI API — but only on an
  explicit "Run test" click, and only for public http(s) URLs (local/private/
  browser pages are blocked in the UI). Documented in the tab and the README.

## Icons

- **Generated as flat PNGs** with a magnifying-glass-on-teal mark via a tiny
  Python script (no PIL dependency — raw PNG encoder). Placeholder-quality but
  crisp at all four sizes; swap freely before Web Store submission.

## Privacy

- **Zero external requests** except (a) the link/hreflang-target fetches the user
  explicitly triggers and (b) opening a Google search tab for Module 4. No
  analytics, no telemetry, no account, no remote config. This is the entire value
  proposition versus the paywalled incumbent.
