import { ShieldAlert } from "lucide-react";
import { LICENCE_EXPIRED_TITLE, LICENCE_RENEWAL_LABEL } from "@/lib/licence";

export function LicenceExpiryNotice() {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-destructive">{LICENCE_EXPIRED_TITLE}</p>
        <p className="font-semibold">{LICENCE_RENEWAL_LABEL}</p>
      </div>
    </div>
  );
}