import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDate } from "@/lib/format";
import { Plus, FileText, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { verifyUrl } from "@/lib/qr";
import { generateInvoicePDF } from "@/lib/pdf-branding";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => pageHead("Invoices", "Manage Hoima City Council tax invoices, due dates and outstanding balances."),
  component: InvoicesPage,
});

async function fetchInvoices(query: string, status: string) {
  let q = supabase.from("invoices").select("*, businesses(business_name, tin, owner_name)").is("deleted_at", null).order("created_at", { ascending: false }).limit(500);
  if (query) q = q.ilike("invoice_number", `%${query}%`);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function InvoicesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<Record<string, unknown> | null>(null);
  const defaultDue = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ business_id: "", tax_type: "Business License", amount: "50000", penalty: "0", discount: "0", financial_year: String(new Date().getFullYear()), due_date: defaultDue, notes: "" });
  const { data: businesses } = useQuery({ queryKey: ["businesses-list"], queryFn: async () => (await supabase.from("businesses").select("id, business_name, tin")).data || [] });
  const { data, isLoading } = useQuery({ queryKey: ["invoices", query, status], queryFn: () => fetchInvoices(query, status) });

  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    const ch = supabase.channel("invoices-live").on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, async (payload) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new as { id: string; invoice_number: string };
        const { data: full } = await supabase.from("invoices").select("*, businesses(business_name, tin, owner_name)").eq("id", row.id).maybeSingle();
        if (full) {
          qc.setQueriesData<Array<Record<string, unknown>>>({ queryKey: ["invoices"] }, (old) => {
            if (!old) return old;
            if (old.some((r) => (r as { id: string }).id === row.id)) return old;
            return [full as Record<string, unknown>, ...old];
          });
          setFlashId(row.id);
          setTimeout(() => setFlashId(null), 3000);
          toast.success(`🧾 New invoice ${row.invoice_number} received from field`, {
            action: { label: "Dismiss", onClick: () => {} },
            duration: 6000,
          });
          // Immediately open the full invoice details page
          navigate({ to: "/invoices/$id", params: { id: row.id } });
        }
      } else {
        qc.invalidateQueries({ queryKey: ["invoices"] });
      }
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, navigate]);


  const create = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("invoices").insert([{
        business_id: form.business_id || null,
        tax_type: form.tax_type,
        amount: Number(form.amount),
        penalty: Number(form.penalty),
        discount: Number(form.discount),
        financial_year: form.financial_year,
        due_date: form.due_date || null,
        notes: form.notes || null,
        issued_by: user.user?.id,
      }]);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Invoice created"); qc.invalidateQueries({ queryKey: ["invoices"] }); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });

  const markOverdue = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("mark_overdue_invoices");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`${n ?? 0} invoice(s) marked overdue`); qc.invalidateQueries({ queryKey: ["invoices"] }); },
    onError: (e) => toast.error(e.message),
  });

  const downloadPDF = async (inv: Record<string, unknown>) => {
    const b = inv.businesses as { business_name?: string; owner_name?: string; tin?: string; phone?: string; email?: string; physical_address?: string } | null;
    await generateInvoicePDF({
      invoice_number: String(inv.invoice_number),
      tax_type: String(inv.tax_type),
      amount: Number(inv.amount),
      penalty: Number(inv.penalty),
      discount: Number(inv.discount),
      paid_amount: Number(inv.paid_amount),
      status: String(inv.status),
      issue_date: inv.issue_date as string,
      due_date: (inv.due_date as string | null) ?? null,
      financial_year: (inv.financial_year as string | null) ?? null,
      businesses: b ?? null,
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader title="Invoices" description="Assessment invoices, taxes, and outstanding balances." actions={
        <div className="flex gap-2">
          <button onClick={() => markOverdue.mutate()} disabled={markOverdue.isPending} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50">{markOverdue.isPending ? "Checking…" : "Mark overdue"}</button>
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110"><Plus className="size-4" /> New Invoice</button>
        </div>
      } />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoice number…" className="w-full bg-white border border-zinc-200 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
        </div>
        <div className="flex gap-1.5 text-xs">
          {(["all", "pending", "partial", "paid", "overdue"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-md font-medium capitalize transition ${status === s ? "bg-brand text-white" : "bg-white ring-1 ring-black/5 text-zinc-600 hover:bg-zinc-50"}`}>{s}</button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
          (data || []).length === 0 ? <Empty title="No invoices yet" description="Issue an invoice to a registered taxpayer." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Invoice #</th>
                  <th className="px-6 py-3">Taxpayer</th>
                  <th className="px-6 py-3">Tax Type</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3 text-right">Balance</th>
                  <th className="px-6 py-3">Due</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-zinc-950/5">
                {(data || []).map((i) => {
                  const b = (i as { businesses?: { business_name?: string; tin?: string } }).businesses;
                  const total = Number(i.amount) + Number(i.penalty) - Number(i.discount);
                  const balance = total - Number(i.paid_amount);
                  const isPastDue = i.due_date && new Date(i.due_date as string) < new Date() && balance > 0;
                  const effectiveStatus = balance <= 0 ? "paid" : isPastDue ? "overdue" : i.status;
                  const daysDiff = i.due_date ? Math.ceil((new Date(i.due_date as string).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <tr key={i.id} className={`hover:bg-zinc-50/40 cursor-pointer transition-colors ${flashId === i.id ? "bg-emerald-50 animate-pulse" : ""}`} onClick={() => navigate({ to: "/invoices/$id", params: { id: i.id } })}>
                      <td className="px-6 py-3 font-mono text-xs font-semibold">{i.invoice_number}</td>
                      <td className="px-6 py-3"><div className="font-medium">{b?.business_name || "—"}</div><div className="text-[11px] text-zinc-500">{b?.tin || ""}</div></td>
                      <td className="px-6 py-3 text-xs">{i.tax_type}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{formatMoney(total)}</td>
                      <td className="px-6 py-3 text-right tabular-nums font-semibold">{formatMoney(balance)}</td>
                      <td className="px-6 py-3 text-xs">
                        <div className={isPastDue ? "text-rose-600 font-medium" : "text-zinc-500"}>{formatDate(i.due_date)}</div>
                        {daysDiff !== null && balance > 0 && (
                          <div className={`text-[10px] ${isPastDue ? "text-rose-500" : daysDiff <= 7 ? "text-amber-600" : "text-zinc-400"}`}>
                            {isPastDue ? `${Math.abs(daysDiff)}d overdue` : `${daysDiff}d left`}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3"><Badge tone={effectiveStatus === "paid" ? "success" : effectiveStatus === "overdue" ? "danger" : effectiveStatus === "partial" ? "warning" : "warning"}>{effectiveStatus}</Badge></td>
                      <td className="px-6 py-3">
                        <button onClick={(e) => { e.stopPropagation(); downloadPDF(i as Record<string, unknown>); }} className="p-1.5 rounded hover:bg-brand-light text-zinc-500 hover:text-brand"><Download className="size-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Create Invoice</h2>
              <p className="text-sm text-zinc-500 mb-5">Issue a new tax assessment.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Taxpayer</span>
                  <select required value={form.business_id} onChange={(e) => setForm({ ...form, business_id: e.target.value })} className="fld2">
                    <option value="">— Select —</option>
                    {(businesses || []).map((b) => <option key={b.id} value={b.id}>{b.business_name} · {b.tin}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Tax type</span>
                  <select value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })} className="fld2">
                    {["Business License","Hotel Levy","Service Levy","Property Tax","Signage Fee","Market Fee"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Amount</span><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="fld2" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Penalty</span><input type="number" value={form.penalty} onChange={(e) => setForm({ ...form, penalty: e.target.value })} className="fld2" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Discount</span><input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} className="fld2" /></label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Due date</span><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="fld2" /></label>
                  <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Financial year</span><input value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: e.target.value })} className="fld2" /></label>
                </div>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="fld2" placeholder="Optional assessment details or remarks" /></label>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={create.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{create.isPending ? "Creating…" : "Create Invoice"}</button>
                </div>
              </form>
              <style>{`.fld2{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fld2:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}

        {viewInvoice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewInvoice(null)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-8" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between border-b border-zinc-100 pb-4 mb-6">
                <div>
                  <div className="flex items-center gap-2"><div className="size-8 bg-brand rounded flex items-center justify-center"><FileText className="size-4 text-white" /></div><h2 className="text-lg font-semibold">Invoice {String(viewInvoice.invoice_number)}</h2></div>
                  <p className="text-xs text-zinc-500 mt-1">Municipal Tax Assessment</p>
                </div>
                <QRCodeSVG value={verifyUrl("invoice", String(viewInvoice.invoice_number))} size={72} />
              </div>
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div><div className="text-xs text-zinc-400 uppercase font-semibold mb-1">Taxpayer</div><div className="font-medium">{(viewInvoice.businesses as { business_name?: string })?.business_name || "—"}</div><div className="text-xs text-zinc-500 font-mono">{(viewInvoice.businesses as { tin?: string })?.tin || ""}</div></div>
                <div><div className="text-xs text-zinc-400 uppercase font-semibold mb-1">Tax Type</div><div>{String(viewInvoice.tax_type)}</div><div className="text-xs text-zinc-500">FY {String(viewInvoice.financial_year || "—")}</div></div>
                <div><div className="text-xs text-zinc-400 uppercase font-semibold mb-1">Issue Date</div><div>{formatDate(viewInvoice.issue_date as string)}</div></div>
                <div><div className="text-xs text-zinc-400 uppercase font-semibold mb-1">Due Date</div><div>{formatDate(viewInvoice.due_date as string | null)}</div></div>
              </div>
              <div className="mt-6 bg-zinc-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">Amount</span><span className="font-medium tabular-nums">{formatMoney(viewInvoice.amount as number)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Penalty</span><span className="tabular-nums">{formatMoney(viewInvoice.penalty as number)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Discount</span><span className="tabular-nums text-emerald-600">- {formatMoney(viewInvoice.discount as number)}</span></div>
                <div className="flex justify-between border-t border-zinc-200 pt-2 mt-2 font-semibold"><span>Balance</span><span className="tabular-nums text-brand">{formatMoney((Number(viewInvoice.amount) + Number(viewInvoice.penalty) - Number(viewInvoice.discount)) - Number(viewInvoice.paid_amount))}</span></div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => downloadPDF(viewInvoice)} className="px-4 py-2 border border-zinc-200 rounded-md text-sm font-medium hover:bg-zinc-50 flex items-center gap-2"><Download className="size-4" /> Download PDF</button>
                <button onClick={() => setViewInvoice(null)} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md">Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
