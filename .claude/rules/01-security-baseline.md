# Security and privacy rules (always loaded)

- Verify HMAC on every webhook and every app proxy request. Admin routes use Shopify session auth only.
- Invitation tokens and email codes: store only `sha256(value + TOKEN_PEPPER)`, compare in constant time, and **never log them**.
- Public output (storefront, metaobjects, emails to buyers) must never contain the seller's email, phone, last name or street address.
- Strip EXIF/GPS from every photo before it can be published.
- Rate-limit every public (proxy) POST endpoint and use Turnstile plus a honeypot on public forms.
- Seller pages send `X-Robots-Tag: noindex, nofollow`.
- Never read, print or commit `.env` files or AWS or Shopify secrets.
- Write an `AuditEvent` for every state change and staff action, including the staff email from the session.
