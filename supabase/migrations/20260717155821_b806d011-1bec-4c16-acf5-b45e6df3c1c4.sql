
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_payments_deleted_at ON public.payments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON public.invoices(deleted_at);

-- Recalc must ignore soft-deleted payments
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_due_dt  timestamptz;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND deleted_at IS NULL
     AND COALESCE(status, 'success') NOT IN ('voided', 'cancelled', 'failed');

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0)), due_date
    INTO v_due, v_due_dt
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN RETURN; END IF;

  IF v_total >= v_due AND v_due > 0 THEN
    v_status := 'paid';
  ELSIF v_total > 0 THEN
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'partial' END;
  ELSE
    v_status := CASE WHEN v_due_dt IS NOT NULL AND v_due_dt < now() THEN 'overdue' ELSE 'pending' END;
  END IF;

  UPDATE public.invoices
     SET paid_amount = v_total, status = v_status
   WHERE id = p_invoice_id;
END;
$function$;

-- When a payment's deleted_at changes, recalc the invoice and device cash
CREATE OR REPLACE FUNCTION public.tg_payments_soft_delete_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    IF NEW.invoice_id IS NOT NULL THEN
      PERFORM public.recalc_invoice_totals(NEW.invoice_id);
    END IF;

    IF NEW.device_id IS NOT NULL AND lower(COALESCE(NEW.payment_method,'')) = 'cash' THEN
      IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        -- Soft deleted: subtract from device cash
        UPDATE public.pos_devices
           SET cash_balance = GREATEST(COALESCE(cash_balance,0) - COALESCE(NEW.amount,0), 0),
               total_transactions = GREATEST(COALESCE(total_transactions,0) - 1, 0)
         WHERE id = NEW.device_id;
      ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
        -- Restored: add back
        UPDATE public.pos_devices
           SET cash_balance = COALESCE(cash_balance,0) + COALESCE(NEW.amount,0),
               total_transactions = COALESCE(total_transactions,0) + 1
         WHERE id = NEW.device_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payments_soft_delete_sync ON public.payments;
CREATE TRIGGER payments_soft_delete_sync
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_soft_delete_sync();
