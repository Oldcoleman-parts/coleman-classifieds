# End-to-end acceptance (launch)

Run with `/dev-store-qa e2e` on staging: after F06 (steps 1–6, 11), and in full in F08-T2.

1. Staff create an invitation (a $20 offer against $30, scope FIRST_MONTH) with 2 staff photos. The link and email copy are shown.
2. The seller opens the link (email code) and starts the draft. `draftDueBy` = +14 days, and the reminder is scheduled.
3. The seller sees $20 with $30 crossed out and the rules, which say lanterns and stoves of any brand, accessories and manuals only with equipment. They fill in the form and add photos (EXIF stripped). The agreement box is unticked by default; they tick it and submit. The version, date and time are recorded.
4. Staff receive an **instant** "Ready to review (new listing)" email with a direct link. They request changes; the seller corrects and resubmits; staff get a "corrected" notice and approve.
5. The seller pays within 7 days (Bogus Gateway). The fee order is tagged, has no shipping, is fulfilled silently, and doesn't appear in the ShippingEasy import or on packing slips. The listing goes LIVE with `expiresAt = addMonths(liveAt,1)`, and the header button appears.
6. The listing is absent from search, collections, New Arrivals and feeds.
7. The next daily digest includes the listing once. An edit or renewal later never re-triggers it.
8. A buyer sends a normal message, which is delivered with Reply-To = buyer. A message containing a link is **held**: staff get an instant email and release it.
9. The seller sells 3 of 11 lanterns and updates the quantity and availability immediately. They remove a sold item's photo (immediate), then add a new photo, which goes to review while the old version stays live. Staff approve, and `expiresAt` is unchanged.
10. Staff pause with reason INVESTIGATION, then resume with "no violation", and the paused time is restored. Staff extend by 2 days (technical).
11. The seller marks the listing sold. It's closed, the link is closed, and the header button hides at 0.
12. The history export (CSV) lists every step. Editing or deleting AuditEvent rows is rejected by the database.
13. A forced publish failure raises a PUBLISHING incident and a problem alert email.
