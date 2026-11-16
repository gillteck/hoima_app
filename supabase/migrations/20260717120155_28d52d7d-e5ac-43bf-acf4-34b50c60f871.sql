
-- Invoice defaults
DROP TRIGGER IF EXISTS trg_invoices_set_defaults ON public.invoices;
CREATE TRIGGER trg_invoices_set_defaults
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_set_defaults();

-- Notify on new invoice (system copy)
DROP TRIGGER IF EXISTS trg_notify_new_invoice ON public.invoices;
CREATE TRIGGER trg_notify_new_invoice
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_new_invoice();

-- Notify on new payment
DROP TRIGGER IF EXISTS trg_notify_new_payment ON public.payments;
CREATE TRIGGER trg_notify_new_payment
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.notify_new_payment();

-- Autolink payment to invoice
DROP TRIGGER IF EXISTS trg_payments_autolink_invoice ON public.payments;
CREATE TRIGGER trg_payments_autolink_invoice
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_autolink_invoice();

-- Sync invoice totals from payments
DROP TRIGGER IF EXISTS trg_payments_sync_invoice ON public.payments;
CREATE TRIGGER trg_payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_sync_invoice();
