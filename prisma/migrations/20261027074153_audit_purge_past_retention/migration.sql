-- F08-T4: the purge role may DELETE an AuditEvent only once it is past retention.
-- A row with a listing: when that listing's purgeAfter has passed (never for an open listing).
-- A row with no listing: when it is older than Settings.recordsRetentionDays (365 if unset).
-- Everything else, and every UPDATE and TRUNCATE, is still rejected. Timestamps are UTC.
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
DECLARE
  retention_days int;
  utc_now timestamp := now() AT TIME ZONE 'UTC';
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'classifieds_purge' THEN
    IF OLD."listingId" IS NULL THEN
      SELECT "recordsRetentionDays" INTO retention_days FROM "Settings" WHERE "id" = 1;
      IF OLD."at" <= utc_now - make_interval(days => COALESCE(retention_days, 365)) THEN
        RETURN OLD;
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM "Listing" WHERE "id" = OLD."listingId" AND "purgeAfter" <= utc_now
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditEvent is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- The trigger runs as the purge role, so it needs to read Settings; the purge also clears
-- a listing's queued alert.
GRANT SELECT ON "Settings" TO classifieds_purge;
GRANT SELECT, DELETE ON "AlertQueue" TO classifieds_purge;
