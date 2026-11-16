import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Landmark, Lock, User, Loader2 } from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { useSystemAccess } from "@/components/system-access-provider";
import { LicenceExpiryNotice } from "@/components/licence-expiry-notice";
import { LICENCE_EXPIRED_MESSAGE } from "@/lib/licence";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Hoima City Revenue Management" },
      { name: "description", content: "Sign in to the Hoima City Council Revenue Management System." },
      { property: "og:title", content: "Staff sign-in — Hoima City Council" },
      { property: "og:description", content: "Secure staff sign-in for Hoima City Council revenue management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { access, refresh } = useSystemAccess();

  // If already signed in, bounce to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      refresh().then((state) => {
        if (state.allowed) navigate({ to: "/dashboard", replace: true });
      }).catch(() => {});
    });
  }, [navigate, refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Accept a username OR full email — map bare usernames to @hoima.gov
    const raw = identifier.trim();
    const email = raw.includes("@") ? raw.toLowerCase() : `${raw.toLowerCase()}@hoima.gov`;
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const state = await refresh();
      if (!state.allowed) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(state.locked ? LICENCE_EXPIRED_MESSAGE : "Please sign in again.");
      }
      toast.success("Welcome back");
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      const latest = await refresh().catch(() => null);
      toast.error(latest?.locked ? LICENCE_EXPIRED_MESSAGE : error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#04140d] flex items-center justify-center p-4 font-sans">
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.15) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(16,185,129,0.1) 0%, transparent 40%)",
      }} />
      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <img src={logoUrl} alt="Hoima City Council" width={56} height={56} className="size-14 rounded-full bg-white/5 ring-1 ring-white/10 p-1" />
          <div className="text-white">
            <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-mono">Hoima City Council</div>
            <div className="font-semibold text-lg leading-tight">Revenue Management</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="mb-6">
            <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100 px-2 py-0.5 rounded-full uppercase mb-3">
              <Landmark className="size-3" /> Staff Access
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to your console</h1>
            <p className="text-sm text-zinc-500 mt-1">Use your staff username and password.</p>
          </div>

          {access?.locked && <div className="mb-4"><LicenceExpiryNotice /></div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-zinc-600 mb-1.5 block">Username or email</span>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                <input
                  autoFocus
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="AlvinRR"
                  required
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-md py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-600 mb-1.5 block">Password</span>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-md py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#04140d] text-white rounded-md py-2.5 text-sm font-semibold hover:bg-[#0a2418] transition disabled:opacity-60"
            >
              {loading ? <><Loader2 className="size-4 animate-spin" /> Signing in…</> : "Sign in"}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-zinc-100 text-[11px] text-zinc-400 text-center">
            Hoima City Council · Revenue Management System v1.2.4
          </div>
        </div>
      </div>
    </div>
  );
}
