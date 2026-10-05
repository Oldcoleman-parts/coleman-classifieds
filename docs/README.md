# Coleman Classifieds — documentation index

## Features

| Feature                                              | Title                    | Phase | Depends on | Tickets | Estimate | Status |
| ---------------------------------------------------- | ------------------------ | ----- | ---------- | ------- | -------- | ------ |
| [F01](features/01-foundation/README.md)              | Foundation and platform  | 1     | —          | 2       | ~3 d     | To do  |
| [F02](features/02-email-and-photos/README.md)        | Email and photo services | 1     | 01         | 2       | ~3.5 d   | To do  |
| [F03](features/03-seller-journey/README.md)          | Seller journey           | 1     | 01, 02     | 2       | ~4 d     | To do  |
| [F04](features/04-staff-console/README.md)           | Staff console            | 1     | 01, 03     | 2       | ~3.5 d   | To do  |
| [F05](features/05-payments-and-publishing/README.md) | Payments and publishing  | 1     | 02, 04     | 2       | ~4.5 d   | To do  |
| [F06](features/06-contact-and-alerts/README.md)      | Buyer contact and alerts | 1     | 05         | 2       | ~2.5 d   | To do  |
| [F07](features/07-operations-and-launch/README.md)   | Operations and launch    | 1     | 02–06      | 3       | ~2.5 d   | To do  |
| [F08](features/08-renewals/README.md)                | Automatic renewals       | 2     | 05, 07     | 2       | ~3 d     | To do  |
| [F09](features/09-open-submissions/README.md)        | Open submissions         | Later | 03, 04     | 1       | ~1.5 d   | To do  |

**Build order:** F01 → F02 → F03 → F04 → F05 ★ → F06 → F07 → launch.

- The two F02 tickets (email and photos) are independent; so are the two F06 tickets.
- ★ The sample workflow milestone comes after F05: invite → submit → approve → pay → live.

## Reviews (on demand)

Code review and security audits are **not** part of each ticket. Run them whenever you choose, for example after 2–3 features:

- `/review-all`: code + security for everything since the last checkpoint.
- `/code-review F03 F04`, `/security-review F05`: specific features.

Reports and the checkpoint log live in `reviews/`. Launch (F07-T2) requires every launch feature to be reviewed, with no open Critical or High findings.

## Shared docs

- `product/overview.md`, `architecture/{architecture,data-model,events,shopify-config,operations}.md`
- `reference/`: email defaults, end-to-end acceptance (plus ses-setup, theme-install, shippingeasy and recovery-runbook, written during the build)
- `CHEATSHEET.md`: every command
