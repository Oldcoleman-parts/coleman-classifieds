# F03-FIX-2 — Only approved photos may be published

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | Done                                         |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `media`, `core` (event payloads)             |
| **Security skills** | `security-media`, `security-core`            |

Start with `/implement-ticket F03-FIX-2`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

The media listeners call `publish(listingId)` with no photo list (`app/modules/media/events.js:8-9`), and `publish()` and `getPublicUrls()` take every current photo of the listing (`services/publish.js:43-51,63-73`). A live listing with a pending revision that added a photo would publish that unreviewed photo as soon as `ListingWentLive` fires again (an overdue payment, a renewal). A rejected revision’s photo behaves the same until something deletes it. Nothing triggers this yet, because F04 (revisions) is not built; it must be fixed before F04-T2.

## Scope

- [x] Decide where “approved photos” is recorded and write it in `docs/architecture/data-model.md`: recommended is the approved `photoIds` carried by `ListingWentLive` and `RevisionApproved` (core change, `docs/architecture/events.md`), with media remembering which photos are approved.
- [x] The listeners publish only the approved photos; a photo that is not approved is never written to `public/`.
- [x] `getPublicUrls()` returns approved, published photos only.
- [x] `publish()` refuses a listing that is closed, and an hourly sweep unpublishes closed listings that still have public photos (covers a failed `ListingClosed` handler).
- [x] Update the F04-T2, F05-T1 and F06-T2 notes with the new contract.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [x] A listing with an approved photo and an unapproved one: after `ListingWentLive`, only the approved photo is in `public/` and in `getPublicUrls()`.
- [x] After `RevisionApproved` for the revision that added the photo, it is published.
- [x] `publish()` on a closed listing writes nothing; a closed listing left with public photos is cleaned by the sweep.
- [x] `npm run test:ai` is green for this feature (full suite: 444 passed, 1 skipped).

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Found by the media security audit. This needs a small change to core’s event payloads, so plan it with the user first.
- Depends on how F04 models a revision’s photos (`ListingRevision.photoIds` exists in the data model).
- Built 2026-10-06. Migration `20261006043552_photo_approved_at` adds `Photo.approvedAt` and marks photos that are already public as approved.
- DECISION: approval is stored on `Photo.approvedAt` (media-owned). The ids travel on `ListingApproved.photoIds` / `RevisionApproved.photoIds`, not on `ListingWentLive`: that event also fires on payment and renewal with no staff decision, so core would have had to store media's photo list.
- DECISION: `APPROVE` and `APPROVE_REVISION` require `photoIds` (may be empty, at most `maxPhotos`, checked by the new `core.requireIdList`). `REISSUE` approves nothing new.
- DECISION: `publish()` on a closed listing logs and returns `[]` (no error), and unpublishes again if the listing closed during the run. The `publish(listingId, { photoIds })` option is removed.
- DECISION: no separate `PhotosApproved` audit row; the event's audit row stores the `photoIds`. The sweep writes `PhotosUnpublished` with `by: "sweep"`.
- Defaults for open questions: if media fails to record an approval, the listing goes live without photos (staff see `approved: false` in `listPhotos()`), so revisit in F05. Photos staff add to a live listing are not approved automatically (F05 decides). A paused listing's photos stay public.
- Tests: `media/tests/approval.test.js` (AC1, AC2, other-listing ids, repeat), `media/tests/sweep.test.js` (AC3, repeat, LIVE untouched), `media/tests/register.test.js` (task registered), `core/tests/lifecycle.test.js` (photoIds refused or audited), `core/tests/validators.test.js` (`requireIdList`).
