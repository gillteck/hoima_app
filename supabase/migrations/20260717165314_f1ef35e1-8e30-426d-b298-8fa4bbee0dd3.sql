
CREATE POLICY "Staff can upload bank slips"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bank-slips' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Staff can view bank slips"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bank-slips' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can delete bank slips"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bank-slips' AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('administrator','super_admin')));
