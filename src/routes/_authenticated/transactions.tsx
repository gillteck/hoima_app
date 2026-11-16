import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Radio, Receipt, FileText, Download, Printer, Search, Smartphone, Phone, Trash2, AlertTriangle, RotateCcw, Archive } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import jsPDF from "jspdf";
import { QRCodeSVG } from "qrcode.react";
import { qrDataUrl, verifyUrl } from "@/lib/qr";
import { deleteTransaction, restoreTransaction } from "@/lib/transactions.functions";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => pageHead("Transactions", "Review and export Hoima City Council invoices and payment transactions."),
  component: TransactionsPage,
});

type Kind = "all" | "receipt" | "invoice";
type Row = {
  id: string;
  kind: "receipt" | "invoice";
  number: string;
  amount: number;
  status: string;
  method?: string;
  business?: string;
  tin?: string;
  officer?: string;
  device_serial?: string;
  device_type?: string;
  at: string;
  raw: Record<string, unknown>;
};

async function fetchReceipts(showDeleted: boolean): Promise<Record<string, unknown>[]> {
  const q = supabase
    .from("payments")
    .select("*, invoices(invoice_number), businesses(business_name, tin), officers(full_name), pos_devices(serial_number, device_type)")
    .order("paid_at", { ascending: false })
    .limit(200);
  const { data } = await (showDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null));
  return (data || []) as Record<string, unknown>[];
}
async function fetchInvoices(showDeleted: boolean): Promise<Record<string, unknown>[]> {
  const q = supabase
    .from("invoices")
    .select("*, businesses(business_name, tin, owner_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  const { data } = await (showDeleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null));
  return (data || []) as Record<string, unknown>[];
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) { toast.error("No transactions match the current filters."); return; }
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function TransactionsPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);
  const [selected, setSelected] = useState<Row | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const deleteFn = useServerFn(deleteTransaction);
  const restoreFn = useServerFn(restoreTransaction);

  const receipts = useQuery({
    queryKey: ["tx-receipts", showDeleted],
    queryFn: () => fetchReceipts(showDeleted),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const invoices = useQuery({
    queryKey: ["tx-invoices", showDeleted],
    queryFn: () => fetchInvoices(showDeleted),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const ch = supabase
      .channel("transactions-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payments" }, (p) => {
        const row = p.new as { id: string; receipt_number: string; amount: number };
        setLiveIds((s) => new Set(s).add(row.id));
        toast.success(`📩 Receipt ${row.receipt_number} · ${formatMoney(row.amount)}`, { description: "Copy received from POS" });
        void qc.invalidateQueries({ queryKey: ["tx-receipts"] });
        void qc.refetchQueries({ queryKey: ["tx-receipts"] });
        setTimeout(() => setLiveIds((s) => { const n = new Set(s); n.delete(row.id); return n; }), 10000);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "payments" }, () => {
        void qc.invalidateQueries({ queryKey: ["tx-receipts"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "invoices" }, (p) => {
        const row = p.new as { id: string; invoice_number: string; amount: number };
        setLiveIds((s) => new Set(s).add(row.id));
        toast.success(`🧾 Invoice ${row.invoice_number} · ${formatMoney(row.amount)}`, { description: "Copy received from field" });
        void qc.invalidateQueries({ queryKey: ["tx-invoices"] });
        void qc.refetchQueries({ queryKey: ["tx-invoices"] });
        setTimeout(() => setLiveIds((s) => { const n = new Set(s); n.delete(row.id); return n; }), 10000);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "invoices" }, () => {
        void qc.invalidateQueries({ queryKey: ["tx-invoices"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const deleteMsg = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("No transaction selected");
      await deleteFn({ data: { transaction_id: deleteTarget.id, kind: deleteTarget.kind } });
    },
    onSuccess: () => {
      toast.success(`${deleteTarget?.kind === "receipt" ? "Receipt" : "Invoice"} moved to trash`, { description: "You can restore it from the Deleted view." });
      void qc.invalidateQueries({ queryKey: ["tx-receipts"] });
      void qc.invalidateQueries({ queryKey: ["tx-invoices"] });
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete transaction"),
  });

  const restoreMsg = useMutation({
    mutationFn: async (r: Row) => {
      await restoreFn({ data: { transaction_id: r.id, kind: r.kind } });
    },
    onSuccess: (_d, r) => {
      toast.success(`${r.kind === "receipt" ? "Receipt" : "Invoice"} restored`);
      void qc.invalidateQueries({ queryKey: ["tx-receipts"] });
      void qc.invalidateQueries({ queryKey: ["tx-invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to restore transaction"),
  });

  const rows: Row[] = useMemo(() => {
    const rs: Row[] = (receipts.data || []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      kind: "receipt",
      number: p.receipt_number as string,
      amount: Number(p.amount),
      status: p.sync_status as string,
      method: p.payment_method as string,
      business: (p.businesses as { business_name?: string })?.business_name,
      tin: (p.businesses as { tin?: string })?.tin,
      officer: (p.officers as { full_name?: string })?.full_name,
      device_serial: (p.pos_devices as { serial_number?: string })?.serial_number,
      device_type: (p.pos_devices as { device_type?: string })?.device_type,
      at: p.paid_at as string,
      raw: p,
    }));
    const is: Row[] = (invoices.data || []).map((i: Record<string, unknown>) => ({
      id: i.id as string,
      kind: "invoice",
      number: i.invoice_number as string,
      amount: Number(i.amount),
      status: i.status as string,
      business: (i.businesses as { business_name?: string })?.business_name,
      tin: (i.businesses as { tin?: string })?.tin,
      at: (i.created_at as string) || (i.issue_date as string),
      raw: i,
    }));
    return [...rs, ...is]
      .filter((r) => kind === "all" || r.kind === kind)
      .filter((r) => method === "all" || (r.method || "").toLowerCase() === method)
      .filter((r) => status === "all" || (r.status || "").toLowerCase() === status)
      .filter((r) => {
        const t = new Date(r.at).getTime();
        return t >= new Date(fromDate).getTime() && t <= new Date(toDate).getTime() + 86400000;
      })
      .filter((r) => !query || r.number.toLowerCase().includes(query.toLowerCase()) || (r.business || "").toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [receipts.data, invoices.data, kind, query, method, status, fromDate, toDate]);

  const totals = useMemo(() => {
    const r = (receipts.data || []).reduce((s, p) => s + Number(p.amount), 0);
    const i = (invoices.data || []).reduce((s, x) => s + Number(x.amount), 0);
    return { receipts: r, invoices: i };
  }, [receipts.data, invoices.data]);

  const isLoading = receipts.isLoading || invoices.isLoading;

  const downloadPDF = (r: Row) => {
    if (r.kind === "receipt") receiptPDF(r);
    else invoicePDF(r);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Transactions"
        description="Every receipt and invoice issued from POS terminals and the mobile POS app streams here in real time."
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full ring-1 ring-emerald-200">
            <Radio className="size-3 animate-pulse" /> LIVE · POS stream
          </span>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Receipt className="size-5" /></div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Receipts</div>
              <div className="text-lg font-semibold tabular-nums">{(receipts.data || []).length}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">Collected · <span className="font-semibold text-zinc-800">{formatMoney(totals.receipts)}</span></div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-brand-light text-brand flex items-center justify-center"><FileText className="size-5" /></div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Invoices</div>
              <div className="text-lg font-semibold tabular-nums">{(invoices.data || []).length}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">Billed · <span className="font-semibold text-zinc-800">{formatMoney(totals.invoices)}</span></div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Radio className="size-5 animate-pulse" /></div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Live in last 10s</div>
              <div className="text-lg font-semibold tabular-nums">{liveIds.size}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">Copies received directly from field devices</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5 text-xs">
          {(["all", "receipt", "invoice"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-md font-medium transition ${kind === k ? "bg-brand text-white" : "bg-white ring-1 ring-black/5 text-zinc-600 hover:bg-zinc-50"}`}>
              {k === "all" ? "All" : k === "receipt" ? "Receipts" : "Invoices"}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number or taxpayer…" className="w-full bg-white border border-zinc-200 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
        </div>
        <button
          onClick={() => setShowDeleted((v) => !v)}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition ${showDeleted ? "bg-amber-500 text-white ring-1 ring-amber-500" : "bg-white ring-1 ring-black/5 text-zinc-600 hover:bg-zinc-50"}`}
          title="Toggle deleted (trash) view"
        >
          <Archive className="size-3.5" /> {showDeleted ? "Viewing Deleted" : "Show Deleted"}
        </button>
        <div className="flex items-center gap-1.5 text-xs">
          <label className="text-zinc-500">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-white border border-zinc-200 rounded-md py-1.5 px-2 text-xs" />
          <label className="text-zinc-500">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-white border border-zinc-200 rounded-md py-1.5 px-2 text-xs" />
        </div>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="bg-white border border-zinc-200 rounded-md py-1.5 px-2 text-xs">
          <option value="all">All methods</option>
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile money</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-white border border-zinc-200 rounded-md py-1.5 px-2 text-xs">
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="synced">Synced</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
        </select>
        <button
          onClick={() => downloadCSV(`transactions_${fromDate}_to_${toDate}.csv`, rows.map((r) => ({
            type: r.kind, number: r.number, taxpayer: r.business || "Walk-in", tin: r.tin || "",
            officer: r.officer || "", device: r.device_serial || "",
            method: r.method || "", status: r.status, amount_ugx: r.amount, at: r.at,
          })))}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand/90"
        >
          <Download className="size-3.5" /> Download ({rows.length})
        </button>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-6 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
          rows.length === 0 ? <Empty title="No transactions yet" description="Receipts and invoices issued in the field will appear here instantly." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Number</th>
                    <th className="px-6 py-3">Taxpayer</th>
                    <th className="px-6 py-3">Source</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Received</th>
                    <th className="px-6 py-3 w-32 text-right">Copy</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-zinc-950/5">
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className={`hover:bg-zinc-50/40 ${liveIds.has(r.id) ? "bg-emerald-50/60" : ""}`}>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${r.kind === "receipt" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-brand-light text-brand ring-brand/20"}`}>
                          {r.kind === "receipt" ? <Receipt className="size-3" /> : <FileText className="size-3" />} {r.kind}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-mono text-xs font-semibold">
                        {liveIds.has(r.id) && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        {r.number}
                      </td>
                      <td className="px-6 py-3">{r.business || "Walk-in"} <span className="text-zinc-400 text-xs">{r.tin && `· ${r.tin}`}</span></td>
                      <td className="px-6 py-3 text-xs text-zinc-600">
                        {r.device_serial ? (
                          <span className="inline-flex items-center gap-1.5">
                            {r.device_type === "mobile_phone" ? <Phone className="size-3" /> : <Smartphone className="size-3" />}
                            {r.device_serial}
                          </span>
                        ) : r.officer ? r.officer : "System"}
                      </td>
                      <td className="px-6 py-3 text-right font-semibold tabular-nums">{formatMoney(r.amount)}</td>
                      <td className="px-6 py-3"><Badge tone={r.status === "paid" || r.status === "synced" ? "success" : r.status === "pending" || r.status === "partial" ? "warning" : r.status === "overdue" ? "danger" : "neutral"}>{r.status}</Badge></td>
                      <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(r.at)}</td>
                      <td className="px-6 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setSelected(r)} className="text-xs px-2.5 py-1 rounded border border-zinc-200 hover:bg-zinc-50 font-medium">View</button>
                          <button onClick={() => downloadPDF(r)} className="p-1.5 rounded hover:bg-brand-light text-zinc-500 hover:text-brand" title="Download PDF"><Download className="size-4" /></button>
                          {showDeleted ? (
                            <button
                              onClick={() => restoreMsg.mutate(r)}
                              disabled={restoreMsg.isPending}
                              className="p-1.5 rounded hover:bg-emerald-50 text-zinc-500 hover:text-emerald-600 disabled:opacity-50"
                              title="Restore transaction"
                            >
                              <RotateCcw className="size-4" />
                            </button>
                          ) : (
                            <button onClick={() => setDeleteTarget(r)} className="p-1.5 rounded hover:bg-red-50 text-zinc-500 hover:text-red-600" title="Delete transaction"><Trash2 className="size-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {/* Copy modal */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`size-10 rounded-lg flex items-center justify-center ${selected.kind === "receipt" ? "bg-emerald-50 text-emerald-600" : "bg-brand-light text-brand"}`}>
                    {selected.kind === "receipt" ? <Receipt className="size-5" /> : <FileText className="size-5" />}
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-zinc-400 font-mono">{selected.kind === "receipt" ? "Payment Receipt Copy" : "Invoice Copy"}</div>
                    <div className="font-semibold">{selected.number}</div>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none">×</button>
              </div>
              <div className="p-6 bg-zinc-50 border-b border-zinc-100">
                <div className="bg-white rounded-lg p-5 shadow-sm ring-1 ring-black/5 font-mono text-xs space-y-1.5 max-w-sm mx-auto">
                  <div className="text-center pb-2 border-b border-dashed border-zinc-300">
                    <div className="font-bold text-sm">HOIMA CITY COUNCIL</div>
                    <div className="text-[10px] text-zinc-500">Revenue Management System</div>
                  </div>
                  <Row2 k={selected.kind === "receipt" ? "Receipt #" : "Invoice #"} v={selected.number} />
                  <Row2 k="Date" v={formatDateTime(selected.at)} />
                  <Row2 k="Taxpayer" v={selected.business || "Walk-in"} />
                  {selected.tin && <Row2 k="TIN" v={selected.tin} />}
                  {selected.officer && <Row2 k="Officer" v={selected.officer} />}
                  {selected.device_serial && <Row2 k="Device" v={`${selected.device_type === "mobile_phone" ? "📱 " : "🖨 "}${selected.device_serial}`} />}
                  {selected.method && <Row2 k="Method" v={selected.method} />}
                  <Row2 k="Status" v={selected.status} />
                  <div className="border-t border-dashed border-zinc-300 pt-2 mt-2 text-center">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Amount</div>
                    <div className="text-lg font-bold tabular-nums">{formatMoney(selected.amount)}</div>
                  </div>
                  <div className="flex flex-col items-center gap-1 pt-2 border-t border-dashed border-zinc-300">
                    <QRCodeSVG value={verifyUrl(selected.kind, selected.number)} size={90} level="M" />
                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider">Scan to verify</div>
                  </div>
                  <div className="text-center text-[10px] text-zinc-500 pt-2 border-t border-dashed border-zinc-300">Thank you for your contribution</div>
                </div>
              </div>
              <div className="p-4 flex justify-end gap-2">
                <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md ring-1 ring-zinc-200 hover:bg-zinc-50"><Printer className="size-4" /> Print</button>
                <button onClick={() => downloadPDF(selected)} className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110"><Download className="size-4" /> Download PDF</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-zinc-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center"><AlertTriangle className="size-5" /></div>
                  <div>
                    <h2 className="text-lg font-semibold">Delete {deleteTarget.kind === "receipt" ? "Receipt" : "Invoice"}</h2>
                    <p className="text-xs text-zinc-500">{deleteTarget.number}</p>
                  </div>
                </div>
                <p className="text-sm text-zinc-600 mb-6">
                  This {deleteTarget.kind} will be moved to the trash. It stops counting toward totals and device balances immediately, and any linked invoice will be recalculated. You can restore it later from the <span className="font-semibold">Show Deleted</span> view.
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
                  <p className="text-sm font-semibold text-red-900">
                    {deleteTarget.kind === "receipt" ? "Receipt" : "Invoice"} {deleteTarget.number} · {formatMoney(deleteTarget.amount)}
                  </p>
                  <p className="text-xs text-red-700 mt-1">{deleteTarget.business || "Walk-in"}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button
                    onClick={() => deleteMsg.mutate()}
                    disabled={deleteMsg.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" /> {deleteMsg.isPending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row2({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{k}</span>
      <span className="font-semibold text-zinc-800 text-right">{v}</span>
    </div>
  );
}

async function receiptPDF(r: Row) {
  const doc = new jsPDF({ unit: "mm", format: [80, 220] });
  doc.setFontSize(11); doc.text("HOIMA CITY COUNCIL", 40, 10, { align: "center" });
  doc.setFontSize(8); doc.text("Payment Receipt (Copy)", 40, 15, { align: "center" });
  doc.line(5, 18, 75, 18);
  let y = 24;
  const line = (label: string, val: string) => { doc.text(`${label}: ${val}`, 5, y); y += 6; };
  line("Receipt", r.number);
  line("Date", formatDateTime(r.at));
  line("Taxpayer", r.business || "Walk-in");
  if (r.tin) line("TIN", r.tin);
  if (r.officer) line("Officer", r.officer);
  if (r.device_serial) line("Device", r.device_serial);
  if (r.method) line("Method", r.method);
  doc.line(5, y, 75, y); y += 8;
  doc.setFontSize(13); doc.text(formatMoney(r.amount), 40, y, { align: "center" }); y += 6;
  const qr = await qrDataUrl(verifyUrl("receipt", r.number), 200);
  doc.addImage(qr, "PNG", 25, y, 30, 30); y += 32;
  doc.setFontSize(7); doc.text("Scan to verify", 40, y, { align: "center" }); y += 6;
  doc.setFontSize(8); doc.text("Thank you for your contribution", 40, y, { align: "center" });
  doc.save(`${r.number}.pdf`);
}

async function invoicePDF(r: Row) {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  doc.setFontSize(14); doc.text("HOIMA CITY COUNCIL", 74, 15, { align: "center" });
  doc.setFontSize(9); doc.text("Tax Invoice (Copy)", 74, 21, { align: "center" });
  doc.line(10, 25, 138, 25);
  doc.setFontSize(10);
  let y = 34;
  const line = (label: string, val: string) => { doc.text(`${label}:`, 12, y); doc.text(val, 45, y); y += 7; };
  line("Invoice #", r.number);
  line("Date", formatDateTime(r.at));
  line("Taxpayer", r.business || "—");
  if (r.tin) line("TIN", r.tin);
  line("Status", r.status);
  doc.line(10, y, 138, y); y += 10;
  doc.setFontSize(12); doc.text("Amount Due", 12, y); doc.text(formatMoney(r.amount), 138, y, { align: "right" }); y += 10;
  const qr = await qrDataUrl(verifyUrl("invoice", r.number), 220);
  doc.addImage(qr, "PNG", 12, y, 32, 32);
  doc.setFontSize(8); doc.text("Scan to verify", 28, y + 36, { align: "center" });
  doc.save(`${r.number}.pdf`);
}
