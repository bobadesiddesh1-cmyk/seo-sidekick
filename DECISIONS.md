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

- **HEAD-first, GET fallback for same-origin.** `fetch(HEAD, no-cors)` returns an
  opaque response (status 0) for cross-origin, so we cannot read its status. For
  same-origin links we retry with `GET` (readable status). Cross-origin links
  that stay opaque are labelled **"Unknown (CORS)"** rather than guessed.
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

- **Word count is `<p>`-first by design.** The headline number counts words inside
  the `<body>`'s visible `<p>` paragraph tags only, because that best approximates
  the page's actual editorial content and excludes navigation, menus, sidebars,
  scripts and boilerplate — matching how SEO tools report "content words". Hidden
  paragraphs (`display:none` / `visibility:hidden` / `opacity:0`) are skipped. A
  secondary "all body text" count (body minus `script`/`style`/`noscript`/
  `template`/`svg`/`iframe`, computed on a detached clone so the live DOM is never
  mutated) is shown for reference, along with heading-word count and reading time.
- **Tokenizer uses Unicode property escapes** (`\p{L}`/`\p{N}` with the `u` flag)
  so accented and non-Latin scripts count correctly; internal apostrophes and
  hyphens keep contractions and hyphenated compounds as single words. An ASCII-ish
  fallback regex covers the rare engine without Unicode escapes.
- **Reads the DOM, no fetch.** Everything (title, meta, canonical, robots,
  headings, images/alt, links, OG/Twitter, JSON-LD `@type`s) is read from the
  live document — no network requests. Runs as a self-contained injected function
  like Modules 1/2/5, invoked from `background.js`.

## Icons

- **Generated as flat PNGs** with a magnifying-glass-on-teal mark via a tiny
  Python script (no PIL dependency — raw PNG encoder). Placeholder-quality but
  crisp at all four sizes; swap freely before Web Store submission.

## Privacy

- **Zero external requests** except (a) the link/hreflang-target fetches the user
  explicitly triggers and (b) opening a Google search tab for Module 4. No
  analytics, no telemetry, no account, no remote config. This is the entire value
  proposition versus the paywalled incumbent.
