# Chrome Web Store — Submission Guide (copy-paste ready)

Everything you need to fill in the Developer Dashboard. Sections match the
dashboard sidebar: **Package · Store listing · Privacy · Distribution · Test
instructions**.

> One-time setup: register a Chrome Web Store developer account
> (https://chrome.google.com/webstore/devconsole) — a **US$5 one-time fee**.

---

## Package

Upload **`seo-sidekick.zip`** (the packaged extension — `manifest.json` is at the
zip root). No build step; it's ready as-is.

---

## Store listing

**Name**
```
SEO Sidekick — On-Page & AI SEO Toolkit
```

**Summary** (132 chars max)
```
Free, no account. On-page audit, AI/GEO readiness, broken links, indexability, hreflang, schema & snippet preview — in a side panel.
```

**Category:** `Developer Tools`
**Language:** `English`

**Description** (paste as-is)
```
SEO Sidekick is a free, private, on-page SEO toolkit that opens as a docked side
panel — so the page stays visible right next to your analysis. No account, no
sign-up, no analytics. Everything runs locally in your browser.

Seven tools in one panel:

• Broken Link Checker — scans the links on the page and reports real HTTP status
  (external links included), redirects, and CSV export.

• On-Page Analyzer — title, meta description, a full heading outline, link and
  image inventories (with export), canonical/robots/viewport, Open Graph and
  Twitter tags, and a main-content word count that ignores nav/header/footer so
  the number reflects the actual article. Structured-data validation (JSON-LD,
  Microdata, RDFa) with per-block JSON download.

• AI / GEO Readiness — the tool built for AI search. Audits which AI crawlers are
  allowed or blocked in robots.txt (GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended, CCBot and more), checks for llms.txt, scores how "quotable"
  your page is for AI answers, and shows keyword density and readability.

• Technical & Indexability — a clear "Will Google index this?" verdict combining
  the X-Robots-Tag response header, meta robots, canonical, and robots.txt, plus
  a robots.txt and XML-sitemap check.

• Hreflang Validator — real ISO 639-1 language-code validation, self-reference,
  duplicates, and return-tag reciprocity.

• Dofollow / Nofollow Highlighter — outlines every link by follow status and
  internal/external scope, with live counts.

• Snippet Preview — pixel-accurate Google title/description widths with desktop
  and mobile truncation points and a live preview card.

Privacy first: SEO Sidekick collects no data. The only network requests are the
checks you run (link/hreflang/robots/sitemap/header lookups), which go straight
from your browser to the site you're analyzing. There is no backend.

Built for SEO professionals who want a fast, private on-page + AI-search toolkit —
for free.
```

**Graphics** (files are in the `store/` folder + `icons/`)

| Asset | Size | File | Required? |
|---|---|---|---|
| Store icon | 128×128 | `store/icon-128x128.png` | Yes |
| Screenshot(s) | 1280×800 (or 640×400) | *you capture — see below* | **Yes, at least 1** |
| Small promo tile | 440×280 | `store/promo-small-440x280.png` | Optional (recommended) |
| Marquee promo | 1400×560 | `store/promo-marquee-1400x560.png` | Optional |

**Screenshots — capture 3–5 (required):** with the extension loaded, open a
content page (a blog article works well), click the icon to open the side panel,
and screenshot each tab. Good ones: On-Page (headings outline + schema),
AI/GEO (score + AI-crawler access), Tech (indexability verdict), Links. Crop each
to **1280×800**. Tip: `chrome://extensions` → your extension → take clean shots;
or use the browser's device toolbar to size the window.

---

## Privacy tab

**Single purpose** (paste)
```
SEO Sidekick is a single-purpose on-page SEO analysis tool. When the user opens
it on a web page, it inspects that page (and the site's robots.txt and sitemap)
and reports SEO diagnostics: broken links, on-page elements, structured data,
AI-crawler readiness, indexability, hreflang, and a snippet preview.
```

**Permission justifications**

- **activeTab**
  ```
  Used to read the current page the user is viewing when they open the panel, to
  run the on-page analysis (title, meta, headings, links, images, structured
  data, word count).
  ```
- **scripting**
  ```
  Used to inject the analysis scripts into the current page on demand to read its
  DOM and to toggle the link highlighter. Nothing is injected until the user
  opens the panel or runs a tool.
  ```
- **storage**
  ```
  Used only to remember the user's local UI preferences on their own device. No
  data is transmitted.
  ```
- **sidePanel**
  ```
  Used to display the extension's interface in Chrome's side panel.
  ```
- **Host permissions (all sites)**
  ```
  Required so the Broken Link Checker can fetch the page's link URLs to report
  their HTTP status, and so the AI/GEO and Technical tabs can fetch the site's
  robots.txt, llms.txt and XML sitemap and read the page's response headers.
  These requests run only when the user triggers a check; nothing is fetched in
  the background and no data is collected.
  ```

**Are you using remote code?** → **No** (all code is in the package).

**Data usage** — check that the extension:
- does **not** collect or use any of the listed user-data types,
- does **not** sell or transfer user data to third parties,
- does **not** use data for purposes unrelated to the item's single purpose,
- does **not** use data to determine creditworthiness / for lending.

**Privacy policy URL** (required because of broad host access) — after you push
this repo, use:
```
https://github.com/bobadesiddesh1-cmyk/seo-sidekick/blob/main/PRIVACY.md
```

---

## Distribution tab

- **Visibility:** Public (or Unlisted if you want a link-only launch first).
- **Regions:** All regions.
- **Pricing:** Free.

---

## Test instructions (Access tab)

```
No account or login is required.

1. Load the extension and open any normal website (e.g. a blog article, or
   https://example.com).
2. Click the SEO Sidekick toolbar icon — a side panel opens on the right and the
   On-Page tab analyzes the page automatically.
3. Open the AI/GEO and Tech tabs — each runs automatically and fetches the site's
   robots.txt / sitemap.
4. Open the Links tab and click "Scan this page for broken links".

No credentials, servers, or external accounts are involved.
```

---

## Pre-submit checklist

- [ ] Developer account registered ($5 paid)
- [ ] `seo-sidekick.zip` uploaded under **Package**
- [ ] Name, summary, description, category filled under **Store listing**
- [ ] 128×128 icon + at least one 1280×800 screenshot uploaded
- [ ] (Optional) 440×280 and 1400×560 promo tiles uploaded
- [ ] Single purpose + all permission justifications filled under **Privacy**
- [ ] Data-usage disclosures set to "does not collect" and certified
- [ ] Privacy policy URL added
- [ ] Test instructions added
- [ ] Visibility + regions + free pricing set under **Distribution**
- [ ] Submit for review
