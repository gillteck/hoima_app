
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
