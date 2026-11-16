
-- Restrict bank_transfers to admins/supervisors for reads and inserts (was any authenticated user)
DROP POLICY IF EXISTS "Staff can submit bank transfers" ON public.bank_transfers;
DROP POLICY IF EXISTS "Staff can view bank transfers" ON public.bank_transfers;

CREATE POLICY "Staff can submit bank transfers" ON public.bank_transfers
FOR INSERT TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::app_role)
  OR private.has_role(auth.uid(), 'supervisor'::app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::app_role)
);

CREATE POLICY "Staff can view bank transfers" ON public.bank_transfers
FOR SELECT TO authenticated
USING (
  private.has_role(auth.uid(), 'administrator'::app_role)
  OR private.has_role(auth.uid(), 'supervisor'::app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::app_role)
);

-- Consolidate duplicate admin policies on businesses (keep single ALL policy)
DROP POLICY IF EXISTS "admins delete businesses" ON public.businesses;
DROP POLICY IF EXISTS "admins update businesses" ON public.businesses;

-- Consolidate duplicate DELETE policies on invoices
DROP POLICY IF EXISTS "admins delete invoices" ON public.invoices;

-- Consolidate duplicate UPDATE policies on payments (keep single ALL-equivalent)
DROP POLICY IF EXISTS "admins update payments" ON public.payments;
