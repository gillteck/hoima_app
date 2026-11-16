
-- Fix trigger to match actual profiles schema (no email column)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  assigned_role public.app_role;
  v_username TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username',
                         NEW.raw_user_meta_data->>'full_name',
                         split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', v_username),
          v_username)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov', 'alvinrr@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;

-- Create the AlvinRR super-admin
DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'alvinrr@hoima.gov';
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated',
      v_email,
      crypt('timeisgood', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'AlvinRR', 'username', 'AlvinRR'),
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id, v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );
  ELSE
    UPDATE auth.users
       SET encrypted_password = crypt('timeisgood', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'AlvinRR', 'username', 'AlvinRR')
     WHERE id = v_user_id;
  END IF;

  INSERT INTO public.profiles (id, full_name, username)
  VALUES (v_user_id, 'AlvinRR', 'AlvinRR')
  ON CONFLICT (id) DO UPDATE SET full_name = 'AlvinRR', username = 'AlvinRR';

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'administrator')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
