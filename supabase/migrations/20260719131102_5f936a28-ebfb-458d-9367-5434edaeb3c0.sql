
-- Public RPC so an unauthenticated mobile app can poll its pairing code's status.
-- The 6-digit code acts as the bearer token; expired/rejected codes reveal nothing sensitive.
CREATE OR REPLACE FUNCTION public.check_pairing_status(p_code text)
RETURNS TABLE(status text, approved_device_id uuid, serial_number text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT dpc.status::text,
         dpc.approved_device_id,
         d.serial_number,
         dpc.expires_at
    FROM public.device_pairing_codes dpc
    LEFT JOIN public.pos_devices d ON d.id = dpc.approved_device_id
   WHERE dpc.code = p_code
   ORDER BY dpc.created_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.check_pairing_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_pairing_status(text) TO anon, authenticated, service_role;

-- Also let anon/authenticated read their own device row by id after pairing so
-- the mobile app can hydrate the approved device (RLS blocks broad reads).
CREATE OR REPLACE FUNCTION public.get_paired_device(p_device_id uuid)
RETURNS TABLE(id uuid, serial_number text, assigned_officer_id uuid, status text, locked boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT d.id, d.serial_number, d.assigned_officer_id, d.status::text, d.locked
    FROM public.pos_devices d
   WHERE d.id = p_device_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_paired_device(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_paired_device(uuid) TO anon, authenticated, service_role;
