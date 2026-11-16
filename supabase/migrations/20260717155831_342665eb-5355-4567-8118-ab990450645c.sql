
REVOKE EXECUTE ON FUNCTION public.tg_payments_soft_delete_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
