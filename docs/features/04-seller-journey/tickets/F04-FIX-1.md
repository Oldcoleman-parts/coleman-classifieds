# F04-FIX-1 — Apply staff decisions on a revision

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | Done                               |
| **Feature**         | [F04 Seller journey](../README.md) |
| **Module(s)**       | `workspace`                        |
| **Security skills** | `security-workspace`               |

Start with `/implement-ticket F04-FIX-1`. Follow-up from [F04-T2](F04-T2.md) (Notes). Must be done before F06 publishes listings.

## Scope

- [x] `workspace` gets `register()` (plus one line in `app/bootstrap.server.js`) with listeners:
  - `RevisionApproved`: copy the revision’s `changes` (title, description) into `Listing`, set the revision APPROVED with `decidedAt` and `decidedBy` (from the event’s actor).
  - `RevisionRejected`: set the revision REJECTED with `decidedAt`/`decidedBy`, and delete its photos with `media.deletePhoto()` to free the slots.
- [x] Both are idempotent: a repeated event changes nothing (only a PENDING revision is decided).

## Out of scope

- The staff review screen (F05) and publishing the change to the metaobject (F06).

## Acceptance criteria

- [x] After `RevisionApproved`, the listing shows the new title and description and the seller can send a new revision.
- [x] After `RevisionRejected`, the revision’s photos are deleted and the listing is unchanged.
- [x] A repeated event does nothing.
- [x] `npm run test:ai` is green for `workspace`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T2 (2026-10-06). Until this is done, a seller with a decided revision can still send new ones only once it is no longer PENDING.
- Built 2026-10-06: `workspace/events.js`, `services/revisions.js`, `cleanRevisionChanges` in `services/fields.js`, `register()` in `index.js`, one line in `app/bootstrap.server.js`. No schema change.
- DECISION: only a PENDING revision of the event’s listing is decided (`updateMany where status PENDING`); a repeat, another listing’s revision or a decided one changes nothing. `decidedBy` = the staff email from the event; non-STAFF events are ignored.
- DECISION: stored `changes` are checked again (only title/description, same rules as the form). If they fail, nothing is applied and the revision stays PENDING; staff can approve again.
- DECISION: on rejection only never-approved photos of the revision are deleted (a live photo is never lost), with the deciding staff member as the media actor (media refuses SYSTEM). A repeated rejection retries failed deletes.
- DECISION: no extra audit rows: the transition audits the decision, media audits each `PhotoDeleted`.
- DECISION: handlers run in subscription order; publishing (F06) must register after workspace. Alternative if that feels fragile: workspace publishes `ListingUpdatedImmediate {fields: ["title", "description"]}` after copying.
- Tests (`workspace/tests/revision-decisions.test.js`, `register.test.js`): approve copies and allows a new revision; reject deletes new photos, keeps approved ones; repeats change nothing (it.each); another listing’s revision ignored; stored changes re-checked (it.each: extra keys, over-long title, HTML); bootstrap wires the listeners. Removing the PENDING guard makes the repeat tests fail.
- `workspace` + `media` + `access`: `✓ 213 passed · 1 skipped`.
- For F05: pass a PENDING revision of that listing and the photo ids staff approved. Partial approval leaves the other photos unapproved; they return in the seller’s next revision (deleting them would be a follow-up).
