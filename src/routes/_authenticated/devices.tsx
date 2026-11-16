import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { approveDevicePairing, updateDeviceDetails, deleteDevice } from "@/lib/devices.functions";
import { useEffect, useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Plus, Smartphone, Phone, Battery, BatteryLow, Wifi, WifiOff, Lock, Unlock, KeyRound, Check, X, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => pageHead("Devices & POS", "Manage Hoima City Council POS devices, phone pairing and device status."),
  component: DevicesPage,
});

function DevicesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "android_pos" | "mobile_phone">("all");
  const [lockTarget, setLockTarget] = useState<{ id: string; serial: string } | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [form, setForm] = useState({ serial_number: "", imei: "", model: "Sunmi V2 Pro", manufacturer: "Sunmi", android_version: "12", sim_number: "", device_type: "android_pos" });
  const [editForm, setEditForm] = useState({ serial_number: "", imei: "", model: "", manufacturer: "", android_version: "", sim_number: "", device_type: "android_pos" as "android_pos" | "mobile_phone" });
  const updateDevice = useServerFn(updateDeviceDetails);
  const deleteDeviceFn = useServerFn(deleteDevice);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; serial: string } | null>(null);
  const removeDevice = useMutation({
    mutationFn: async (id: string) => await deleteDeviceFn({ data: { device_id: id } }),
    onSuccess: () => { toast.success("Device removed"); qc.invalidateQueries({ queryKey: ["devices"] }); setDeleteTarget(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove device"),
  });

  const { data: officers } = useQuery({ queryKey: ["officers-list"], queryFn: async () => (await supabase.from("officers").select("id, full_name")).data || [] });
  const { data, isLoading } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => (await supabase.from("pos_devices").select("*, officers(full_name)").order("created_at", { ascending: false })).data || [],
  });

  // Pending pairing codes from Android app
  const { data: pending } = useQuery({
    queryKey: ["pairing-codes"],
    queryFn: async () => (await supabase.from("device_pairing_codes").select("*, officers(full_name)").eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })).data || [],
    refetchInterval: 5000,
  });

  // Live updates when devices or pairing requests change
  useEffect(() => {
    const ch = supabase.channel("devices-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_devices" }, () => qc.invalidateQueries({ queryKey: ["devices"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "device_pairing_codes" }, (p) => {
        qc.invalidateQueries({ queryKey: ["pairing-codes"] });
        if (p.eventType === "INSERT") {
          const row = p.new as { code: string; model: string | null };
          toast.info(`📱 New device pairing request: ${row.code}${row.model ? ` (${row.model})` : ""}`);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const approvePairFn = useServerFn(approveDevicePairing);
  const approvePair = useMutation({
    mutationFn: async ({ code, serial, officer_id }: { code: string; serial: string; officer_id: string | null }) => {
      return await approvePairFn({ data: { code, serial_number: serial, assigned_officer_id: officer_id } });
    },
    onSuccess: () => { toast.success("Device approved and provisioned"); qc.invalidateQueries({ queryKey: ["pairing-codes"] }); qc.invalidateQueries({ queryKey: ["devices"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to approve device"),
  });

  const rejectPair = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("device_pairing_codes").update({ status: "rejected" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pairing request rejected"); qc.invalidateQueries({ queryKey: ["pairing-codes"] }); },
    onError: (e) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload = { ...form };
      if (form.device_type === "mobile_phone" && !form.model) payload.model = "Mobile Phone";
      const { error } = await supabase.from("pos_devices").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Device registered"); qc.invalidateQueries({ queryKey: ["devices"] }); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async ({ id, officer_id }: { id: string; officer_id: string | null }) => { const { error } = await supabase.from("pos_devices").update({ assigned_officer_id: officer_id }).eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Assignment updated"); qc.invalidateQueries({ queryKey: ["devices"] }); },
  });

  const toggleLock = useMutation({
    mutationFn: async ({ id, locked, reason }: { id: string; locked: boolean; reason?: string }) => {
      const { error } = await supabase.from("pos_devices").update({
        locked,
        lock_reason: locked ? (reason || null) : null,
        locked_at: locked ? new Date().toISOString() : null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      toast.success(v.locked ? "Device locked — mobile app will block on next sync" : "Device unlocked");
      qc.invalidateQueries({ queryKey: ["devices"] });
      setLockTarget(null); setLockReason("");
    },
    onError: (e) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      await updateDevice({
        data: {
          device_id: editingDevice.id,
          serial_number: editForm.serial_number || undefined,
          imei: editForm.imei || null,
          model: editForm.model || null,
          manufacturer: editForm.manufacturer || null,
          android_version: editForm.android_version || null,
          sim_number: editForm.sim_number || null,
          device_type: editForm.device_type,
        },
      });
    },
    onSuccess: () => {
      toast.success("Device details updated");
      qc.invalidateQueries({ queryKey: ["devices"] });
      setEditOpen(false);
      setEditingDevice(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update device"),
  });

  const filtered = (data || []).filter((d) => filter === "all" || (d.device_type || "android_pos") === filter);
  const counts = { total: (data || []).length, phones: (data || []).filter((d) => d.device_type === "mobile_phone").length, locked: (data || []).filter((d) => d.locked).length };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="POS Devices & Mobile Terminals"
        description={`${counts.total} devices · ${counts.phones} mobile phones · ${counts.locked} locked`}
        actions={
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110"><Plus className="size-4" /> Register Device</button>
        }
      />

      <div className="flex gap-1.5 text-xs">
        {(["all", "android_pos", "mobile_phone"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md font-medium transition ${filter === f ? "bg-brand text-white" : "bg-white ring-1 ring-black/5 text-zinc-600 hover:bg-zinc-50"}`}>
            {f === "all" ? "All" : f === "android_pos" ? "POS Terminals" : "Mobile Phones"}
          </button>
        ))}
      </div>

      {(pending || []).length > 0 && (
        <Card className="p-5 ring-2 ring-amber-200 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="size-4 text-amber-600" />
            <h2 className="font-semibold text-sm">Pending Device Approvals <span className="text-xs font-normal text-zinc-500">· {(pending || []).length} awaiting</span></h2>
          </div>
          <div className="space-y-2">
            {(pending || []).map((p) => (
              <PendingPairRow
                key={p.id}
                pair={p as { id: string; code: string; device_type: string; model: string | null; manufacturer: string | null; officers?: { full_name?: string } | null; created_at: string }}
                officers={officers || []}
                onApprove={(serial, officer_id) => approvePair.mutate({ code: p.code, serial, officer_id })}
                onReject={() => rejectPair.mutate(p.id)}
              />
            ))}
          </div>
        </Card>
      )}


      {isLoading ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map((i) => <Skeleton key={i} className="h-52 rounded-xl" />)}</div> :
        filtered.length === 0 ? <Card className="p-0"><Empty title="No devices" description="Register an Android POS terminal or a mobile phone running the POS app." /></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => {
            const isPhone = d.device_type === "mobile_phone";
            return (
              <motion.div key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`bg-white rounded-xl ring-1 shadow-sm p-5 ${d.locked ? "ring-amber-300 bg-amber-50/30" : "ring-black/5"}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-11 rounded-lg flex items-center justify-center ${d.online_status === "online" ? "bg-brand-light text-brand" : "bg-zinc-100 text-zinc-400"}`}>
                      {isPhone ? <Phone className="size-5" /> : <Smartphone className="size-5" />}
                    </div>
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">{d.serial_number} {d.locked && <Lock className="size-3.5 text-amber-600" />}</div>
                      <div className="text-xs text-zinc-500">{isPhone ? "Mobile POS App" : "Android POS"} · {d.model}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingDevice(d); setEditForm({ serial_number: d.serial_number, imei: d.imei || "", model: d.model || "", manufacturer: d.manufacturer || "", android_version: d.android_version || "", sim_number: d.sim_number || "", device_type: (d.device_type || "android_pos") as "android_pos" | "mobile_phone" }); setEditOpen(true); }} className="text-zinc-500 hover:text-brand p-1 rounded hover:bg-zinc-100" title="Edit device"><Edit2 className="size-4" /></button>
                    <button onClick={() => setDeleteTarget({ id: d.id, serial: d.serial_number })} className="text-zinc-500 hover:text-red-600 p-1 rounded hover:bg-red-50" title="Remove device"><Trash2 className="size-4" /></button>
                    <Badge tone={d.locked ? "warning" : d.online_status === "online" ? "success" : d.online_status === "syncing" ? "warning" : "neutral"}>{d.locked ? "locked" : d.online_status}</Badge>
                  </div>
                </div>

                {d.locked && d.lock_reason && (
                  <div className="mt-3 text-xs bg-amber-100/60 text-amber-900 rounded-md px-2.5 py-1.5 border border-amber-200">
                    <span className="font-semibold">Lock reason:</span> {d.lock_reason}
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2 text-xs">
                  <div className="flex items-center justify-between"><span className="text-zinc-500 flex items-center gap-1.5">{(d.battery_level ?? 0) < 20 ? <BatteryLow className="size-3.5 text-amber-500" /> : <Battery className="size-3.5" />} Battery</span><span className="font-medium tabular-nums">{(d.battery_level ?? 0)}%</span></div>
                  <div className="flex items-center justify-between"><span className="text-zinc-500 flex items-center gap-1.5">{d.online_status === "online" ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />} Network</span><span>{d.network_strength}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Cash balance</span><span className="font-semibold">{formatMoney(d.cash_balance)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Last seen</span><span>{d.last_seen ? formatDateTime(d.last_seen) : "—"}</span></div>
                </div>

                <div className="mt-4">
                  <label className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider mb-1 block">Assigned Officer</label>
                  <select value={d.assigned_officer_id || ""} onChange={(e) => assign.mutate({ id: d.id, officer_id: e.target.value || null })} className="w-full bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 text-xs">
                    <option value="">— Unassigned —</option>
                    {(officers || []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </div>

                <div className="mt-3 pt-3 border-t border-zinc-100">
                  {d.locked ? (
                    <button onClick={() => toggleLock.mutate({ id: d.id, locked: false })} disabled={toggleLock.isPending} className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 text-white text-xs font-medium py-2 rounded-md hover:brightness-110 disabled:opacity-50">
                      <Unlock className="size-3.5" /> Unlock Device
                    </button>
                  ) : (
                    <button onClick={() => setLockTarget({ id: d.id, serial: d.serial_number })} className="w-full inline-flex items-center justify-center gap-2 bg-zinc-900 text-white text-xs font-medium py-2 rounded-md hover:bg-zinc-800">
                      <Lock className="size-3.5" /> Lock Device Remotely
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Register modal */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Register Device</h2>
              <p className="text-sm text-zinc-500 mb-5">Add an Android POS terminal or a mobile phone running the Mobile POS app.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <div>
                  <span className="text-xs font-medium text-zinc-600 mb-1 block">Device type</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: "android_pos", label: "Android POS", icon: Smartphone },
                      { v: "mobile_phone", label: "Mobile Phone", icon: Phone },
                    ].map((t) => (
                      <button key={t.v} type="button" onClick={() => setForm({ ...form, device_type: t.v as "android_pos" | "mobile_phone" })} className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-xs font-medium transition ${form.device_type === t.v ? "bg-brand text-white" : "bg-zinc-50 ring-1 ring-zinc-200 text-zinc-700 hover:bg-zinc-100"}`}>
                        <t.icon className="size-4" /> {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Serial *</span><input required value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="fld5" placeholder={form.device_type === "mobile_phone" ? "MP-1001" : "POS-1001"} /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">IMEI</span><input value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Model</span><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="fld5" placeholder={form.device_type === "mobile_phone" ? "Samsung A15" : "Sunmi V2 Pro"} /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Manufacturer</span><input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Android version</span><input value={form.android_version} onChange={(e) => setForm({ ...form, android_version: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">SIM number</span><input value={form.sim_number} onChange={(e) => setForm({ ...form, sim_number: e.target.value })} className="fld5" /></label>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{create.isPending ? "Registering…" : "Register"}</button>
                </div>
              </form>
              <style>{`.fld5{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld5:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lock modal */}
      <AnimatePresence>
        {lockTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setLockTarget(null)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="size-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><Lock className="size-5" /></div>
                <div>
                  <h2 className="text-lg font-semibold">Lock {lockTarget.serial}</h2>
                  <p className="text-xs text-zinc-500">The device will block all POS actions on next sync.</p>
                </div>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-zinc-600 mb-1 block">Reason (shown on device screen)</span>
                <textarea value={lockReason} onChange={(e) => setLockReason(e.target.value)} rows={3} className="w-full bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand focus:bg-white" placeholder="e.g. End of shift · Suspected misuse · Cash reconciliation pending" />
              </label>
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setLockTarget(null)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                <button onClick={() => toggleLock.mutate({ id: lockTarget.id, locked: true, reason: lockReason })} disabled={toggleLock.isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"><Lock className="size-4" /> {toggleLock.isPending ? "Locking…" : "Lock Device"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editOpen && editingDevice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Edit Device Details</h2>
              <p className="text-sm text-zinc-500 mb-5">Update device information.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); update.mutate(); }}>
                <div>
                  <span className="text-xs font-medium text-zinc-600 mb-1 block">Device type</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: "android_pos", label: "Android POS", icon: Smartphone },
                      { v: "mobile_phone", label: "Mobile Phone", icon: Phone },
                    ].map((t) => (
                      <button key={t.v} type="button" onClick={() => setEditForm({ ...editForm, device_type: t.v as "android_pos" | "mobile_phone" })} className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-xs font-medium transition ${editForm.device_type === t.v ? "bg-brand text-white" : "bg-zinc-50 ring-1 ring-zinc-200 text-zinc-700 hover:bg-zinc-100"}`}>
                        <t.icon className="size-4" /> {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Serial</span><input value={editForm.serial_number} onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">IMEI</span><input value={editForm.imei} onChange={(e) => setEditForm({ ...editForm, imei: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Model</span><input value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Manufacturer</span><input value={editForm.manufacturer} onChange={(e) => setEditForm({ ...editForm, manufacturer: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Android version</span><input value={editForm.android_version} onChange={(e) => setEditForm({ ...editForm, android_version: e.target.value })} className="fld5" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">SIM number</span><input value={editForm.sim_number} onChange={(e) => setEditForm({ ...editForm, sim_number: e.target.value })} className="fld5" /></label>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={update.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{update.isPending ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
              <style>{`.fld5{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld5:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1 text-red-700">Remove Device</h2>
              <p className="text-sm text-zinc-600 mb-5">Permanently remove device <span className="font-semibold">{deleteTarget.serial}</span>? This cannot be undone. Only the super administrator can perform this action.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteTarget(null)} className="px-3 py-2 rounded-md text-sm bg-zinc-100 hover:bg-zinc-200">Cancel</button>
                <button onClick={() => removeDevice.mutate(deleteTarget.id)} disabled={removeDevice.isPending} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"><Trash2 className="size-4" /> {removeDevice.isPending ? "Removing…" : "Remove"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PendingPairRow({ pair, officers, onApprove, onReject }: {
  pair: { id: string; code: string; device_type: string; model: string | null; manufacturer: string | null; officers?: { full_name?: string } | null; created_at: string };
  officers: Array<{ id: string; full_name: string }>;
  onApprove: (serial: string, officer_id: string | null) => void;
  onReject: () => void;
}) {
  const [serial, setSerial] = useState(`POS-${pair.code}`);
  const [officerId, setOfficerId] = useState<string>("");
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white rounded-md ring-1 ring-amber-200 p-3">
      <div className="flex-1 min-w-[180px]">
        <div className="flex items-center gap-2">
          <div className="font-mono text-lg font-bold tracking-widest text-amber-700">{pair.code}</div>
          <Badge tone="warning">{pair.device_type}</Badge>
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          {pair.manufacturer || "Unknown"} {pair.model || ""} · requested by {pair.officers?.full_name || "unknown officer"} · {formatDateTime(pair.created_at)}
        </div>
      </div>
      <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial number" className="bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 text-xs w-40" />
      <select value={officerId} onChange={(e) => setOfficerId(e.target.value)} className="bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 text-xs w-40">
        <option value="">Assign officer…</option>
        {officers.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
      </select>
      <button onClick={() => onApprove(serial, officerId || null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-md hover:bg-emerald-700"><Check className="size-3.5" /> Approve</button>
      <button onClick={onReject} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 text-xs font-medium rounded-md ring-1 ring-red-200 hover:bg-red-50"><X className="size-3.5" /> Reject</button>
    </div>
  );
}

