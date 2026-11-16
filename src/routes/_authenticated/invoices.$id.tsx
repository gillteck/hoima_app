import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, Skeleton } from "@/components/primitives";
import { formatMoney, formatDate, formatDateTime } from "@/lib/format";
import { ArrowLeft, Download, FileText, Printer, Plus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { verifyUrl } from "@/lib/qr";
import { generateInvoicePDF } from "@/lib/pdf-branding";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => pageHead("Invoice Details", "View an invoice, payment ledger and printable copy for Hoima City Council."),
  component: InvoiceDetailsPage,
});

async function fetchInvoice(id: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, businesses(business_name, tin, owner_name, phone, email, physical_address)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchPayments(invoiceId: string) {
  const { data } = await supabase
    .from("payments")
    .select("*, officers(full_name), pos_devices(serial_number)")
    .eq("invoice_id", invoiceId)
    .is("deleted_at", null)
    .order("paid_at", { ascending: false });
  return data || [];
}

function InvoiceDetailsPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: inv, isLoading, refetch } = useQuery({ queryKey: ["invoice", id], queryFn: () => fetchInvoice(id) });
  const { data: payments } = useQuery({ queryKey: ["invoice-payments", id], queryFn: () => fetchPayments(id) });
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", payment_method: "cash", reference_number: "" });

  useEffect(() => {
    const ch = supabase
      .channel(`invoice-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `id=eq.${id}` }, () => { refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `invoice_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["invoice-payments", id] });
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, refetch, router, qc]);

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!inv) throw new Error("Invoice not loaded");
      const { error } = await supabase.from("payments").insert([{
        invoice_id: id,
        business_id: (inv as { business_id?: string }).business_id ?? null,
        amount: Number(payForm.amount),
        payment_method: payForm.payment_method,
        reference_number: payForm.reference_number || null,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPayOpen(false);
      setPayForm({ amount: "", payment_method: "cash", reference_number: "" });
      qc.invalidateQueries({ queryKey: ["invoice-payments", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading) return <div className="p-8 max-w-4xl mx-auto space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (!inv) return <div className="p-8 max-w-4xl mx-auto"><Card className="p-8 text-center text-zinc-500">Invoice not found.</Card></div>;

  const b = (inv as { businesses?: { business_name?: string; tin?: string; owner_name?: string; phone?: string; email?: string; physical_address?: string } }).businesses;
  const total = Number(inv.amount) + Number(inv.penalty) - Number(inv.discount);
  const balance = total - Number(inv.paid_amount);

  const downloadPDF = async () => {
    await generateInvoicePDF({
      invoice_number: inv.invoice_number,
      tax_type: inv.tax_type,
      amount: Number(inv.amount),
      penalty: Number(inv.penalty),
      discount: Number(inv.discount),
      paid_amount: Number(inv.paid_amount),
      status: inv.status,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      financial_year: inv.financial_year,
      businesses: b ?? null,
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl mx-auto print:p-0">
      <div className="print:hidden">
        <Link to="/invoices" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-brand mb-2"><ArrowLeft className="size-4" /> Back to invoices</Link>
        <PageHeader title={`Invoice ${inv.invoice_number}`} description={`Issued ${formatDateTime(inv.issue_date)}`} actions={
          <div className="flex gap-2">
            {balance > 0 && inv.status !== "voided" && (
              <button onClick={() => { setPayForm({ amount: String(balance), payment_method: "cash", reference_number: "" }); setPayOpen(true); }} className="inline-flex items-center gap-2 bg-emerald-600 text-white px-3.5 py-2 rounded-md text-sm font-medium hover:brightness-110"><Plus className="size-4" /> Record Payment</button>
            )}
            <button
              onClick={async () => {
                try {
                  await downloadPDF();
                  toast.success("Invoice copy downloaded — open the PDF to print");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to generate copy");
                }
              }}
              title="Download a printable PDF copy of this invoice"
              className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110"
            >
              <Download className="size-4" /> <Printer className="size-4 -ml-1 opacity-80" /> Download / Print copy
            </button>
          </div>
        } />
      </div>

      <Card className="p-8">
        <div className="flex items-start justify-between border-b border-zinc-100 pb-6 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2"><div className="size-9 bg-brand rounded flex items-center justify-center"><FileText className="size-5 text-white" /></div><div><div className="text-xs uppercase text-zinc-400 font-semibold">Municipal Tax Invoice</div><div className="text-xl font-semibold">{inv.invoice_number}</div></div></div>
            <Badge tone={inv.status === "paid" ? "success" : inv.status === "overdue" ? "danger" : "warning"}>{inv.status}</Badge>
          </div>
          <QRCodeSVG value={verifyUrl("invoice", inv.invoice_number)} size={90} />
        </div>

        <div className="grid grid-cols-2 gap-8 text-sm mb-6">
          <div>
            <div className="text-xs text-zinc-400 uppercase font-semibold mb-2">Taxpayer</div>
            <div className="font-semibold text-base">{b?.business_name || "—"}</div>
            {b?.owner_name && <div className="text-zinc-600">{b.owner_name}</div>}
            {b?.tin && <div className="text-xs text-zinc-500 font-mono mt-1">TIN {b.tin}</div>}
            {b?.physical_address && <div className="text-xs text-zinc-500 mt-1">{b.physical_address}</div>}
            {b?.phone && <div className="text-xs text-zinc-500">{b.phone}</div>}
          </div>
          <div className="space-y-3">
            <div><div className="text-xs text-zinc-400 uppercase font-semibold">Tax Type</div><div>{inv.tax_type}</div></div>
            <div><div className="text-xs text-zinc-400 uppercase font-semibold">Financial Year</div><div>{inv.financial_year || "—"}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-zinc-400 uppercase font-semibold">Issue Date</div><div>{formatDate(inv.issue_date)}</div></div>
              <div><div className="text-xs text-zinc-400 uppercase font-semibold">Due Date</div><div>{formatDate(inv.due_date)}</div></div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 rounded-lg p-5 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-zinc-500">Amount</span><span className="font-medium tabular-nums">{formatMoney(inv.amount)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Penalty</span><span className="tabular-nums">{formatMoney(inv.penalty)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Discount</span><span className="tabular-nums text-emerald-600">- {formatMoney(inv.discount)}</span></div>
          <div className="flex justify-between border-t border-zinc-200 pt-2 mt-2"><span className="text-zinc-500">Total</span><span className="tabular-nums font-medium">{formatMoney(total)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Paid</span><span className="tabular-nums text-emerald-600">{formatMoney(inv.paid_amount)}</span></div>
          <div className="flex justify-between border-t border-zinc-200 pt-3 mt-2 text-base font-semibold"><span>Balance Due</span><span className="tabular-nums text-brand">{formatMoney(balance)}</span></div>
        </div>

        {(inv as { notes?: string | null }).notes && (
          <div className="mt-6 text-sm">
            <div className="text-xs text-zinc-400 uppercase font-semibold mb-1">Notes</div>
            <div className="whitespace-pre-wrap text-zinc-700">{(inv as { notes?: string }).notes}</div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Payment ledger</h2>
          <div className="text-xs text-zinc-500">
            {(payments || []).length} payment{(payments || []).length === 1 ? "" : "s"} · {formatMoney(inv.paid_amount)} of {formatMoney(total)} collected
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${balance <= 0 ? "bg-emerald-500" : "bg-brand"}`}
              style={{ width: `${total > 0 ? Math.min(100, (Number(inv.paid_amount) / total) * 100) : 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[11px] text-zinc-500 tabular-nums">
            <span>{total > 0 ? Math.round((Number(inv.paid_amount) / total) * 100) : 0}% paid</span>
            <span>{balance > 0 ? `${formatMoney(balance)} outstanding` : "Fully settled"}</span>
          </div>
        </div>

        {(payments || []).length === 0 ? (
          <div className="text-sm text-zinc-500 py-6 text-center border border-dashed border-zinc-200 rounded-lg">
            No payments recorded yet. The balance will update automatically as the taxpayer pays.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <tr className="text-left">
                <th className="py-2">#</th>
                <th className="py-2">Receipt</th>
                <th className="py-2">Method</th>
                <th className="py-2">Officer</th>
                <th className="py-2">Device</th>
                <th className="py-2">Paid at</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Balance after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(() => {
                // Oldest → newest to compute running balance, then render newest first.
                const asc = [...(payments || [])].sort((a, b) => new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime());
                let running = 0;
                const withBalance = asc.map((p, idx) => {
                  const counts = !["voided", "cancelled", "failed"].includes(String(p.status || "success"));
                  if (counts) running += Number(p.amount || 0);
                  return { ...p, _seq: idx + 1, _balanceAfter: Math.max(total - running, 0), _counts: counts };
                });
                return withBalance.slice().reverse().map((p) => (
                  <tr key={p.id} className={p._counts ? "" : "opacity-50"}>
                    <td className="py-2 text-xs text-zinc-400 tabular-nums">{p._seq}</td>
                    <td className="py-2 font-mono text-xs">{p.receipt_number}</td>
                    <td className="py-2 text-xs capitalize">{String(p.payment_method).replace("_", " ")}</td>
                    <td className="py-2 text-xs">{(p as { officers?: { full_name?: string } }).officers?.full_name || "—"}</td>
                    <td className="py-2 text-xs font-mono">{(p as { pos_devices?: { serial_number?: string } }).pos_devices?.serial_number || "—"}</td>
                    <td className="py-2 text-xs text-zinc-500">{formatDateTime(p.paid_at)}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-emerald-600">+ {formatMoney(p.amount)}</td>
                    <td className="py-2 text-right tabular-nums text-xs text-zinc-600">{formatMoney(p._balanceAfter)}</td>
                  </tr>
                ));
              })()}
              <tr className="bg-zinc-50 font-semibold">
                <td colSpan={6} className="py-2.5 px-2 text-xs uppercase text-zinc-500">Totals</td>
                <td className="py-2.5 text-right tabular-nums text-emerald-600">{formatMoney(inv.paid_amount)}</td>
                <td className="py-2.5 text-right tabular-nums text-brand">{formatMoney(balance)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>



      <AnimatePresence>
        {payOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden" onClick={() => setPayOpen(false)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Record Payment</h2>
              <p className="text-sm text-zinc-500 mb-5">Balance due: <span className="font-semibold text-zinc-900">{formatMoney(balance)}</span></p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); recordPayment.mutate(); }}>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Amount</span><input required type="number" min="1" step="1" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="fldi" /></label>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Method</span>
                  <select value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })} className="fldi">
                    {["cash","mobile_money","bank","card","pos"].map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-xs font-medium text-zinc-600 mb-1 block">Reference #</span><input value={payForm.reference_number} onChange={(e) => setPayForm({ ...payForm, reference_number: e.target.value })} className="fldi" placeholder="Transaction ID (optional)" /></label>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setPayOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={recordPayment.isPending} className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{recordPayment.isPending ? "Recording…" : "Record"}</button>
                </div>
              </form>
              <style>{`.fldi{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none}.fldi:focus{background:white;border-color:var(--color-brand)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
