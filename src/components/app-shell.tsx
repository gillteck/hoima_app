import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  FileText, CreditCard, UserCog, Smartphone, Receipt,
  Wallet, ClipboardList, BarChart3, MapPin, Building2, Clock, ChevronDown, Landmark, ShieldCheck, LogOut, KeyRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import logoUrl from "@/assets/logo.png";
import { NotificationsBell } from "./notifications-bell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSystemAccess } from "./system-access-provider";

const navGroups = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Control Hub", icon: Landmark },
      { to: "/map", label: "Live Map", icon: MapPin },
    ],
  },
  {
    label: "Field Operations",
    items: [
      { to: "/field-collections", label: "Field Collections", icon: Wallet },
      { to: "/devices", label: "Devices & POS", icon: Smartphone },
      { to: "/handovers", label: "Cash Handovers", icon: ClipboardList },
      { to: "/officers", label: "Revenue Officers", icon: UserCog },
    ],
  },
  {
    label: "Revenue",
    items: [
      { to: "/taxpayers", label: "Hotel Taxpayers", icon: Building2 },
      { to: "/invoices", label: "Invoices & Payments", icon: FileText },
      { to: "/bank-transfers", label: "Bank Transfers", icon: Landmark },
      { to: "/transactions", label: "Transactions", icon: Receipt },
      { to: "/reports", label: "Reports & Audit", icon: BarChart3 },
    ],
  },
] as const;

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const now = useClock();
  const navigate = useNavigate();
  const { access } = useSystemAccess();

  const [displayName, setDisplayName] = useState("Staff");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      const meta = (u.user_metadata || {}) as { username?: string; full_name?: string };
      setDisplayName(meta.username || meta.full_name || (u.email ? u.email.split("@")[0] : "Staff"));
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  };

  const clockLabel = now.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " +
    now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

  return (
    <div className="min-h-screen w-full bg-neutral-100 font-sans text-zinc-900">
      {/* Dark top bar */}
      <header className="bg-[#04140d] text-white sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 lg:px-8 h-16 gap-4">
          <Link to="/dashboard" className="flex items-center gap-3 min-w-0">
            <img src={logoUrl} alt="Hoima City Council" width={40} height={40} className="size-10 rounded-full bg-white/5 ring-1 ring-white/10 p-0.5" />
            <div className="leading-tight min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-400 font-mono">Hoima City Council</div>
              <div className="font-semibold tracking-tight text-white flex items-center gap-2 truncate">
                Revenue Management System
                <span className="text-[10px] text-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded px-1.5 py-0.5 font-mono">v1.2.4</span>
              </div>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/5 ring-1 ring-white/10 text-xs font-mono text-emerald-100">
            <Clock className="size-3.5 text-emerald-400" />
            {clockLabel}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 text-xs">
              <span className="text-[10px] uppercase tracking-wider text-white/50">Access Role</span>
              <button className="flex items-center gap-2 rounded-md bg-white/5 ring-1 ring-white/10 px-3 py-1.5 hover:bg-white/10 transition-colors">
                <span className="font-medium">{access?.can_manage ? "Super Administrator" : "Staff"}</span>
                <ChevronDown className="size-3.5 text-white/60" />
              </button>
            </div>

            <NotificationsBell />


            <div className="hidden sm:flex items-center gap-2 rounded-md bg-white/5 ring-1 ring-white/10 pl-1.5 pr-3 py-1">
              <div className="size-7 rounded-md bg-emerald-500/20 ring-1 ring-emerald-500/30 flex items-center justify-center text-emerald-300 font-semibold text-xs">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="leading-tight">
                <div className="text-xs font-semibold truncate max-w-[120px]">{displayName}</div>
                <div className="text-[9px] uppercase tracking-wider text-white/50">{access?.can_manage ? "Super Administrator" : "Staff"}</div>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              title="Sign out"
              className="size-9 rounded-md flex items-center justify-center bg-white/5 ring-1 ring-white/10 hover:bg-red-500/20 hover:ring-red-500/30 hover:text-red-300 transition-colors"
            >
              <LogOut className="size-4" />
            </button>


          </div>
        </div>
      </header>

      <div className="flex gap-6 p-4 lg:p-6 max-w-[1600px] mx-auto">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="bg-white rounded-xl ring-1 ring-black/5 shadow-sm sticky top-[88px] max-h-[calc(100vh-88px)] overflow-y-auto">
            <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-mono">Municipal Hub</div>
                <div className="font-semibold text-sm mt-0.5">Central Portal</div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100 px-2 py-0.5 rounded-full uppercase">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
              </span>
            </div>

            <nav className="p-3 space-y-4">
              {navGroups.map((group) => (
                <div key={group.label}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">{group.label}</div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
                      return (
                        <Link
                          key={item.to + item.label}
                          to={item.to}
                          className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                            active
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                              : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                          }`}
                        >
                          <item.icon className="size-4 shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {active && <span className="size-1.5 rounded-full bg-emerald-500" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
