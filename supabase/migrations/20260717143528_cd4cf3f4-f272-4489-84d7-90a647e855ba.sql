CREATE OR REPLACE FUNCTION public.tg_payments_prepare_mobile_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_officer_id uuid;
  v_device public.pos_devices;
BEGIN
  IF TG_OP <> 'INSERT' AND TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Fill the officer from the logged-in officer profile when Android omits it.
  IF NEW.officer_id IS NULL AND v_uid IS NOT NULL THEN
    SELECT id INTO v_officer_id
      FROM public.officers
     WHERE user_id = v_uid
     LIMIT 1;
    NEW.officer_id := v_officer_id;
  ELSE
    v_officer_id := NEW.officer_id;
  END IF;

  -- Fill taxpayer/business from the invoice when Android sends invoice_id only.
  IF NEW.business_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT business_id INTO NEW.business_id
      FROM public.invoices
     WHERE id = NEW.invoice_id;
  END IF;

  -- Validate the POS/mobile device and block payments from locked devices.
  IF NEW.device_id IS NOT NULL THEN
    SELECT * INTO v_device
      FROM public.pos_devices
     WHERE id = NEW.device_id
     LIMIT 1;

    IF v_device.id IS NULL THEN
      RAISE EXCEPTION 'POS device not found';
    END IF;

    IF COALESCE(v_device.locked, false) THEN
      RAISE EXCEPTION 'POS device is locked: %', COALESCE(v_device.lock_reason, 'handover required');
    END IF;

    IF v_uid IS NOT NULL
       AND v_device.assigned_officer_id IS NOT NULL
       AND v_officer_id IS NOT NULL
       AND v_device.assigned_officer_id IS DISTINCT FROM v_officer_id
       AND NOT (private.has_role(v_uid, 'administrator') OR private.has_role(v_uid, 'supervisor')) THEN
      RAISE EXCEPTION 'This POS device is not assigned to the logged-in officer';
    END IF;

    NEW.sync_status := COALESCE(NULLIF(NEW.sync_status, ''), 'synced');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_payments_update_device_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_cash numeric := 0;
  v_new_cash numeric := 0;
  v_old_tx integer := 0;
  v_new_tx integer := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.device_id IS NOT NULL THEN
    IF lower(COALESCE(OLD.payment_method, '')) = 'cash'
       AND COALESCE(OLD.status, 'success') IN ('success', 'completed', 'paid') THEN
      v_old_cash := COALESCE(OLD.amount, 0);
      v_old_tx := 1;
    END IF;

    UPDATE public.pos_devices
       SET cash_balance = GREATEST(COALESCE(cash_balance, 0) - v_old_cash, 0),
           total_transactions = GREATEST(COALESCE(total_transactions, 0) - v_old_tx, 0),
           last_seen = now(),
           online_status = 'online',
           sync_status = 'synced'
     WHERE id = OLD.device_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.device_id IS NOT NULL THEN
    IF lower(COALESCE(NEW.payment_method, '')) = 'cash'
       AND COALESCE(NEW.status, 'success') IN ('success', 'completed', 'paid') THEN
      v_new_cash := COALESCE(NEW.amount, 0);
      v_new_tx := 1;
    END IF;

    UPDATE public.pos_devices
       SET cash_balance = GREATEST(COALESCE(cash_balance, 0) + v_new_cash, 0),
           total_transactions = GREATEST(COALESCE(total_transactions, 0) + v_new_tx, 0),
           last_seen = now(),
           online_status = 'online',
           sync_status = 'synced'
     WHERE id = NEW.device_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_prepare_mobile_sync ON public.payments;
CREATE TRIGGER trg_payments_prepare_mobile_sync
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_prepare_mobile_sync();

DROP TRIGGER IF EXISTS trg_payments_update_device_cash ON public.payments;
CREATE TRIGGER trg_payments_update_device_cash
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.tg_payments_update_device_cash();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cash_handovers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_handovers;
  END IF;
END $$;