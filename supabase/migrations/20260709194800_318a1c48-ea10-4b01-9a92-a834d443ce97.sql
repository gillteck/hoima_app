
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['businesses','officers','pos_devices','invoices','payments','cash_handovers','audit_logs','notifications','profiles','user_roles']) LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon', t);
    EXECUTE format('DROP POLICY IF EXISTS "demo anon all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "demo anon all" ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
