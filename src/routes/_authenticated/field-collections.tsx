import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDateTime, initials } from "@/lib/format";
import { Wallet, Smartphone, MapPin, BatteryMedium, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/field-collections")({
  head: () => pageHead("Field Collections", "Track officer collections, locations and device activity in Hoima City."),
  component: FieldCollectionsPage,
});

type OfficerRow = {
  id: string;
  full_name: string;
  employee_id: string;
  division: string | null;
  collection_area: string | null;
  status: string;
};
type DeviceRow = {
  id: string;
  serial_number: string;
  model: string | null;
  battery_level: number | null;
  network_strength: string | null;
  online_status: string;
  sync_status: string;
  current_lat: number | null;
  current_lng: number | null;
  last_seen: string | null;
  cash_balance: number | null;
  assigned_officer_id: string | null;
};
type PaymentRow = {
  id: string;
  amount: number;
  paid_at: string;
  officer_id: string | null;
  device_id: string | null;
  status: string;
  payment_method: string;
  gps_lat: number | null;
  gps_lng: number | null;
};
type HandoverRow = {
  id: string;
  officer_id: string | null;
  actual_amount: number | null;
  status: string;
  handover_date: string;
};

async function fetchAll() {
  const [officers, devices, payments, handovers] = await Promise.all([
    supabase.from("officers").select("id, full_name, employee_id, division, collection_area, status"),
    supabase.from("pos_devices").select("id, serial_number, model, battery_level, network_strength, online_status, sync_status, current_lat, current_lng, last_seen, cash_balance, assigned_officer_id"),
    supabase.from("payments").select("id, amount, paid_at, officer_id, device_id, status, payment_method, gps_lat, gps_lng").is("deleted_at", null).gte("paid_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    supabase.from("cash_handovers").select("id, officer_id, actual_amount, status, handover_date").gte("handover_date", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);
  return {
    officers: (officers.data || []) as OfficerRow[],
    devices: (devices.data || []) as DeviceRow[],
    payments: (payments.data || []) as PaymentRow[],
    handovers: (handovers.data || []) as HandoverRow[],
  };
}

function FieldCollectionsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["field-collections"],
    queryFn: fetchAll,
    refetchInterval: 15_000,
  });

  // Realtime: refresh when a new payment lands
  useEffect(() => {
    const ch = supabase
      .channel("field-collections-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_devices" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

  const officers = data?.officers || [];
  const devices = data?.devices || [];
  const payments = (data?.payments || []).filter((p) => p.status === "success");
  const handovers = (data?.handovers || []).filter((h) => h.status === "approved");

  const deviceByOfficer = new Map<string, DeviceRow>();
  devices.forEach((d) => { if (d.assigned_officer_id) deviceByOfficer.set(d.assigned_officer_id, d); });

  const rows = officers.map((o) => {
    const device = deviceByOfficer.get(o.id);
    const officerPayments = payments.filter((p) => p.officer_id === o.id);
    const collectedToday = officerPayments.reduce((a, b) => a + Number(b.amount), 0);
    const cashCollected = officerPayments.filter((p) => p.payment_method === "cash").reduce((a, b) => a + Number(b.amount), 0);
    const handedOver = handovers.filter((h) => h.officer_id === o.id).reduce((a, b) => a + Number(b.actual_amount || 0), 0);
    const expectedHandover = Math.max(0, cashCollected - handedOver);
    const lastPayment = officerPayments.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())[0];
    const lastLat = lastPayment?.gps_lat ?? device?.current_lat ?? null;
    const lastLng = lastPayment?.gps_lng ?? device?.current_lng ?? null;
    return { officer: o, device, collectedToday, cashCollected, handedOver, expectedHandover, txnCount: officerPayments.length, lastPayment, lastLat, lastLng };
  }).sort((a, b) => b.collectedToday - a.collectedToday);

  const totalCollected = rows.reduce((a, r) => a + r.collectedToday, 0);
  const totalExpectedHandover = rows.reduce((a, r) => a + r.expectedHandover, 0);
  const totalCash = rows.reduce((a, r) => a + r.cashCollected, 0);
  const onlineDevices = devices.filter((d) => d.online_status === "online").length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Field Collections — Live"
        description="Per-officer collections today, device status, last known location, and expected end-of-day handover."
        actions={
          <button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-md bg-white ring-1 ring-black/5 px-3 py-2 text-xs font-semibold hover:bg-zinc-50">
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Collected Today" value={formatMoney(totalCollected)} tone="emerald" icon={Wallet} sub={`${rows.reduce((a, r) => a + r.txnCount, 0)} receipts`} />
        <KpiCard label="Cash In Field" value={formatMoney(totalCash)} tone="amber" icon={Wallet} sub="cash-only tenders" />
        <KpiCard label="Expected Handover" value={formatMoney(totalExpectedHandover)} tone="rose" icon={Wallet} sub="cash not yet handed over" />
        <KpiCard label="Devices Online" value={`${onlineDevices} / ${devices.length}`} tone="sky" icon={Smartphone} sub={`${devices.length - onlineDevices} offline`} />
      </section>

      <Card className="overflow-hidden">
        <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Officer Collections & Handover Register</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Live view — updates automatically as receipts sync from POS devices.</p>
          </div>
          <Badge tone="success">Auto-refresh 15s</Badge>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : rows.length === 0 ? (
          <Empty title="No officers registered yet" description="Add revenue officers to begin tracking field collections." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50/70 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 text-left">Officer</th>
                  <th className="px-6 py-3 text-left">Device</th>
                  <th className="px-6 py-3 text-left">Location</th>
                  <th className="px-6 py-3 text-right">Receipts</th>
                  <th className="px-6 py-3 text-right">Collected</th>
                  <th className="px-6 py-3 text-right">Cash</th>
                  <th className="px-6 py-3 text-right">Handed Over</th>
                  <th className="px-6 py-3 text-right">Expected Handover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => {
                  const d = r.device;
                  const online = d?.online_status === "online";
                  const batt = d?.battery_level ?? null;
                  return (
                    <tr key={r.officer.id} className="hover:bg-zinc-50/40">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center">{initials(r.officer.full_name)}</div>
                          <div className="min-w-0">
                            <div className="font-medium text-zinc-900 truncate">{r.officer.full_name}</div>
                            <div className="text-[11px] text-zinc-500 font-mono">{r.officer.employee_id} · {r.officer.division || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {d ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-zinc-700">{d.serial_number}</span>
                              {online ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100 px-1.5 py-0.5 rounded"><Wifi className="size-2.5" /> online</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-500 bg-zinc-100 ring-1 ring-zinc-200 px-1.5 py-0.5 rounded"><WifiOff className="size-2.5" /> offline</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                              <BatteryMedium className="size-3" />
                              <span className={`tabular-nums ${batt !== null && batt < 20 ? "text-rose-600 font-semibold" : ""}`}>{batt ?? "—"}%</span>
                              <span>·</span>
                              <span>sync: {d.sync_status}</span>
                              {d.last_seen && <><span>·</span><span title={new Date(d.last_seen).toLocaleString()}>{formatDateTime(d.last_seen)}</span></>}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400 italic">No device assigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {r.lastLat && r.lastLng ? (
                          <a
                            href={`https://www.google.com/maps?q=${r.lastLat},${r.lastLng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline font-mono"
                          >
                            <MapPin className="size-3.5" />
                            {Number(r.lastLat).toFixed(4)}, {Number(r.lastLng).toFixed(4)}
                          </a>
                        ) : (
                          <span className="text-xs text-zinc-400 italic">No GPS</span>
                        )}
                        {r.lastPayment && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">Last txn {formatDateTime(r.lastPayment.paid_at)}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums text-zinc-700">{r.txnCount}</td>
                      <td className="px-6 py-4 text-right tabular-nums font-semibold text-zinc-900">{formatMoney(r.collectedToday)}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-amber-700">{formatMoney(r.cashCollected)}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-zinc-600">{formatMoney(r.handedOver)}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={`tabular-nums font-bold ${r.expectedHandover > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(r.expectedHandover)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-zinc-50/70 text-xs font-semibold text-zinc-700">
                <tr>
                  <td className="px-6 py-3" colSpan={4}>Totals</td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatMoney(totalCollected)}</td>
                  <td className="px-6 py-3 text-right tabular-nums text-amber-700">{formatMoney(totalCash)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{formatMoney(rows.reduce((a, r) => a + r.handedOver, 0))}</td>
                  <td className="px-6 py-3 text-right tabular-nums text-rose-700">{formatMoney(totalExpectedHandover)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiCard({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; tone: "emerald" | "amber" | "rose" | "sky" }) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    sky: "bg-sky-50 text-sky-600",
  };
  return (
    <div className="bg-white rounded-xl ring-1 ring-black/5 shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{label}</span>
        <div className={`size-9 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon className="size-4" /></div>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-zinc-900 font-mono">{value}</div>
      {sub && <div className="text-[11px] mt-1 text-zinc-500">{sub}</div>}
    </div>
  );
}
