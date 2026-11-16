-- Remove duplicate legacy triggers so each mobile invoice/payment is processed once.
DROP TRIGGER IF EXISTS invoices_set_defaults ON public.invoices;
DROP TRIGGER IF EXISTS payments_autolink_invoice ON public.payments;
DROP TRIGGER IF EXISTS payments_sync_invoice ON public.payments;

-- Mobile RPC: issue an invoice from the POS app and return the saved copy.
CREATE OR REPLACE FUNCTION public.mobile_issue_invoice(
  p_business_id uuid,
  p_tax_type text,
  p_amount numeric,
  p_penalty numeric DEFAULT 0,
  p_discount numeric DEFAULT 0,
  p_due_date timestamp with time zone DEFAULT NULL,
  p_financial_year text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_assessment_number text DEFAULT NULL
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invoice public.invoices;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login required to issue invoice';
  END IF;

  IF NOT (
    private.has_role(v_uid, 'administrator') OR
    private.has_role(v_uid, 'supervisor') OR
    private.has_role(v_uid, 'revenue_officer')
  ) THEN
    RAISE EXCEPTION 'Only authorized staff can issue invoices';
  END IF;

  IF p_tax_type IS NULL OR btrim(p_tax_type) = '' THEN
    RAISE EXCEPTION 'Tax type is required';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice amount must be greater than zero';
  END IF;

  INSERT INTO public.invoices (
    business_id,
    tax_type,
    amount,
    penalty,
    discount,
    due_date,
    financial_year,
    notes,
    assessment_number,
    issued_by
  )
  VALUES (
    p_business_id,
    btrim(p_tax_type),
    p_amount,
    COALESCE(p_penalty, 0),
    COALESCE(p_discount, 0),
    p_due_date,
    p_financial_year,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    NULLIF(btrim(COALESCE(p_assessment_number, '')), ''),
    v_uid
  )
  RETURNING * INTO v_invoice;

  RETURN v_invoice;
END;
$$;

-- Mobile RPC: record a payment/receipt from the POS app and return the saved copy.
CREATE OR REPLACE FUNCTION public.mobile_record_payment(
  p_amount numeric,
  p_payment_method text,
  p_invoice_id uuid DEFAULT NULL,
  p_business_id uuid DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_receipt_number text DEFAULT NULL,
  p_gps_lat numeric DEFAULT NULL,
  p_gps_lng numeric DEFAULT NULL,
  p_paid_at timestamp with time zone DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_business_id uuid;
  v_device public.pos_devices;
  v_payment public.payments;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login required to record payment';
  END IF;

  IF NOT (
    private.has_role(v_uid, 'administrator') OR
    private.has_role(v_uid, 'supervisor') OR
    private.has_role(v_uid, 'revenue_officer')
  ) THEN
    RAISE EXCEPTION 'Only authorized staff can record payments';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF p_payment_method IS NULL OR btrim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  SELECT id INTO v_officer_id
    FROM public.officers
   WHERE user_id = v_uid
   LIMIT 1;

  IF v_officer_id IS NULL THEN
    RAISE EXCEPTION 'This login is not linked to an officer profile';
  END IF;

  IF p_device_id IS NOT NULL THEN
    SELECT * INTO v_device
      FROM public.pos_devices
     WHERE id = p_device_id
     LIMIT 1;

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
    SELECT business_id INTO v_business_id
      FROM public.invoices
     WHERE id = p_invoice_id;
  END IF;

  INSERT INTO public.payments (
    receipt_number,
    invoice_id,
    business_id,
    officer_id,
    device_id,
    amount,
    payment_method,
    reference_number,
    gps_lat,
    gps_lng,
    status,
    sync_status,
    paid_at
  )
  VALUES (
    NULLIF(btrim(COALESCE(p_receipt_number, '')), ''),
    p_invoice_id,
    v_business_id,
    v_officer_id,
    p_device_id,
    p_amount,
    btrim(p_payment_method),
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    p_gps_lat,
    p_gps_lng,
    'success',
    'synced',
    COALESCE(p_paid_at, now())
  )
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

-- Mobile RPC: submit end-of-day handover from the POS app for admin approval.
CREATE OR REPLACE FUNCTION public.mobile_submit_cash_handover(
  p_device_id uuid,
  p_actual_amount numeric,
  p_signature_url text DEFAULT NULL
)
RETURNS public.cash_handovers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_device public.pos_devices;
  v_handover public.cash_handovers;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login required to submit handover';
  END IF;

  IF NOT (
    private.has_role(v_uid, 'administrator') OR
    private.has_role(v_uid, 'supervisor') OR
    private.has_role(v_uid, 'revenue_officer')
  ) THEN
    RAISE EXCEPTION 'Only authorized staff can submit cash handovers';
  END IF;

  SELECT id INTO v_officer_id
    FROM public.officers
   WHERE user_id = v_uid
   LIMIT 1;

  IF v_officer_id IS NULL THEN
    RAISE EXCEPTION 'This login is not linked to an officer profile';
  END IF;

  SELECT * INTO v_device
    FROM public.pos_devices
   WHERE id = p_device_id
   LIMIT 1;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'POS device not found';
  END IF;

  IF v_device.assigned_officer_id IS DISTINCT FROM v_officer_id
     AND NOT (private.has_role(v_uid, 'administrator') OR private.has_role(v_uid, 'supervisor')) THEN
    RAISE EXCEPTION 'This POS device is not assigned to the logged-in officer';
  END IF;

  INSERT INTO public.cash_handovers (
    officer_id,
    device_id,
    opening_balance,
    collected_amount,
    expected_amount,
    actual_amount,
    difference,
    status,
    signature_url
  )
  VALUES (
    v_officer_id,
    p_device_id,
    0,
    COALESCE(v_device.cash_balance, 0),
    COALESCE(v_device.cash_balance, 0),
    COALESCE(p_actual_amount, 0),
    COALESCE(p_actual_amount, 0) - COALESCE(v_device.cash_balance, 0),
    'pending',
    NULLIF(btrim(COALESCE(p_signature_url, '')), '')
  )
  RETURNING * INTO v_handover;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'Cash handover submitted',
    'Officer submitted UGX ' || to_char(COALESCE(p_actual_amount,0), 'FM999,999,999') || ' for admin confirmation.',
    'handover',
    false
  );

  RETURN v_handover;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_issue_invoice(uuid, text, numeric, numeric, numeric, timestamp with time zone, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mobile_record_payment(numeric, text, uuid, uuid, uuid, text, text, numeric, numeric, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mobile_submit_cash_handover(uuid, numeric, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mobile_issue_invoice(uuid, text, numeric, numeric, numeric, timestamp with time zone, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_record_payment(numeric, text, uuid, uuid, uuid, text, text, numeric, numeric, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_submit_cash_handover(uuid, numeric, text) TO authenticated;

-- Explicitly keep the canonical triggers attached.
DROP TRIGGER IF EXISTS trg_invoices_set_defaults ON public.invoices;
CREATE TRIGGER trg_invoices_set_defaults
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.tg_invoices_set_defaults();

DROP TRIGGER IF EXISTS trg_notify_new_invoice ON public.invoices;
CREATE TRIGGER trg_notify_new_invoice
AFTER INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_invoice();

DROP TRIGGER IF EXISTS trg_payments_autolink_invoice ON public.payments;
CREATE TRIGGER trg_payments_autolink_invoice
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_autolink_invoice();

DROP TRIGGER IF EXISTS trg_payments_sync_invoice ON public.payments;
CREATE TRIGGER trg_payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_sync_invoice();

DROP TRIGGER IF EXISTS trg_notify_new_payment ON public.payments;
CREATE TRIGGER trg_notify_new_payment
AFTER INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_payment();