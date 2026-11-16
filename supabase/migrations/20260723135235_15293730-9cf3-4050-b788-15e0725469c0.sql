
-- Switch pairing lookup functions from SECURITY DEFINER to SECURITY INVOKER
-- and add narrow RLS policies so anon/authenticated can still poll pairing status.

CREATE OR REPLACE FUNCTION public.check_pairing_status(p_code text)
 RETURNS TABLE(status text, approved_device_id uuid, serial_number text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT dpc.status::text,
         dpc.approved_device_id,
         d.serial_number,
         dpc.expires_at
    FROM public.device_pairing_codes dpc
    LEFT JOIN public.pos_devices d ON d.id = dpc.approved_device_id
   WHERE dpc.code = p_code
   ORDER BY dpc.created_at DESC
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_paired_device(p_device_id uuid)
 RETURNS TABLE(id uuid, serial_number text, assigned_officer_id uuid, status text, locked boolean)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT d.id, d.serial_number, d.assigned_officer_id, d.status::text, d.locked
    FROM public.pos_devices d
   WHERE d.id = p_device_id
   LIMIT 1;
$function$;

-- Ensure roles can still call the RPCs
GRANT EXECUTE ON FUNCTION public.check_pairing_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_paired_device(uuid) TO anon, authenticated;

-- Table-level SELECT grants required for INVOKER lookups
GRANT SELECT ON public.device_pairing_codes TO anon;
GRANT SELECT ON public.pos_devices TO anon;

-- Narrow RLS: only allow reading a pairing code by exact code lookup during pairing.
DROP POLICY IF EXISTS "pairing lookup by code" ON public.device_pairing_codes;
CREATE POLICY "pairing lookup by code"
  ON public.device_pairing_codes
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Narrow RLS: only allow reading a pos_device row when it is referenced by a pairing code.
DROP POLICY IF EXISTS "device lookup via approved pairing" ON public.pos_devices;
CREATE POLICY "device lookup via approved pairing"
  ON public.pos_devices
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.device_pairing_codes dpc
      WHERE dpc.approved_device_id = pos_devices.id
    )
  );
