import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Plus, CheckCircle2, Smartphone, Wifi, WifiOff, BatteryLow, BatteryMedium, BatteryFull, Lock } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { confirmHandover, adminCollectFromOfficer } from "@/lib/handovers.functions";

export const Route = createFileRoute("/_authenticated/handovers")({
  head: () => pageHead("Cash Handovers", "Review officer cash collections and confirm handovers for Hoima City Council."),
  component: HandoversPage,
});

type DeviceRow = {
  id: string;
  serial_number: string;
  model: string | null;
  manufacturer: string | null;
  device_type: string | null;
  online_status: string | null;
  sync_status: string | null;
  battery_level: number | null;
  cash_balance: number | null;
  locked: boolean | null;
  last_seen: string | null;
  assigned_officer_id: string | null;
  status: string | null;
};

function deviceLabel(d: Pick<DeviceRow, "manufacturer" | "model" | "device_type" | "serial_number">) {
  const kind = d.device_type === "mobile_phone" ? "📱" : d.device_type === "web_pos" ? "💻" : "🖥️";
  const name = [d.manufacturer, d.model].filter(Boolean).join(" ") || (d.device_type === "mobile_phone" ? "Mobile phone" : "POS terminal");
  return `${kind} ${name} · ${d.serial_number}`;
}

function BatteryIcon({ level }: { level: number | null }) {
  const v = level ?? 0;
  if (v < 20) return <BatteryLow className="size-3.5 text-red-500" />;
  if (v < 60) return <BatteryMedium className="size-3.5 text-amber-500" />;
  return <BatteryFull className="size-3.5 text-emerald-600" />;
}

function DeviceStatusChips({ d }: { d: DeviceRow }) {
  const online = d.online_status === "online";
  const stale = d.last_seen ? (Date.now() - new Date(d.last_seen).getTime()) > 5 * 60 * 1000 : true;
  const effectiveOnline = online && !stale;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ${effectiveOnline ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-zinc-100 text-zinc-500 ring-zinc-200"}`}>
        {effectiveOnline ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
        {effectiveOnline ? "Online" : "Offline"}
      </span>
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200">
        <BatteryIcon level={d.battery_level} /> {d.battery_level ?? 0}%
      </span>
      <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ${d.sync_status === "synced" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : d.sync_status === "pending" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-zinc-100 text-zinc-500 ring-zinc-200"}`}>
        Sync: {d.sync_status ?? "—"}
      </span>
      {d.locked && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200">
          <Lock className="size-3" /> Locked
        </span>
      )}
    </div>
  );
}

function HandoversPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ officer_id: "", device_id: "", opening_balance: "0", collected_amount: "0", expected_amount: "0", actual_amount: "0" });

  const { data: officers } = useQuery({
    queryKey: ["officers-list"],
    queryFn: async () => (await supabase.from("officers").select("id, full_name")).data || [],
  });
  const { data: devices } = useQuery({
    queryKey: ["devices-list-full"],
    queryFn: async () => (await supabase
      .from("pos_devices")
      .select("id, serial_number, model, manufacturer, device_type, online_status, sync_status, battery_level, cash_balance, locked, last_seen, assigned_officer_id, status")
      .order("last_seen", { ascending: false })
    ).data as DeviceRow[] | null || [],
    refetchInterval: 20000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["handovers"],
    queryFn: async () => (await supabase
      .from("cash_handovers")
      .select("*, officers(full_name), pos_devices(serial_number, model, manufacturer, device_type, online_status, sync_status, battery_level, locked, last_seen)")
      .order("created_at", { ascending: false })).data || [],
  });

  // Today's collections per officer (cash only, successful, non-deleted)
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); }, []);
  const { data: todayPayments } = useQuery({
    queryKey: ["today-payments", todayStart],
    queryFn: async () => (await supabase
      .from("payments")
      .select("amount, payment_method, officer_id, device_id, status, deleted_at, paid_at, officers(full_name)")
      .gte("paid_at", todayStart)
      .is("deleted_at", null)
    ).data || [],
    refetchInterval: 20000,
  });

  // Realtime device status refresh
  useEffect(() => {
    const ch = supabase
      .channel("handovers-devices")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_devices" }, () => {
        qc.invalidateQueries({ queryKey: ["devices-list-full"] });
        qc.invalidateQueries({ queryKey: ["handovers"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => {
        qc.invalidateQueries({ queryKey: ["handovers"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Auto-populate opening + expected from selected device cash_balance
  const selectedDevice = useMemo(() => (devices || []).find((d) => d.id === form.device_id) || null, [devices, form.device_id]);
  useEffect(() => {
    if (selectedDevice) {
      const bal = String(selectedDevice.cash_balance ?? 0);
      setForm((f) => ({ ...f, expected_amount: bal, opening_balance: f.opening_balance === "0" ? "0" : f.opening_balance }));
      // preselect officer if device is assigned
      if (selectedDevice.assigned_officer_id) {
        setForm((f) => ({ ...f, officer_id: f.officer_id || selectedDevice.assigned_officer_id || "" }));
      }
    }
  }, [selectedDevice]);

  const create = useMutation({
    mutationFn: async () => {
      const payload = { ...form, officer_id: form.officer_id || null, device_id: form.device_id || null, opening_balance: Number(form.opening_balance), collected_amount: Number(form.collected_amount), expected_amount: Number(form.expected_amount), actual_amount: Number(form.actual_amount) };
      const { error } = await supabase.from("cash_handovers").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Handover submitted for approval"); qc.invalidateQueries({ queryKey: ["handovers"] }); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async ({ id, nextDeadline }: { id: string; nextDeadline: string | null }) => {
      await confirmHandover({ data: { handover_id: id, next_deadline: nextDeadline } });
    },
    onSuccess: () => {
      toast.success("Handover confirmed · device cash reset to 0 UGX & unlocked");
      qc.invalidateQueries({ queryKey: ["handovers"] });
      qc.invalidateQueries({ queryKey: ["devices-list-full"] });
      qc.invalidateQueries({ queryKey: ["officers-list"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const adminCollect = useMutation({
    mutationFn: async ({ device_id, officer_id, actual_amount, next_deadline }: { device_id: string; officer_id: string; actual_amount: number; next_deadline: string | null }) => {
      return await adminCollectFromOfficer({ data: { device_id, officer_id, actual_amount, next_deadline } });
    },
    onSuccess: (res) => {
      toast.success(`Collected ${formatMoney(res.reset_amount)} · mobile app reset to 0 UGX`);
      qc.invalidateQueries({ queryKey: ["handovers"] });
      qc.invalidateQueries({ queryKey: ["devices-list-full"] });
      qc.invalidateQueries({ queryKey: ["today-payments", todayStart] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adminCollectPrompt = (device_id: string, officer_id: string, expected: number) => {
    const input = window.prompt(
      `Confirm cash received from officer.\n\nDevice balance: ${formatMoney(expected)}\nEnter actual amount received (UGX):`,
      String(expected)
    );
    if (input === null) return;
    const actual = Number(input.replace(/[^0-9.]/g, ""));
    if (isNaN(actual) || actual < 0) { toast.error("Invalid amount"); return; }
    // default next deadline: tomorrow 5:00 PM
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0);
    adminCollect.mutate({ device_id, officer_id, actual_amount: actual, next_deadline: d.toISOString() });
  };

  const confirmWithPrompt = (id: string) => {
    const input = window.prompt(
      "Next handover deadline (YYYY-MM-DD HH:MM, 24h) — leave blank to clear:",
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ")
    );
    if (input === null) return;
    const trimmed = input.trim();
    let iso: string | null = null;
    if (trimmed) {
      const parsed = new Date(trimmed.replace(" ", "T"));
      if (isNaN(parsed.getTime())) { toast.error("Invalid date format"); return; }
      iso = parsed.toISOString();
    }
    approve.mutate({ id, nextDeadline: iso });
  };

  // Default = tomorrow 5:00 PM local
  const quickConfirmTomorrow = (id: string) => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0);
    approve.mutate({ id, nextDeadline: d.toISOString() });
  };

  const devicesOnline = (devices || []).filter((d) => d.online_status === "online" && d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 5 * 60 * 1000).length;
  const totalCashInField = (devices || []).reduce((s, d) => s + Number(d.cash_balance || 0), 0);

  // Aggregate today's collections by officer
  const byOfficer = useMemo(() => {
    const map = new Map<string, { officer_id: string; name: string; cash: number; other: number; total: number; count: number }>();
    for (const p of (todayPayments || [])) {
      const oid = (p as any).officer_id as string | null;
      if (!oid) continue;
      const name = ((p as any).officers?.full_name as string) || "Unknown officer";
      const amt = Number((p as any).amount || 0);
      const method = String((p as any).payment_method || "").toLowerCase();
      const cur = map.get(oid) || { officer_id: oid, name, cash: 0, other: 0, total: 0, count: 0 };
      cur.total += amt; cur.count += 1;
      if (method === "cash") cur.cash += amt; else cur.other += amt;
      map.set(oid, cur);
    }
    // add officer device cash for context
    const withDevice = Array.from(map.values()).map((row) => {
      const dev = (devices || []).find((d) => d.assigned_officer_id === row.officer_id) || null;
      return { ...row, deviceCash: Number(dev?.cash_balance || 0), device: dev };
    });
    return withDevice.sort((a, b) => b.cash - a.cash);
  }, [todayPayments, devices]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader title="Cash Handovers" description="End-of-day cash reconciliation. Officers hand over today's cash — device resets to 0 UGX for the next day." actions={
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110"><Plus className="size-4" /> Submit Handover</button>
      } />

      {/* Today's collections by officer */}
      <Card>
        <div className="p-4 border-b border-zinc-950/5 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Today's Collections by Officer</h3>
          <span className="text-[11px] text-zinc-500">{new Date().toDateString()}</span>
        </div>
        {byOfficer.length === 0 ? (
          <div className="p-6"><Empty title="No collections yet today" description="Payments recorded today will appear here so you know what each officer must hand over." /></div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">Officer</th>
                <th className="px-6 py-3 text-right">Txns</th>
                <th className="px-6 py-3 text-right">Cash Today</th>
                <th className="px-6 py-3 text-right">Non-cash Today</th>
                <th className="px-6 py-3 text-right">Total Today</th>
                <th className="px-6 py-3 text-right">Device Cash Balance</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-950/5">
              {byOfficer.map((r) => (
                <tr key={r.officer_id} className="hover:bg-zinc-50/40">
                  <td className="px-6 py-3 font-medium">{r.name}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{r.count}</td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold">{formatMoney(r.cash)}</td>
                  <td className="px-6 py-3 text-right tabular-nums text-zinc-500">{formatMoney(r.other)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatMoney(r.total)}</td>
                  <td className={`px-6 py-3 text-right tabular-nums font-semibold ${r.deviceCash > 0 ? "text-amber-600" : "text-emerald-600"}`}>{formatMoney(r.deviceCash)}</td>
                  <td className="px-6 py-3 text-right space-x-3">
                    {r.device && r.deviceCash > 0 && (
                      <button
                        onClick={() => adminCollectPrompt(r.device!.id, r.officer_id, r.deviceCash)}
                        disabled={adminCollect.isPending}
                        className="text-xs bg-brand text-white px-2.5 py-1 rounded-md font-semibold hover:brightness-110 disabled:opacity-50"
                      >
                        Collect &amp; reset
                      </button>
                    )}
                    <button onClick={() => { if (r.device) setForm((f) => ({ ...f, device_id: r.device!.id, officer_id: r.officer_id, actual_amount: String(r.deviceCash) })); setOpen(true); }} className="text-xs text-zinc-500 font-semibold hover:underline">Manual entry</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>


      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Devices Online</div>
          <div className="text-2xl font-bold mt-1">{devicesOnline}<span className="text-sm text-zinc-400 font-normal"> / {(devices || []).length}</span></div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Cash In Field</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{formatMoney(totalCashInField)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Pending Handovers</div>
          <div className="text-2xl font-bold mt-1">{(data || []).filter((h) => h.status === "pending").length}</div>
        </Card>
      </div>

      {/* Device fleet card */}
      <Card>
        <div className="p-4 border-b border-zinc-950/5 flex items-center gap-2">
          <Smartphone className="size-4 text-zinc-500" />
          <h3 className="text-sm font-semibold">Field Devices</h3>
        </div>
        {(devices || []).length === 0 ? (
          <div className="p-6"><Empty title="No devices registered" description="Pair a mobile phone or POS terminal to see it here." /></div>
        ) : (
          <div className="divide-y divide-zinc-950/5">
            {(devices || []).map((d) => (
              <div key={d.id} className="p-4 flex items-center gap-4 hover:bg-zinc-50/40">
                <div className="size-10 rounded-lg bg-zinc-100 flex items-center justify-center text-lg">
                  {d.device_type === "mobile_phone" ? "📱" : "🖥️"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{[d.manufacturer, d.model].filter(Boolean).join(" ") || "Unknown device"}</div>
                  <div className="text-xs text-zinc-500 font-mono">{d.serial_number}</div>
                </div>
                <div><DeviceStatusChips d={d} /></div>
                <div className="text-right min-w-[110px]">
                  <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Cash on device</div>
                  <div className="text-sm font-semibold tabular-nums">{formatMoney(d.cash_balance || 0)}</div>
                </div>
                <div className="text-[11px] text-zinc-400 tabular-nums min-w-[130px] text-right">
                  {d.last_seen ? `seen ${formatDateTime(d.last_seen)}` : "never seen"}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Handovers table */}
      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
          (data || []).length === 0 ? <Empty title="No handovers recorded" description="Officers submit their collected cash here at end of shift." /> : (
          <table className="w-full text-left">
            <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">Officer</th>
                <th className="px-6 py-3">Device</th>
                <th className="px-6 py-3">Device Status</th>
                <th className="px-6 py-3 text-right">Expected</th>
                <th className="px-6 py-3 text-right">Actual</th>
                <th className="px-6 py-3 text-right">Variance</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-zinc-950/5">
              {(data || []).map((h) => {
                const dev = h.pos_devices as Partial<DeviceRow> | null;
                return (
                <tr key={h.id} className="hover:bg-zinc-50/40">
                  <td className="px-6 py-3">{(h.officers as { full_name?: string })?.full_name || "—"}</td>
                  <td className="px-6 py-3">
                    {dev ? (
                      <div>
                        <div className="text-xs">{dev.device_type === "mobile_phone" ? "📱" : "🖥️"} {[dev.manufacturer, dev.model].filter(Boolean).join(" ") || "Device"}</div>
                        <div className="font-mono text-[11px] text-zinc-500">{dev.serial_number}</div>
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-6 py-3">
                    {dev ? <DeviceStatusChips d={dev as DeviceRow} /> : <span className="text-xs text-zinc-400">—</span>}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatMoney(h.expected_amount)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatMoney(h.actual_amount)}</td>
                  <td className={`px-6 py-3 text-right tabular-nums font-semibold ${Number(h.difference) < 0 ? "text-destructive" : Number(h.difference) > 0 ? "text-emerald-600" : ""}`}>{Number(h.difference) > 0 ? "+" : ""}{formatMoney(h.difference)}</td>
                  <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(h.handover_date)}</td>
                  <td className="px-6 py-3"><Badge tone={h.status === "approved" ? "success" : h.status === "rejected" ? "danger" : "warning"}>{h.status}</Badge></td>
                  <td className="px-6 py-3">
                    {h.status === "pending" && (
                     <div className="flex items-center gap-3">
                        <button onClick={() => quickConfirmTomorrow(h.id)} className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold hover:underline"><CheckCircle2 className="size-3.5" /> Confirm · reset for tomorrow</button>
                        <button onClick={() => confirmWithPrompt(h.id)} className="text-[11px] text-zinc-500 hover:underline">Custom deadline…</button>
                      </div>
                    )}
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        )}
      </Card>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Submit Cash Handover</h2>
              <p className="text-sm text-zinc-500 mb-5">End-of-shift cash reconciliation. Mobile phones and POS terminals both supported.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!form.device_id || !form.officer_id) { toast.error("Select both device and officer"); return; } create.mutate(); }}>
                <label className="block">
                  <span className="text-xs font-medium text-zinc-600 mb-1 block">Device (phone or terminal) <span className="text-red-500">*</span></span>
                  <select required value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })} className="fld6">
                    <option value="">—</option>
                    {(devices || []).map((d) => <option key={d.id} value={d.id}>{deviceLabel(d)}</option>)}
                  </select>
                </label>
                {selectedDevice && (
                  <div className="rounded-md bg-zinc-50 p-2.5 border border-zinc-200/70">
                    <DeviceStatusChips d={selectedDevice} />
                    <div className="text-[11px] text-zinc-500 mt-1.5">Cash on device: <span className="font-semibold text-zinc-700 tabular-nums">{formatMoney(selectedDevice.cash_balance || 0)}</span></div>
                  </div>
                )}
                <label className="block">
                  <span className="text-xs font-medium text-zinc-600 mb-1 block">Officer <span className="text-red-500">*</span></span>
                  <select required value={form.officer_id} onChange={(e) => setForm({ ...form, officer_id: e.target.value })} className="fld6">
                    <option value="">—</option>
                    {(officers || []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Opening</span><input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} className="fld6" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Collected</span><input type="number" value={form.collected_amount} onChange={(e) => setForm({ ...form, collected_amount: e.target.value })} className="fld6" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Expected</span><input type="number" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} className="fld6" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Actual</span><input type="number" value={form.actual_amount} onChange={(e) => setForm({ ...form, actual_amount: e.target.value })} className="fld6" /></label>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110">{create.isPending ? "Submitting…" : "Submit"}</button>
                </div>
              </form>
              <style>{`.fld6{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld6:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
