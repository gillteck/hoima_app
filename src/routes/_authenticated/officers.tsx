import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, initials } from "@/lib/format";
import { Plus, KeyRound, Clock, AlertTriangle, Edit2, Key, Copy, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { createOfficerAccount, updateOfficerDetails, resetOfficerPassword, deleteOfficer } from "@/lib/officers.functions";
import { setOfficerHandoverDeadline } from "@/lib/handovers.functions";

export const Route = createFileRoute("/_authenticated/officers")({
  head: () => pageHead("Revenue Officers", "Manage Hoima City Council revenue officer assignments and accounts."),
  component: OfficersPage,
});

function OfficersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState<any>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetOfficer, setResetOfficer] = useState<any>(null);
  const [resetResult, setResetResult] = useState<{ password: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const createAccount = useServerFn(createOfficerAccount);
  const updateAccount = useServerFn(updateOfficerDetails);
  const resetPwFn = useServerFn(resetOfficerPassword);
  const deleteFn = useServerFn(deleteOfficer);
  const qcDel = useQueryClient();
  const removeOfficer = async (o: { id: string; full_name: string }) => {
    if (!confirm(`Remove ${o.full_name}? Their login will be deleted.`)) return;
    try { await deleteFn({ data: { officer_id: o.id } }); toast.success("Officer removed"); qcDel.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "revenue_officer" as "administrator" | "supervisor" | "revenue_officer",
    employee_id: "",
    full_name: "",
    phone: "",
    division: "Kinondoni",
    collection_area: "",
    monthly_target: "1000000",
  });
  const [editForm, setEditForm] = useState({
    full_name: "",
    phone: "",
    division: "Kinondoni",
    collection_area: "",
    monthly_target: "1000000",
  });
  const setDeadline = useMutation({
    mutationFn: async ({ officer_id, deadline }: { officer_id: string; deadline: string | null }) => {
      await setOfficerHandoverDeadline({ data: { officer_id, deadline } });
    },
    onSuccess: () => { toast.success("Handover deadline updated"); qc.invalidateQueries({ queryKey: ["officers"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set deadline"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["officers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("officers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await createAccount({ data: {
        username: form.username,
        password: form.password,
        role: form.role,
        employee_id: form.employee_id,
        full_name: form.full_name,
        phone: form.phone || null,
        division: form.division || null,
        collection_area: form.collection_area || null,
        monthly_target: Number(form.monthly_target) || 0,
      } });
    },
    onSuccess: () => {
      toast.success("Officer account created");
      setOpen(false);
      setForm({ username: "", password: "", role: "revenue_officer", employee_id: "", full_name: "", phone: "", division: "Kinondoni", collection_area: "", monthly_target: "1000000" });
      qc.invalidateQueries({ queryKey: ["officers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create officer"),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editingOfficer) return;
      await updateAccount({ data: {
        officer_id: editingOfficer.id,
        full_name: editForm.full_name,
        phone: editForm.phone || null,
        division: editForm.division || null,
        collection_area: editForm.collection_area || null,
        monthly_target: Number(editForm.monthly_target) || 0,
      } });
    },
    onSuccess: () => {
      toast.success("Officer updated");
      setEditOpen(false);
      setEditingOfficer(null);
      qc.invalidateQueries({ queryKey: ["officers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update officer"),
  });

  const resetPassword = useMutation({
    mutationFn: async () => {
      if (!resetOfficer) return null;
      return await resetPwFn({ data: { officer_id: resetOfficer.id } });
    },
    onSuccess: (res) => {
      if (res) setResetResult({ password: res.password, email: res.email ?? "" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to reset password"),
  });

  const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader title="Revenue Officers" description="Field officers responsible for collection across divisions." actions={
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110"><Plus className="size-4" /> Add Officer</button>
      } />

      {isLoading ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div> :
        (data || []).length === 0 ? <Card className="p-0"><Empty title="No officers registered" description="Add revenue officers to assign POS devices and collection routes." /></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data || []).map((o) => (
            <motion.div key={o.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl ring-1 ring-black/5 shadow-sm p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-full bg-brand-light text-brand flex items-center justify-center font-semibold">{initials(o.full_name)}</div>
                  <div>
                    <div className="font-semibold text-sm">{o.full_name}</div>
                    <div className="text-xs text-zinc-500 font-mono">{o.employee_id}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingOfficer(o); setEditForm({ full_name: o.full_name, phone: o.phone || "", division: o.division || "Kinondoni", collection_area: o.collection_area || "", monthly_target: String(o.monthly_target) }); setEditOpen(true); }} className="text-zinc-500 hover:text-brand p-1 rounded hover:bg-zinc-100" title="Edit officer"><Edit2 className="size-4" /></button>
                  <button onClick={() => { setResetOfficer(o); setResetResult(null); setResetOpen(true); }} className="text-zinc-500 hover:text-amber-600 p-1 rounded hover:bg-zinc-100" title="Reset password"><Key className="size-4" /></button>
                  <button onClick={() => removeOfficer(o)} className="text-zinc-500 hover:text-red-600 p-1 rounded hover:bg-zinc-100" title="Remove officer"><Trash2 className="size-4" /></button>
                  <Badge tone={o.status === "active" ? "success" : "neutral"}>{o.status}</Badge>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-zinc-500">Division</span><span className="font-medium">{o.division || "—"}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Area</span><span className="font-medium">{o.collection_area || "—"}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Phone</span><span>{o.phone || "—"}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Monthly target</span><span className="font-semibold">{formatMoney(o.monthly_target)}</span></div>
              </div>
              {(() => {
                const dl = (o as { handover_deadline?: string | null }).handover_deadline;
                const overdue = dl && new Date(dl) < new Date();
                return (
                  <div className={`mt-3 pt-3 border-t border-zinc-100 rounded-md ${overdue ? "bg-red-50/60 -mx-2 px-2 py-2" : ""}`}>
                    <label className="text-[10px] uppercase font-semibold text-zinc-500 tracking-wider mb-1 flex items-center gap-1">
                      {overdue ? <AlertTriangle className="size-3 text-red-600" /> : <Clock className="size-3" />}
                      Handover Deadline {overdue && <span className="text-red-600 normal-case font-bold">· OVERDUE</span>}
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="datetime-local"
                        defaultValue={toLocalInput(dl ?? null)}
                        onBlur={(e) => {
                          const val = e.target.value;
                          const iso = val ? new Date(val).toISOString() : null;
                          if (iso !== (dl ?? null)) setDeadline.mutate({ officer_id: o.id, deadline: iso });
                        }}
                        className="flex-1 bg-white ring-1 ring-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-brand"
                      />
                      {dl && (
                        <button onClick={() => setDeadline.mutate({ officer_id: o.id, deadline: null })} className="text-[10px] px-2 py-1 rounded hover:bg-zinc-100 text-zinc-500" title="Clear deadline">✕</button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1">Past this time the officer's device auto-locks until admin confirms handover.</p>
                  </div>
                );
              })()}
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Add Officer</h2>
              <p className="text-sm text-zinc-500 mb-5">Creates a sign-in account for the Android POS and web console.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <div className="rounded-lg bg-emerald-50/60 ring-1 ring-emerald-100 p-3 flex gap-2 text-[11px] text-emerald-800">
                  <KeyRound className="size-4 shrink-0 mt-0.5" />
                  <div>Sign-in email will be <span className="font-mono font-semibold">{(form.username || "username").toLowerCase()}@hoima.gov</span>. Share the password with the officer securely.</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Username *</span><input required autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="fld4" placeholder="jdoe" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Password *</span><input required type="text" minLength={6} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="fld4" placeholder="min 6 chars" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Employee ID *</span><input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="fld4" placeholder="EMP-001" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Full name *</span><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="fld4" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Role</span>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })} className="fld4">
                      <option value="revenue_officer">Revenue Officer</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="fld4" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Division</span>
                    <select value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} className="fld4">{["Kinondoni","Ilala","Temeke","Ubungo","Kigamboni"].map((d) => <option key={d}>{d}</option>)}</select>
                  </label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Monthly target</span><input type="number" value={form.monthly_target} onChange={(e) => setForm({ ...form, monthly_target: e.target.value })} className="fld4" /></label>
                </div>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Collection area</span><input value={form.collection_area} onChange={(e) => setForm({ ...form, collection_area: e.target.value })} className="fld4" placeholder="Central Market" /></label>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{create.isPending ? "Creating…" : "Create account"}</button>
                </div>
              </form>
              <style>{`.fld4{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld4:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {editOpen && editingOfficer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Edit Officer Details</h2>
              <p className="text-sm text-zinc-500 mb-5">Update officer information.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); update.mutate(); }}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Full name</span><input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} className="fld4" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Phone</span><input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="fld4" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Division</span>
                    <select value={editForm.division} onChange={(e) => setEditForm({ ...editForm, division: e.target.value })} className="fld4">{["Kinondoni","Ilala","Temeke","Ubungo","Kigamboni"].map((d) => <option key={d}>{d}</option>)}</select>
                  </label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Monthly target</span><input type="number" value={editForm.monthly_target} onChange={(e) => setEditForm({ ...editForm, monthly_target: e.target.value })} className="fld4" /></label>
                </div>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Collection area</span><input value={editForm.collection_area} onChange={(e) => setEditForm({ ...editForm, collection_area: e.target.value })} className="fld4" placeholder="Central Market" /></label>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={update.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{update.isPending ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
              <style>{`.fld4{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld4:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetOpen && resetOfficer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setResetOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              {!resetResult ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><Key className="size-5" /></div>
                    <div>
                      <h2 className="text-lg font-semibold">Reset Password</h2>
                      <p className="text-xs text-zinc-500">{resetOfficer.full_name}</p>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-600 mb-4">Generate a new temporary password. The officer can sign in with the new password and change it later.</p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setResetOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                    <button onClick={() => resetPassword.mutate()} disabled={resetPassword.isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50"><Key className="size-4" /> {resetPassword.isPending ? "Generating…" : "Generate Password"}</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center"><Check className="size-5" /></div>
                    <div>
                      <h2 className="text-lg font-semibold">Password Reset</h2>
                      <p className="text-xs text-zinc-500">New password generated</p>
                    </div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200 mb-4">
                    <p className="text-xs text-emerald-700 mb-2 font-semibold uppercase">Sign-in email:</p>
                    <p className="text-sm font-mono font-semibold text-emerald-900 mb-3">{resetResult.email}</p>
                    <p className="text-xs text-emerald-700 mb-2 font-semibold uppercase">New temporary password:</p>
                    <div className="flex gap-2 items-center">
                      <code className="flex-1 text-sm font-mono bg-white border border-emerald-300 rounded px-3 py-2 font-semibold">{resetResult.password}</code>
                      <button onClick={() => { navigator.clipboard.writeText(resetResult.password); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className={`p-2 rounded transition ${copied ? "bg-emerald-200 text-emerald-700" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}><Copy className="size-4" /></button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-600 mb-4 bg-amber-50 border border-amber-200 rounded p-3">Share this password with the officer securely. They can change it after signing in.</p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setResetOpen(false); setResetResult(null); }} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700">Done</button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
