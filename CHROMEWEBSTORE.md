# Chrome Web Store Listing — Offline Semantic Search

Last updated: 2026-10-09. Initial release candidate: 1.0.0. Agent publishing guide. The developer uploaded the original 0.1.0 draft; upload 1.0.0 to correct the name before submission.

## Store listing

**Extension name:** Offline Semantic Search

**Short description:** Free, open-source search for relevant text on the current page. Private, offline, with no account or subscription.

**Detailed description:**

Offline Semantic Search is free and open source. Find relevant sentences and paragraphs on the current webpage, even when you describe what you want in different words.

No subscription, account or API key. Source code: https://github.com/matterialize/offline-semantic-search

Type a question or phrase to see ranked passages. Click a result to jump to it on the page. Highlights show the selected text and its nearby context. Use Enter and Shift+Enter to move between results, or Escape to close the search panel. The panel supports light and dark themes.

Click the Offline Semantic Search toolbar icon to search a page. You can also use Alt+Shift+F on Windows/Linux or Option+Shift+F on Mac, subject to your browser's shortcut settings.

Search runs locally on your device. No account, subscription or API key is required. Page text and queries are not sent to Matterialize or an online search service. The extension reads the page you choose when you invoke it; it does not request permanent access to every website.

Search covers accessible text already loaded on ordinary webpages. Protected browser pages, PDF viewers, text inside images, and inaccessible embedded content are outside its scope. Results are related passages, not generated answers or guaranteed factual answers. The initial release targets desktop Chrome. Large pages may take longer to search.

Privacy contact: Matthew Bajorek — matthew.bajorek@matterialize.com
Website: https://matterialize.com/offline-semantic-search/

**Category:** Productivity/search tools; select the corresponding category and subcategory available in the current dashboard.

**Single purpose:** Find and highlight relevant sentences and paragraphs on the current webpage from the user's search query.

**Primary language:** English. The current search models are evaluated for English; do not advertise multilingual support.

## Graphics and assets

| Asset | Dimensions | Status | Filename |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Prepared | `store-assets/icon-128.png` |
| Screenshot 1 — light theme | 1280×800 PNG | Prepared | `docs/screenshots/desktop.png` |
| Screenshot 2 — dark theme | 1280×800 PNG | Prepared | `docs/screenshots/desktop-dark.png` |
| Required small promotional image | 440×280 PNG | Prepared | `store-assets/promo-440x280.png` |
| Marquee promotional image | 1400×560 PNG | Prepared (optional) | `store-assets/marquee-1400x560.png` |

The desktop screenshots capture the actual extension running local search on a fictional guide page. `docs/screenshots/mobile.png` is a narrow-viewport Chromium documentation image, not a phone benchmark or a store claim of Chrome mobile support. Regenerate with `npm run screenshots` after UI changes. Chrome's current [image requirements](https://developer.chrome.com/docs/webstore/images) include the small promo image as well as an icon and screenshot.

## Permissions justification

| Permission/resource | Type | Justification |
| --- | --- | --- |
| `activeTab` | Permission | Grants temporary access to the page the user chooses by clicking the toolbar action or invoking the shortcut, so its text can be searched and matched passages highlighted. |
| `scripting` | Permission | Inserts the page-text extraction and highlighting script into that chosen page after the user's action. |
| No persistent host permissions | — | Production does not request permanent access to all sites. Localhost permission appears only in development/test copies. |
| `panel.html` available to page frames | Web-accessible resource | Displays the extension-origin search panel on the chosen page. This is an embedded resource declaration, not an all-sites host-access permission. |

The extension uses only bundled JavaScript, WASM, model and tokenizer files. Answer **No** to remotely hosted executable code. The local WASM CSP allowance is for bundled inference, not remote execution. Keep the distinction between web-accessible resources and host permissions clear in the dashboard.

## Privacy and data use

Matterialize does not receive search data from the extension. The extension nevertheless **handles website content and user-entered queries locally**. Do not describe it as never accessing user data. Complete the dashboard consistently with [Google's current data-use definitions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [the policy draft](docs/PRIVACY.md).

| Data type | Actual handling | Transmitted off-device by the extension? |
| --- | --- | --- |
| Website content | Accessible rendered text from the selected page is processed in panel/worker memory for search and highlighting. | No |
| User activity / user-provided queries | The search query and selected result are processed locally; no activity analytics or background browsing tracking. | No |
| Personally identifiable, health, financial, personal communication or location information | No separate collection feature; these can occur incidentally in the page text the user chooses to search. They remain local under the website-content processing described above. | No |
| Authentication information / form values | No authentication feature or cookie access; editable form values are outside text extraction. | No |
| Browsing history | No history permission, background history collection or persistent visited-page index. | No |

Data is not sold, used for purposes unrelated to search, or used for creditworthiness/lending. Query and embedding caches are temporary. An explicitly invoked developer export saves a user-controlled local file and does not upload it. These statements apply to the production ZIP, which has no development reload connections.

## Privacy policy

**Public policy content:** `docs/PRIVACY.md`.

**Public URL:** https://github.com/matterialize/offline-semantic-search/blob/main/docs/PRIVACY.md

**Status:** The policy is publicly hosted in this GitHub repository. Use the GitHub URL above in the Chrome Web Store Privacy practices tab. The former Matterialize-hosted copy has been removed.

## Distribution and developer info

**Developer:** Matthew Bajorek (Matterialize)

**Publisher display name:** matterialize (confirmed by the developer).

**Public contact:** matthew.bajorek@matterialize.com (existing developer account confirmed; check verification status in the dashboard).

**Privacy contact:** Matthew Bajorek — matthew.bajorek@matterialize.com

**Homepage:** https://matterialize.com/offline-semantic-search/

**Visibility:** Not selected; unlisted is a reasonable first review/test release, with public distribution chosen in the dashboard when ready.

**Regions:** Confirm in the dashboard; no geography-dependent functionality.

The publisher must have a Chrome Web Store developer account and complete required account verification/2-Step Verification before submission. No account, registration, payment or store action was performed by the release scripts.

## Package and verification

```sh
npm ci
npm run assets
npm run check
npm run package:store
npm run screenshots
```

Upload `artifacts/chrome-web-store/offline-semantic-search-v1.0.0.zip`. It has `manifest.json` at the root, contains both local search models and runtime, and excludes the demo, source, test files, screenshots and submission documents. `package-report.json` alongside it records size and SHA-256. The staging copy is `artifacts/chrome-web-store/extension/`. Retained unused runtime fallback assets can be reviewed for a later size reduction without changing model behavior.

To smoke-test the exact staged package using the existing offline extension test:

```sh
EXTENSION_UNDER_TEST=artifacts/chrome-web-store/extension npm run test:browser -- tests/browser/extension.spec.ts --trace off
```

The test adds localhost permission only to its disposable copy. Real activeTab gesture behavior requires clicking the toolbar icon or invoking the shortcut in Chrome. Use `CHROMIUM_EXECUTABLE_PATH` if the default Playwright browser is unavailable.

## Version history

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 1.0.0 | 2026-10-09 | Initial local page search with ranked passages, section context, highlighting, keyboard navigation and Warm Paper light/dark styling. | Draft |

## Review notes and remaining steps

- Enter the verified public privacy-policy URL in the dashboard.
- Confirm developer-account setup, the verified developer contact email, visibility and distribution regions.
- Upload the production ZIP, store icon, two desktop screenshots and small promo image.
- Enter listing text, single purpose, permission justifications and accurate privacy disclosures.
- Manually try a few ordinary sites, protected pages, restricted CSP, offline cold search, large pages and repeated open/close cycles in the target desktop Chrome versions.
- Submit for review only when those dashboard fields and checks are complete. No publication is promised or performed here.

Search is heuristic and can rank topical passages that do not answer a question. The development acceptance cutoff and 40-candidate reranking limit constrain recall. Measured memory is substantial on long pages; see `docs/VALIDATION.md`. Chrome mobile support and physical iPhone performance are not claimed. Model attribution/licenses are bundled in `NOTICE.md` and `licenses/`. Research evidence and implementation details belong in the repository documentation, not the user-facing store description.

## Submission steps

1. Register in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), pay the one-time registration fee and complete account setup. Choose the public publisher name and verify matthew.bajorek@matterialize.com. Enable 2-Step Verification and complete any verification requested by the dashboard.
2. Publish `docs/PRIVACY.md` at a stable URL accessible without signing in. The policy must describe local page-text and query processing, temporary caches and the optional local export.
3. Run `npm run package:store` and upload the generated ZIP using **Add new item**. The current package is about 131.6 MB; Google's maximum is 2 GB.
4. Fill in the listing using the copy above. Upload the prepared icon, at least one desktop screenshot and the 440×280 promotional image.
5. Complete the Privacy tab: explain the single purpose, justify `activeTab` and `scripting`, disclose local website-content/query handling and enter the public policy URL. Declare that there is no remotely hosted executable code.
6. Choose distribution regions and visibility. Submit for review; choose deferred publishing if you want to publish manually after approval.

Official references: [registration](https://developer.chrome.com/docs/webstore/register), [account and public contact requirements](https://developer.chrome.com/docs/webstore/set-up-account), [publishing workflow](https://developer.chrome.com/docs/webstore/publish), [required graphics](https://developer.chrome.com/docs/webstore/images), and [local-data disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Agent handoff

The public README explains use and development; deployment instructions stay here. The developer confirmed an existing registered account, publisher display name `matterialize`, and contact `matthew.bajorek@matterialize.com`. Before a first submission, check Google sign-in, 2-Step Verification and contact-email verification. Use the signed-in dashboard for the initial listing and privacy fields. API automation additionally requires an authorized Chrome Web Store OAuth connection and the publisher/item IDs; do not ask for passwords or paste tokens into chat.

Preserve the extension repository as a single initial-release commit when committing and pushing release changes.
