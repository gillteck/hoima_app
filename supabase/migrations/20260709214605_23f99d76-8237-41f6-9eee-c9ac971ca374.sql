
-- Helper to resolve current user's officer record
CREATE OR REPLACE FUNCTION public.current_officer_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.officers WHERE user_id = auth.uid() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_officer_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_officer_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_officer_id() TO authenticated;

-- Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE ALL ON FUNCTION public.notify_new_invoice() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_new_invoice() FROM anon;
REVOKE ALL ON FUNCTION public.notify_new_invoice() FROM authenticated;

REVOKE ALL ON FUNCTION public.notify_new_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_new_payment() FROM anon;
REVOKE ALL ON FUNCTION public.notify_new_payment() FROM authenticated;

REVOKE ALL ON FUNCTION public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_pairing_code(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_pairing_code(text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_pairing_code(text, text, uuid) TO authenticated;

-- businesses: staff-only SELECT
DROP POLICY IF EXISTS "businesses readable" ON public.businesses;
CREATE POLICY "businesses readable by staff" ON public.businesses FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  public.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

-- cash_handovers: admin/supervisor or own officer
DROP POLICY IF EXISTS "handovers readable" ON public.cash_handovers;
CREATE POLICY "handovers readable by admin or own officer" ON public.cash_handovers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  officer_id = public.current_officer_id()
);

-- device_pairing_codes: admin or requesting officer
DROP POLICY IF EXISTS "pairing readable by authenticated" ON public.device_pairing_codes;
CREATE POLICY "pairing readable by admin or requester" ON public.device_pairing_codes FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  requested_by_officer_id = public.current_officer_id()
);

-- invoices: restrict UPDATE to admin or issuer
DROP POLICY IF EXISTS "authenticated update invoices" ON public.invoices;
CREATE POLICY "admin or issuer update invoices" ON public.invoices FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'::public.app_role) OR issued_by = auth.uid())
WITH CHECK (public.has_role(auth.uid(), 'administrator'::public.app_role) OR issued_by = auth.uid());

-- notifications: remove broad policies; keep 'own notifications'
DROP POLICY IF EXISTS "authenticated read notifications" ON public.notifications;
DROP POLICY IF EXISTS "authenticated update notifications" ON public.notifications;
DROP POLICY IF EXISTS "authenticated delete notifications" ON public.notifications;

-- officers: admin/supervisor see all; officers see self
DROP POLICY IF EXISTS "officers readable" ON public.officers;
CREATE POLICY "officers readable by admin or self" ON public.officers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  user_id = auth.uid()
);

-- payments: admin/supervisor or own officer
DROP POLICY IF EXISTS "payments readable" ON public.payments;
CREATE POLICY "payments readable by admin or own officer" ON public.payments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  officer_id = public.current_officer_id()
);

-- pos_devices: restrict UPDATE to admin or assigned officer
DROP POLICY IF EXISTS "authenticated update device status" ON public.pos_devices;
CREATE POLICY "admin or assigned officer update devices" ON public.pos_devices FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'::public.app_role) OR assigned_officer_id = public.current_officer_id())
WITH CHECK (public.has_role(auth.uid(), 'administrator'::public.app_role) OR assigned_officer_id = public.current_officer_id());

-- profiles: self or admin
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by self or admin" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'administrator'::public.app_role));

-- user_roles: self or admin
DROP POLICY IF EXISTS "roles readable by authenticated" ON public.user_roles;
CREATE POLICY "roles readable by self or admin" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'administrator'::public.app_role));
