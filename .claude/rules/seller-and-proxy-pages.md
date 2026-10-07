---
paths:
  - "app/routes/proxy.*"
  - "app/modules/workspace/**"
  - "app/modules/contact/**"
  - "app/modules/access/**"
---

# Seller and public proxy page rules

- Pages the app serves through the proxy are standalone documents (Liquid response with `layout: false`), never inside the theme, styled to match the store, and must work at a 360px width first. Pages whose URL carries a seller token load no script, stylesheet or font from another origin (the staff-set logo image is the only outside file).
- Resolve the seller token on **every** request, and check that the action is allowed for the current listing status on the server. Never trust hidden fields or UI state.
- Clearly label each field as **Public** or **Private**.
- Seller-facing wording is plain and friendly. Show the fee and duration before any commitment.
- There must be no path that creates a second listing from one invitation.
- Seller live edits: price, quantity, availability note and photo removal are immediate. Title, description and photo additions create a revision. No path may add or replace merchandise.
- Buyer messages: BLOCKED (bot, honeypot, rate) → rejected; HELD (settings rules) → not delivered until a staff release.
