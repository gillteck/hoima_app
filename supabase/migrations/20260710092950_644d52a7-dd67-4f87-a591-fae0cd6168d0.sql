
CREATE OR REPLACE FUNCTION public.approve_pairing_code_admin(
  p_caller uuid, p_code text, p_serial_number text, p_assigned_officer_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.approve_pairing_code(p_caller, p_code, p_serial_number, p_assigned_officer_id);
$$;
REVOKE ALL ON FUNCTION public.approve_pairing_code_admin(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pairing_code_admin(uuid, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_payment_admin(
  p_caller uuid, p_invoice_id uuid, p_amount numeric, p_payment_method text,
  p_officer_id uuid DEFAULT NULL, p_device_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL, p_gps_lat numeric DEFAULT NULL, p_gps_lng numeric DEFAULT NULL
) RETURNS TABLE(payment_id uuid, receipt_number text, new_paid numeric, new_status text)
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private.record_payment(p_caller, p_invoice_id, p_amount, p_payment_method, p_officer_id, p_device_id, p_reference, p_gps_lat, p_gps_lng);
$$;
REVOKE ALL ON FUNCTION public.record_payment_admin(uuid, uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_admin(uuid, uuid, numeric, text, uuid, uuid, text, numeric, numeric) TO service_role;
