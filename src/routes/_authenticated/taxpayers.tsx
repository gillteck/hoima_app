import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader, Card, Badge, Empty, Skeleton } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { Plus, Search, Trash2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/_authenticated/taxpayers")({
  head: () => pageHead("Hotel Taxpayers", "Manage Hoima City Council taxpayer businesses and registration details."),
  component: TaxpayersPage,
});

async function fetchBusinesses(query: string) {
  let q = supabase.from("businesses").select("*").order("created_at", { ascending: false }).limit(200);
  if (query) q = q.or(`business_name.ilike.%${query}%,tin.ilike.%${query}%,owner_name.ilike.%${query}%,phone.ilike.%${query}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function TaxpayersPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ business_name: "", owner_name: "", tin: "", phone: "", email: "", physical_address: "", division: "Kinondoni", category: "Retail", status: "active" });
  const { data, isLoading } = useQuery({ queryKey: ["businesses", query], queryFn: () => fetchBusinesses(query) });

  const createM = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        tin: form.tin.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        owner_name: form.owner_name.trim() || null,
        physical_address: form.physical_address.trim() || null,
      };
      const { error } = await supabase.from("businesses").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Taxpayer added"); setOpen(false); qc.invalidateQueries({ queryKey: ["businesses"] }); setForm({ ...form, business_name: "", owner_name: "", tin: "", phone: "", email: "", physical_address: "" }); },
    onError: (e: Error) => toast.error(e.message.includes("businesses_tin_key") ? "A taxpayer with this TIN already exists." : e.message),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("businesses").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["businesses"] }); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Taxpayers & Businesses"
        description="Manage registered businesses, hotels, and taxpayers across all divisions."
        actions={
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 bg-brand text-white px-3.5 py-2 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110">
            <Plus className="size-4" /> Register Taxpayer
          </button>
        }
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by TIN, name, owner, phone…" className="w-full bg-white border border-zinc-200 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
        ) : (data || []).length === 0 ? (
          <Empty title="No taxpayers registered" description="Register your first business to start issuing invoices." action={<button onClick={() => setOpen(true)} className="text-sm text-brand font-medium">+ Register taxpayer</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-50/70 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <th className="px-6 py-3">Business</th>
                  <th className="px-6 py-3">TIN</th>
                  <th className="px-6 py-3">Owner</th>
                  <th className="px-6 py-3">Contact</th>
                  <th className="px-6 py-3">Division / Category</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Registered</th>
                  <th className="px-6 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-zinc-950/5">
                {(data || []).map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-50/40">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded bg-brand-light text-brand flex items-center justify-center text-xs font-semibold"><Building2 className="size-4" /></div>
                        <div>
                          <div className="font-medium">{b.business_name}</div>
                          {b.physical_address && <div className="text-[11px] text-zinc-500 truncate max-w-[220px]">{b.physical_address}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs">{b.tin || "—"}</td>
                    <td className="px-6 py-3">{b.owner_name || "—"}</td>
                    <td className="px-6 py-3 text-zinc-600 text-xs">{b.phone || b.email || "—"}</td>
                    <td className="px-6 py-3 text-xs">{b.division || "—"} · <span className="text-zinc-500">{b.category || "—"}</span></td>
                    <td className="px-6 py-3"><Badge tone={b.status === "active" ? "success" : b.status === "suspended" ? "warning" : "neutral"}>{b.status}</Badge></td>
                    <td className="px-6 py-3 text-xs text-zinc-500">{formatDate(b.date_registered)}</td>
                    <td className="px-6 py-3">
                      <button onClick={() => confirm(`Delete ${b.business_name}?`) && deleteM.mutate(b.id)} className="p-1.5 rounded hover:bg-red-50 text-zinc-400 hover:text-destructive"><Trash2 className="size-4" /></button>
                    </td>
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
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-1">Register Taxpayer</h2>
              <p className="text-sm text-zinc-500 mb-6">Add a new business or hotel to the register.</p>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createM.mutate(); }}>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Business name" required><input required value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} className="fld" /></FormField>
                  <FormField label="Owner name"><input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className="fld" /></FormField>
                  <FormField label="TIN"><input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} className="fld" placeholder="102-445-921" /></FormField>
                  <FormField label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="fld" /></FormField>
                  <FormField label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="fld" /></FormField>
                  <FormField label="Division">
                    <select value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} className="fld">{["Kinondoni","Ilala","Temeke","Ubungo","Kigamboni"].map((d) => <option key={d}>{d}</option>)}</select>
                  </FormField>
                  <FormField label="Category">
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="fld">{["Retail","Hospitality","Transport","Manufacturing","Services","Restaurant","Hotel"].map((c) => <option key={c}>{c}</option>)}</select>
                  </FormField>
                  <FormField label="Status">
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="fld">{["active","suspended","inactive"].map((s) => <option key={s}>{s}</option>)}</select>
                  </FormField>
                </div>
                <FormField label="Physical address"><textarea value={form.physical_address} onChange={(e) => setForm({ ...form, physical_address: e.target.value })} className="fld" rows={2} /></FormField>
                <div className="flex justify-end gap-2 pt-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-md hover:bg-zinc-100">Cancel</button>
                  <button type="submit" disabled={createM.isPending} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:brightness-110 disabled:opacity-50">{createM.isPending ? "Saving…" : "Register"}</button>
                </div>
              </form>
              <style>{`.fld{width:100%;background:rgb(244 244 245);border:1px solid rgb(228 228 231);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;transition:all .15s}.fld:focus{background:white;border-color:var(--color-brand);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-brand) 15%,transparent)}`}</style>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FormField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-600 mb-1 block">{label}{required && <span className="text-brand ml-1">*</span>}</span>
      {children}
    </label>
  );
}
