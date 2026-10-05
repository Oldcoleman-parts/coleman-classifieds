# F03-FIX-1 — A repeated upload completion must not delete the stored photo

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | Done                                         |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `media`                                      |
| **Security skills** | `security-media`                             |

Start with `/implement-ticket F03-FIX-1`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

In `completeUpload()` (`app/modules/media/services/uploads.js:169,192-197`) the stored file is written before the transaction, and the “listing is full” check runs before the insert. When two requests complete the same photo and it takes the last place, the second one gets “too many photos” (not the duplicate-key path) and deletes the `private/` file, which now belongs to the first request’s `Photo` row. `publish()` later throws on that row and skips the listing’s remaining photos. Reproduced during the audit.

## Scope

- [x] Inside the per-listing lock, look the photo up by id first and return it when it exists; only then count and insert.
- [x] On any failure, delete the stored file only when no `Photo` row for that id exists.
- [x] Check the photo count before downloading and decoding, so a full listing is refused cheaply (the count is still re-checked in the lock).
- [x] `deleteObjects()` throws when S3 reports per-key `Errors` (`services/store.js:52-59`), and `mockS3` can return them.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [x] Two parallel `completeUpload()` calls for the same photo, with one place left, both return the same photo and its `private/` object still exists.
- [x] A different photo that loses the race for the last place is refused and only its own files are removed.
- [x] A full listing is refused before the upload is read.
- [x] A `DeleteObjects` answer with `Errors` is treated as a failure.
- [x] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Rated High by the code review and Medium by the media audit; kept at High because it silently destroys a stored photo.
- Built in `services/uploads.js` (`completeUpload()`), `services/store.js` (`deleteObjects()` throws on per-key `Errors`), `services/publish.js` (a failed clean-up of unneeded copies no longer skips the remaining photos) and `tests/factories.js` (`mockS3().failDeletes`).
- DECISION (stricter than the scope line): after a failed insert the stored file is deleted only when the failure was a refusal (listing full) **and** no row owns the file. The ownership check takes the listing’s lock again, so it can’t run before a same-photo request that is inserting has committed. After any other error nothing is deleted, so the call can be retried.
- DECISION: the file is still written to `private/` before the transaction. Inside it, the lock and a connection would be held during an S3 upload; after it, a failed write would leave a photo with no file (the original symptom). Worst case now: a spare private file with no metadata.
- DECISION: clean-up deletes in `completeUpload()` are logged, never thrown, so a failed clean-up can’t hide the upload’s own result. `incoming/` is also emptied daily by the bucket rule.
- DECISION: an early refusal (listing already full) removes the upload from `incoming/` without downloading it.
- Follow-ups, not built here: `deletePhoto()` removes the file before taking the lock, so a repeat completion at that moment could re-write a spare file; a failed delete in retention stops the listings after it on every run. Both are covered by the Medium “takedown isn’t reliable” item in review 1.
- Closed with `app/modules/media/tests/upload-race.test.js` (7 tests; three of them fail on the code before the fix). Not covered by a test: the branch that keeps the files after an unexpected (non-validation) database error.
