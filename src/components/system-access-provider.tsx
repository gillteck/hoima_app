import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { systemAccessSchema, mustSignOut, canUseOperations, type SystemAccess } from "@/lib/system-access";
import { toast } from "sonner";
import { LICENCE_EXPIRED_MESSAGE } from "@/lib/licence";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LicenceExpiryNotice } from "./licence-expiry-notice";
import { SystemLockButton } from "./system-lock-button";
import logoUrl from "@/assets/logo.png";

const SystemAccessContext = createContext<{
  access: SystemAccess | null;
  refresh: () => Promise<SystemAccess>;
}>({ access: null, refresh: async () => { throw new Error("System access is unavailable"); } });

export function useSystemAccess() {
  return useContext(SystemAccessContext);
}

export function SystemAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<SystemAccess | null>(null);
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_system_access" as never);
    if (error) throw new Error("Unable to verify system access. Please try again.");
    const result = systemAccessSchema.parse(data);
    setAccess(result);
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    let running = false;
    const check = async () => {
      if (!active || running) return;
      running = true;
      try {
        const result = await refresh();
        if (!active || !mustSignOut(result)) return;
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        // Clear all cached operational data before the auth gate redirects.
        await queryClient.cancelQueries();
        queryClient.clear();
        await supabase.auth.signOut({ scope: "local" });
        void navigate({ to: "/auth", replace: true });
        toast.error(result.locked ? LICENCE_EXPIRED_MESSAGE : "Your session has ended. Please sign in again.");
      } catch {
        // Never interpret a network failure as an unlocked system.
        if (active) setAccess(null);
      } finally {
        running = false;
      }
    };
    const channel = supabase.channel("system-access")
      .on("postgres_changes", { event: "*", schema: "public", table: "system_control" }, () => { void check(); })
      .subscribe();
    const { data: auth } = supabase.auth.onAuthStateChange(() => {
      // Auth callbacks must not await another auth operation.
      window.setTimeout(() => { void check(); }, 0);
    });
    const interval = window.setInterval(() => { void check(); }, 5000);
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    void check();
    return () => {
      active = false;
      auth.subscription.unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, refresh, navigate]);

  const publicPage = pathname === "/auth" || pathname === "/";
  return <SystemAccessContext.Provider value={{ access, refresh }}>
    {publicPage || canUseOperations(access) ? children : access?.locked ? (
      <main className="min-h-screen bg-background px-4 py-12 text-foreground">
        <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-xl flex-col">
          <div className="my-auto">
            <div className="mb-6 flex items-center gap-3">
              <img src={logoUrl} alt="Hoima City Council" width={48} height={48} className="size-12" />
              <h1 className="text-xl font-semibold">Hoima City Council</h1>
            </div>
            <LicenceExpiryNotice />
          </div>
          <SystemLockButton />
        </div>
      </main>
    ) : (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-sm text-muted-foreground" role="status">Verifying access…</div>
    )}
  </SystemAccessContext.Provider>;
}