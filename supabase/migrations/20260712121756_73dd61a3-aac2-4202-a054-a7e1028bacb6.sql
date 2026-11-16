
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
