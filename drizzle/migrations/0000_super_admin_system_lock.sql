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