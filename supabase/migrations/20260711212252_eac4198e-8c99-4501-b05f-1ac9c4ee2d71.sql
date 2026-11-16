
-- 1) Default due_date = issue_date + 30 days when null
CREATE OR REPLACE FUNCTION public.tg_invoices_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := COALESCE(NEW.issue_date, now()) + interval '30 days';
  END IF;
  IF NEW.financial_year IS NULL THEN
    NEW.financial_year := to_char(COALESCE(NEW.issue_date, now()), 'YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_set_defaults ON public.invoices;
CREATE TRIGGER invoices_set_defaults
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_set_defaults();

REVOKE EXECUTE ON FUNCTION public.tg_invoices_set_defaults() FROM PUBLIC, anon, authenticated;

-- 2) Recalc now includes 'overdue' state
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     AND COALESCE(status, 'completed') <> 'voided';

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
     SET paid_amount = v_total,
         status = v_status
   WHERE id = p_invoice_id;
END;
$$;

-- 3) Sweep function to mark overdue invoices (safe to call on a schedule)
CREATE OR REPLACE FUNCTION public.mark_overdue_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.invoices
     SET status = 'overdue'
   WHERE due_date IS NOT NULL
     AND due_date < now()
     AND status IN ('pending', 'partial')
     AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_overdue_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_overdue_invoices() TO authenticated, service_role;

-- 4) Run the sweep once now
SELECT public.mark_overdue_invoices();
