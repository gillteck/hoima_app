# Moving Muniverse Collect to a new Supabase project

## 0. Before you start
- New project created. Keep its database password and keys out of git and out of chat.
- Install `psql` and the Supabase CLI.

## 1. Schema
1. Copy `supabase/migrations/20260817060000_bank_slips_bucket_and_overdue_cron.sql` into the repo's `supabase/migrations/`.
2. `export NEW_DB_URL=...` (Dashboard > Connect > direct or session-pooler string).
3. `./scripts/migrate-schema.sh`

## 2. Dashboard settings
- Auth > URL Configuration: Site URL and redirect URLs for the new hosting domain.
- Auth > Providers: email sign-in on; match the old email-confirmation setting.
- Database > Extensions: confirm `pg_cron` is on.
- Storage: confirm the private `bank-slips` bucket exists.

## 3. Accounts
The migrations already create `alvinrr@hoima.gov` (super_admin) plus two administrator accounts, with passwords
written in the migration files. After setup, change all three passwords in Authentication > Users.
No manual role SQL is needed.

## 4. App config
- `.env` and host secrets: see `.env.example`.
- `supabase/config.toml`: set `project_id` to the new ref.
- `supabase gen types typescript --project-id <new-ref> > src/integrations/supabase/types.ts`

## 5. Verify
- Sign in as super admin; open dashboard, create a business, issue an invoice, record a payment.
- Upload a bank slip on Bank transfers.
- Lock then reopen the system; confirm sign-ins are blocked while locked.
- Confirm `SELECT * FROM cron.job;` lists `lock-overdue-devices`.

## 6. Android / POS app
Rebuild with the new URL and publishable key. Paired devices stop working until updated.

## 7. Existing data (only if you keep it)
Lock the old system to freeze writes, copy `auth.users` + `auth.identities` first, then `public` tables with triggers disabled
(`SET session_replication_role = replica;`), then copy `bank-slips` files via the Storage API.
