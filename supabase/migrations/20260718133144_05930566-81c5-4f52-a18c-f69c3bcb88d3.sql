
-- Enhance the autolink trigger: if no matching invoice exists for the taxpayer,
-- auto-create one so the walk-in payment produces a fully-reconciled invoice.
CREATE OR REPLACE FUNCTION public.tg_payments_autolink_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_officer_id uuid;
BEGIN
  NEW.amount := COALESCE(NEW.amount, 0);
  NEW.status := COALESCE(NEW.status, 'success');
  NEW.sync_status := COALESCE(NEW.sync_status, 'synced');
  NEW.paid_at := COALESCE(NEW.paid_at, now());

  IF NEW.officer_id IS NULL THEN
    SELECT id INTO v_officer_id FROM public.officers WHERE user_id = auth.uid() LIMIT 1;
    NEW.officer_id := v_officer_id;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Match by reference_number = invoice_number
  IF NEW.reference_number IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE invoice_number = NEW.reference_number
     LIMIT 1;
  END IF;

  -- 2. Fallback: oldest unpaid invoice for this taxpayer/business
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = NEW.business_id
       AND status <> 'paid'
       AND deleted_at IS NULL
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) > 0
     ORDER BY COALESCE(due_date, issue_date) ASC, issue_date ASC
     LIMIT 1;
  END IF;

  -- 3. Auto-create an invoice for walk-in payments so nothing goes unaccounted
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL AND COALESCE(NEW.amount,0) > 0 THEN
    INSERT INTO public.invoices (
      business_id, tax_type, amount, penalty, discount,
      issue_date, due_date, financial_year, status,
      notes, issued_by
    )
    VALUES (
      NEW.business_id,
      'walk_in_payment',
      NEW.amount,
      0, 0,
      COALESCE(NEW.paid_at, now()),
      COALESCE(NEW.paid_at, now()),
      to_char(COALESCE(NEW.paid_at, now()), 'YYYY'),
      'pending',
      'Auto-generated from receipt ' || COALESCE(NEW.receipt_number, ''),
      auth.uid()
    )
    RETURNING id INTO v_invoice_id;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    NEW.invoice_id := v_invoice_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: for every existing unlinked, non-deleted payment, create an invoice and link it.
DO $$
DECLARE
  p RECORD;
  v_invoice_id uuid;
BEGIN
  FOR p IN
    SELECT id, business_id, amount, paid_at, receipt_number
      FROM public.payments
     WHERE invoice_id IS NULL
       AND deleted_at IS NULL
       AND business_id IS NOT NULL
       AND COALESCE(amount,0) > 0
  LOOP
    -- Try to find an existing pending invoice first
    SELECT id INTO v_invoice_id
      FROM public.invoices
     WHERE business_id = p.business_id
       AND status <> 'paid'
       AND deleted_at IS NULL
       AND (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0) - COALESCE(paid_amount,0)) >= p.amount
     ORDER BY COALESCE(due_date, issue_date) ASC
     LIMIT 1;

    IF v_invoice_id IS NULL THEN
      INSERT INTO public.invoices (
        business_id, tax_type, amount, penalty, discount,
        issue_date, due_date, financial_year, status,
        notes
      )
      VALUES (
        p.business_id, 'walk_in_payment', p.amount, 0, 0,
        COALESCE(p.paid_at, now()), COALESCE(p.paid_at, now()),
        to_char(COALESCE(p.paid_at, now()), 'YYYY'),
        'pending',
        'Auto-generated from receipt ' || COALESCE(p.receipt_number, '')
      )
      RETURNING id INTO v_invoice_id;
    END IF;

    UPDATE public.payments SET invoice_id = v_invoice_id WHERE id = p.id;
    PERFORM public.recalc_invoice_totals(v_invoice_id);
  END LOOP;
END $$;

-- Also recalc every invoice to normalize any drifted paid_amount/status
DO $$
DECLARE inv RECORD;
BEGIN
  FOR inv IN SELECT id FROM public.invoices WHERE deleted_at IS NULL LOOP
    PERFORM public.recalc_invoice_totals(inv.id);
  END LOOP;
END $$;
