DROP POLICY IF EXISTS "invoices readable by staff or issuer" ON public.invoices;
CREATE POLICY "invoices readable by staff"
ON public.invoices FOR SELECT TO authenticated
USING (
  private.has_role(auth.uid(), 'administrator'::app_role)
  OR private.has_role(auth.uid(), 'supervisor'::app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::app_role)
);