
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
