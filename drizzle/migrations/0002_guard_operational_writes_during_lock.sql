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