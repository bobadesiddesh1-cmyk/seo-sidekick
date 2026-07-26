# Privacy Policy — SEO Sidekick

_Last updated: 2026_

**SEO Sidekick does not collect, store, transmit, or sell any personal data.**
There are no accounts, no analytics, no telemetry, and no tracking of any kind.
Everything the extension does runs locally in your browser.

## What data we collect

**None.** We do not collect personally identifiable information, browsing
history, web-form data, authentication information, location, financial
information, health information, or any personal communications. We operate no
servers and receive nothing from you.

## Local storage on your device

The extension uses Chrome's local storage (`chrome.storage.local`) only to
remember your own preferences on your own device (for example, UI settings). This
data never leaves your computer and is not shared with us or anyone else.

## Network requests

SEO Sidekick only makes network requests that **you explicitly trigger** by
running a check, and those requests go **directly from your browser to the
website you are analyzing** — never to us:

- **Broken Link Checker** — requests the link URLs on the current page to read
  their HTTP status.
- **Hreflang Validator** — requests each hreflang target page to verify return
  tags.
- **AI/GEO** and **Technical** tabs — request the current site's `robots.txt`,
  `llms.txt`, and XML sitemap, and the current page's response headers.

No data from these requests is collected, logged, or transmitted to the
developer. The extension has no backend.

## Permissions

Permissions are used solely to provide the features above:

- **activeTab / scripting** — to read the current page's content (headings,
  links, images, structured data, etc.) when you open the panel or a tool.
- **host permissions (all sites)** — required so the checks above can fetch link
  targets, `robots.txt`, sitemaps, and response headers of the site you are
  analyzing.
- **storage** — to remember your local preferences.
- **sidePanel** — to show the extension's interface in Chrome's side panel.

## Data sharing and sale

We do not sell, rent, or share any data, because we do not collect any.

## Changes to this policy

If this policy changes, the updated version will be posted at this URL.

## Contact

Questions? Contact the developer at **bobadesiddesh1@gmail.com**.
