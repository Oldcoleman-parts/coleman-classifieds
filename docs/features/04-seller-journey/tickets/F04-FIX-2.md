# F04-FIX-2 — Seller pages render outside the theme

|                     |                                         |
| ------------------- | --------------------------------------- |
| **Status**          | Done                                    |
| **Feature**         | [F04 Seller journey](../README.md)      |
| **Module(s)**       | `access`, `workspace` (page styles)     |
| **Security skills** | `security-access`, `security-workspace` |

Start with `/implement-ticket F04-FIX-2`. From [review 3](../../../reviews/2026-10-07-review-3.md) (**High**, security audit of `access`). Must be done before launch.

## Problem

`sellerLayout()` in `app/modules/access/services/seller-pages.js:46` calls `liquid()` without `layout: false`, so every seller page is rendered inside the storefront theme. Theme scripts, Shopify analytics and any installed pixel then run on a page whose URL is the seller's token. The token is also in the page markup (form actions), and the same scripts can read the device credential from `localStorage`. `Referrer-Policy: no-referrer` only covers the Referer header. A pixel that records page URLs collects working seller links, which breaks "tokens never reach analytics or third parties" in `security-access`.

## Scope

- [x] Every page whose URL carries the token is returned with `layout: false` (the `{% layout none %}` form of `liquid()`): the gate pages in `access` and the listing pages in `workspace` that use `sellerLayout()`.
- [x] Those pages bring their own minimal document: `<html>`, title, viewport, `noindex`, `no-referrer`, and a small stylesheet so the forms stay usable on a phone. No theme assets, no third-party scripts.
- [x] The Get my link page (`/apps/classifieds/my-link`) is standalone too, so every app page looks the same (changed on 2026-10-07, see Notes). It has no token in its URL and keeps the Turnstile script.
- [x] Existing headers are kept: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.

## Out of scope

- Replacing the `localStorage` device credential or making it revocable (a review 3 Medium; needs its own decision).
- Server request logs (F01-FIX-7).

## Acceptance criteria

- [x] Every seller page response starts with `{% layout none %}` (test over each stage: code request, code verify, draft, submitted, changes requested, awaiting payment, live, closed, and the error pages).
- [x] No seller page includes a `<script src>` or stylesheet link to another origin (test).
- [x] The Get my link pages are standalone too, and the Turnstile script on the form is their only cross-origin script (test).
- [x] The pages are usable on the dev store on a phone-width screen (recorded manual check).
- [x] `npm run test:ai` is green for `access` and `workspace`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- **Manual check (user, dev store, 2026-10-07):** the seller link pages and Get my link work at a 360px width. View source and the Network tab show no script, analytics, pixel or theme request on the seller link page, so nothing is injected when the theme layout is off.

- **Decision (user, 2026-10-07): every page the app serves is standalone, none inside the theme.** This changes the original third scope item and third criterion, which let Get my link stay in the theme. `.claude/rules/seller-and-proxy-pages.md` and the `access` and `workspace` `CLAUDE.md` files are updated to match.
- **Decision (user, 2026-10-07): the pages are styled to match the store.** `SELLER_CSS` in `access/services/seller-pages.js` holds fixed values read from the public oldcolemanparts.com theme (Horizon 3.4.0): white page, navy `#0f2d58` headings, `#3b3b3b` text, black buttons with a 14px radius, 4px inputs, red `#c0252a` accent. If the theme is restyled, this block is updated by hand.
- **Decision (user, 2026-10-07): the header shows a logo set in Settings.** The existing "Logo link" in Settings → Emails (`EmailSettings.logoUrl`, read through `getEmailSettings()` from the notifications `index.js`) is used for both emails and pages; no new setting or schema change. With no logo, the store name is shown. `sellerLayout()` and every renderer built on it are async because of this read.
- **Decision (user, 2026-10-07): a fuller design.** White header with the logo, a navy title band ("Private seller classifieds" plus the page title), the content in a white card, and on the listing page a four-step progress bar (Prepare, Review, Payment, Live) from `stepsBar()` in `workspace/services/views.js`. Changes requested counts as Prepare; an ended or lapsed listing shows no steps.
- The logo is an https image from wherever staff host it, loaded with `referrerpolicy="no-referrer"`. It is the only file a token page loads from another origin; an image cannot read the page or its URL.
- The font stack names Inter first but does not load it, so most devices show their system font.
- `closedAfterAll` in `workspace/services/handlers.js` (the 410 page) called `liquid` directly; it now uses `sellerLayout()`.
- `sellerLayout()` sets `X-Robots-Tag` itself as well as the proxy wrapper.
- Follow-up (F03, `notifications`): the logo is a pasted link; an upload field in Settings would be easier for staff. A button colour for the pages could reuse `buttonColor` if wanted.
- Follow-up (F01, `platform`): the JSDoc at `platform/services/proxy.js:11` still says `liquid` renders inside the theme.
- Follow-up (F01 or F04): a Content-Security-Policy for token pages.
- Follow-up (F07): the buyer contact pages must use the same standalone layout.
