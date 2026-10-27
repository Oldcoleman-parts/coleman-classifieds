-- CreateIndex
CREATE INDEX "AuditEvent_at_id_idx" ON "AuditEvent"("at", "id");

-- F01-FIX-11 (review 8): pin the trigger function's search_path, built-ins first, so no
-- table in the app schema can shadow what it calls.
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.audit_event_append_only() SET search_path = pg_catalog, %I',
    current_schema(), current_schema());
END $$;
