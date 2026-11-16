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