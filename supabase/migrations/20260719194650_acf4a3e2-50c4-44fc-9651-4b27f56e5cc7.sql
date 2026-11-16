CREATE OR REPLACE FUNCTION public.mobile_record_payment(p_amount numeric, p_payment_method text, p_invoice_id uuid DEFAULT NULL::uuid, p_business_id uuid DEFAULT NULL::uuid, p_device_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_receipt_number text DEFAULT NULL::text, p_gps_lat numeric DEFAULT NULL::numeric, p_gps_lng numeric DEFAULT NULL::numeric, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS payments
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_business_id uuid;
  v_device public.pos_devices;
  v_payment public.payments;
  v_receipt text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login required to record payment';
  END IF;

  IF NOT (
    private.has_role(v_uid, 'administrator') OR
    private.has_role(v_uid, 'supervisor') OR
    private.has_role(v_uid, 'revenue_officer')
  ) THEN
    RAISE EXCEPTION 'Not authorized to record payments';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF p_payment_method IS NULL OR btrim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  SELECT id INTO v_officer_id FROM public.officers WHERE user_id = v_uid LIMIT 1;
  IF v_officer_id IS NULL THEN
    RAISE EXCEPTION 'This login is not linked to an officer profile';
  END IF;

  IF p_device_id IS NOT NULL THEN
    SELECT * INTO v_device FROM public.pos_devices WHERE id = p_device_id LIMIT 1;
    IF v_device.id IS NULL THEN
      RAISE EXCEPTION 'POS device not found';
    END IF;
    IF v_device.assigned_officer_id IS DISTINCT FROM v_officer_id
       AND NOT (private.has_role(v_uid, 'administrator') OR private.has_role(v_uid, 'supervisor')) THEN
      RAISE EXCEPTION 'This POS device is not assigned to the logged-in officer';
    END IF;
    IF COALESCE(v_device.locked, false) THEN
      RAISE EXCEPTION 'POS device is locked: %', COALESCE(v_device.lock_reason, 'handover required');
    END IF;
  END IF;

  v_business_id := p_business_id;
  IF v_business_id IS NULL AND p_invoice_id IS NOT NULL THEN
    SELECT business_id INTO v_business_id FROM public.invoices WHERE id = p_invoice_id;
  END IF;

  v_receipt := NULLIF(btrim(COALESCE(p_receipt_number, '')), '');
  IF v_receipt IS NULL THEN
    v_receipt := 'RC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.receipt_seq')::text, 6, '0');
  END IF;

  INSERT INTO public.payments (
    receipt_number, invoice_id, business_id, officer_id, device_id,
    amount, payment_method, reference_number, gps_lat, gps_lng,
    status, sync_status, paid_at
  )
  VALUES (
    v_receipt, p_invoice_id, v_business_id, v_officer_id, p_device_id,
    p_amount, btrim(p_payment_method),
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    p_gps_lat, p_gps_lng, 'success', 'synced',
    COALESCE(p_paid_at, now())
  )
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$function$;