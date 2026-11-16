
-- Consolidate duplicate policies
DROP POLICY IF EXISTS "admins manage officers" ON public.officers;
DROP POLICY IF EXISTS "admins manage devices" ON public.pos_devices;

-- Consolidate overlapping UPDATE policies on cash_handovers
DROP POLICY IF EXISTS "admin manage handovers" ON public.cash_handovers;
DROP POLICY IF EXISTS "admins update handovers" ON public.cash_handovers;
CREATE POLICY "admins and supervisors update handovers" ON public.cash_handovers
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::app_role) OR private.has_role(auth.uid(), 'supervisor'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::app_role) OR private.has_role(auth.uid(), 'supervisor'::app_role));

-- Revoke direct EXECUTE for authenticated on admin SECURITY DEFINER functions.
-- These are now invoked exclusively from server functions using the service role.
REVOKE EXECUTE ON FUNCTION public.set_officer_handover_deadline(uuid, timestamptz) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlock_device_admin(uuid) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_handover_admin(uuid, timestamptz) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_overdue_devices() FROM authenticated, PUBLIC;
