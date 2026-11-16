
-- =====================================================================
-- 1. DEVICE PAIRING CODES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.device_pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  device_type TEXT NOT NULL DEFAULT 'phone',
  model TEXT,
  manufacturer TEXT,
  android_version TEXT,
  imei TEXT,
  requested_by_officer_id UUID REFERENCES public.officers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_device_id UUID REFERENCES public.pos_devices(id) ON DELETE SET NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.device_pairing_codes TO authenticated;
GRANT ALL ON public.device_pairing_codes TO service_role;

ALTER TABLE public.device_pairing_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pairing readable by authenticated" ON public.device_pairing_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pairing insertable by authenticated" ON public.device_pairing_codes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pairing updatable by admin" ON public.device_pairing_codes
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.device_pairing_codes;

-- =====================================================================
-- 2. NOTIFICATION TRIGGERS (invoice + payment)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_new_invoice()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE biz_name TEXT;
BEGIN
  SELECT business_name INTO biz_name FROM public.businesses WHERE id = NEW.business_id;
  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'New invoice ' || NEW.invoice_number,
    'Issued to ' || COALESCE(biz_name, 'Unknown taxpayer') ||
      ' · UGX ' || to_char(NEW.amount, 'FM999,999,999'),
    'invoice',
    false
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_new_invoice ON public.invoices;
CREATE TRIGGER trg_notify_new_invoice
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_new_invoice();

CREATE OR REPLACE FUNCTION public.notify_new_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE biz_name TEXT;
BEGIN
  SELECT business_name INTO biz_name FROM public.businesses WHERE id = NEW.business_id;
  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'Payment ' || NEW.receipt_number || ' received',
    COALESCE(biz_name, 'Taxpayer') || ' paid UGX ' ||
      to_char(NEW.amount, 'FM999,999,999') || ' via ' || NEW.payment_method,
    'payment',
    false
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_new_payment ON public.payments;
CREATE TRIGGER trg_notify_new_payment
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.notify_new_payment();

-- =====================================================================
-- 3. record_payment RPC — atomic receipt + invoice update + audit log
-- =====================================================================
CREATE OR REPLACE FUNCTION public.record_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_officer_id UUID DEFAULT NULL,
  p_device_id UUID DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_gps_lat NUMERIC DEFAULT NULL,
  p_gps_lng NUMERIC DEFAULT NULL
) RETURNS TABLE (payment_id UUID, receipt_number TEXT, new_paid NUMERIC, new_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_receipt TEXT;
  v_payment_id UUID;
  v_new_paid NUMERIC;
  v_total NUMERIC;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  v_receipt := 'RCP-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  v_new_paid := v_invoice.paid_amount + p_amount;
  v_total := v_invoice.amount + v_invoice.penalty - v_invoice.discount;
  v_new_status := CASE WHEN v_new_paid >= v_total THEN 'paid'
                       WHEN v_new_paid > 0 THEN 'partial'
                       ELSE v_invoice.status END;

  INSERT INTO public.payments (
    receipt_number, invoice_id, business_id, officer_id, device_id,
    amount, payment_method, reference_number, gps_lat, gps_lng,
    status, sync_status, paid_at
  ) VALUES (
    v_receipt, p_invoice_id, v_invoice.business_id, p_officer_id, p_device_id,
    p_amount, p_payment_method, p_reference, p_gps_lat, p_gps_lng,
    'completed', 'synced', now()
  ) RETURNING id INTO v_payment_id;

  UPDATE public.invoices
     SET paid_amount = v_new_paid, status = v_new_status
   WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    auth.uid(), 'record_payment', 'payments', v_payment_id::text,
    jsonb_build_object('receipt', v_receipt, 'amount', p_amount, 'invoice_id', p_invoice_id, 'device_id', p_device_id)
  );

  RETURN QUERY SELECT v_payment_id, v_receipt, v_new_paid, v_new_status;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_payment TO authenticated;

-- =====================================================================
-- 4. approve_pairing_code RPC — admin approves pending Android device
-- =====================================================================
CREATE OR REPLACE FUNCTION public.approve_pairing_code(
  p_code TEXT,
  p_serial_number TEXT,
  p_assigned_officer_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pair public.device_pairing_codes%ROWTYPE;
  v_device_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can approve devices';
  END IF;

  SELECT * INTO v_pair FROM public.device_pairing_codes
   WHERE code = p_code AND status = 'pending' AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pairing code invalid or expired'; END IF;

  INSERT INTO public.pos_devices (
    serial_number, imei, model, manufacturer, android_version,
    device_type, assigned_officer_id, status, online_status, sync_status, locked
  ) VALUES (
    p_serial_number, v_pair.imei, v_pair.model, v_pair.manufacturer, v_pair.android_version,
    v_pair.device_type, COALESCE(p_assigned_officer_id, v_pair.requested_by_officer_id),
    'active', 'offline', 'idle', false
  ) RETURNING id INTO v_device_id;

  UPDATE public.device_pairing_codes
     SET status = 'approved', approved_device_id = v_device_id,
         approved_by = auth.uid(), approved_at = now()
   WHERE id = v_pair.id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (auth.uid(), 'approve_pairing', 'pos_devices', v_device_id::text,
          jsonb_build_object('code', p_code, 'serial', p_serial_number));

  RETURN v_device_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.approve_pairing_code TO authenticated;

-- =====================================================================
-- 5. TIGHTEN RLS — remove demo anon-all policies, add admin/officer scope
-- =====================================================================
DROP POLICY IF EXISTS "demo anon all" ON public.audit_logs;
DROP POLICY IF EXISTS "demo anon all" ON public.businesses;
DROP POLICY IF EXISTS "demo anon all" ON public.cash_handovers;
DROP POLICY IF EXISTS "demo anon all" ON public.invoices;
DROP POLICY IF EXISTS "demo anon all" ON public.notifications;
DROP POLICY IF EXISTS "demo anon all" ON public.officers;
DROP POLICY IF EXISTS "demo anon all" ON public.payments;
DROP POLICY IF EXISTS "demo anon all" ON public.pos_devices;
DROP POLICY IF EXISTS "demo anon all" ON public.profiles;
DROP POLICY IF EXISTS "demo anon all" ON public.user_roles;

REVOKE ALL ON public.audit_logs, public.businesses, public.cash_handovers, public.invoices,
              public.notifications, public.officers, public.payments, public.pos_devices,
              public.profiles, public.user_roles FROM anon;

-- Admin can update/delete any operational data
CREATE POLICY "admin manage businesses" ON public.businesses
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "admin manage invoices" ON public.invoices
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "admin manage payments" ON public.payments
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));
CREATE POLICY "admin delete payments" ON public.payments
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "admin manage officers" ON public.officers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "admin manage devices" ON public.pos_devices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "authenticated update device status" ON public.pos_devices
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "admin manage handovers" ON public.cash_handovers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "admin delete handovers" ON public.cash_handovers
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'));

CREATE POLICY "authenticated read notifications" ON public.notifications
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated update notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated delete notifications" ON public.notifications
  FOR DELETE TO authenticated USING (true);
