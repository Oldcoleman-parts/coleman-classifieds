# F03-FIX-1 — A repeated upload completion must not delete the stored photo

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | To do                                        |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `media`                                      |
| **Security skills** | `security-media`                             |

Start with `/implement-ticket F03-FIX-1`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

In `completeUpload()` (`app/modules/media/services/uploads.js:169,192-197`) the stored file is written before the transaction, and the “listing is full” check runs before the insert. When two requests complete the same photo and it takes the last place, the second one gets “too many photos” (not the duplicate-key path) and deletes the `private/` file, which now belongs to the first request’s `Photo` row. `publish()` later throws on that row and skips the listing’s remaining photos. Reproduced during the audit.

## Scope

- [ ] Inside the per-listing lock, look the photo up by id first and return it when it exists; only then count and insert.
- [ ] On any failure, delete the stored file only when no `Photo` row for that id exists.
- [ ] Check the photo count before downloading and decoding, so a full listing is refused cheaply (the count is still re-checked in the lock).
- [ ] `deleteObjects()` throws when S3 reports per-key `Errors` (`services/store.js:52-59`), and `mockS3` can return them.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [ ] Two parallel `completeUpload()` calls for the same photo, with one place left, both return the same photo and its `private/` object still exists.
- [ ] A different photo that loses the race for the last place is refused and only its own files are removed.
- [ ] A full listing is refused before the upload is read.
- [ ] A `DeleteObjects` answer with `Errors` is treated as a failure.
- [ ] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Rated High by the code review and Medium by the media audit; kept at High because it silently destroys a stored photo.
