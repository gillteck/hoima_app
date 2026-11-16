import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge, Empty, Skeleton, StatCard } from "@/components/primitives";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useMemo, useState } from "react";
import { Search, User, Users, Download } from "lucide-react";

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) { alert("No rows to export for the current filters."); return; }
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => pageHead("Audit & Accountability", "Review Hoima City Council collection records, officer activity and taxpayer balances."),
  component: AuditPage,
});

function AuditPage() {
  const [q, setQ] = useState("");
  const [officerId, setOfficerId] = useState<string>("all");
  const [taxpayerId, setTaxpayerId] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { data: officers } = useQuery({
    queryKey: ["audit-officers"],
    queryFn: async () => (await supabase.from("officers").select("id, full_name, employee_id").order("full_name")).data || [],
  });

  const { data: taxpayers } = useQuery({
    queryKey: ["audit-taxpayers"],
    queryFn: async () => (await supabase.from("businesses").select("id, business_name, owner_name").order("business_name")).data || [],
  });

  const { data: audit, isLoading } = useQuery({
    queryKey: ["audit", q],
    queryFn: async () => {
      let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500);
      if (q) query = query.or(`action.ilike.%${q}%,user_name.ilike.%${q}%,table_name.ilike.%${q}%`);
      return (await query).data || [];
    },
  });

  const fromIso = new Date(fromDate + "T00:00:00").toISOString();
  const toIso = new Date(toDate + "T23:59:59").toISOString();

  const { data: officerPayments } = useQuery({
    queryKey: ["audit-officer-payments", officerId, fromDate, toDate],
    enabled: officerId !== "all",
    queryFn: async () => {
      const { data } = await supabase.from("payments")
        .select("id, receipt_number, amount, payment_method, status, paid_at, business_id, invoice_id")
        .eq("officer_id", officerId)
        .is("deleted_at", null)
        .gte("paid_at", fromIso).lte("paid_at", toIso)
        .order("paid_at", { ascending: false });
      return data || [];
    },
  });

  const { data: taxpayerData } = useQuery({
    queryKey: ["audit-taxpayer", taxpayerId, fromDate, toDate],
    enabled: taxpayerId !== "all",
    queryFn: async () => {
      const [{ data: invs }, { data: pays }] = await Promise.all([
        supabase.from("invoices")
          .select("id, invoice_number, tax_type, amount, penalty, discount, paid_amount, status, issue_date, due_date")
          .eq("business_id", taxpayerId)
          .is("deleted_at", null)
          .order("issue_date", { ascending: false }),
        supabase.from("payments")
          .select("id, receipt_number, amount, payment_method, status, paid_at, invoice_id, officer_id")
          .eq("business_id", taxpayerId)
          .is("deleted_at", null)
          .order("paid_at", { ascending: false }),
      ]);
      return { invoices: invs || [], payments: pays || [] };
    },
  });

  const officerSummary = useMemo(() => {
    const rows = (officerPayments || []).filter((p: any) => p.status === "success");
    const total = rows.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const byMethod = new Map<string, number>();
    rows.forEach((p: any) => byMethod.set(p.payment_method, (byMethod.get(p.payment_method) || 0) + Number(p.amount)));
    return { total, count: rows.length, byMethod: Array.from(byMethod.entries()) };
  }, [officerPayments]);

  const taxpayerSummary = useMemo(() => {
    if (!taxpayerData) return null;
    const invoiced = taxpayerData.invoices.reduce((s, i: any) => s + Number(i.amount) + Number(i.penalty) - Number(i.discount), 0);
    const paid = taxpayerData.invoices.reduce((s, i: any) => s + Number(i.paid_amount), 0);
    const outstanding = Math.max(0, invoiced - paid);
    const overdue = taxpayerData.invoices.filter((i: any) => i.status === "overdue").length;
    return { invoiced, paid, outstanding, overdue, invoiceCount: taxpayerData.invoices.length };
  }, [taxpayerData]);

  const bizById = new Map((taxpayers || []).map((b: any) => [b.id, b]));
  const offById = new Map((officers || []).map((o: any) => [o.id, o]));

  const { data: allTx } = useQuery({
    queryKey: ["audit-all-tx", officerId, taxpayerId, fromDate, toDate],
    queryFn: async () => {
      let q1 = supabase.from("payments")
        .select("id, receipt_number, amount, payment_method, status, paid_at, business_id, officer_id, invoice_id, reference_number")
        .is("deleted_at", null)
        .gte("paid_at", fromIso).lte("paid_at", toIso)
        .order("paid_at", { ascending: false });
      if (officerId !== "all") q1 = q1.eq("officer_id", officerId);
      if (taxpayerId !== "all") q1 = q1.eq("business_id", taxpayerId);
      return (await q1).data || [];
    },
  });

  const exportAllTx = () => {
    const rows = (allTx || []).map((p: any) => ({
      receipt_number: p.receipt_number,
      paid_at: p.paid_at,
      taxpayer: (bizById.get(p.business_id) as any)?.business_name || "",
      officer: (offById.get(p.officer_id) as any)?.full_name || "",
      payment_method: p.payment_method,
      status: p.status,
      amount_ugx: p.amount,
      reference: p.reference_number || "",
      invoice_id: p.invoice_id || "",
    }));
    downloadCSV(`transactions_${fromDate}_to_${toDate}.csv`, rows);
  };

  const exportAuditLog = () => {
    const rows = (audit || []).map((a: any) => ({
      when: a.created_at, user: a.user_name || "System", role: a.role || "",
      action: a.action, table: a.table_name || "", record_id: a.record_id || "",
      ip: a.ip_address || "", browser: a.browser || "",
    }));
    downloadCSV(`audit_log.csv`, rows);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader title="Audit & Accountability" description="Track collections by officer, invoicing and balances by taxpayer, and every system action." />

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1"><User className="size-3" /> Revenue Officer</label>
            <select value={officerId} onChange={(e) => setOfficerId(e.target.value)} className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All officers</option>
              {(officers || []).map((o: any) => <option key={o.id} value={o.id}>{o.full_name} ({o.employee_id})</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1"><Users className="size-3" /> Taxpayer</label>
            <select value={taxpayerId} onChange={(e) => setTaxpayerId(e.target.value)} className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All taxpayers</option>
              {(taxpayers || []).map((b: any) => <option key={b.id} value={b.id}>{b.business_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
          <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mr-2">Download</span>
          <button onClick={exportAllTx} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand text-white rounded-md hover:bg-brand/90">
            <Download className="size-3.5" /> Transactions ({(allTx || []).length})
          </button>
          {officerId !== "all" && (
            <button onClick={() => downloadCSV(`officer_${(offById.get(officerId) as any)?.employee_id || officerId}_${fromDate}_to_${toDate}.csv`, (officerPayments || []).map((p: any) => ({ receipt_number: p.receipt_number, paid_at: p.paid_at, taxpayer: (bizById.get(p.business_id) as any)?.business_name || "", payment_method: p.payment_method, status: p.status, amount_ugx: p.amount })))} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white ring-1 ring-zinc-200 rounded-md hover:bg-zinc-50">
              <Download className="size-3.5" /> Officer collections
            </button>
          )}
          {taxpayerId !== "all" && (
            <>
              <button onClick={() => downloadCSV(`taxpayer_invoices_${taxpayerId}.csv`, (taxpayerData?.invoices || []).map((i: any) => ({ invoice_number: i.invoice_number, tax_type: i.tax_type, issue_date: i.issue_date, due_date: i.due_date, status: i.status, demanded_ugx: Number(i.amount)+Number(i.penalty)-Number(i.discount), paid_ugx: i.paid_amount, balance_ugx: Math.max(0, Number(i.amount)+Number(i.penalty)-Number(i.discount)-Number(i.paid_amount)) })))} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white ring-1 ring-zinc-200 rounded-md hover:bg-zinc-50">
                <Download className="size-3.5" /> Taxpayer invoices
              </button>
              <button onClick={() => downloadCSV(`taxpayer_payments_${taxpayerId}.csv`, (taxpayerData?.payments || []).map((p: any) => ({ receipt_number: p.receipt_number, paid_at: p.paid_at, officer: (offById.get(p.officer_id) as any)?.full_name || "", payment_method: p.payment_method, amount_ugx: p.amount })))} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white ring-1 ring-zinc-200 rounded-md hover:bg-zinc-50">
                <Download className="size-3.5" /> Taxpayer payments
              </button>
            </>
          )}
          <button onClick={exportAuditLog} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white ring-1 ring-zinc-200 rounded-md hover:bg-zinc-50">
            <Download className="size-3.5" /> Activity log
          </button>
        </div>
      </Card>

      {officerId !== "all" && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900">Officer Collections — {(offById.get(officerId) as any)?.full_name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total Collected" value={formatMoney(officerSummary.total)} />
            <StatCard label="Transactions" value={String(officerSummary.count)} />
            <StatCard label="Payment Methods" value={String(officerSummary.byMethod.length)} />
          </div>
          {officerSummary.byMethod.length > 0 && (
            <Card className="p-4">
              <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Breakdown by method</div>
              <div className="flex flex-wrap gap-2">
                {officerSummary.byMethod.map(([m, v]) => (
                  <div key={m} className="px-3 py-1.5 bg-zinc-50 rounded-md text-xs ring-1 ring-zinc-200">
                    <span className="font-semibold capitalize">{m}</span>: <span className="text-zinc-600">{formatMoney(v)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card className="overflow-hidden">
            {(officerPayments || []).length === 0 ? <Empty title="No collections in this range" /> : (
              <table className="w-full text-left">
                <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3">Receipt</th>
                    <th className="px-6 py-3">When</th>
                    <th className="px-6 py-3">Taxpayer</th>
                    <th className="px-6 py-3">Method</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-zinc-950/5">
                  {(officerPayments || []).map((p: any) => (
                    <tr key={p.id} className="hover:bg-zinc-50/40">
                      <td className="px-6 py-3 font-mono text-xs">{p.receipt_number}</td>
                      <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(p.paid_at)}</td>
                      <td className="px-6 py-3">{(bizById.get(p.business_id) as any)?.business_name || "—"}</td>
                      <td className="px-6 py-3 capitalize">{p.payment_method}</td>
                      <td className="px-6 py-3"><Badge tone={p.status === "success" ? "success" : "warning"}>{p.status}</Badge></td>
                      <td className="px-6 py-3 text-right font-semibold">{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      )}

      {taxpayerId !== "all" && taxpayerSummary && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900">Taxpayer Ledger — {(bizById.get(taxpayerId) as any)?.business_name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="Total Invoiced (Demanded)" value={formatMoney(taxpayerSummary.invoiced)} />
            <StatCard label="Total Paid" value={formatMoney(taxpayerSummary.paid)} />
            <StatCard label="Outstanding Balance" value={formatMoney(taxpayerSummary.outstanding)} />
            <StatCard label="Overdue Invoices" value={String(taxpayerSummary.overdue)} />
          </div>
          <Card className="overflow-hidden">
            <div className="px-6 py-3 text-[11px] font-bold text-zinc-500 uppercase tracking-wider bg-zinc-50/70">Invoices</div>
            {(taxpayerData?.invoices || []).length === 0 ? <Empty title="No invoices" /> : (
              <table className="w-full text-left">
                <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3">Invoice #</th>
                    <th className="px-6 py-3">Tax Type</th>
                    <th className="px-6 py-3">Issued</th>
                    <th className="px-6 py-3">Due</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Demanded</th>
                    <th className="px-6 py-3 text-right">Paid</th>
                    <th className="px-6 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-zinc-950/5">
                  {(taxpayerData?.invoices || []).map((i: any) => {
                    const demanded = Number(i.amount) + Number(i.penalty) - Number(i.discount);
                    const balance = Math.max(0, demanded - Number(i.paid_amount));
                    return (
                      <tr key={i.id} className="hover:bg-zinc-50/40">
                        <td className="px-6 py-3 font-mono text-xs">{i.invoice_number}</td>
                        <td className="px-6 py-3">{i.tax_type}</td>
                        <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(i.issue_date)}</td>
                        <td className="px-6 py-3 text-xs text-zinc-500">{i.due_date ? formatDateTime(i.due_date) : "—"}</td>
                        <td className="px-6 py-3"><Badge tone={i.status === "paid" ? "success" : i.status === "overdue" ? "danger" : "warning"}>{i.status}</Badge></td>
                        <td className="px-6 py-3 text-right">{formatMoney(demanded)}</td>
                        <td className="px-6 py-3 text-right text-emerald-700">{formatMoney(i.paid_amount)}</td>
                        <td className="px-6 py-3 text-right font-semibold">{formatMoney(balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="overflow-hidden">
            <div className="px-6 py-3 text-[11px] font-bold text-zinc-500 uppercase tracking-wider bg-zinc-50/70">Payments</div>
            {(taxpayerData?.payments || []).length === 0 ? <Empty title="No payments" /> : (
              <table className="w-full text-left">
                <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3">Receipt</th>
                    <th className="px-6 py-3">When</th>
                    <th className="px-6 py-3">Officer</th>
                    <th className="px-6 py-3">Method</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-zinc-950/5">
                  {(taxpayerData?.payments || []).map((p: any) => (
                    <tr key={p.id} className="hover:bg-zinc-50/40">
                      <td className="px-6 py-3 font-mono text-xs">{p.receipt_number}</td>
                      <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(p.paid_at)}</td>
                      <td className="px-6 py-3">{(offById.get(p.officer_id) as any)?.full_name || "—"}</td>
                      <td className="px-6 py-3 capitalize">{p.payment_method}</td>
                      <td className="px-6 py-3 text-right font-semibold">{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Activity Log</h2>
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, user, table…" className="w-full bg-white border border-zinc-200 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
        </div>
        <Card className="overflow-hidden">
          {isLoading ? <div className="p-6 space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
            (audit || []).length === 0 ? <Empty title="No audit entries yet" description="System actions will be logged here automatically." /> : (
            <table className="w-full text-left">
              <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">When</th>
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Action</th>
                  <th className="px-6 py-3">Table</th>
                  <th className="px-6 py-3">Record</th>
                  <th className="px-6 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-zinc-950/5">
                {(audit || []).map((a: any) => (
                  <tr key={a.id} className="hover:bg-zinc-50/40">
                    <td className="px-6 py-3 text-xs text-zinc-500">{formatDateTime(a.created_at)}</td>
                    <td className="px-6 py-3">{a.user_name || "System"}</td>
                    <td className="px-6 py-3"><Badge tone="info">{a.role || "—"}</Badge></td>
                    <td className="px-6 py-3 font-medium">{a.action}</td>
                    <td className="px-6 py-3 font-mono text-xs">{a.table_name || "—"}</td>
                    <td className="px-6 py-3 font-mono text-xs text-zinc-500">{a.record_id ? a.record_id.slice(0, 8) : "—"}</td>
                    <td className="px-6 py-3 font-mono text-xs text-zinc-500">{a.ip_address || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}
