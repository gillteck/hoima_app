
CREATE OR REPLACE FUNCTION public.tg_payments_autolink_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1) Try match by reference_number = invoice_number
  IF NEW.reference_number IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE invoice_number = NEW.reference_number
     LIMIT 1;
  END IF;

  -- 2) Fallback: oldest unpaid invoice for this business
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = NEW.business_id
       AND status <> 'paid'
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0
     ORDER BY COALESCE(due_date, issue_date) ASC, issue_date ASC
     LIMIT 1;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    NEW.invoice_id := v_invoice_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_payments_autolink_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_autolink_invoice ON public.payments;
CREATE TRIGGER payments_autolink_invoice
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_autolink_invoice();

-- Ensure the existing sync trigger exists (recalc totals after insert/update/delete)
DROP TRIGGER IF EXISTS payments_sync_invoice ON public.payments;
CREATE TRIGGER payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_sync_invoice();

-- Force sync_status default to 'synced' for anything arriving from clients
ALTER TABLE public.payments ALTER COLUMN sync_status SET DEFAULT 'synced';

-- Backfill: link historical NULL-invoice payments to their business's oldest matching invoice
DO $$
DECLARE r record; v_inv uuid;
BEGIN
  FOR r IN SELECT id, business_id, reference_number FROM public.payments WHERE invoice_id IS NULL LOOP
    v_inv := NULL;
    IF r.reference_number IS NOT NULL THEN
      SELECT id INTO v_inv FROM public.invoices WHERE invoice_number = r.reference_number LIMIT 1;
    END IF;
    IF v_inv IS NULL AND r.business_id IS NOT NULL THEN
      SELECT id INTO v_inv FROM public.invoices
        WHERE business_id = r.business_id AND status <> 'paid'
        ORDER BY COALESCE(due_date, issue_date) ASC LIMIT 1;
    END IF;
    IF v_inv IS NOT NULL THEN
      UPDATE public.payments SET invoice_id = v_inv WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
