# F03-FIX-2 — Only approved photos may be published

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | To do                                        |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `media`, `core` (event payloads)             |
| **Security skills** | `security-media`, `security-core`            |

Start with `/implement-ticket F03-FIX-2`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

The media listeners call `publish(listingId)` with no photo list (`app/modules/media/events.js:8-9`), and `publish()` and `getPublicUrls()` take every current photo of the listing (`services/publish.js:43-51,63-73`). A live listing with a pending revision that added a photo would publish that unreviewed photo as soon as `ListingWentLive` fires again (an overdue payment, a renewal). A rejected revision’s photo behaves the same until something deletes it. Nothing triggers this yet, because F04 (revisions) is not built; it must be fixed before F04-T2.

## Scope

- [ ] Decide where “approved photos” is recorded and write it in `docs/architecture/data-model.md`: recommended is the approved `photoIds` carried by `ListingWentLive` and `RevisionApproved` (core change, `docs/architecture/events.md`), with media remembering which photos are approved.
- [ ] The listeners publish only the approved photos; a photo that is not approved is never written to `public/`.
- [ ] `getPublicUrls()` returns approved, published photos only.
- [ ] `publish()` refuses a listing that is closed, and an hourly sweep unpublishes closed listings that still have public photos (covers a failed `ListingClosed` handler).
- [ ] Update the F04-T2, F05-T1 and F06-T2 notes with the new contract.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [ ] A listing with an approved photo and an unapproved one: after `ListingWentLive`, only the approved photo is in `public/` and in `getPublicUrls()`.
- [ ] After `RevisionApproved` for the revision that added the photo, it is published.
- [ ] `publish()` on a closed listing writes nothing; a closed listing left with public photos is cleaned by the sweep.
- [ ] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Found by the media security audit. This needs a small change to core’s event payloads, so plan it with the user first.
- Depends on how F04 models a revision’s photos (`ListingRevision.photoIds` exists in the data model).
