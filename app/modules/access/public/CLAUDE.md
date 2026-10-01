# Module `access/public` — part of F09 Open submissions

Sellers request a listing without an invitation; staff approval is still required.

- **Spec and tickets:** `docs/features/09-open-submissions/`
- **Security skill:** `security-open-submissions` (loads automatically when you edit this module; audits are on demand).
- **Events:** Existing events; listens to `FeatureToggled`.

## Rules for this feature

- 404 unless released and enabled; email verification; one open listing per email; Turnstile and rate limits; standard or promo fee only.

## Boundaries

- Export only through `index.ts`. Never import other modules’ `services/`; use their `index.ts` or events.
- Status changes go through `core` `transition()`.
