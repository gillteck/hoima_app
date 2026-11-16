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
