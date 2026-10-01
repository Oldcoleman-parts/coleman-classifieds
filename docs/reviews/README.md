# Reviews

Reviews are run on demand with `/code-review`, `/security-review` or `/review-all`.

- **Scope:** by default, everything changed since the last checkpoint (git tag `review-N`). You can also name features (`/review-all F03 F04`).
- **Report:** `docs/reviews/YYYY-MM-DD-review-N.md`, with findings grouped as Critical, High, Medium and Low.
- **Fix tickets:** Critical and High findings become tickets `FNN-FIX-N` in the right feature folder.
- **Checkpoint:** once you confirm, the review is appended to `review-log.json` and tagged `review-N`.
- **Launch gate:** every launch feature must appear in a completed review (code + security), with `openCriticalHigh` = 0.
