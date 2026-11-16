
-- Wipe operational data
TRUNCATE TABLE
  public.audit_logs,
  public.notifications,
  public.payments,
  public.invoices,
  public.cash_handovers,
  public.device_pairing_codes,
  public.pos_devices,
  public.officers,
  public.businesses
RESTART IDENTITY CASCADE;

-- Remove all users except Bridget (cascades to profiles and user_roles via FKs)
DELETE FROM auth.users WHERE email <> 'bridget@hoima.gov';

-- Best-effort cleanup for any orphaned rows if FKs are not ON DELETE CASCADE
DELETE FROM public.user_roles WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.profiles WHERE id NOT IN (SELECT id FROM auth.users);

-- Ensure Bridget is administrator only (drop any duplicate revenue_officer role)
DELETE FROM public.user_roles
WHERE user_id = (SELECT id FROM auth.users WHERE email='bridget@hoima.gov')
  AND role <> 'administrator';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'administrator' FROM auth.users WHERE email='bridget@hoima.gov'
ON CONFLICT DO NOTHING;
