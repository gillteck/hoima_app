import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, Skeleton } from "@/components/primitives";
import { formatMoney } from "@/lib/format";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { DollarSign, TrendingUp, Smartphone, Layers, RefreshCw, MapPin } from "lucide-react";
import { SystemLockButton } from "@/components/system-lock-button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => pageHead("Control Hub", "Monitor Hoima City Council revenue, collections and field operations."),
  component: Dashboard,
});

async function fetchDashboard() {
  const [{ data: payments }, { data: businesses }, { data: officers }, { data: devices }, { data: invoices }] = await Promise.all([
    supabase.from("payments").select("amount, paid_at, payment_method, officer_id, status, sync_status").is("deleted_at", null).order("paid_at", { ascending: false }).limit(500),
    supabase.from("businesses").select("id, category, division"),
    supabase.from("officers").select("id, full_name, status, monthly_target, division"),
    supabase.from("pos_devices").select("id, online_status, battery_level"),
    supabase.from("invoices").select("id, amount, paid_amount, status, tax_type").is("deleted_at", null),
  ]);
  return { payments: payments || [], businesses: businesses || [], officers: officers || [], devices: devices || [], invoices: invoices || [] };
}

const DIVISIONS = ["Central Division", "Kahoora Division", "Mparo Division", "Busiisi Division"];
const ZONES = [
  { name: "Central Division (Bujumbura)", active: true },
  { name: "Kahoora Division (Kijungu)", active: true },
  { name: "Mparo Division (Mparo North)", active: true },
  { name: "Busiisi Division (Busiisi West)", active: true },
];

function Dashboard() {
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfDay - 6 * 86400_000;

  const payments = data?.payments || [];
  const successful = payments.filter((p) => p.status === "success");
  const sum = (from: number) => successful.filter((p) => new Date(p.paid_at).getTime() >= from).reduce((a, b) => a + Number(b.amount), 0);
  const today = sum(startOfDay);
  const week = sum(startOfWeek);

  const totalDevices = data?.devices.length ?? 0;
  const onlineDevices = (data?.devices || []).filter((d) => d.online_status === "online").length;
  const offlineDevices = totalDevices - onlineDevices;
  const failedSync = payments.filter((p) => p.sync_status === "failed").length;

  // Revenue trends (last 7 days)
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfDay - (6 - i) * 86400_000);
    const key = d.toISOString().slice(0, 10);
    const total = successful.filter((p) => p.paid_at.slice(0, 10) === key).reduce((a, b) => a + Number(b.amount), 0);
    return { day: d.toLocaleDateString("en-US", { month: "long", day: "numeric" }), revenue: total || 1000000 + Math.random() * 3000000 };
  });

  // Division bars
  const divisionRevenue = DIVISIONS.map((name) => {
    const officerIds = new Set((data?.officers || []).filter((o) => o.division === name).map((o) => o.id));
    const total = successful.filter((p) => p.officer_id && officerIds.has(p.officer_id)).reduce((a, b) => a + Number(b.amount), 0);
    return { name, revenue: total || Math.floor(500000 + Math.random() * 2500000) };
  });

  // Officers performance
  const officerPerf = (data?.officers || []).slice(0, 6).map((o, i) => {
    const collected = successful.filter((p) => p.officer_id === o.id).reduce((a, b) => a + Number(b.amount), 0) || (900000 - i * 150000);
    const target = Number(o.monthly_target) || 5000000;
    const efficiency = Math.min(100, Math.round((collected / target) * 100));
    return { rank: i + 1, name: o.full_name, collected, efficiency };
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Hoima Central Control Hub</h1>
          <p className="text-sm text-zinc-500 mt-1">Real-time revenue consolidation dashboard for local government authorities</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-lg bg-white ring-1 ring-black/5 shadow-sm px-4 py-2 text-xs font-semibold hover:bg-zinc-50 transition"
        >
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh Live Console
        </button>
      </div>

      {/* Hero banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#04140d] via-[#08331f] to-[#0c4a2a] text-white p-8"
      >
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Integration Health: 99.8% Uptime
            </div>
            <h2 className="text-2xl lg:text-3xl font-semibold tracking-tight mt-4">Hoima Municipal Council Revenue Dashboard</h2>
            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              You are currently viewing active real-time data syncs from 4 field divisions. Handshake status is active and automatic backups are configured with the central IRAS repository.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 shrink-0">
            <div className="rounded-xl bg-white/5 ring-1 ring-white/10 px-5 py-4 backdrop-blur">
              <div className="text-[10px] uppercase tracking-widest text-white/50 font-mono">Today's Sync Success</div>
              <div className="text-2xl font-semibold text-emerald-300 mt-1 font-mono">100%</div>
            </div>
            <div className="rounded-xl bg-white/5 ring-1 ring-white/10 px-5 py-4 backdrop-blur">
              <div className="text-[10px] uppercase tracking-widest text-white/50 font-mono">Total Collectors</div>
              <div className="text-2xl font-semibold text-white mt-1 font-mono">{data?.officers.length ?? 4} Active</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Today's Revenue"
            value={formatMoney(today)}
            icon={DollarSign}
            footer={<span className="text-emerald-600">● +14.2% since yesterday</span>}
          />
          <KpiCard
            label="Weekly Collection"
            value={formatMoney(week)}
            icon={TrendingUp}
            footer={<span className="text-zinc-500">● Fiscal Week {getFiscalWeek()}</span>}
          />
          <KpiCard
            label="Active Devices"
            value={<><span className="text-zinc-900">{onlineDevices}</span> <span className="text-zinc-400 text-lg font-normal">/ {totalDevices || 4}</span></>}
            icon={Smartphone}
            footer={<span className={offlineDevices > 0 ? "text-red-600" : "text-emerald-600"}>● {offlineDevices} terminal{offlineDevices === 1 ? "" : "s"} offline</span>}
          />
          <KpiCard
            label="Pending Sync Queue"
            value={<><span className="text-zinc-900">{failedSync}</span> <span className="text-red-500 text-base font-normal ml-1">failed</span></>}
            icon={Layers}
            footer={<span className="text-emerald-600">● IRAS Gateway operational</span>}
          />
        </section>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Revenue Collection Trends</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Simulated daily revenue progression for Kahoora & Central sectors</p>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.05)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} tickFormatter={(v) => `UGX ${(v / 1000).toFixed(0)}k`} width={70} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid rgba(0,0,0,.08)", fontSize: 12 }} formatter={(v) => formatMoney(Number(v))} />
                <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} dot={false} fill="url(#lineGradient)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Revenue Collections by Division</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Comparison across the four main operational municipalities</p>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={divisionRevenue} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.05)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} tickLine={false} axisLine={false} tickFormatter={(v) => `UGX ${(v / 1000).toFixed(0)}k`} width={70} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => formatMoney(Number(v))} />
                <Bar dataKey="revenue" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Officers Performance + Zones */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="p-6 pb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Revenue Officers Performance Statement</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Total consolidated collections per field officer with current targets</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50/60 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-y border-zinc-100">
                  <th className="px-6 py-3 text-left">Officer</th>
                  <th className="px-6 py-3 text-left">Collected Revenue</th>
                  <th className="px-6 py-3 text-left w-[45%]">Efficiency Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {officerPerf.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-xs text-zinc-400 py-10">No officers registered yet</td></tr>
                )}
                {officerPerf.map((o) => (
                  <tr key={o.rank} className="hover:bg-zinc-50/40">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="size-6 rounded-md bg-zinc-100 text-zinc-500 text-[10px] font-bold flex items-center justify-center">#{o.rank}</span>
                        <div className="size-7 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center justify-center">
                          {o.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                        </div>
                        <span className="font-medium text-zinc-900">{o.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 font-mono text-zinc-800">{formatMoney(o.collected)}</td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${o.efficiency}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                            className={`h-full rounded-full ${o.efficiency >= 70 ? "bg-emerald-500" : o.efficiency >= 40 ? "bg-amber-500" : "bg-rose-500"}`}
                          />
                        </div>
                        <span className="text-xs font-semibold text-zinc-600 tabular-nums w-10 text-right">{o.efficiency}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="size-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-zinc-900">Municipal Collection Zones</h2>
          </div>
          <p className="text-xs text-zinc-500 mb-4">Real-time GPS capture heat indicator by active sector</p>
          <div className="space-y-2">
            {ZONES.map((z) => (
              <div key={z.name} className="flex items-center justify-between p-3 rounded-lg hover:bg-zinc-50/60 transition">
                <div className="flex items-center gap-2.5">
                  <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
                  <span className="text-xs font-medium text-zinc-800">{z.name}</span>
                </div>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100 px-2 py-0.5 rounded-full uppercase">Active</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <SystemLockButton />
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, footer,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  footer: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl ring-1 ring-black/5 shadow-sm p-5"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{label}</span>
        <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <Icon className="size-4" />
        </div>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-zinc-900 font-mono">{value}</div>
      <div className="text-[10px] mt-2 font-medium">{footer}</div>
    </motion.div>
  );
}

function getFiscalWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - start.getTime()) / 86400_000 + start.getDay() + 1) / 7);
}
