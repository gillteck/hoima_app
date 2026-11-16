DROP POLICY IF EXISTS "authenticated write audit" ON public.audit_logs;
CREATE POLICY "staff can write audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "authenticated create businesses" ON public.businesses;
CREATE POLICY "staff can create businesses"
ON public.businesses
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "authenticated create handovers" ON public.cash_handovers;
CREATE POLICY "staff can create handovers"
ON public.cash_handovers
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "pairing insertable by authenticated" ON public.device_pairing_codes;
CREATE POLICY "staff can request device pairing"
ON public.device_pairing_codes
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND status = 'pending'
  AND (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
  )
);

DROP POLICY IF EXISTS "authenticated create invoices" ON public.invoices;
CREATE POLICY "staff can create invoices"
ON public.invoices
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "authenticated create payments" ON public.payments;
CREATE POLICY "staff can create payments"
ON public.payments
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);