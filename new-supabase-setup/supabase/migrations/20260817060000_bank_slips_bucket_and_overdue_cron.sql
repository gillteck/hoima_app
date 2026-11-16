-- Fixes two things that only existed in the old Lovable Cloud project, not in migrations.

-- 1. The private bucket the bank-slip policies and bank-transfers.tsx rely on.
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-slips', 'bank-slips', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Auto-lock of overdue POS devices every 5 minutes (idempotent).
--    Skipped silently if pg_cron is not enabled, so enable the extension first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lock-overdue-devices')
      FROM cron.job WHERE jobname = 'lock-overdue-devices';
    PERFORM cron.schedule('lock-overdue-devices', '*/5 * * * *',
      $cron$SELECT public.lock_overdue_devices();$cron$);
  ELSE
    RAISE WARNING 'pg_cron is not enabled: overdue devices will NOT auto-lock until it is.';
  END IF;
END $$;
