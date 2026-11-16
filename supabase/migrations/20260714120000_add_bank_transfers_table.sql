-- Intentionally empty.
-- An earlier draft of public.bank_transfers lived here. The live schema uses the version created in
-- 20260717165254_*.sql (with officer_id, submitted_by, admin_notes, reviewed_by), which matches
-- src/integrations/supabase/types.ts. Creating the table twice fails on a fresh database.
SELECT 1;
