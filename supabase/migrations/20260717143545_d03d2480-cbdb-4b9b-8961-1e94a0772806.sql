REVOKE ALL ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM anon;
REVOKE ALL ON FUNCTION public.tg_payments_prepare_mobile_sync() FROM authenticated;

REVOKE ALL ON FUNCTION public.tg_payments_update_device_cash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_payments_update_device_cash() FROM anon;
REVOKE ALL ON FUNCTION public.tg_payments_update_device_cash() FROM authenticated;