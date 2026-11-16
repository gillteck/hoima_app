
ALTER TABLE public.device_pairing_codes
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid DEFAULT auth.uid();

UPDATE public.device_pairing_codes
   SET requested_by_user_id = COALESCE(requested_by_user_id,
                                       (SELECT user_id FROM public.officers o WHERE o.id = requested_by_officer_id))
 WHERE requested_by_user_id IS NULL;

DROP POLICY IF EXISTS "pairing readable by admin or requester" ON public.device_pairing_codes;
CREATE POLICY "pairing readable by admin or requester"
  ON public.device_pairing_codes
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::app_role)
    OR requested_by_user_id = auth.uid()
    OR (requested_by_officer_id IS NOT NULL AND requested_by_officer_id = private.current_officer_id())
  );

DROP POLICY IF EXISTS "pairing updatable by admin" ON public.device_pairing_codes;
CREATE POLICY "pairing updatable by admin or requester"
  ON public.device_pairing_codes
  FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::app_role)
    OR requested_by_user_id = auth.uid()
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'administrator'::app_role)
    OR requested_by_user_id = auth.uid()
  );
