import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Plus, Landmark, Check, X, Loader2, RefreshCw, Camera, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { SUPPORTED_BANKS } from "@/lib/bank-transfers.types";

export const Route = createFileRoute("/_authenticated/bank-transfers")({
  head: () => pageHead("Bank Transfers", "Review bank references and bank transfer payments for Hoima City Council."),
  component: BankTransfersPage,
});

type Transfer = {
  id: string;
  bank_name: string;
  bank_code: string | null;
  transaction_reference: string;
  amount: number;
  status: "pending" | "confirmed" | "rejected";
  admin_notes: string | null;
  proof_document_url: string | null;
  submitted_at: string;
  confirmed_at: string | null;
};

async function fetchTransfers(status: string) {
  let q = supabase
    .from("bank_transfers" as never)
    .select("id, bank_name, bank_code, transaction_reference, amount, status, admin_notes, proof_document_url, submitted_at, confirmed_at")
    .order("submitted_at", { ascending: false })
    .limit(300);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as unknown as Transfer[];
}

function BankTransfersPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"all" | "pending" | "confirmed" | "rejected">("all");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["bank-transfers", status], queryFn: () => fetchTransfers(status), refetchInterval: 15000 });

  const review = useMutation({
    mutationFn: async ({ id, action, notes }: { id: string; action: "confirmed" | "rejected"; notes?: string }) => {
      const patch: Record<string, unknown> = { status: action, admin_notes: notes || null, reviewed_by: (await supabase.auth.getUser()).data.user?.id };
      if (action === "confirmed") patch.confirmed_at = new Date().toISOString();
      const { error } = await supabase.from("bank_transfers" as never).update(patch as never).eq("id", id);
      if (error) throw error;

      if (action === "confirmed") {
        const row = (data || []).find((t) => t.id === id);
        if (row) {
          const { error: pErr } = await supabase.from("payments").insert([{
            amount: row.amount,
            payment_method: "bank",
            reference_number: row.transaction_reference,
            status: "success",
            sync_status: "synced",
          }]);
          if (pErr) throw pErr;
        }
      }
    },
    onSuccess: (_d, v) => {
      toast.success(v.action === "confirmed" ? "Bank transfer confirmed" : "Bank transfer rejected");
      qc.invalidateQueries({ queryKey: ["bank-transfers"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalPending = (data || []).filter((t) => t.status === "pending").reduce((a, t) => a + Number(t.amount), 0);
  const totalConfirmed = (data || []).filter((t) => t.status === "confirmed").reduce((a, t) => a + Number(t.amount), 0);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Bank Transfer Payments"
        description="Every bank transfer submitted from the field is auto-recorded as a payment and appears in Transactions instantly. Cross-reference the transaction number with bank statements or URA/Local Government settlement reports for audit."
        actions={
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110">
            <Plus className="size-4" /> Submit Bank Transfer
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Total received</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{formatMoney(totalConfirmed + totalPending)}</div>
          <div className="text-xs text-zinc-500 mt-1">{(data || []).length} transfers</div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Confirmed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{formatMoney(totalConfirmed)}</div>
        </Card>
        <Card className="p-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Filter</div>
            <div className="mt-2 flex gap-1.5">
              {(["pending","confirmed","rejected","all"] as const).map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize ${status===s ? "bg-brand text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>{s}</button>
              ))}
            </div>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: ["bank-transfers"] })} className="p-2 rounded-md hover:bg-zinc-100 text-zinc-500"><RefreshCw className="size-4" /></button>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (data || []).length === 0 ? (
          <Empty title="No bank transfers" description="Submitted bank transfers will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Slip</th>
                  <th className="px-6 py-3">Transaction #</th>
                  <th className="px-6 py-3">Bank</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Submitted</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-zinc-950/5">
                {(data || []).map((t) => (
                  <tr key={t.id} className="hover:bg-zinc-50/40">
                    <td className="px-6 py-3">
                      <SlipThumb path={t.proof_document_url} onOpen={setPreview} />
                    </td>
                    <td className="px-6 py-3 font-mono text-xs font-semibold">{t.transaction_reference}</td>
                    <td className="px-6 py-3 font-medium">{t.bank_name}</td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums">{formatMoney(t.amount)}</td>
                    <td className="px-6 py-3">
                      <Badge tone={t.status === "confirmed" ? "success" : t.status === "rejected" ? "danger" : "warning"}>{t.status}</Badge>
                    </td>
                    <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(t.submitted_at)}</td>
                    <td className="px-6 py-3 text-right">
                      {t.status === "pending" ? (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => review.mutate({ id: t.id, action: "confirmed" })}
                            disabled={review.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:brightness-110 disabled:opacity-50"
                          >
                            <Check className="size-3.5" /> Confirm
                          </button>
                          <button
                            onClick={() => {
                              const reason = prompt("Reason for rejection (optional):") || "";
                              review.mutate({ id: t.id, action: "rejected", notes: reason });
                            }}
                            disabled={review.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 text-white text-xs font-medium hover:brightness-110 disabled:opacity-50"
                          >
                            <X className="size-3.5" /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-400">{t.confirmed_at ? formatDateTime(t.confirmed_at) : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {open && <SubmitModal onClose={() => setOpen(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ["bank-transfers"] }); setOpen(false); }} />}
        {preview && <PreviewModal url={preview} onClose={() => setPreview(null)} />}
      </AnimatePresence>
    </div>
  );
}

function SlipThumb({ path, onOpen }: { path: string | null; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) { setUrl(null); return; }
    (async () => {
      const { data } = await supabase.storage.from("bank-slips").createSignedUrl(path, 3600);
      if (!cancelled) setUrl(data?.signedUrl || null);
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (!path) return (
    <div className="size-12 rounded-md bg-zinc-100 flex flex-col items-center justify-center text-zinc-400" title="No image provided">
      <ImageIcon className="size-4" />
      <span className="text-[8px] leading-tight mt-0.5">No image</span>
    </div>
  );
  if (!url) return <div className="size-12 rounded-md bg-zinc-100 animate-pulse" />;
  return (
    <button onClick={() => onOpen(url)} className="block size-12 rounded-md overflow-hidden ring-1 ring-zinc-200 hover:ring-brand transition">
      <img src={url} alt="Bank slip" className="size-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
    </button>
  );
}

function PreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <img src={url} alt="Bank slip" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"><X className="size-5" /></button>
    </motion.div>
  );
}

function SubmitModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<{ bank_name: string; transaction_reference: string; amount: string }>({
    bank_name: SUPPORTED_BANKS[1].name,
    transaction_reference: "",
    amount: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  const onPick = (f: File | null) => {
    setFile(f);
    if (f) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else setPreview(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.transaction_reference.trim()) return toast.error("Transaction reference is required");
    if (!Number(form.amount)) return toast.error("Enter a valid amount");

    setSubmitting(true);
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const bankCode = SUPPORTED_BANKS.find((b) => b.name === form.bank_name)?.code || null;

      let path: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "jpg";
        path = `${uid || "anon"}/${Date.now()}-${form.transaction_reference.trim().replace(/[^a-z0-9]/gi, "")}.${ext}`;
        const { error: upErr } = await supabase.storage.from("bank-slips").upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (upErr) throw upErr;
      }

      const { error } = await supabase.from("bank_transfers" as never).insert([{
        submitted_by: uid || null,
        account_name: "—",
        account_number: "—",
        bank_name: form.bank_name,
        bank_code: bankCode,
        transaction_reference: form.transaction_reference.trim(),
        amount: Number(form.amount),
        proof_document_url: path,
        status: "pending",
      }] as never);
      if (error) throw error;

      toast.success("Bank transfer submitted — awaiting admin verification");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center"><Landmark className="size-5" /></div>
          <div>
            <h2 className="text-lg font-semibold">Submit Bank Transfer</h2>
            <p className="text-xs text-zinc-500">Verify against bank statements using the reference number.</p>
          </div>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="text-xs font-medium text-zinc-600 mb-1 block">Transaction Reference<span className="text-red-500"> *</span></span>
            <input required value={form.transaction_reference} onChange={(e) => setForm({ ...form, transaction_reference: e.target.value })} className="fld3" placeholder="FT2607UGA123" />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 mb-1 block">Bank Name<span className="text-red-500"> *</span></span>
            <select value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="fld3">
              {SUPPORTED_BANKS.map((b) => <option key={b.code} value={b.name}>{b.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-600 mb-1 block">Amount (UGX)<span className="text-red-500"> *</span></span>
            <input required type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="fld3" />
          </label>

          <div className="block">
            <span className="text-xs font-medium text-zinc-600 mb-1 block">Bank Slip Photo <span className="text-zinc-400 font-normal">(optional)</span></span>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
            <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />

            {preview ? (
              <div className="relative rounded-lg overflow-hidden ring-1 ring-zinc-200">
                <img src={preview} alt="Slip preview" className="w-full max-h-64 object-contain bg-zinc-50" />
                <button type="button" onClick={() => onPick(null)} className="absolute top-2 right-2 p-1.5 rounded-full bg-red-600 text-white hover:brightness-110"><X className="size-3.5" /></button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => camRef.current?.click()} className="flex flex-col items-center justify-center gap-1.5 py-6 rounded-lg border-2 border-dashed border-zinc-300 hover:border-brand hover:bg-brand/5 text-zinc-600 hover:text-brand transition">
                  <Camera className="size-6" />
                  <span className="text-xs font-medium">Take Photo</span>
                </button>
                <button type="button" onClick={() => galRef.current?.click()} className="flex flex-col items-center justify-center gap-1.5 py-6 rounded-lg border-2 border-dashed border-zinc-300 hover:border-brand hover:bg-brand/5 text-zinc-600 hover:text-brand transition">
                  <ImageIcon className="size-6" />
                  <span className="text-xs font-medium">From Gallery</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Uploading…" : "Submit for Review"}
            </button>
          </div>
        </form>
        <style>{`.fld3{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld3:focus{background:white;border-color:var(--color-brand)}`}</style>
      </motion.div>
    </motion.div>
  );
}
