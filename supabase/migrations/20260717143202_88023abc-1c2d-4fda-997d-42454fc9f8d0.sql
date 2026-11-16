-- Restore and harden invoice/payment automation for mobile POS sync

-- Ensure the existing invoice default function also records who issued it.
CREATE OR REPLACE FUNCTION public.tg_invoices_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.issued_by IS NULL THEN
    NEW.issued_by := auth.uid();
  END IF;

  IF NEW.issue_date IS NULL THEN
    NEW.issue_date := now();
  END IF;

  IF NEW.due_date IS NULL THEN
    NEW.due_date := COALESCE(NEW.issue_date, now()) + interval '30 days';
  END IF;

  IF NEW.financial_year IS NULL THEN
    NEW.financial_year := to_char(COALESCE(NEW.issue_date, now()), 'YYYY');
  END IF;

  IF NEW.status IS NULL THEN
    NEW.status := 'pending';
  END IF;

  NEW.amount := COALESCE(NEW.amount, 0);
  NEW.penalty := COALESCE(NEW.penalty, 0);
  NEW.discount := COALESCE(NEW.discount, 0);
  NEW.paid_amount := COALESCE(NEW.paid_amount, 0);

  RETURN NEW;
END;
$$;

-- Recalculate invoice totals/status whenever a payment changes.
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total   numeric;
  v_due     numeric;
  v_due_dt  timestamptz;
  v_status  text;
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND COALESCE(status, 'success') NOT IN ('voided', 'cancelled', 'failed');

  SELECT (COALESCE(amount,0) + COALESCE(penalty,0) - COALESCE(discount,0)), due_date
    INTO v_due, v_due_dt
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF v_due IS NULL THEN
    RETURN;
  END IF;

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

-- Before a payment is saved, fill officer/device-friendly defaults and link to an invoice if possible.
CREATE OR REPLACE FUNCTION public.tg_payments_autolink_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_id uuid;
  v_officer_id uuid;
BEGIN
  NEW.amount := COALESCE(NEW.amount, 0);
  NEW.status := COALESCE(NEW.status, 'success');
  NEW.sync_status := COALESCE(NEW.sync_status, 'synced');
  NEW.paid_at := COALESCE(NEW.paid_at, now());

  IF NEW.officer_id IS NULL THEN
    SELECT id
      INTO v_officer_id
      FROM public.officers
     WHERE user_id = auth.uid()
     LIMIT 1;

    NEW.officer_id := v_officer_id;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Match by reference_number = invoice_number first.
  IF NEW.reference_number IS NOT NULL THEN
    SELECT id
      INTO v_invoice_id
      FROM public.invoices
     WHERE invoice_number = NEW.reference_number
     LIMIT 1;
  END IF;

  -- Fallback: oldest unpaid invoice for this taxpayer/business.
  IF v_invoice_id IS NULL AND NEW.business_id IS NOT NULL THEN
    SELECT id
      INTO v_invoice_id
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

-- After payments change, update linked invoice status and device cash totals for handover.
CREATE OR REPLACE FUNCTION public.tg_payments_sync_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      PERFORM public.recalc_invoice_totals(OLD.invoice_id);
    END IF;

    IF OLD.device_id IS NOT NULL AND COALESCE(OLD.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN
      UPDATE public.pos_devices
         SET cash_balance = GREATEST(COALESCE(cash_balance,0) - COALESCE(OLD.amount,0), 0),
             total_transactions = GREATEST(COALESCE(total_transactions,0) - 1, 0),
             sync_status = 'synced',
             last_seen = now(),
             online_status = 'online'
       WHERE id = OLD.device_id;
    END IF;

    RETURN OLD;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    PERFORM public.recalc_invoice_totals(NEW.invoice_id);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND OLD.invoice_id IS NOT NULL THEN
    PERFORM public.recalc_invoice_totals(OLD.invoice_id);
  END IF;

  IF NEW.device_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND COALESCE(NEW.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN
      UPDATE public.pos_devices
         SET cash_balance = COALESCE(cash_balance,0) + COALESCE(NEW.amount,0),
             total_transactions = COALESCE(total_transactions,0) + 1,
             sync_status = 'synced',
             last_seen = now(),
             online_status = 'online',
             current_lat = COALESCE(NEW.gps_lat, current_lat),
             current_lng = COALESCE(NEW.gps_lng, current_lng)
       WHERE id = NEW.device_id;
    ELSIF TG_OP = 'UPDATE' THEN
      UPDATE public.pos_devices
         SET cash_balance = GREATEST(
               COALESCE(cash_balance,0)
               - CASE WHEN COALESCE(OLD.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN COALESCE(OLD.amount,0) ELSE 0 END
               + CASE WHEN COALESCE(NEW.status, 'success') NOT IN ('voided', 'cancelled', 'failed') THEN COALESCE(NEW.amount,0) ELSE 0 END,
               0
             ),
             sync_status = 'synced',
             last_seen = now(),
             online_status = 'online',
             current_lat = COALESCE(NEW.gps_lat, current_lat),
             current_lng = COALESCE(NEW.gps_lng, current_lng)
       WHERE id = NEW.device_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Admin notifications for mobile-issued invoices.
CREATE OR REPLACE FUNCTION public.notify_new_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  biz_name text;
BEGIN
  SELECT business_name INTO biz_name FROM public.businesses WHERE id = NEW.business_id;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'New invoice ' || NEW.invoice_number,
    'Issued to ' || COALESCE(biz_name, 'Unknown taxpayer') ||
      ' · UGX ' || to_char(COALESCE(NEW.amount,0), 'FM999,999,999'),
    'invoice',
    false
  );

  RETURN NEW;
END;
$$;

-- Admin notifications for mobile-issued receipts/payments.
CREATE OR REPLACE FUNCTION public.notify_new_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  biz_name text;
BEGIN
  SELECT business_name INTO biz_name FROM public.businesses WHERE id = NEW.business_id;

  INSERT INTO public.notifications (title, message, category, is_read)
  VALUES (
    'Payment ' || NEW.receipt_number || ' received',
    COALESCE(biz_name, 'Taxpayer') || ' paid UGX ' ||
      to_char(COALESCE(NEW.amount,0), 'FM999,999,999') || ' via ' || NEW.payment_method,
    'payment',
    false
  );

  RETURN NEW;
END;
$$;

-- Reattach triggers idempotently.
DROP TRIGGER IF EXISTS trg_invoices_set_defaults ON public.invoices;
CREATE TRIGGER trg_invoices_set_defaults
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.tg_invoices_set_defaults();

DROP TRIGGER IF EXISTS trg_notify_new_invoice ON public.invoices;
CREATE TRIGGER trg_notify_new_invoice
AFTER INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_invoice();

DROP TRIGGER IF EXISTS trg_payments_autolink_invoice ON public.payments;
CREATE TRIGGER trg_payments_autolink_invoice
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_autolink_invoice();

DROP TRIGGER IF EXISTS trg_payments_sync_invoice ON public.payments;
CREATE TRIGGER trg_payments_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_sync_invoice();

DROP TRIGGER IF EXISTS trg_notify_new_payment ON public.payments;
CREATE TRIGGER trg_notify_new_payment
AFTER INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_payment();

-- Keep realtime publication attached for live web updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Reaffirm Data API access for authenticated mobile/web users and backend service operations.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.officers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;

GRANT ALL ON public.invoices TO service_role;
GRANT ALL ON public.payments TO service_role;
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON public.pos_devices TO service_role;
GRANT ALL ON public.officers TO service_role;
GRANT ALL ON public.businesses TO service_role;