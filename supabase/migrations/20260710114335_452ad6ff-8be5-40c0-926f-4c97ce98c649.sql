-- Let all staff (admins, supervisors, revenue officers) read payments,
-- matching the invoices/businesses model. This also lets the mobile POS
-- re-read a payment it just inserted, and lets the web admin see receipts
-- from mobile officers immediately.
DROP POLICY IF EXISTS "payments readable by admin or own officer" ON public.payments;

CREATE POLICY "payments readable by staff"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::app_role)
    OR private.has_role(auth.uid(), 'supervisor'::app_role)
    OR private.has_role(auth.uid(), 'revenue_officer'::app_role)
  );