
-- Wipe operational/demo data; keep only super admins (AlvinRR, RRnFamily)
TRUNCATE TABLE
  public.payments,
  public.invoices,
  public.cash_handovers,
  public.device_pairing_codes,
  public.pos_devices,
  public.officers,
  public.businesses,
  public.notifications,
  public.audit_logs
RESTART IDENTITY CASCADE;

-- Remove non-admin users (profiles, roles, and auth users)
DELETE FROM public.user_roles
 WHERE user_id NOT IN (
   '3762eb74-7fc7-4655-b1b0-fac04ac20466',
   'fcc69bde-d7f8-4b5e-82ba-65b8b702973e'
 );

DELETE FROM public.profiles
 WHERE id NOT IN (
   '3762eb74-7fc7-4655-b1b0-fac04ac20466',
   'fcc69bde-d7f8-4b5e-82ba-65b8b702973e'
 );

DELETE FROM auth.users
 WHERE id NOT IN (
   '3762eb74-7fc7-4655-b1b0-fac04ac20466',
   'fcc69bde-d7f8-4b5e-82ba-65b8b702973e'
 );
