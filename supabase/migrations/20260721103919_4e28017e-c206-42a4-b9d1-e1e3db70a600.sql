
-- Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated/PUBLIC
-- Keep check_pairing_status callable by anon (mobile pairing flow) and
-- get_paired_device callable by authenticated (paired device hydration).

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_soft_delete_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_update_device_cash() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_bank_transfers_touch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_sync_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_autolink_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_invoices_set_defaults() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_invoice() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_pairing_code_admin(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payment_admin(uuid, uuid, numeric, text, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_officer_handover_deadline(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_device_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_handover_admin(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_overdue_devices() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_invoices() FROM PUBLIC, anon, authenticated;

-- Keep pairing helpers callable by their intended callers only
REVOKE EXECUTE ON FUNCTION public.check_pairing_status(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.check_pairing_status(text) TO anon;

REVOKE EXECUTE ON FUNCTION public.get_paired_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paired_device(uuid) TO authenticated;
