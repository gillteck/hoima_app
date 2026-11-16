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

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov', 'alvinrr@hoima.gov', 'rrnfamily@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $function$;