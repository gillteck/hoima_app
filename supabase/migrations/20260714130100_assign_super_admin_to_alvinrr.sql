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
