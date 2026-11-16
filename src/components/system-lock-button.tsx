import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LockKeyhole, LockKeyholeOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useSystemAccess } from "./system-access-provider";
import { setSystemLock } from "@/lib/system-control.functions";
import { LICENCE_EXPIRED_TITLE, LICENCE_RENEWAL_LABEL } from "@/lib/licence";

export function SystemLockButton() {
  const { access, refresh } = useSystemAccess();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const setLock = useServerFn(setSystemLock);

  if (!access?.can_manage) return null;
  const locked = access.locked;
  const changeLock = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await setLock({ data: { locked: !locked, expected_version: access.version } });
      await refresh();
      toast.success(locked ? "System reopened. Staff can sign in again." : "System locked: licence expired. All other sessions have ended.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change system access.");
      await refresh().catch(() => {});
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <>
    <section aria-label="System access controls" className="flex flex-wrap items-center justify-between gap-4 border-t border-border py-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">System access</h2>
        <p className="mt-1 text-xs text-muted-foreground">{locked ? "Licence expired · Access paused" : "Access open"}</p>
      </div>
      <Button variant={locked ? "default" : "destructive"}
        aria-label={locked ? "Reopen system" : "Lock system"}
        title={locked ? "Reopen system" : "Lock system and sign out all other devices"}
        onClick={() => setOpen(true)}>
        {locked ? <LockKeyholeOpen /> : <LockKeyhole />}
        {locked ? "Reopen system" : "Lock system"}
      </Button>
    </section>
    <AlertDialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{locked ? "Reopen the system?" : "Lock the entire system?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {locked ? "Staff and officers will be able to sign in again. Previously ended sessions will stay signed out." : `Staff and officers will see: “${LICENCE_EXPIRED_TITLE} ${LICENCE_RENEWAL_LABEL}.” Sessions will end, and all transactions and operational access will be blocked. No collections or invoices will be deleted.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant={locked ? "default" : "destructive"} disabled={busy} onClick={() => { void changeLock(); }}>
            {busy ? <Loader2 className="animate-spin" /> : locked ? <LockKeyholeOpen /> : <LockKeyhole />}
            {busy ? "Please wait…" : locked ? "Reopen system" : "Lock & sign out devices"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}