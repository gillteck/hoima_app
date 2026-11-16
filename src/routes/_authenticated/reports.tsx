import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, StatCard } from "@/components/primitives";
import { formatMoney } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Download, FileText, Filter, X } from "lucide-react";
import jsPDF from "jspdf";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => pageHead("Reports & Audit", "Filter and download Hoima City Council revenue and taxpayer reports."),
  component: ReportsPage,
});

type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now); to.setHours(23, 59, 59, 999);
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  if (preset === "week") from.setDate(from.getDate() - 6);
  else if (preset === "month") from.setDate(1);
  else if (preset === "quarter") { const q = Math.floor(from.getMonth() / 3) * 3; from.setMonth(q, 1); }
  else if (preset === "year") from.setMonth(0, 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function ReportsPage() {
  const [preset, setPreset] = useState<Preset>("month");
  const initial = presetRange("month");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [taxType, setTaxType] = useState<string>("all");
  const [paymentMethod, setPaymentMethod] = useState<string>("all");
  const [division, setDivision] = useState<string>("all");
  const [officerId, setOfficerId] = useState<string>("all");
  const [taxpayerId, setTaxpayerId] = useState<string>("all");
  const [status, setStatus] = useState<string>("success");

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") { const r = presetRange(p); setFromDate(r.from); setToDate(r.to); }
  };

  const resetFilters = () => {
    setPreset("month");
    const r = presetRange("month"); setFromDate(r.from); setToDate(r.to);
    setTaxType("all"); setPaymentMethod("all"); setDivision("all"); setOfficerId("all"); setTaxpayerId("all"); setStatus("success");
  };

  const { data } = useQuery({
    queryKey: ["reports", fromDate, toDate, taxType, paymentMethod, division, officerId, taxpayerId, status],
    queryFn: async () => {
      const fromIso = new Date(fromDate + "T00:00:00").toISOString();
      const toIso = new Date(toDate + "T23:59:59").toISOString();

      let paymentsQ = supabase.from("payments")
        .select("amount, paid_at, payment_method, status, business_id, officer_id, invoice_id")
        .is("deleted_at", null)
        .gte("paid_at", fromIso).lte("paid_at", toIso);
      if (status !== "all") paymentsQ = paymentsQ.eq("status", status);
      if (paymentMethod !== "all") paymentsQ = paymentsQ.eq("payment_method", paymentMethod);
      if (officerId !== "all") paymentsQ = paymentsQ.eq("officer_id", officerId);
      if (taxpayerId !== "all") paymentsQ = paymentsQ.eq("business_id", taxpayerId);

      let invoicesQ = supabase.from("invoices")
        .select("id, amount, paid_amount, status, tax_type, issue_date, business_id")
        .is("deleted_at", null)
        .gte("issue_date", fromDate).lte("issue_date", toDate);
      if (taxType !== "all") invoicesQ = invoicesQ.eq("tax_type", taxType);
      if (taxpayerId !== "all") invoicesQ = invoicesQ.eq("business_id", taxpayerId);

      const [{ data: p }, { data: i }, { data: b }, { data: o }] = await Promise.all([
        paymentsQ,
        invoicesQ,
        supabase.from("businesses").select("id, division, category"),
        supabase.from("officers").select("id, division"),
      ]);

      const bizById = new Map((b || []).map((x: any) => [x.id, x]));
      const offById = new Map((o || []).map((x: any) => [x.id, x]));

      let payments = p || [];
      let invoices = i || [];

      if (division !== "all") {
        payments = payments.filter((x: any) => {
          const biz = x.business_id ? bizById.get(x.business_id) : null;
          const off = x.officer_id ? offById.get(x.officer_id) : null;
          return (biz && (biz as any).division === division) || (off && (off as any).division === division);
        });
        invoices = invoices.filter((x: any) => {
          const biz = x.business_id ? bizById.get(x.business_id) : null;
          return biz && (biz as any).division === division;
        });
      }
      if (taxType !== "all") {
        const invIds = new Set(invoices.map((x: any) => x.id));
        payments = payments.filter((x: any) => !x.invoice_id || invIds.has(x.invoice_id));
      }

      return { payments, invoices };
    },
  });

  const { data: filterOpts } = useQuery({
    queryKey: ["reports-filter-opts"],
    queryFn: async () => {
      const [{ data: inv }, { data: pay }, { data: biz }, { data: offs }, { data: taxpayers }] = await Promise.all([
        supabase.from("invoices").select("tax_type"),
        supabase.from("payments").select("payment_method"),
        supabase.from("businesses").select("division"),
        supabase.from("officers").select("id, full_name, employee_id").order("full_name"),
        supabase.from("businesses").select("id, business_name, tin").order("business_name"),
      ]);
      return {
        taxTypes: Array.from(new Set((inv || []).map((x: any) => x.tax_type).filter(Boolean))).sort(),
        paymentMethods: Array.from(new Set((pay || []).map((x: any) => x.payment_method).filter(Boolean))).sort(),
        divisions: Array.from(new Set((biz || []).map((x: any) => x.division).filter(Boolean))).sort(),
        officers: offs || [],
        taxpayers: taxpayers || [],
      };
    },
  });

  const payments = data?.payments || [];
  const invoices = data?.invoices || [];

  const totalCollected = payments.filter((p: any) => p.status === "success").reduce((a: number, p: any) => a + Number(p.amount), 0);
  const totalOutstanding = invoices.reduce((a: number, i: any) => a + Math.max(0, Number(i.amount) - Number(i.paid_amount)), 0);
  const totalInvoices = invoices.length;

  const months = useMemo(() => {
    const map = new Map<string, number>();
    payments.filter((p: any) => p.status === "success").forEach((p: any) => {
      const key = p.paid_at.slice(0, 7);
      map.set(key, (map.get(key) || 0) + Number(p.amount));
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
      month: new Date(k + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      total: v,
    }));
  }, [payments]);

  const byTax = new Map<string, number>();
  invoices.forEach((i: any) => byTax.set(i.tax_type, (byTax.get(i.tax_type) || 0) + Number(i.paid_amount)));
  const taxData = Array.from(byTax.entries()).map(([name, value]) => ({ name, value }));

  const byMethod = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    payments.filter((p: any) => p.status === "success").forEach((p: any) => {
      const cur = map.get(p.payment_method) || { total: 0, count: 0 };
      cur.total += Number(p.amount); cur.count += 1;
      map.set(p.payment_method, cur);
    });
    return Array.from(map.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.total - a.total);
  }, [payments]);

  const selectedOfficer = (filterOpts?.officers || []).find((o: any) => o.id === officerId) as any;
  const selectedTaxpayer = (filterOpts?.taxpayers || []).find((t: any) => t.id === taxpayerId) as any;

  const taxpayerLedger = useMemo(() => {
    if (taxpayerId === "all") return null;
    const demanded = invoices.reduce((a: number, i: any) => a + Number(i.amount || 0), 0);
    const paid = invoices.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    const outstanding = Math.max(0, demanded - paid);
    const paymentsTotal = payments.filter((p: any) => p.status === "success").reduce((a: number, p: any) => a + Number(p.amount), 0);
    return { demanded, paid, outstanding, paymentsTotal, invoiceCount: invoices.length, paymentCount: payments.length };
  }, [taxpayerId, invoices, payments]);

  const activeFilterCount = [
    taxType !== "all", paymentMethod !== "all", division !== "all", officerId !== "all", taxpayerId !== "all", status !== "success", preset !== "month",
  ].filter(Boolean).length;

  const filterSummary = () => {
    const parts: string[] = [`${fromDate} → ${toDate}`];
    if (taxType !== "all") parts.push(`Tax: ${taxType}`);
    if (paymentMethod !== "all") parts.push(`Method: ${paymentMethod}`);
    if (division !== "all") parts.push(`Division: ${division}`);
    if (officerId !== "all" && selectedOfficer) parts.push(`Officer: ${selectedOfficer.full_name}`);
    if (taxpayerId !== "all" && selectedTaxpayer) parts.push(`Taxpayer: ${selectedTaxpayer.business_name}`);
    if (status !== "all") parts.push(`Status: ${status}`);
    return parts.join(" · ");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text("Municipal Revenue Report", 20, 20);
    doc.setFontSize(9); doc.text(`Generated ${new Date().toLocaleString()}`, 20, 27);
    doc.text(`Filters: ${filterSummary()}`, 20, 33);
    doc.line(20, 37, 190, 37);
    doc.setFontSize(12);
    doc.text(`Total Collected: ${formatMoney(totalCollected)}`, 20, 48);
    doc.text(`Total Outstanding: ${formatMoney(totalOutstanding)}`, 20, 58);
    doc.text(`Total Invoices: ${totalInvoices}`, 20, 68);
    doc.text(`Total Transactions: ${payments.length}`, 20, 78);
    doc.setFontSize(10);
    doc.text("Monthly Revenue (filtered):", 20, 92);
    let y = 102;
    months.forEach((m) => { doc.text(`${m.month}: ${formatMoney(m.total)}`, 25, y); y += 6; });
    doc.save("municipal-report.pdf");
  };

  const exportCSV = () => {
    const rows = [["month", "total"], ...months.map((m) => [m.month, m.total.toString()])];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "monthly-revenue.csv"; a.click();
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader title="Reports & Analytics" description="Filter, view, and export revenue data by period, tax type, method, and division." actions={
        <div className="flex gap-2">
          <button onClick={exportCSV} className="inline-flex items-center gap-2 border border-zinc-200 px-3 py-2 rounded-md text-sm font-medium hover:bg-zinc-50"><Download className="size-4" /> Export CSV</button>
          <button onClick={exportPDF} className="inline-flex items-center gap-2 bg-brand text-white px-3 py-2 rounded-md text-sm font-medium hover:brightness-110"><FileText className="size-4" /> Export PDF</button>
        </div>
      } />

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-900">Report Filters</h2>
            {activeFilterCount > 0 && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{activeFilterCount} active</span>}
          </div>
          <button onClick={resetFilters} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"><X className="size-3" /> Reset</button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {(["today", "week", "month", "quarter", "year", "custom"] as Preset[]).map((p) => (
            <button key={p} onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ring-1 capitalize ${preset === p ? "bg-brand text-white ring-brand" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`}>
              {p === "today" ? "Today" : p === "week" ? "Last 7 days" : p === "month" ? "This month" : p === "quarter" ? "This quarter" : p === "year" ? "This year" : "Custom"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">From <span className="text-rose-600">*</span></label>
            <input type="date" required value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreset("custom"); }}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">To <span className="text-rose-600">*</span></label>
            <input type="date" required value={toDate} onChange={(e) => { setToDate(e.target.value); setPreset("custom"); }}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Tax Type</label>
            <select value={taxType} onChange={(e) => setTaxType(e.target.value)}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All tax types</option>
              {(filterOpts?.taxTypes || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Payment Method</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All methods</option>
              {(filterOpts?.paymentMethods || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Division</label>
            <select value={division} onChange={(e) => setDivision(e.target.value)}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All divisions</option>
              {(filterOpts?.divisions || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Revenue Officer</label>
            <select value={officerId} onChange={(e) => setOfficerId(e.target.value)}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All officers</option>
              {(filterOpts?.officers || []).map((o: any) => <option key={o.id} value={o.id}>{o.full_name} ({o.employee_id})</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Payment Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Taxpayer</label>
            <select value={taxpayerId} onChange={(e) => setTaxpayerId(e.target.value)}
              className="mt-1 w-full text-sm border border-zinc-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All taxpayers</option>
              {(filterOpts?.taxpayers || []).map((t: any) => <option key={t.id} value={t.id}>{t.business_name}{t.tin ? ` (${t.tin})` : ""}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-100 text-[11px] text-zinc-500">
          Showing: <span className="font-medium text-zinc-700">{filterSummary()}</span>
        </div>
      </Card>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Collected" value={formatMoney(totalCollected)} />
        <StatCard label="Outstanding" value={formatMoney(totalOutstanding)} />
        <StatCard label="Invoices in range" value={String(totalInvoices)} />
        <StatCard label="Transactions" value={String(payments.length)} />
      </section>

      {taxpayerId !== "all" && selectedTaxpayer && taxpayerLedger && (
        <Card className="p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold">Taxpayer Ledger — {selectedTaxpayer.business_name}</h2>
            {selectedTaxpayer.tin && <span className="text-xs text-zinc-500">TIN: <span className="font-mono">{selectedTaxpayer.tin}</span></span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="rounded-md ring-1 ring-zinc-200 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Total Demanded</div>
              <div className="text-lg font-semibold mt-1">{formatMoney(taxpayerLedger.demanded)}</div>
              <div className="text-[11px] text-zinc-400">{taxpayerLedger.invoiceCount} invoice(s)</div>
            </div>
            <div className="rounded-md ring-1 ring-zinc-200 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Paid (Invoices)</div>
              <div className="text-lg font-semibold mt-1 text-emerald-700">{formatMoney(taxpayerLedger.paid)}</div>
              <div className="text-[11px] text-zinc-400">{taxpayerLedger.demanded > 0 ? ((taxpayerLedger.paid / taxpayerLedger.demanded) * 100).toFixed(1) : "0.0"}% settled</div>
            </div>
            <div className="rounded-md ring-1 ring-zinc-200 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Outstanding</div>
              <div className={`text-lg font-semibold mt-1 ${taxpayerLedger.outstanding > 0 ? "text-rose-700" : "text-zinc-700"}`}>{formatMoney(taxpayerLedger.outstanding)}</div>
              <div className="text-[11px] text-zinc-400">Balance due</div>
            </div>
            <div className="rounded-md ring-1 ring-zinc-200 p-3">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Payments Received</div>
              <div className="text-lg font-semibold mt-1">{formatMoney(taxpayerLedger.paymentsTotal)}</div>
              <div className="text-[11px] text-zinc-400">{taxpayerLedger.paymentCount} transaction(s)</div>
            </div>
          </div>
          {invoices.length > 0 && (
            <div className="overflow-hidden rounded-md ring-1 ring-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2">Issue Date</th>
                    <th className="px-4 py-2">Tax Type</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Paid</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {invoices.map((inv: any) => {
                    const bal = Math.max(0, Number(inv.amount || 0) - Number(inv.paid_amount || 0));
                    return (
                      <tr key={inv.id} className="hover:bg-zinc-50/40">
                        <td className="px-4 py-2">{new Date(inv.issue_date).toLocaleDateString()}</td>
                        <td className="px-4 py-2 capitalize">{inv.tax_type}</td>
                        <td className="px-4 py-2 capitalize">{inv.status}</td>
                        <td className="px-4 py-2 text-right">{formatMoney(Number(inv.amount || 0))}</td>
                        <td className="px-4 py-2 text-right text-emerald-700">{formatMoney(Number(inv.paid_amount || 0))}</td>
                        <td className={`px-4 py-2 text-right font-semibold ${bal > 0 ? "text-rose-700" : "text-zinc-500"}`}>{formatMoney(bal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {officerId !== "all" && selectedOfficer && (
        <Card className="p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold">Officer Collections — {selectedOfficer.full_name}</h2>
            <span className="text-xs text-zinc-500">Employee ID: <span className="font-mono">{selectedOfficer.employee_id}</span></span>
          </div>
          {byMethod.length === 0 ? (
            <div className="text-sm text-zinc-400">No successful collections for this officer in the selected range.</div>
          ) : (
            <div className="overflow-hidden rounded-md ring-1 ring-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2">Payment Method</th>
                    <th className="px-4 py-2 text-right">Transactions</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {byMethod.map((m) => (
                    <tr key={m.method} className="hover:bg-zinc-50/40">
                      <td className="px-4 py-2 capitalize font-medium">{m.method}</td>
                      <td className="px-4 py-2 text-right">{m.count}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatMoney(m.total)}</td>
                      <td className="px-4 py-2 text-right text-zinc-500">{totalCollected > 0 ? ((m.total / totalCollected) * 100).toFixed(1) : "0.0"}%</td>
                    </tr>
                  ))}
                  <tr className="bg-zinc-50/60 font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right">{byMethod.reduce((s, m) => s + m.count, 0)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(totalCollected)}</td>
                    <td className="px-4 py-2 text-right">100.0%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}


      <Card className="p-6">
        <h2 className="text-sm font-semibold mb-4">Revenue by Month (filtered range)</h2>
        <div className="h-[320px]">
          {months.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-zinc-400">No data for the selected filters</div>
          ) : (
            <ResponsiveContainer>
              <BarChart data={months}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.05)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => formatMoney(Number(v))} />
                <Bar dataKey="total" fill="oklch(0.55 0.15 155)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {taxData.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold mb-4">Revenue by Tax Type</h2>
          <div className="h-[280px]">
            <ResponsiveContainer>
              <BarChart data={taxData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.05)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} width={120} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => formatMoney(Number(v))} />
                <Bar dataKey="value" fill="oklch(0.55 0.15 155)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
