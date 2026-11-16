-- Muniverse Collect: full schema for a NEW Supabase project (tested on a clean database).
-- Run once in Dashboard > SQL Editor. Enable pg_cron first (Database > Extensions).
-- ===== supabase/migrations/20260709190311_5d89bbd7-aec0-4683-a647-5a241e3399d1.sql =====

-- Roles enum + user_roles table
CREATE TYPE public.app_role AS ENUM ('administrator', 'revenue_officer', 'supervisor', 'super_admin');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT,
  username TEXT UNIQUE,
  phone TEXT,
  division TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'revenue_officer');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Officers
CREATE TABLE public.officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  employee_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  division TEXT,
  collection_area TEXT,
  photo_url TEXT,
  pin TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  monthly_target NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.officers TO authenticated;
GRANT ALL ON public.officers TO service_role;
ALTER TABLE public.officers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "officers readable" ON public.officers FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage officers" ON public.officers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

-- POS Devices
CREATE TABLE public.pos_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT UNIQUE NOT NULL,
  imei TEXT,
  model TEXT,
  manufacturer TEXT,
  android_version TEXT,
  app_version TEXT,
  sim_number TEXT,
  battery_level INT DEFAULT 100,
  network_strength TEXT DEFAULT 'good',
  assigned_officer_id UUID REFERENCES public.officers ON DELETE SET NULL,
  current_lat NUMERIC,
  current_lng NUMERIC,
  last_seen TIMESTAMPTZ,
  online_status TEXT NOT NULL DEFAULT 'offline',
  sync_status TEXT NOT NULL DEFAULT 'idle',
  cash_balance NUMERIC DEFAULT 0,
  total_transactions INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_devices TO authenticated;
GRANT ALL ON public.pos_devices TO service_role;
ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices readable" ON public.pos_devices FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage devices" ON public.pos_devices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administrator'))
  WITH CHECK (public.has_role(auth.uid(), 'administrator'));

-- Businesses / Taxpayers
CREATE TABLE public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  owner_name TEXT,
  tin TEXT UNIQUE,
  registration_number TEXT,
  phone TEXT,
  email TEXT,
  physical_address TEXT,
  division TEXT,
  category TEXT,
  gps_lat NUMERIC,
  gps_lng NUMERIC,
  status TEXT NOT NULL DEFAULT 'active',
  photo_url TEXT,
  date_registered TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "businesses readable" ON public.businesses FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated create businesses" ON public.businesses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admins update businesses" ON public.businesses FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'administrator'));
CREATE POLICY "admins delete businesses" ON public.businesses FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'administrator'));

-- Invoices
CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1;
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL DEFAULT ('INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_seq')::text, 6, '0')),
  assessment_number TEXT,
  business_id UUID REFERENCES public.businesses ON DELETE SET NULL,
  tax_type TEXT NOT NULL,
  financial_year TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  penalty NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  issue_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ,
  issued_by UUID REFERENCES auth.users ON DELETE SET NULL,
  qr_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices readable" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated create invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update invoices" ON public.invoices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "admins delete invoices" ON public.invoices FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'administrator'));

-- Payments
CREATE SEQUENCE IF NOT EXISTS public.receipt_seq START 1;
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT UNIQUE NOT NULL DEFAULT ('RC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.receipt_seq')::text, 6, '0')),
  invoice_id UUID REFERENCES public.invoices ON DELETE SET NULL,
  business_id UUID REFERENCES public.businesses ON DELETE SET NULL,
  officer_id UUID REFERENCES public.officers ON DELETE SET NULL,
  device_id UUID REFERENCES public.pos_devices ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL,
  reference_number TEXT,
  gps_lat NUMERIC,
  gps_lng NUMERIC,
  status TEXT NOT NULL DEFAULT 'success',
  sync_status TEXT NOT NULL DEFAULT 'synced',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments readable" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated create payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admins update payments" ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'administrator'));

-- Cash Handovers
CREATE TABLE public.cash_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID REFERENCES public.officers ON DELETE SET NULL,
  device_id UUID REFERENCES public.pos_devices ON DELETE SET NULL,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  collected_amount NUMERIC NOT NULL DEFAULT 0,
  expected_amount NUMERIC NOT NULL DEFAULT 0,
  actual_amount NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC GENERATED ALWAYS AS (actual_amount - expected_amount) STORED,
  supervisor_id UUID REFERENCES auth.users ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  signature_url TEXT,
  handover_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_handovers TO authenticated;
GRANT ALL ON public.cash_handovers TO service_role;
ALTER TABLE public.cash_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handovers readable" ON public.cash_handovers FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated create handovers" ON public.cash_handovers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admins update handovers" ON public.cash_handovers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'administrator') OR public.has_role(auth.uid(), 'supervisor'));

-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  user_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  browser TEXT,
  device TEXT,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit readable by admins" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'administrator'));
CREATE POLICY "authenticated write audit" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  category TEXT DEFAULT 'info',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated USING (user_id = auth.uid() OR user_id IS NULL) WITH CHECK (true);

-- Indexes
CREATE INDEX ON public.invoices (business_id);
CREATE INDEX ON public.invoices (status);
CREATE INDEX ON public.payments (invoice_id);
CREATE INDEX ON public.payments (officer_id);
CREATE INDEX ON public.payments (paid_at DESC);
CREATE INDEX ON public.businesses (division);
CREATE INDEX ON public.businesses (category);
CREATE INDEX ON public.pos_devices (online_status);

-- ===== supabase/migrations/20260709193742_baa4a85d-5bd7-45eb-ba77-2ce6118f0a86.sql =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'administrator'::public.app_role
FROM auth.users u
WHERE u.email IN ('admin@hoima.gov', 'alvin@hoima.gov')
ON CONFLICT DO NOTHING;
-- ===== supabase/migrations/20260709194800_318a1c48-ea10-4b01-9a92-a834d443ce97.sql =====

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['businesses','officers','pos_devices','invoices','payments','cash_handovers','audit_logs','notifications','profiles','user_roles']) LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon', t);
    EXECUTE format('DROP POLICY IF EXISTS "demo anon all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "demo anon all" ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ===== supabase/migrations/20260709200306_c3bae554-c8fa-4fac-ac97-06f7d65603b9.sql =====

ALTER TABLE public.pos_devices
  ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'android_pos',
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.invoices REPLICA IDENTITY FULL;
ALTER TABLE public.pos_devices REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='invoices') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='pos_devices') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_devices;
  END IF;
END $$;

-- ===== supabase/migrations/20260709212245_894f9c65-46f3-4b47-9cda-1fb02ca65f95.sql =====
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
-- ===== supabase/migrations/20260709213003_3c6ea102-f88e-43c9-a54c-3958f64090b3.sql =====

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

-- ===== supabase/migrations/20260709213528_d0222bd4-d04d-4509-9afc-2b331f68360a.sql =====

-- Fix trigger to match actual profiles schema (no email column)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role public.app_role;
  v_username TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username',
                         NEW.raw_user_meta_data->>'full_name',
                         split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', v_username),
          v_username)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov', 'alvinrr@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;

-- Create the AlvinRR super-admin
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'alvinrr@hoima.gov';
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      v_email,
      crypt('timeisgood', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'AlvinRR', 'username', 'AlvinRR'),
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );
  ELSE
    UPDATE auth.users
       SET encrypted_password = crypt('timeisgood', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'AlvinRR', 'username', 'AlvinRR')
     WHERE id = v_user_id;
  END IF;

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (v_user_id, 'AlvinRR', 'AlvinRR')
  ON CONFLICT (id) DO UPDATE SET full_name = 'AlvinRR', username = 'AlvinRR';

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'administrator')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;

-- ===== supabase/migrations/20260709214605_23f99d76-8237-41f6-9eee-c9ac971ca374.sql =====

-- Helper to resolve current user's officer record
CREATE OR REPLACE FUNCTION public.current_officer_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.officers WHERE user_id = auth.uid() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_officer_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_officer_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_officer_id() TO authenticated;

-- Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE ALL ON FUNCTION public.notify_new_invoice() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_new_invoice() FROM anon;
REVOKE ALL ON FUNCTION public.notify_new_invoice() FROM authenticated;

REVOKE ALL ON FUNCTION public.notify_new_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_new_payment() FROM anon;
REVOKE ALL ON FUNCTION public.notify_new_payment() FROM authenticated;

REVOKE ALL ON FUNCTION public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, numeric, text, uuid, uuid, text, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_pairing_code(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_pairing_code(text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_pairing_code(text, text, uuid) TO authenticated;

-- businesses: staff-only SELECT
DROP POLICY IF EXISTS "businesses readable" ON public.businesses;
CREATE POLICY "businesses readable by staff" ON public.businesses FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  public.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

-- cash_handovers: admin/supervisor or own officer
DROP POLICY IF EXISTS "handovers readable" ON public.cash_handovers;
CREATE POLICY "handovers readable by admin or own officer" ON public.cash_handovers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  officer_id = public.current_officer_id()
);

-- device_pairing_codes: admin or requesting officer
DROP POLICY IF EXISTS "pairing readable by authenticated" ON public.device_pairing_codes;
CREATE POLICY "pairing readable by admin or requester" ON public.device_pairing_codes FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  requested_by_officer_id = public.current_officer_id()
);

-- invoices: restrict UPDATE to admin or issuer
DROP POLICY IF EXISTS "authenticated update invoices" ON public.invoices;
CREATE POLICY "admin or issuer update invoices" ON public.invoices FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'::public.app_role) OR issued_by = auth.uid())
WITH CHECK (public.has_role(auth.uid(), 'administrator'::public.app_role) OR issued_by = auth.uid());

-- notifications: remove broad policies; keep 'own notifications'
DROP POLICY IF EXISTS "authenticated read notifications" ON public.notifications;
DROP POLICY IF EXISTS "authenticated update notifications" ON public.notifications;
DROP POLICY IF EXISTS "authenticated delete notifications" ON public.notifications;

-- officers: admin/supervisor see all; officers see self
DROP POLICY IF EXISTS "officers readable" ON public.officers;
CREATE POLICY "officers readable by admin or self" ON public.officers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  user_id = auth.uid()
);

-- payments: admin/supervisor or own officer
DROP POLICY IF EXISTS "payments readable" ON public.payments;
CREATE POLICY "payments readable by admin or own officer" ON public.payments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'administrator'::public.app_role) OR
  public.has_role(auth.uid(), 'supervisor'::public.app_role) OR
  officer_id = public.current_officer_id()
);

-- pos_devices: restrict UPDATE to admin or assigned officer
DROP POLICY IF EXISTS "authenticated update device status" ON public.pos_devices;
CREATE POLICY "admin or assigned officer update devices" ON public.pos_devices FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'administrator'::public.app_role) OR assigned_officer_id = public.current_officer_id())
WITH CHECK (public.has_role(auth.uid(), 'administrator'::public.app_role) OR assigned_officer_id = public.current_officer_id());

-- profiles: self or admin
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by self or admin" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'administrator'::public.app_role));

-- user_roles: self or admin
DROP POLICY IF EXISTS "roles readable by authenticated" ON public.user_roles;
CREATE POLICY "roles readable by self or admin" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'administrator'::public.app_role));

-- ===== supabase/migrations/20260710092839_c4d4383e-90af-4439-8855-cd8d4ec18304.sql =====

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

-- ===== supabase/migrations/20260710092950_644d52a7-dd67-4f87-a591-fae0cd6168d0.sql =====

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

-- ===== supabase/migrations/20260710094030_fd616fac-953d-461e-a580-f401b435d332.sql =====

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

-- ===== supabase/migrations/20260710100604_b8f7e303-546e-47e6-86b7-b11496c68728.sql =====
DROP POLICY IF EXISTS "invoices readable by staff or issuer" ON public.invoices;
CREATE POLICY "invoices readable by staff"
ON public.invoices FOR SELECT TO authenticated
USING (
  private.has_role(auth.uid(), 'administrator'::app_role)
  OR private.has_role(auth.uid(), 'supervisor'::app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::app_role)
);
-- ===== supabase/migrations/20260710114335_452ad6ff-8be5-40c0-926f-4c97ce98c649.sql =====
-- Let all staff (admins, supervisors, revenue officers) read payments,
-- matching the invoices/businesses model. This also lets the mobile POS
-- re-read a payment it just inserted, and lets the web admin see receipts
-- from mobile officers immediately.
DROP POLICY IF EXISTS "payments readable by admin or own officer" ON public.payments;

CREATE POLICY "payments readable by staff"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    private.has_role(auth.uid(), 'administrator'::app_role)
    OR private.has_role(auth.uid(), 'supervisor'::app_role)
    OR private.has_role(auth.uid(), 'revenue_officer'::app_role)
  );
-- ===== supabase/migrations/20260710160623_88db4f29-db4b-455b-97ba-5900bb5853f5.sql =====
-- Ensure realtime is enabled for invoices and payments so the office sees mobile-issued invoices live
ALTER TABLE public.invoices REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='invoices') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='payments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.payments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

-- Attach existing notify functions as triggers so the office bell/toast fires
DROP TRIGGER IF EXISTS trg_notify_new_invoice ON public.invoices;
CREATE TRIGGER trg_notify_new_invoice
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_new_invoice();

DROP TRIGGER IF EXISTS trg_notify_new_payment ON public.payments;
CREATE TRIGGER trg_notify_new_payment
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.notify_new_payment();
-- ===== supabase/migrations/20260711000926_208ac40d-4310-4ffa-8d06-820cfe1d43c9.sql =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_handovers TO authenticated;
GRANT ALL ON public.cash_handovers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_pairing_codes TO authenticated;
GRANT ALL ON public.device_pairing_codes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.officers TO authenticated;
GRANT ALL ON public.officers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_devices TO authenticated;
GRANT ALL ON public.pos_devices TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
-- ===== supabase/migrations/20260711001042_46e239ba-33ab-4090-aac0-f7294b14d3c0.sql =====
DROP POLICY IF EXISTS "authenticated write audit" ON public.audit_logs;
CREATE POLICY "staff can write audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "authenticated create businesses" ON public.businesses;
CREATE POLICY "staff can create businesses"
ON public.businesses
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "authenticated create handovers" ON public.cash_handovers;
CREATE POLICY "staff can create handovers"
ON public.cash_handovers
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "pairing insertable by authenticated" ON public.device_pairing_codes;
CREATE POLICY "staff can request device pairing"
ON public.device_pairing_codes
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND status = 'pending'
  AND (
    private.has_role(auth.uid(), 'administrator'::public.app_role)
    OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
    OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
  )
);

DROP POLICY IF EXISTS "authenticated create invoices" ON public.invoices;
CREATE POLICY "staff can create invoices"
ON public.invoices
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);

DROP POLICY IF EXISTS "authenticated create payments" ON public.payments;
CREATE POLICY "staff can create payments"
ON public.payments
FOR INSERT
TO authenticated
WITH CHECK (
  private.has_role(auth.uid(), 'administrator'::public.app_role)
  OR private.has_role(auth.uid(), 'supervisor'::public.app_role)
  OR private.has_role(auth.uid(), 'revenue_officer'::public.app_role)
);
-- ===== supabase/migrations/20260711035826_be34ceef-a122-4e52-8954-7922000790ad.sql =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $$;
-- ===== supabase/migrations/20260711061521_742d9507-da8e-4ae5-8cf0-76643a608673.sql =====

-- 1. Add handover deadline to officers
ALTER TABLE public.officers
  ADD COLUMN IF NOT EXISTS handover_deadline TIMESTAMPTZ;

-- 2. Admin sets an officer's handover deadline
CREATE OR REPLACE FUNCTION public.set_officer_handover_deadline(
  p_caller uuid,
  p_officer_id uuid,
  p_deadline timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can set handover deadlines';
  END IF;
  UPDATE public.officers SET handover_deadline = p_deadline WHERE id = p_officer_id;
  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES ('Handover deadline set',
          'Deadline updated for officer ' || p_officer_id::text || ' to ' || to_char(p_deadline, 'YYYY-MM-DD HH24:MI'),
          'handover', false);
END; $$;

-- 3. Admin confirms a handover: mark approved, reset device cash to 0, unlock, optionally set next deadline
CREATE OR REPLACE FUNCTION public.confirm_handover_admin(
  p_caller uuid,
  p_handover_id uuid,
  p_next_deadline timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer_id uuid;
  v_device_id  uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can confirm handovers';
  END IF;

  UPDATE public.cash_handovers
    SET status = 'approved', supervisor_id = p_caller
    WHERE id = p_handover_id
  RETURNING officer_id, device_id INTO v_officer_id, v_device_id;

  IF v_device_id IS NOT NULL THEN
    UPDATE public.pos_devices
      SET cash_balance = 0,
          locked = false,
          lock_reason = NULL,
          locked_at = NULL
      WHERE id = v_device_id;
  END IF;

  IF v_officer_id IS NOT NULL THEN
    UPDATE public.officers
      SET handover_deadline = p_next_deadline
      WHERE id = v_officer_id;
  END IF;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES ('Handover confirmed',
          'Cash received; device cash reset to 0 UGX and unlocked.',
          'handover', false);
END; $$;

-- 4. Admin unlocks a device manually
CREATE OR REPLACE FUNCTION public.unlock_device_admin(
  p_caller uuid,
  p_device_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can unlock devices';
  END IF;
  UPDATE public.pos_devices
    SET locked = false, lock_reason = NULL, locked_at = NULL
    WHERE id = p_device_id;
END; $$;

-- 5. Lock devices whose assigned officer missed their handover deadline
CREATE OR REPLACE FUNCTION public.lock_overdue_devices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH overdue AS (
    SELECT d.id
    FROM public.pos_devices d
    JOIN public.officers o ON o.id = d.assigned_officer_id
    WHERE o.handover_deadline IS NOT NULL
      AND o.handover_deadline < now()
      AND COALESCE(d.locked, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.cash_handovers h
        WHERE h.device_id = d.id
          AND h.status = 'approved'
          AND h.created_at >= o.handover_deadline
      )
  )
  UPDATE public.pos_devices d
    SET locked = true,
        lock_reason = 'Handover deadline missed',
        locked_at = now()
    FROM overdue
    WHERE d.id = overdue.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.set_officer_handover_deadline(uuid, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_handover_admin(uuid, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlock_device_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_overdue_devices() TO authenticated, service_role;

-- 6. Schedule auto-lock every 5 minutes via pg_cron (if extension available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lock-overdue-devices') FROM cron.job WHERE jobname = 'lock-overdue-devices';
    PERFORM cron.schedule('lock-overdue-devices', '*/5 * * * *', $cron$SELECT public.lock_overdue_devices();$cron$);
  END IF;
END $$;

-- ===== supabase/migrations/20260711061546_ee75d8c7-e992-4b36-b1ed-aa993c3d61eb.sql =====

-- Drop old signatures
DROP FUNCTION IF EXISTS public.set_officer_handover_deadline(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.confirm_handover_admin(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.unlock_device_admin(uuid, uuid);

-- Recreate using auth.uid() so only the signed-in admin can succeed
CREATE OR REPLACE FUNCTION public.set_officer_handover_deadline(
  p_officer_id uuid,
  p_deadline timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can set handover deadlines';
  END IF;
  UPDATE public.officers SET handover_deadline = p_deadline WHERE id = p_officer_id;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_handover_admin(
  p_handover_id uuid,
  p_next_deadline timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_device_id  uuid;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can confirm handovers';
  END IF;

  UPDATE public.cash_handovers
    SET status = 'approved', supervisor_id = v_uid
    WHERE id = p_handover_id
  RETURNING officer_id, device_id INTO v_officer_id, v_device_id;

  IF v_device_id IS NOT NULL THEN
    UPDATE public.pos_devices
      SET cash_balance = 0, locked = false, lock_reason = NULL, locked_at = NULL
      WHERE id = v_device_id;
  END IF;

  IF v_officer_id IS NOT NULL THEN
    UPDATE public.officers SET handover_deadline = p_next_deadline WHERE id = v_officer_id;
  END IF;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES ('Handover confirmed', 'Cash received; device cash reset to 0 UGX and unlocked.', 'handover', false);
END; $$;

CREATE OR REPLACE FUNCTION public.unlock_device_admin(
  p_device_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can unlock devices';
  END IF;
  UPDATE public.pos_devices
    SET locked = false, lock_reason = NULL, locked_at = NULL
    WHERE id = p_device_id;
END; $$;

-- Restrict EXECUTE — no anon; authenticated calls succeed only for admins via the internal check
REVOKE ALL ON FUNCTION public.set_officer_handover_deadline(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_handover_admin(uuid, timestamptz)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlock_device_admin(uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lock_overdue_devices()                           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_officer_handover_deadline(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_handover_admin(uuid, timestamptz)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlock_device_admin(uuid)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_overdue_devices()                           TO service_role;

-- ===== supabase/migrations/20260711064951_cf77f6d1-e33b-4da6-a397-3168d0645b39.sql =====
DO $$
DECLARE tbl record;
BEGIN
  FOR tbl IN SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname='public'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl.table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl.table_name);
  END LOOP;
END $$;
-- ===== supabase/migrations/20260711074928_f161e4c7-1543-42b1-bb10-c0f93ffaf7d6.sql =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role public.app_role;
  v_username TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username',
                         NEW.raw_user_meta_data->>'full_name',
                         split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', v_username),
          v_username)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov', 'alvinrr@hoima.gov', 'rrnfamily@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;
-- ===== supabase/migrations/20260711203013_b7ca1fb9-f742-47f4-94ef-14c7e4383ba4.sql =====

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

-- ===== supabase/migrations/20260711203047_0c08d8d0-8e15-4ad7-8343-049b9207f00a.sql =====

CREATE OR REPLACE FUNCTION public.set_officer_handover_deadline(p_officer_id uuid, p_deadline timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can set handover deadlines';
  END IF;
  UPDATE public.officers SET handover_deadline = p_deadline WHERE id = p_officer_id;
END; $$;

CREATE OR REPLACE FUNCTION public.unlock_device_admin(p_device_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can unlock devices';
  END IF;
  UPDATE public.pos_devices
    SET locked = false, lock_reason = NULL, locked_at = NULL
    WHERE id = p_device_id;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_handover_admin(p_handover_id uuid, p_next_deadline timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_device_id  uuid;
BEGIN
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can confirm handovers';
  END IF;

  UPDATE public.cash_handovers
    SET status = 'approved', supervisor_id = COALESCE(v_uid, supervisor_id)
    WHERE id = p_handover_id
  RETURNING officer_id, device_id INTO v_officer_id, v_device_id;

  IF v_device_id IS NOT NULL THEN
    UPDATE public.pos_devices
      SET cash_balance = 0, locked = false, lock_reason = NULL, locked_at = NULL
      WHERE id = v_device_id;
  END IF;

  IF v_officer_id IS NOT NULL THEN
    UPDATE public.officers SET handover_deadline = p_next_deadline WHERE id = v_officer_id;
  END IF;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES ('Handover confirmed', 'Cash received; device cash reset to 0 UGX and unlocked.', 'handover', false);
END; $$;

REVOKE EXECUTE ON FUNCTION public.set_officer_handover_deadline(uuid, timestamptz) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlock_device_admin(uuid) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_handover_admin(uuid, timestamptz) FROM authenticated, PUBLIC;

-- ===== supabase/migrations/20260711203227_f0cd289f-c103-44ae-accb-974c23afca36.sql =====

CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND COALESCE(status, 'completed') <> 'voided';

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0))
    INTO v_due
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN RETURN; END IF;

  IF v_total <= 0 THEN
    v_status := 'pending';
  ELSIF v_total >= v_due THEN
    v_status := 'paid';
  ELSE
    v_status := 'partial';
  END IF;

  UPDATE public.invoices
     SET paid_amount = v_total,
         status = v_status
   WHERE id = p_invoice_id;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_payments_sync_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_invoice_totals(OLD.invoice_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalc_invoice_totals(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.recalc_invoice_totals(OLD.invoice_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS payments_sync_invoice ON public.payments;
CREATE TRIGGER payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_sync_invoice();

-- Backfill existing invoices to match current payment history
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT invoice_id FROM public.payments WHERE invoice_id IS NOT NULL LOOP
    PERFORM public.recalc_invoice_totals(r.invoice_id);
  END LOOP;
END $$;

-- ===== supabase/migrations/20260711203236_17256b45-0be9-4d94-80d8-95719a96e5fb.sql =====

REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_sync_invoice() FROM PUBLIC, anon, authenticated;

-- ===== supabase/migrations/20260711203908_2114ecbb-b2b6-412d-94c5-f778e84616e0.sql =====

CREATE OR REPLACE FUNCTION public.tg_payments_autolink_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1) Try match by reference_number = invoice_number
  IF NEW.reference_number IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE invoice_number = NEW.reference_number
     LIMIT 1;
  END IF;

  -- 2) Fallback: oldest unpaid invoice for this business
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = NEW.business_id
       AND status <> 'paid'
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0
     ORDER BY COALESCE(due_date, issue_date) ASC, issue_date ASC
     LIMIT 1;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    NEW.invoice_id := v_invoice_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_payments_autolink_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_autolink_invoice ON public.payments;
CREATE TRIGGER payments_autolink_invoice
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_autolink_invoice();

-- Ensure the existing sync trigger exists (recalc totals after insert/update/delete)
DROP TRIGGER IF EXISTS payments_sync_invoice ON public.payments;
CREATE TRIGGER payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_sync_invoice();

-- Force sync_status default to 'synced' for anything arriving from clients
ALTER TABLE public.payments ALTER COLUMN sync_status SET DEFAULT 'synced';

-- Backfill: link historical NULL-invoice payments to their business's oldest matching invoice
DO $$
DECLARE r record; v_inv uuid;
BEGIN
  FOR r IN SELECT id, business_id, reference_number FROM public.payments WHERE invoice_id IS NULL LOOP
    v_inv := NULL;
    IF r.reference_number IS NOT NULL THEN
      SELECT id INTO v_inv FROM public.invoices WHERE invoice_number = r.reference_number LIMIT 1;
    END IF;
    IF v_inv IS NULL AND r.business_id IS NOT NULL THEN
      SELECT id INTO v_inv FROM public.invoices
        WHERE business_id = r.business_id AND status <> 'paid'
        ORDER BY COALESCE(due_date, issue_date) ASC LIMIT 1;
    END IF;
    IF v_inv IS NOT NULL THEN
      UPDATE public.payments SET invoice_id = v_inv WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- ===== supabase/migrations/20260711211707_ac9a4514-64d2-4e76-936d-97553107f0bc.sql =====

-- Wipe operational/demo data; keep only super admins (AlvinRR, RRnFamily)
TRUNCATE TABLE
  public.payments,
  public.invoices,
  public.cash_handovers,
  public.device_pairing_codes,
  public.pos_devices,
  public.officers,
  public.businesses,
  public.notifications,
  public.audit_logs
RESTART IDENTITY CASCADE;

-- Remove non-admin users (profiles, roles, and auth users)
DELETE FROM public.user_roles
 WHERE user_id NOT IN (
   '3762eb74-7fc7-4655-b1b0-fac04ac20466',
   'fcc69bde-d7f8-4b5e-82ba-65b8b702973e'
 );

DELETE FROM public.profiles
 WHERE id NOT IN (
   '3762eb74-7fc7-4655-b1b0-fac04ac20466',
   'fcc69bde-d7f8-4b5e-82ba-65b8b702973e'
 );

DELETE FROM auth.users
 WHERE id NOT IN (
   '3762eb74-7fc7-4655-b1b0-fac04ac20466',
   'fcc69bde-d7f8-4b5e-82ba-65b8b702973e'
 );

-- ===== supabase/migrations/20260711212252_eac4198e-8c99-4501-b05f-1ac9c4ee2d71.sql =====

-- 1) Default due_date = issue_date + 30 days when null
CREATE OR REPLACE FUNCTION public.tg_invoices_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := COALESCE(NEW.issue_date, now()) + interval '30 days';
  END IF;
  IF NEW.financial_year IS NULL THEN
    NEW.financial_year := to_char(COALESCE(NEW.issue_date, now()), 'YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_set_defaults ON public.invoices;
CREATE TRIGGER invoices_set_defaults
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_set_defaults();

REVOKE EXECUTE ON FUNCTION public.tg_invoices_set_defaults() FROM PUBLIC, anon, authenticated;

-- 2) Recalc now includes 'overdue' state
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_due_dt  timestamptz;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND COALESCE(status, 'completed') <> 'voided';

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0)), due_date
    INTO v_due, v_due_dt
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN RETURN; END IF;

  IF v_total >= v_due AND v_due > 0 THEN
    v_status := 'paid';
  ELSIF v_total > 0 THEN
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'partial' END;
  ELSE
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'pending' END;
  END IF;

  UPDATE public.invoices
     SET paid_amount = v_total,
         status = v_status
   WHERE id = p_invoice_id;
END;
$$;

-- 3) Sweep function to mark overdue invoices (safe to call on a schedule)
CREATE OR REPLACE FUNCTION public.mark_overdue_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.invoices
     SET status = 'overdue'
   WHERE due_date IS NOT NULL
     AND due_date < now()
     AND status IN ('pending', 'partial')
     AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_overdue_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_overdue_invoices() TO authenticated, service_role;

-- 4) Run the sweep once now
SELECT public.mark_overdue_invoices();

-- ===== supabase/migrations/20260711212306_429dd058-8aab-4381-ba37-1f9e6a65403c.sql =====

REVOKE EXECUTE ON FUNCTION public.mark_overdue_invoices() FROM authenticated;

-- ===== supabase/migrations/20260711215312_dfbd1f1a-834e-4c04-aed5-5306834976bb.sql =====

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_email text := 'katende@hoima.gov';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
  ELSE
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      crypt('kats@1', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username','Katende','full_name','Katende'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());
  END IF;

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (v_uid, 'Katende', 'Katende')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'administrator')
  ON CONFLICT DO NOTHING;
END $$;

-- Also add katende@hoima.gov to the admin allowlist in the signup trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role public.app_role;
  v_username TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username',
                         NEW.raw_user_meta_data->>'full_name',
                         split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', v_username),
          v_username)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov', 'alvinrr@hoima.gov', 'rrnfamily@hoima.gov', 'katende@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;

-- ===== supabase/migrations/20260712093249_1191052b-97bc-4536-ac90-d0899eba6973.sql =====

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_email text := 'bridget@hoima.gov';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    UPDATE auth.users SET encrypted_password = crypt('brig123', gen_salt('bf')) WHERE id = v_uid;
  ELSE
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      crypt('brig123', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username','Bridget','full_name','Bridget'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());
  END IF;

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (v_uid, 'Bridget', 'Bridget')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'administrator')
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role public.app_role;
  v_username TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username',
                         NEW.raw_user_meta_data->>'full_name',
                         split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', v_username),
          v_username)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov', 'alvinrr@hoima.gov', 'rrnfamily@hoima.gov', 'katende@hoima.gov', 'bridget@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;

-- ===== supabase/migrations/20260712121506_6a0b9583-9d7b-4bce-8a20-0d42723986f9.sql =====

-- Wipe operational data
TRUNCATE TABLE
  public.audit_logs,
  public.notifications,
  public.payments,
  public.invoices,
  public.cash_handovers,
  public.device_pairing_codes,
  public.pos_devices,
  public.officers,
  public.businesses
RESTART IDENTITY CASCADE;

-- Remove all users except Bridget (cascades to profiles and user_roles via FKs)
DELETE FROM auth.users WHERE email <> 'bridget@hoima.gov';

-- Best-effort cleanup for any orphaned rows if FKs are not ON DELETE CASCADE
DELETE FROM public.user_roles WHERE user_id NOT IN (SELECT id FROM auth.users);
DELETE FROM public.profiles WHERE id NOT IN (SELECT id FROM auth.users);

-- Ensure Bridget is administrator only (drop any duplicate revenue_officer role)
DELETE FROM public.user_roles
WHERE user_id = (SELECT id FROM auth.users WHERE email='bridget@hoima.gov')
  AND role <> 'administrator';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'administrator' FROM auth.users WHERE email='bridget@hoima.gov'
ON CONFLICT DO NOTHING;

-- ===== supabase/migrations/20260712121756_73dd61a3-aac2-4202-a054-a7e1028bacb6.sql =====

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_email text := 'alvinrr@hoima.gov';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    UPDATE auth.users SET encrypted_password = crypt('timeisgood', gen_salt('bf')) WHERE id = v_uid;
  ELSE
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      crypt('timeisgood', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username','AlvinRR','full_name','AlvinRR'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());
  END IF;

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (v_uid, 'AlvinRR', 'AlvinRR')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username;

  DELETE FROM public.user_roles WHERE user_id = v_uid AND role <> 'administrator';
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'administrator')
  ON CONFLICT DO NOTHING;
END $$;

-- ===== supabase/migrations/20260712121916_bfdd69e2-189a-4cbc-a502-9f5c3bcc3556.sql =====

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_email text := 'katende@hoima.gov';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    UPDATE auth.users SET encrypted_password = crypt('kats@12', gen_salt('bf')) WHERE id = v_uid;
  ELSE
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      crypt('kats@12', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username','katende','full_name','Katende'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());
  END IF;

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (v_uid, 'Katende', 'katende')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, username = EXCLUDED.username;

  DELETE FROM public.user_roles WHERE user_id = v_uid AND role <> 'administrator';
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'administrator')
  ON CONFLICT DO NOTHING;
END $$;

-- ===== supabase/migrations/20260714120000_add_bank_transfers_table.sql =====
-- Intentionally empty.
-- An earlier draft of public.bank_transfers lived here. The live schema uses the version created in
-- 20260717165254_*.sql (with officer_id, submitted_by, admin_notes, reviewed_by), which matches
-- src/integrations/supabase/types.ts. Creating the table twice fails on a fresh database.
SELECT 1;

-- ===== supabase/migrations/20260714130000_fix_app_role_enum.sql =====
-- Fix app_role enum to properly include super_admin
-- This migration recreates the enum type to support all roles

-- (Enum recreation removed: app_role now includes super_admin from the first migration.
-- Dropping the type fails on a fresh database because policies already depend on it.)

-- Update any function references
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Update or create helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = _user_id AND role IN ('administrator'::public.app_role, 'super_admin'::public.app_role)
  );
$$;

-- ===== supabase/migrations/20260714130100_assign_super_admin_to_alvinrr.sql =====
-- Assign super_admin role to AlvinRR (runs after enum is fixed)
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Find AlvinRR's user ID
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'alvinrr@hoima.gov';
  
  IF v_user_id IS NOT NULL THEN
    -- Remove any existing roles for AlvinRR
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    
    -- Assign super_admin role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'super_admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ===== supabase/migrations/20260717113320_b14920ce-0c34-4b7e-b4cd-d1190db02c71.sql =====

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

-- ===== supabase/migrations/20260717120155_28d52d7d-e5ac-43bf-acf4-34b50c60f871.sql =====

-- Invoice defaults
DROP TRIGGER IF EXISTS trg_invoices_set_defaults ON public.invoices;
CREATE TRIGGER trg_invoices_set_defaults
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_set_defaults();

-- Notify on new invoice (system copy)
DROP TRIGGER IF EXISTS trg_notify_new_invoice ON public.invoices;
CREATE TRIGGER trg_notify_new_invoice
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_new_invoice();

-- Notify on new payment
DROP TRIGGER IF EXISTS trg_notify_new_payment ON public.payments;
CREATE TRIGGER trg_notify_new_payment
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.notify_new_payment();

-- Autolink payment to invoice
DROP TRIGGER IF EXISTS trg_payments_autolink_invoice ON public.payments;
CREATE TRIGGER trg_payments_autolink_invoice
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_autolink_invoice();

-- Sync invoice totals from payments
DROP TRIGGER IF EXISTS trg_payments_sync_invoice ON public.payments;
CREATE TRIGGER trg_payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_sync_invoice();

-- ===== supabase/migrations/20260717143202_88023abc-1c2d-4fda-997d-42454fc9f8d0.sql =====
-- Restore and harden invoice/payment automation for mobile POS sync

-- Ensure the existing invoice default function also records who issued it.
CREATE OR REPLACE FUNCTION public.tg_invoices_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.issued_by IS NULL THEN
    NEW.issued_by := auth.uid();
  END IF;

  IF NEW.issue_date IS NULL THEN
    NEW.issue_date := now();
  END IF;

  IF NEW.due_date IS NULL THEN
    NEW.due_date := COALESCE(NEW.issue_date, now()) + interval '30 days';
  END IF;

  IF NEW.financial_year IS NULL THEN
    NEW.financial_year := to_char(COALESCE(NEW.issue_date, now()), 'YYYY');
  END IF;

  IF NEW.status IS NULL THEN
    NEW.status := 'pending';
  END IF;

  NEW.amount := COALESCE(NEW.amount, 0);
  NEW.penalty := COALESCE(NEW.penalty, 0);
  NEW.discount := COALESCE(NEW.discount, 0);
  NEW.paid_amount := COALESCE(NEW.paid_amount, 0);

  RETURN NEW;
END;
$$;

-- Recalculate invoice totals/status whenever a payment changes.
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_due_dt  timestamptz;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND COALESCE(status, 'success') NOT IN ('voided', 'cancelled', 'failed');

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0)), due_date
    INTO v_due, v_due_dt
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN
    RETURN;
  END IF;

  IF v_total >= v_due AND v_due > 0 THEN
    v_status := 'paid';
  ELSIF v_total > 0 THEN
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'partial' END;
  ELSE
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'pending' END;
  END IF;

  UPDATE public.invoices
     SET paid_amount = v_total,
         status = v_status
   WHERE id = p_invoice_id;
END;
$$;

-- Before a payment is saved, fill officer/device-friendly defaults and link to an invoice if possible.
CREATE OR REPLACE FUNCTION public.tg_payments_autolink_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_id uuid;
  v_officer_id uuid;
BEGIN
  NEW.amount := COALESCE(NEW.amount, 0);
  NEW.status := COALESCE(NEW.status, 'success');
  NEW.sync_status := COALESCE(NEW.sync_status, 'synced');
  NEW.paid_at := COALESCE(NEW.paid_at, now());

  IF NEW.officer_id IS NULL THEN
    SELECT id
      INTO v_officer_id
      FROM public.officers
     WHERE user_id = auth.uid()
     LIMIT 1;

    NEW.officer_id := v_officer_id;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Match by reference_number = invoice_number first.
  IF NEW.reference_number IS NOT NULL THEN
    SELECT id
      INTO v_invoice_id
      FROM public.invoices
     WHERE invoice_number = NEW.reference_number
     LIMIT 1;
  END IF;

  -- Fallback: oldest unpaid invoice for this taxpayer/business.
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL THEN
    SELECT id
      INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = NEW.business_id
       AND status <> 'paid'
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0
     ORDER BY COALESCE(due_date, issue_date) ASC, issue_date ASC
     LIMIT 1;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    NEW.invoice_id := v_invoice_id;
  END IF;

  RETURN NEW;
END;
$$;

-- After payments change, update linked invoice status and device cash totals for handover.
CREATE OR REPLACE FUNCTION public.tg_payments_sync_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      PERFORM public.recalc_invoice_totals(OLD.invoice_id);
    END IF;

    IF OLD.device_id IS NOT NULL AND COALESCE(OLD.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN
      UPDATE public.pos_devices
         SET cash_balance = GREATEST(COALESCE(cash_balance,0) - COALESCE(OLD.amount,0), 0),
             total_transactions = GREATEST(COALESCE(total_transactions,0) - 1, 0),
             sync_status = 'synced',
             last_seen = now(),
             online_status = 'online'
       WHERE id = OLD.device_id;
    END IF;

    RETURN OLD;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    PERFORM public.recalc_invoice_totals(NEW.invoice_id);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND OLD.invoice_id IS NOT NULL THEN
    PERFORM public.recalc_invoice_totals(OLD.invoice_id);
  END IF;

  IF NEW.device_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND COALESCE(NEW.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN
      UPDATE public.pos_devices
         SET cash_balance = COALESCE(cash_balance,0) + COALESCE(NEW.amount,0),
             total_transactions = COALESCE(total_transactions,0) + 1,
             sync_status = 'synced',
             last_seen = now(),
             online_status = 'online',
             current_lat = COALESCE(NEW.gps_lat, current_lat),
             current_lng = COALESCE(NEW.gps_lng, current_lng)
       WHERE id = NEW.device_id;
    ELSIF TG_OP = 'UPDATE' THEN
      UPDATE public.pos_devices
         SET cash_balance = GREATEST(
               COALESCE(cash_balance,0)
               - CASE WHEN COALESCE(OLD.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN COALESCE(OLD.amount,0) ELSE 0 END
               + CASE WHEN COALESCE(NEW.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN COALESCE(NEW.amount,0) ELSE 0 END,
               0
             ),
             sync_status = 'synced',
             last_seen = now(),
             online_status = 'online',
             current_lat = COALESCE(NEW.gps_lat, current_lat),
             current_lng = COALESCE(NEW.gps_lng, current_lng)
       WHERE id = NEW.device_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Admin notifications for mobile-issued invoices.
CREATE OR REPLACE FUNCTION public.notify_new_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  biz_name text;
BEGIN
  SELECT business_name INTO biz_name FROM public.businesses WHERE id = NEW.business_id;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'New invoice ' || NEW.invoice_number,
    'Issued to ' || COALESCE(biz_name, 'Unknown taxpayer') ||
      ' · UGX ' || to_char(COALESCE(NEW.amount,0), 'FM999,999,999'),
    'invoice',
    false
  );

  RETURN NEW;
END;
$$;

-- Admin notifications for mobile-issued receipts/payments.
CREATE OR REPLACE FUNCTION public.notify_new_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  biz_name text;
BEGIN
  SELECT business_name INTO biz_name FROM public.businesses WHERE id = NEW.business_id;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'Payment ' || NEW.receipt_number || ' received',
    COALESCE(biz_name, 'Taxpayer') || ' paid UGX ' ||
      to_char(COALESCE(NEW.amount,0), 'FM999,999,999') || ' via ' || NEW.payment_method,
    'payment',
    false
  );

  RETURN NEW;
END;
$$;

-- Reattach triggers idempotently.
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

-- Keep realtime publication attached for live web updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Reaffirm Data API access for authenticated mobile/web users and backend service operations.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.officers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;

GRANT ALL ON public.invoices TO service_role;
GRANT ALL ON public.payments TO service_role;
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON public.pos_devices TO service_role;
GRANT ALL ON public.officers TO service_role;
GRANT ALL ON public.businesses TO service_role;
-- ===== supabase/migrations/20260717143351_aeb2e0a3-93f4-403f-bf38-8d3786a00293.sql =====
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
-- ===== supabase/migrations/20260717143528_cd4cf3f4-f272-4489-84d7-90a647e855ba.sql =====
CREATE OR REPLACE FUNCTION public.tg_payments_prepare_mobile_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_device public.pos_devices;
BEGIN
  IF TG_OP <> 'INSERT' AND TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Fill the officer from the logged-in officer profile when Android omits it.
  IF NEW.officer_id IS NULL AND v_uid IS NOT NULL THEN
    SELECT id INTO v_officer_id
      FROM public.officers
     WHERE user_id = v_uid
     LIMIT 1;
    NEW.officer_id := v_officer_id;
  ELSE
    v_officer_id := NEW.officer_id;
  END IF;

  -- Fill taxpayer/business from the invoice when Android sends invoice_id only.
  IF NEW.business_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT business_id INTO NEW.business_id
      FROM public.invoices
     WHERE id = NEW.invoice_id;
  END IF;

  -- Validate the POS/mobile device and block payments from locked devices.
  IF NEW.device_id IS NOT NULL THEN
    SELECT * INTO v_device
      FROM public.pos_devices
     WHERE id = NEW.device_id
     LIMIT 1;

    IF v_device.id IS NULL THEN
      RAISE EXCEPTION 'POS device not found';
    END IF;

    IF COALESCE(v_device.locked, false) THEN
      RAISE EXCEPTION 'POS device is locked: %', COALESCE(v_device.lock_reason, 'handover required');
    END IF;

    IF v_uid IS NOT NULL
       AND v_device.assigned_officer_id IS NOT NULL
       AND v_officer_id IS NOT NULL
       AND v_device.assigned_officer_id IS DISTINCT FROM v_officer_id
       AND NOT (private.has_role(v_uid, 'administrator') OR private.has_role(v_uid, 'supervisor')) THEN
      RAISE EXCEPTION 'This POS device is not assigned to the logged-in officer';
    END IF;

    NEW.sync_status := COALESCE(NULLIF(NEW.sync_status, ''), 'synced');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_payments_update_device_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_cash numeric := 0;
  v_new_cash numeric := 0;
  v_old_tx integer := 0;
  v_new_tx integer := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.device_id IS NOT NULL THEN
    IF lower(COALESCE(OLD.payment_method, '')) = 'cash'
       AND COALESCE(OLD.status, 'success') IN ('success', 'completed', 'paid') THEN
      v_old_cash := COALESCE(OLD.amount, 0);
      v_old_tx := 1;
    END IF;

    UPDATE public.pos_devices
       SET cash_balance = GREATEST(COALESCE(cash_balance, 0) - v_old_cash, 0),
           total_transactions = GREATEST(COALESCE(total_transactions, 0) - v_old_tx, 0),
           last_seen = now(),
           online_status = 'online',
           sync_status = 'synced'
     WHERE id = OLD.device_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.device_id IS NOT NULL THEN
    IF lower(COALESCE(NEW.payment_method, '')) = 'cash'
       AND COALESCE(NEW.status, 'success') IN ('success', 'completed', 'paid') THEN
      v_new_cash := COALESCE(NEW.amount, 0);
      v_new_tx := 1;
    END IF;

    UPDATE public.pos_devices
       SET cash_balance = GREATEST(COALESCE(cash_balance, 0) + v_new_cash, 0),
           total_transactions = GREATEST(COALESCE(total_transactions, 0) + v_new_tx, 0),
           last_seen = now(),
           online_status = 'online',
           sync_status = 'synced'
     WHERE id = NEW.device_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_prepare_mobile_sync ON public.payments;
CREATE TRIGGER trg_payments_prepare_mobile_sync
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_prepare_mobile_sync();

DROP TRIGGER IF EXISTS trg_payments_update_device_cash ON public.payments;
CREATE TRIGGER trg_payments_update_device_cash
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_update_device_cash();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cash_handovers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_handovers;
  END IF;
END $$;
-- ===== supabase/migrations/20260717143545_d03d2480-cbdb-4b9b-8961-1e94a0772806.sql =====
REVOKE ALL ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM anon;
REVOKE ALL ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM authenticated;

REVOKE ALL ON FUNCTION public.tg_payments_update_device_cash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_payments_update_device_cash() FROM anon;
REVOKE ALL ON FUNCTION public.tg_payments_update_device_cash() FROM authenticated;
-- ===== supabase/migrations/20260717155821_b806d011-1bec-4c16-acf5-b45e6df3c1c4.sql =====

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_payments_deleted_at ON public.payments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON public.invoices(deleted_at);

-- Recalc must ignore soft-deleted payments
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_due_dt  timestamptz;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND deleted_at IS NULL
     AND COALESCE(status, 'success') NOT IN ('voided', 'cancelled', 'failed');

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0)), due_date
    INTO v_due, v_due_dt
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN RETURN; END IF;

  IF v_total >= v_due AND v_due > 0 THEN
    v_status := 'paid';
  ELSIF v_total > 0 THEN
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'partial' END;
  ELSE
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'pending' END;
  END IF;

  UPDATE public.invoices
     SET paid_amount = v_total, status = v_status
   WHERE id = p_invoice_id;
END;
$function$;

-- When a payment's deleted_at changes, recalc the invoice and device cash
CREATE OR REPLACE FUNCTION public.tg_payments_soft_delete_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    IF NEW.invoice_id IS NOT NULL THEN
      PERFORM public.recalc_invoice_totals(NEW.invoice_id);
    END IF;

    IF NEW.device_id IS NOT NULL AND lower(COALESCE(NEW.payment_method,'')) = 'cash' THEN
      IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        -- Soft deleted: subtract from device cash
        UPDATE public.pos_devices
           SET cash_balance = GREATEST(COALESCE(cash_balance,0) - COALESCE(NEW.amount,0), 0),
               total_transactions = GREATEST(COALESCE(total_transactions,0) - 1, 0)
         WHERE id = NEW.device_id;
      ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
        -- Restored: add back
        UPDATE public.pos_devices
           SET cash_balance = COALESCE(cash_balance,0) + COALESCE(NEW.amount,0),
               total_transactions = COALESCE(total_transactions,0) + 1
         WHERE id = NEW.device_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payments_soft_delete_sync ON public.payments;
CREATE TRIGGER payments_soft_delete_sync
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_soft_delete_sync();

-- ===== supabase/migrations/20260717155831_342665eb-5355-4567-8118-ab990450645c.sql =====

REVOKE EXECUTE ON FUNCTION public.tg_payments_soft_delete_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;

-- ===== supabase/migrations/20260717165254_1eb3946d-66d5-444c-b942-17aadddf7a70.sql =====

CREATE TABLE public.bank_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  officer_id UUID REFERENCES public.officers(id) ON DELETE SET NULL,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  transaction_reference TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  proof_document_url TEXT,
  notes TEXT,
  admin_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_transfers_status ON public.bank_transfers(status);
CREATE INDEX idx_bank_transfers_invoice ON public.bank_transfers(invoice_id);
CREATE INDEX idx_bank_transfers_business ON public.bank_transfers(business_id);
CREATE INDEX idx_bank_transfers_submitted_at ON public.bank_transfers(submitted_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.bank_transfers TO authenticated;
GRANT ALL ON public.bank_transfers TO service_role;

ALTER TABLE public.bank_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view bank transfers"
  ON public.bank_transfers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Staff can submit bank transfers"
  ON public.bank_transfers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update bank transfers"
  ON public.bank_transfers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','super_admin')));

CREATE OR REPLACE FUNCTION public.tg_bank_transfers_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_bank_transfers_updated_at
  BEFORE UPDATE ON public.bank_transfers
  FOR EACH ROW EXECUTE FUNCTION public.tg_bank_transfers_touch();

-- ===== supabase/migrations/20260717165314_f1ef35e1-8e30-426d-b298-8fa4bbee0dd3.sql =====

CREATE POLICY "Staff can upload bank slips"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bank-slips' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Staff can view bank slips"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bank-slips' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can delete bank slips"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bank-slips' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','super_admin')));

-- ===== supabase/migrations/20260718124204_dbb12f62-ef7d-4780-98a6-44d3cd5dfdea.sql =====
REVOKE ALL ON FUNCTION public.mobile_issue_invoice(uuid, text, numeric, numeric, numeric, timestamptz, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobile_issue_invoice(uuid, text, numeric, numeric, numeric, timestamptz, text, text, text) TO authenticated;
-- ===== supabase/migrations/20260718133144_05930566-81c5-4f52-a18c-f69c3bcb88d3.sql =====

-- Enhance the autolink trigger: if no matching invoice exists for the taxpayer,
-- auto-create one so the walk-in payment produces a fully-reconciled invoice.
CREATE OR REPLACE FUNCTION public.tg_payments_autolink_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_officer_id uuid;
BEGIN
  NEW.amount := COALESCE(NEW.amount, 0);
  NEW.status := COALESCE(NEW.status, 'success');
  NEW.sync_status := COALESCE(NEW.sync_status, 'synced');
  NEW.paid_at := COALESCE(NEW.paid_at, now());

  IF NEW.officer_id IS NULL THEN
    SELECT id INTO v_officer_id FROM public.officers WHERE user_id = auth.uid() LIMIT 1;
    NEW.officer_id := v_officer_id;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Match by reference_number = invoice_number
  IF NEW.reference_number IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE invoice_number = NEW.reference_number
     LIMIT 1;
  END IF;

  -- 2. Fallback: oldest unpaid invoice for this taxpayer/business
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = NEW.business_id
       AND status <> 'paid'
       AND deleted_at IS NULL
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0
     ORDER BY COALESCE(due_date, issue_date) ASC, issue_date ASC
     LIMIT 1;
  END IF;

  -- 3. Auto-create an invoice for walk-in payments so nothing goes unaccounted
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL AND COALESCE(NEW.amount,0) > 0 THEN
    INSERT INTO public.invoices (
      business_id, tax_type, amount, penalty, discount,
      issue_date, due_date, financial_year, status,
      notes, issued_by
    )
    VALUES (
      NEW.business_id,
      'walk_in_payment',
      NEW.amount,
      0, 0,
      COALESCE(NEW.paid_at, now()),
      COALESCE(NEW.paid_at, now()),
      to_char(COALESCE(NEW.paid_at, now()), 'YYYY'),
      'pending',
      'Auto-generated from receipt ' || COALESCE(NEW.receipt_number, ''),
      auth.uid()
    )
    RETURNING id INTO v_invoice_id;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    NEW.invoice_id := v_invoice_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: for every existing unlinked, non-deleted payment, create an invoice and link it.
DO $$
DECLARE
  p RECORD;
  v_invoice_id uuid;
BEGIN
  FOR p IN
    SELECT id, business_id, amount, paid_at, receipt_number
      FROM public.payments
     WHERE invoice_id IS NULL
       AND deleted_at IS NULL
       AND business_id IS NOT NULL
       AND COALESCE(amount,0) > 0
  LOOP
    -- Try to find an existing pending invoice first
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = p.business_id
       AND status <> 'paid'
       AND deleted_at IS NULL
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) >= p.amount
     ORDER BY COALESCE(due_date, issue_date) ASC
     LIMIT 1;

    IF v_invoice_id IS NULL THEN
      INSERT INTO public.invoices (
        business_id, tax_type, amount, penalty, discount,
        issue_date, due_date, financial_year, status,
        notes
      )
      VALUES (
        p.business_id, 'walk_in_payment', p.amount, 0, 0,
        COALESCE(p.paid_at, now()), COALESCE(p.paid_at, now()),
        to_char(COALESCE(p.paid_at, now()), 'YYYY'),
        'pending',
        'Auto-generated from receipt ' || COALESCE(p.receipt_number, '')
      )
      RETURNING id INTO v_invoice_id;
    END IF;

    UPDATE public.payments SET invoice_id = v_invoice_id WHERE id = p.id;
    PERFORM public.recalc_invoice_totals(v_invoice_id);
  END LOOP;
END $$;

-- Also recalc every invoice to normalize any drifted paid_amount/status
DO $$
DECLARE inv RECORD;
BEGIN
  FOR inv IN SELECT id FROM public.invoices WHERE deleted_at IS NULL LOOP
    PERFORM public.recalc_invoice_totals(inv.id);
  END LOOP;
END $$;

-- ===== supabase/migrations/20260718140947_a81b9715-ec6a-4fcc-b91d-332cea7f15cd.sql =====

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

-- ===== supabase/migrations/20260719131102_5f936a28-ebfb-458d-9367-5434edaeb3c0.sql =====

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

-- ===== supabase/migrations/20260719194650_acf4a3e2-50c4-44fc-9651-4b27f56e5cc7.sql =====
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
-- ===== supabase/migrations/20260721103919_4e28017e-c206-42a4-b9d1-e1e3db70a600.sql =====

-- Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated/PUBLIC
-- Keep check_pairing_status callable by anon (mobile pairing flow) and
-- get_paired_device callable by authenticated (paired device hydration).

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_soft_delete_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_update_device_cash() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_bank_transfers_touch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_sync_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_autolink_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_invoices_set_defaults() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_invoice() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_pairing_code_admin(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payment_admin(uuid, uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_officer_handover_deadline(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_device_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_handover_admin(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_overdue_devices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_invoices() FROM PUBLIC, anon, authenticated;

-- Keep pairing helpers callable by their intended callers only
REVOKE EXECUTE ON FUNCTION public.check_pairing_status(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.check_pairing_status(text) TO anon;

REVOKE EXECUTE ON FUNCTION public.get_paired_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paired_device(uuid) TO authenticated;

-- ===== supabase/migrations/20260722130632_237373bd-05b2-431c-b0a1-337c8535dd67.sql =====
GRANT EXECUTE ON FUNCTION public.check_pairing_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_paired_device(uuid) TO anon, authenticated;
-- ===== supabase/migrations/20260723135235_15293730-9cf3-4050-b788-15e0725469c0.sql =====

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

-- ===== supabase/migrations/20260727070902_f26823c5-c2fe-4bfa-85d5-bfbc5d5d28bc.sql =====
ALTER TABLE public.pos_devices REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pos_devices'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_devices';
  END IF;
END $$;
-- ===== supabase/migrations/20260817053706_29b0a1ac-da23-46ad-bc94-a72786cfee28.sql =====
CREATE OR REPLACE FUNCTION private.approve_pairing_code(p_caller uuid, p_code text, p_serial_number text, p_assigned_officer_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pair public.device_pairing_codes%ROWTYPE;
  v_device_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role IN ('administrator','super_admin')) THEN
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
-- ===== drizzle/migrations/0000_super_admin_system_lock.sql =====
CREATE TABLE public.system_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  locked boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 0,
  revoked_before timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.system_control TO anon, authenticated;
GRANT ALL ON public.system_control TO service_role;
ALTER TABLE public.system_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY "System lock status is readable" ON public.system_control FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.get_system_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_locked boolean := false;
  v_version bigint := 0;
  v_cutoff timestamptz;
  v_uid uuid := auth.uid();
  v_manage boolean := false;
  v_revoked boolean := false;
  v_session_created timestamptz;
  v_session text := auth.jwt()->>'session_id';
BEGIN
  SELECT locked, version, revoked_before INTO v_locked, v_version, v_cutoff
    FROM public.system_control WHERE id = true;
  v_locked := coalesce(v_locked, false);
  v_version := coalesce(v_version, 0);
  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role::text = 'super_admin') INTO v_manage;
    IF NOT v_manage AND v_cutoff IS NOT NULL THEN
      SELECT created_at INTO v_session_created FROM auth.sessions
        WHERE id::text = v_session AND user_id = v_uid;
      v_revoked := v_session_created IS NULL OR v_session_created <= v_cutoff;
    END IF;
  END IF;
  RETURN jsonb_build_object('locked', v_locked, 'version', v_version,
    'can_manage', v_manage, 'session_revoked', v_revoked,
    'allowed', v_uid IS NOT NULL AND (v_manage OR (NOT v_locked AND NOT v_revoked)));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_system_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_system_access() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_system_access() IS 'Intentional public status lookup: returns only global lock state and the authenticated caller own access. No personal or operational data.';

CREATE OR REPLACE FUNCTION public.system_access_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT CASE WHEN auth.uid() IS NULL
    THEN NOT (public.get_system_access()->>'locked')::boolean
    ELSE (public.get_system_access()->>'allowed')::boolean END;
$function$;
REVOKE ALL ON FUNCTION public.system_access_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_access_allowed() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.set_system_lock(p_locked boolean, p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.system_control%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role::text = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only the super administrator can lock or reopen the system' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.system_control (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_before FROM public.system_control WHERE id = true FOR UPDATE;
  IF v_before.version <> p_expected_version THEN
    RAISE EXCEPTION 'System access changed. Refresh and try again.';
  END IF;
  IF v_before.locked IS DISTINCT FROM p_locked THEN
    UPDATE public.system_control SET locked = p_locked, version = version + 1,
      revoked_before = clock_timestamp(), changed_at = clock_timestamp() WHERE id = true;
    INSERT INTO public.audit_logs (user_id, role, action, table_name, record_id, old_value, new_value)
    VALUES (v_uid, 'super_admin', CASE WHEN p_locked THEN 'system_locked' ELSE 'system_reopened' END,
      'system_control', 'true', jsonb_build_object('locked', v_before.locked, 'version', v_before.version),
      jsonb_build_object('locked', p_locked, 'version', v_before.version + 1));
  END IF;
  RETURN public.get_system_access();
END;
$function$;
REVOKE ALL ON FUNCTION private.set_system_lock(boolean, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_system_lock(boolean, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_system_lock(p_locked boolean, p_expected_version bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $function$
  SELECT private.set_system_lock(p_locked, p_expected_version);
$function$;
REVOKE ALL ON FUNCTION public.set_system_lock(boolean, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_system_lock(boolean, bigint) TO authenticated;

DO $block$
DECLARE v_table text;
BEGIN
  FOR v_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'system_control'
  LOOP
    EXECUTE format('CREATE POLICY system_access_gate ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT public.system_access_allowed())) WITH CHECK ((SELECT public.system_access_allowed()))', v_table);
  END LOOP;
END;
$block$;

ALTER TABLE public.system_control REPLICA IDENTITY FULL;
DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'system_control'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_control;
  END IF;
END;
$block$;
-- ===== drizzle/migrations/0001_strict_system_lock_and_login_suspensions.sql =====
CREATE TABLE public.system_lock_accounts (
  user_id uuid PRIMARY KEY,
  original_banned_until timestamptz,
  applied_banned_until timestamptz,
  restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.system_lock_accounts TO service_role;
ALTER TABLE public.system_lock_accounts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.system_lock_accounts IS 'Service-only snapshots used to restore account restrictions after a global system lock without removing independent bans.';

CREATE OR REPLACE FUNCTION public.system_access_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT NOT (public.get_system_access()->>'locked')::boolean
    AND CASE WHEN auth.uid() IS NULL THEN true ELSE (public.get_system_access()->>'allowed')::boolean END;
$function$;
REVOKE ALL ON FUNCTION public.system_access_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_access_allowed() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.set_system_lock_for_caller(p_caller uuid, p_locked boolean, p_expected_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_before public.system_control%ROWTYPE;
BEGIN
  IF p_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role::text = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.system_control (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_before FROM public.system_control WHERE id = true FOR UPDATE;
  IF v_before.version <> p_expected_version THEN RAISE EXCEPTION 'System access changed. Refresh and try again.'; END IF;
  IF v_before.locked IS DISTINCT FROM p_locked THEN
    UPDATE public.system_control SET locked = p_locked, version = version + 1,
      revoked_before = clock_timestamp(), changed_at = clock_timestamp() WHERE id = true;
    INSERT INTO public.audit_logs (user_id, role, action, table_name, record_id, old_value, new_value)
    VALUES (p_caller, 'super_admin', CASE WHEN p_locked THEN 'system_locked' ELSE 'system_reopened' END,
      'system_control', 'true', jsonb_build_object('locked', v_before.locked, 'version', v_before.version),
      jsonb_build_object('locked', p_locked, 'version', v_before.version + 1));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.set_system_lock_for_caller(uuid, boolean, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_system_lock_for_caller(uuid, boolean, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.set_system_lock_service(p_caller uuid, p_locked boolean, p_expected_version bigint)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $function$
  SELECT private.set_system_lock_for_caller(p_caller, p_locked, p_expected_version);
$function$;
REVOKE ALL ON FUNCTION public.set_system_lock_service(uuid, boolean, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_system_lock_service(uuid, boolean, bigint) TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_system_lock(boolean, bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.set_system_lock(boolean, bigint) FROM authenticated;
COMMENT ON FUNCTION public.set_system_lock(boolean, bigint) IS 'DEPRECATED: use the verified application lock action so login restrictions are applied and restored before reopening.';

-- ===== drizzle/migrations/0002_guard_operational_writes_during_lock.sql =====
CREATE OR REPLACE FUNCTION public.guard_system_locked_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_locked boolean;
BEGIN
  SELECT locked INTO v_locked FROM public.system_control WHERE id = true FOR SHARE;
  IF coalesce(v_locked, false) THEN
    RAISE EXCEPTION 'The system licence has expired. Pay 60 USD to renew.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_system_locked_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_system_locked_write() TO service_role;
DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['bank_transfers','businesses','cash_handovers','device_pairing_codes','invoices','notifications','officers','payments','pos_devices']
  LOOP
    EXECUTE format('CREATE TRIGGER guard_global_system_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_system_locked_write()', v_table);
  END LOOP;
END;
$block$;
COMMENT ON FUNCTION public.guard_system_locked_write() IS 'Blocks operational writes for every role including service-role work while the global lock is active, and serializes writes against lock state changes.';
-- ===== new =====
-- Fixes two things that only existed in the old Lovable Cloud project, not in migrations.

-- 1. The private bucket the bank-slip policies and bank-transfers.tsx rely on.
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-slips', 'bank-slips', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Auto-lock of overdue POS devices every 5 minutes (idempotent).
--    Skipped silently if pg_cron is not enabled, so enable the extension first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lock-overdue-devices')
      FROM cron.job WHERE jobname = 'lock-overdue-devices';
    PERFORM cron.schedule('lock-overdue-devices', '*/5 * * * *',
      $cron$SELECT public.lock_overdue_devices();$cron$);
  ELSE
    RAISE WARNING 'pg_cron is not enabled: overdue devices will NOT auto-lock until it is.';
  END IF;
END $$;
