# F04-FIX-2 — Seller pages render outside the theme

|                     |                                         |
| ------------------- | --------------------------------------- |
| **Status**          | To do                                   |
| **Feature**         | [F04 Seller journey](../README.md)      |
| **Module(s)**       | `access`, `workspace` (page styles)     |
| **Security skills** | `security-access`, `security-workspace` |

Start with `/implement-ticket F04-FIX-2`. From [review 3](../../../reviews/2026-10-07-review-3.md) (**High**, security audit of `access`). Must be done before launch.

## Problem

`sellerLayout()` in `app/modules/access/services/seller-pages.js:46` calls `liquid()` without `layout: false`, so every seller page is rendered inside the storefront theme. Theme scripts, Shopify analytics and any installed pixel then run on a page whose URL is the seller's token. The token is also in the page markup (form actions), and the same scripts can read the device credential from `localStorage`. `Referrer-Policy: no-referrer` only covers the Referer header. A pixel that records page URLs collects working seller links, which breaks "tokens never reach analytics or third parties" in `security-access`.

## Scope

- [ ] Every page whose URL carries the token is returned with `layout: false` (the `{% layout none %}` form of `liquid()`): the gate pages in `access` and the listing pages in `workspace` that use `sellerLayout()`.
- [ ] Those pages bring their own minimal document: `<html>`, title, viewport, `noindex`, `no-referrer`, and a small stylesheet so the forms stay usable on a phone. No theme assets, no third-party scripts.
- [ ] The Get my link page (`/apps/classifieds/my-link`) has no token in its URL and may stay inside the theme.
- [ ] Existing headers are kept: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.

## Out of scope

- Replacing the `localStorage` device credential or making it revocable (a review 3 Medium; needs its own decision).
- Server request logs (F01-FIX-7).

## Acceptance criteria

- [ ] Every seller page response starts with `{% layout none %}` (test over each stage: code request, code verify, draft, submitted, changes requested, awaiting payment, live, closed, and the error pages).
- [ ] No seller page includes a `<script src>` or stylesheet link to another origin (test).
- [ ] The Get my link page still renders inside the theme (test).
- [ ] The pages are usable on the dev store on a phone-width screen (recorded manual check).
- [ ] `npm run test:ai` is green for `access` and `workspace`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._
