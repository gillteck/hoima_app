CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IN ('admin@hoima.gov', 'alvin@hoima.gov') THEN
    assigned_role := 'administrator';
  ELSE
    assigned_role := 'revenue_officer';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'administrator'::public.app_role
FROM auth.users u
WHERE u.email IN ('admin@hoima.gov', 'alvin@hoima.gov')
ON CONFLICT DO NOTHING;