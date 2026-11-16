
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
