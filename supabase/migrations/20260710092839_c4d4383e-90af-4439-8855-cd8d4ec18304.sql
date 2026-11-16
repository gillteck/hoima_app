
-- 1. Private schema for internal helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- 2. Recreate helpers in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_officer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.officers WHERE user_id = auth.uid() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.current_officer_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_officer_id() TO authenticated, service_role;

-- 3. Rewrite every RLS policy that referenced public.has_role / public.current_officer_id
--    to reference the private schema versions.

-- audit_logs
DROP POLICY IF EXISTS "audit readable by admins" ON public.audit_logs;
CREATE POLICY "audit readable by admins" ON public.audit_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));

-- businesses
DROP POLICY IF EXISTS "admin manage businesses" ON public.businesses;
CREATE POLICY "admin manage businesses" ON public.businesses FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admins delete businesses" ON public.businesses;
CREATE POLICY "admins delete businesses" ON public.businesses FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admins update businesses" ON public.businesses;
CREATE POLICY "admins update businesses" ON public.businesses FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "businesses readable by staff" ON public.businesses;
CREATE POLICY "businesses readable by staff" ON public.businesses FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
  );

-- cash_handovers
DROP POLICY IF EXISTS "admin delete handovers" ON public.cash_handovers;
CREATE POLICY "admin delete handovers" ON public.cash_handovers FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admin manage handovers" ON public.cash_handovers;
CREATE POLICY "admin manage handovers" ON public.cash_handovers FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admins update handovers" ON public.cash_handovers;
CREATE POLICY "admins update handovers" ON public.cash_handovers FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  );
DROP POLICY IF EXISTS "handovers readable by admin or own officer" ON public.cash_handovers;
CREATE POLICY "handovers readable by admin or own officer" ON public.cash_handovers FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR (officer_id = private.current_officer_id())
  );

-- device_pairing_codes
DROP POLICY IF EXISTS "pairing readable by admin or requester" ON public.device_pairing_codes;
CREATE POLICY "pairing readable by admin or requester" ON public.device_pairing_codes FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR (requested_by_officer_id = private.current_officer_id())
  );
DROP POLICY IF EXISTS "pairing updatable by admin" ON public.device_pairing_codes;
CREATE POLICY "pairing updatable by admin" ON public.device_pairing_codes FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));

-- invoices — fix broad SELECT + rewrite helpers
DROP POLICY IF EXISTS "admin manage invoices" ON public.invoices;
CREATE POLICY "admin manage invoices" ON public.invoices FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admin or issuer update invoices" ON public.invoices;
CREATE POLICY "admin or issuer update invoices" ON public.invoices FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role) OR issued_by = auth.uid())
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role) OR issued_by = auth.uid());
DROP POLICY IF EXISTS "admins delete invoices" ON public.invoices;
CREATE POLICY "admins delete invoices" ON public.invoices FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "invoices readable" ON public.invoices;
CREATE POLICY "invoices readable by staff or issuer" ON public.invoices FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR issued_by = auth.uid()
    OR (
      private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
      AND business_id IN (
        SELECT b.id FROM public.businesses b
        JOIN public.officers o ON o.collection_area = b.division
        WHERE o.user_id = auth.uid()
      )
    )
  );

-- officers
DROP POLICY IF EXISTS "admin manage officers" ON public.officers;
CREATE POLICY "admin manage officers" ON public.officers FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admins manage officers" ON public.officers;
CREATE POLICY "admins manage officers" ON public.officers FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "officers readable by admin or self" ON public.officers;
CREATE POLICY "officers readable by admin or self" ON public.officers FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR user_id = auth.uid()
  );

-- payments
DROP POLICY IF EXISTS "admin delete payments" ON public.payments;
CREATE POLICY "admin delete payments" ON public.payments FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admin manage payments" ON public.payments;
CREATE POLICY "admin manage payments" ON public.payments FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admins update payments" ON public.payments;
CREATE POLICY "admins update payments" ON public.payments FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "payments readable by admin or own officer" ON public.payments;
CREATE POLICY "payments readable by admin or own officer" ON public.payments FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR officer_id = private.current_officer_id()
  );

-- pos_devices — fix broad SELECT + rewrite helpers
DROP POLICY IF EXISTS "admin manage devices" ON public.pos_devices;
CREATE POLICY "admin manage devices" ON public.pos_devices FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "admin or assigned officer update devices" ON public.pos_devices;
CREATE POLICY "admin or assigned officer update devices" ON public.pos_devices FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR assigned_officer_id = private.current_officer_id()
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR assigned_officer_id = private.current_officer_id()
  );
DROP POLICY IF EXISTS "admins manage devices" ON public.pos_devices;
CREATE POLICY "admins manage devices" ON public.pos_devices FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'administrator'::public.app_role));
DROP POLICY IF EXISTS "devices readable" ON public.pos_devices;
CREATE POLICY "devices readable by admin supervisor or assignee" ON public.pos_devices FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR assigned_officer_id = private.current_officer_id()
  );

-- profiles
DROP POLICY IF EXISTS "profiles readable by self or admin" ON public.profiles;
CREATE POLICY "profiles readable by self or admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR private.has_role(auth.uid(), 'administrator'::public.app_role));

-- user_roles
DROP POLICY IF EXISTS "roles readable by self or admin" ON public.user_roles;
CREATE POLICY "roles readable by self or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'administrator'::public.app_role));

-- notifications — fix null user_id policy: split personal vs broadcast
DROP POLICY IF EXISTS "own notifications" ON public.notifications;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "broadcast notifications readable" ON public.notifications FOR SELECT TO authenticated
  USING (user_id IS NULL);
CREATE POLICY "admins manage broadcast notifications" ON public.notifications FOR ALL TO authenticated
  USING (user_id IS NULL AND private.has_role(auth.uid(), 'administrator'::public.app_role))
  WITH CHECK (user_id IS NULL AND private.has_role(auth.uid(), 'administrator'::public.app_role));

-- 4. Move RPC-style functions into private schema and expose thin invoker wrappers in public
--    so they remain callable via supabase.rpc() but the SECURITY DEFINER body lives outside
--    the exposed API schema.

CREATE OR REPLACE FUNCTION private.approve_pairing_code(
  p_caller uuid, p_code text, p_serial_number text, p_assigned_officer_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pair public.device_pairing_codes%ROWTYPE;
  v_device_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'administrator') THEN
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
         approved_by = p_caller, approved_at = now()
   WHERE id = v_pair.id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (p_caller, 'approve_pairing', 'pos_devices', v_device_id::text,
          jsonb_build_object('code', p_code, 'serial', p_serial_number));

  RETURN v_device_id;
END; $$;
REVOKE ALL ON FUNCTION private.approve_pairing_code(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.approve_pairing_code(uuid, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.record_payment(
  p_caller uuid, p_invoice_id uuid, p_amount numeric, p_payment_method text,
  p_officer_id uuid DEFAULT NULL, p_device_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL, p_gps_lat numeric DEFAULT NULL, p_gps_lng numeric DEFAULT NULL
) RETURNS TABLE(payment_id uuid, receipt_number text, new_paid numeric, new_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_receipt TEXT;
  v_payment_id UUID;
  v_new_paid NUMERIC;
  v_total NUMERIC;
  v_new_status TEXT;
BEGIN
  IF p_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

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
    p_caller, 'record_payment', 'payments', v_payment_id::text,
    jsonb_build_object('receipt', v_receipt, 'amount', p_amount, 'invoice_id', p_invoice_id, 'device_id', p_device_id)
  );

  RETURN QUERY SELECT v_payment_id, v_receipt, v_new_paid, v_new_status;
END; $$;
REVOKE ALL ON FUNCTION private.record_payment(uuid, uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.record_payment(uuid, uuid, numeric, text, uuid, uuid, text, numeric, numeric) TO service_role;

-- 5. Drop the old SECURITY DEFINER functions from the public (exposed) schema
DROP FUNCTION IF EXISTS public.approve_pairing_code(text, text, uuid);
DROP FUNCTION IF EXISTS public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.current_officer_id();
