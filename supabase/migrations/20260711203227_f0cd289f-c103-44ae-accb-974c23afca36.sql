
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND COALESCE(status, 'completed') <> 'voided';

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0))
    INTO v_due
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN RETURN; END IF;

  IF v_total <= 0 THEN
    v_status := 'pending';
  ELSIF v_total >= v_due THEN
    v_status := 'paid';
  ELSE
    v_status := 'partial';
  END IF;

  UPDATE public.invoices
     SET paid_amount = v_total,
         status = v_status
   WHERE id = p_invoice_id;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_payments_sync_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_invoice_totals(OLD.invoice_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalc_invoice_totals(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.recalc_invoice_totals(OLD.invoice_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS payments_sync_invoice ON public.payments;
CREATE TRIGGER payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_sync_invoice();

-- Backfill existing invoices to match current payment history
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT invoice_id FROM public.payments WHERE invoice_id IS NOT NULL LOOP
    PERFORM public.recalc_invoice_totals(r.invoice_id);
  END LOOP;
END $$;
