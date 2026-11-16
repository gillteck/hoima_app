#!/usr/bin/env bash
# Builds the Muniverse Collect schema on a NEW, EMPTY Supabase project.
# Run from the repo root, after copying the new migration into supabase/migrations/.
#
#   export NEW_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
#   ./scripts/migrate-schema.sh
#
# Order matters: supabase/migrations first, then the system-lock SQL in
# drizzle/migrations (it depends on public.user_roles and public.audit_logs).
set -euo pipefail
: "${NEW_DB_URL:?Set NEW_DB_URL to the new project's database connection string}"

psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_cron;" \
  || echo "WARNING: could not enable pg_cron. Enable it in Dashboard > Database > Extensions, then re-run the last supabase migration."

echo "== supabase/migrations"
for f in $(ls supabase/migrations/*.sql | sort); do
  echo "-> $f"; psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "== drizzle/migrations (system lock)"
for f in $(ls drizzle/migrations/*.sql | sort); do
  echo "-> $f"; psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "Done. Next: create the first super admin user, then run the role-assignment SQL (see MIGRATION.md)."
