import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Plus, Download, Search, Radio } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { generateReceiptPDF } from "@/lib/pdf-branding";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => pageHead("Payments & Receipts", "Review municipal tax payments and receipts for Hoima City Council."),
  component: PaymentsPage,
});

async function fetchPayments(query: string) {
  let q = supabase.from("payments").select("*, invoices(invoice_number, tax_type, financial_year, amount, penalty, discount, paid_amount, status), businesses(business_name, tin, owner_name, physical_address), officers(full_name, employee_id), pos_devices(serial_number)").is("deleted_at", null).order("paid_at", { ascending: false }).limit(300);
  if (query) q = q.ilike("receipt_number", `%${query}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function PaymentsPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ invoice_id: "", amount: "", payment_method: "cash", reference_number: "" });
  const { data: invoices } = useQuery({ queryKey: ["unpaid-invoices"], queryFn: async () => (await supabase.from("invoices").select("id, invoice_number, amount, paid_amount, business_id, businesses(business_name)").is("deleted_at", null).neq("status", "paid").limit(200)).data || [] });
  const { data, isLoading } = useQuery({ queryKey: ["payments", query], queryFn: () => fetchPayments(query), refetchInterval: 15000, refetchOnWindowFocus: true });

  // Live receipts from POS terminals & mobile POS app
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const start = async () => {
      // Realtime respects RLS — the socket needs the current access token.
      const { data: s } = await supabase.auth.getSession();
      if (s.session?.access_token) await supabase.realtime.setAuth(s.session.access_token);
      if (cancelled) return;

      const refresh = () => {
        qc.invalidateQueries({ queryKey: ["payments"] });
        qc.invalidateQueries({ queryKey: ["unpaid-invoices"] });
        qc.invalidateQueries({ queryKey: ["invoices"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      };

      ch = supabase
        .channel("payments-live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "payments" }, (payload) => {
          const row = payload.new as { id: string; receipt_number: string; amount: number };
          setLiveIds((prev) => { const n = new Set(prev); n.add(row.id); return n; });
          toast.success(`📩 New receipt ${row.receipt_number} · ${formatMoney(row.amount)}`, { description: "Issued from POS terminal" });
          refresh();
          setTimeout(() => setLiveIds((prev) => { const n = new Set(prev); n.delete(row.id); return n; }), 8000);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "payments" }, refresh)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "payments" }, refresh)
        .subscribe();
    };

    start();
    return () => { cancelled = true; if (ch) supabase.removeChannel(ch); };
  }, [qc]);


  const create = useMutation({
    mutationFn: async () => {
      const inv = (invoices || []).find((i) => i.id === form.invoice_id);
      const { error } = await supabase.from("payments").insert([{
        invoice_id: form.invoice_id || null,
        business_id: inv?.business_id || null,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        reference_number: form.reference_number || null,
      }]);
      if (error) throw error;
      // paid_amount + status are updated automatically by tg_payments_sync_invoice
    },
    onSuccess: () => { toast.success("Payment recorded"); qc.invalidateQueries({ queryKey: ["payments"] }); qc.invalidateQueries({ queryKey: ["unpaid-invoices"] }); qc.invalidateQueries({ queryKey: ["invoices"] }); setOpen(false); setForm({ invoice_id: "", amount: "", payment_method: "cash", reference_number: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const receiptPDF = async (p: Record<string, unknown>) => {
    await generateReceiptPDF(p as Parameters<typeof generateReceiptPDF>[0]);
  };

  const total = (data || []).reduce((a, p) => a + Number(p.amount), 0);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader title="Payments & Live Receipts" description={`Total collected · ${formatMoney(total)}`} actions={
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full ring-1 ring-emerald-200">
            <Radio className="size-3 animate-pulse" /> LIVE · POS stream
          </span>
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110"><Plus className="size-4" /> Record Payment</button>
        </div>
      } />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search receipt number…" className="w-full bg-white border border-zinc-200 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
          (data || []).length === 0 ? <Empty title="No payments recorded" description="Record a payment against an invoice to see it here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Receipt</th>
                  <th className="px-6 py-3">Invoice</th>
                  <th className="px-6 py-3">Taxpayer</th>
                  <th className="px-6 py-3">Officer</th>
                  <th className="px-6 py-3">Method</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3">Sync</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-zinc-950/5">
                {(data || []).map((p) => (
                  <tr key={p.id} className={`hover:bg-zinc-50/40 ${liveIds.has(p.id) ? "bg-emerald-50/60 animate-pulse" : ""}`}>
                    <td className="px-6 py-3 font-mono text-xs font-semibold">
                      {liveIds.has(p.id) && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />}
                      {p.receipt_number}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs">{(p.invoices as { invoice_number?: string })?.invoice_number || "—"}</td>
                    <td className="px-6 py-3">{(p.businesses as { business_name?: string })?.business_name || "Walk-in"}</td>
                    <td className="px-6 py-3 text-zinc-600">{(p.officers as { full_name?: string })?.full_name || "System"}</td>
                    <td className="px-6 py-3 text-xs capitalize">{p.payment_method}</td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums">{formatMoney(p.amount)}</td>
                    <td className="px-6 py-3"><Badge tone={p.sync_status === "synced" ? "success" : p.sync_status === "pending" ? "warning" : "danger"}>{p.sync_status}</Badge></td>
                    <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(p.paid_at)}</td>
                    <td className="px-6 py-3"><button onClick={() => receiptPDF(p as Record<string, unknown>)} className="p-1.5 rounded hover:bg-brand-light text-zinc-500 hover:text-brand"><Download className="size-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Record Payment</h2>
              <p className="text-sm text-zinc-500 mb-5">Log a payment against an outstanding invoice.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Invoice</span>
                  <select required value={form.invoice_id} onChange={(e) => { const inv = (invoices||[]).find(i => i.id === e.target.value); setForm({ ...form, invoice_id: e.target.value, amount: inv ? String(Number(inv.amount) - Number(inv.paid_amount)) : "" }); }} className="fld3">
                    <option value="">— Select invoice —</option>
                    {(invoices || []).map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {(i as { businesses?: { business_name?: string } }).businesses?.business_name} · {formatMoney(Number(i.amount) - Number(i.paid_amount))}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Amount (TZS)</span><input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="fld3" /></label>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Method</span>
                  <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="fld3">
                    {["cash","mobile_money","bank","card","pos"].map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Reference #</span><input value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} className="fld3" placeholder="Transaction ID" /></label>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{create.isPending ? "Recording…" : "Record"}</button>
                </div>
              </form>
              <style>{`.fld3{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld3:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
