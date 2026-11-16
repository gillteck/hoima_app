import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card } from "@/components/primitives";
import { KeyRound, Smartphone, Lock, Unlock, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => pageHead("POS Pairing", "Pair an authorized phone or terminal with Hoima City Council revenue management."),
  component: PosPairingPage,
});

const STORAGE_KEY = "pos.pairedDeviceId";

type PairRow = {
  id: string;
  code: string;
  status: "pending" | "approved" | "rejected" | "expired";
  approved_device_id: string | null;
  expires_at: string;
  created_at: string;
};

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function detectDevice() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isPhone = /Android|iPhone|Mobile/i.test(ua);
  const model = /iPhone/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android Phone" : "Web Browser";
  const manufacturer = /iPhone|iPad/i.test(ua) ? "Apple" : /Android/i.test(ua) ? "Android" : "Web";
  const androidMatch = ua.match(/Android\s([\d.]+)/);
  return {
    device_type: isPhone ? "mobile_phone" : "web_pos",
    model,
    manufacturer,
    android_version: androidMatch?.[1] ?? null,
  };
}

function PosPairingPage() {
  const [pair, setPair] = useState<PairRow | null>(null);
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setPairedDeviceId(saved);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remainingSec = useMemo(() => {
    if (!pair) return 0;
    return Math.max(0, Math.floor((new Date(pair.expires_at).getTime() - now) / 1000));
  }, [pair, now]);

  const expired = pair && remainingSec === 0 && pair.status === "pending";

  // Realtime subscription for this pairing code
  useEffect(() => {
    if (!pair || pairedDeviceId) return;
    const ch = supabase
      .channel(`pair-${pair.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "device_pairing_codes", filter: `id=eq.${pair.id}` },
        (payload) => {
          const row = payload.new as PairRow;
          setPair(row);
          if (row.status === "approved" && row.approved_device_id) {
            localStorage.setItem(STORAGE_KEY, row.approved_device_id);
            setPairedDeviceId(row.approved_device_id);
            toast.success("Device paired · POS unlocked");
          } else if (row.status === "rejected") {
            toast.error("Pairing rejected by administrator");
          }
        }
      )
      .subscribe();

    // Polling fallback (in case realtime is delayed / blocked)
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("check_pairing_status", { p_code: pair.code });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      if (row.status === "approved" && row.approved_device_id) {
        localStorage.setItem(STORAGE_KEY, row.approved_device_id);
        setPairedDeviceId(row.approved_device_id);
        setPair((p) => (p ? { ...p, status: "approved", approved_device_id: row.approved_device_id } : p));
        toast.success("Device paired · POS unlocked");
      } else if (row.status === "rejected") {
        setPair((p) => (p ? { ...p, status: "rejected" } : p));
        toast.error("Pairing rejected by administrator");
      }
    }, 3000);

    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [pair, pairedDeviceId]);

  const requestCode = async () => {
    setCreating(true);
    try {
      const info = detectDevice();
      const code = genCode();
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You must be signed in to pair a device");
      const { data: officer } = await supabase.from("officers").select("id").eq("user_id", uid).limit(1).maybeSingle();
      const { data, error } = await supabase
        .from("device_pairing_codes")
        .insert([{
          code,
          device_type: info.device_type,
          model: info.model,
          manufacturer: info.manufacturer,
          android_version: info.android_version,
          requested_by_user_id: uid,
          requested_by_officer_id: officer?.id ?? null,
        }])
        .select("id, code, status, approved_device_id, expires_at, created_at")
        .single();
      if (error) throw error;
      setPair(data as PairRow);
      toast.success(`Pairing code ${code} generated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create pairing code");
    } finally {
      setCreating(false);
    }
  };

  const unpair = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPairedDeviceId(null);
    setPair(null);
    toast.info("Device unpaired");
  };

  const cancel = async () => {
    if (!pair) return;
    await supabase.from("device_pairing_codes").update({ status: "rejected" }).eq("id", pair.id);
    setPair(null);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1200px] mx-auto">
      <PageHeader
        title="POS Terminal"
        description={pairedDeviceId ? "This terminal is paired and unlocked." : "Pair this terminal to start recording payments."}
      />

      <AnimatePresence mode="wait">
        {pairedDeviceId ? (
          <motion.div key="paired" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="p-8">
              <div className="flex items-start gap-4">
                <div className="size-14 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Unlock className="size-7" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold">POS Unlocked</h2>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 px-2 py-0.5 rounded-full uppercase">Paired</span>
                  </div>
                  <p className="text-sm text-zinc-500 mt-1">Device ID <span className="font-mono text-zinc-700">{pairedDeviceId}</span></p>
                  <div className="mt-6 grid sm:grid-cols-2 gap-3">
                    <button className="rounded-lg bg-brand text-white px-4 py-3 font-medium text-sm shadow-sm hover:brightness-110">Record Payment</button>
                    <button className="rounded-lg bg-white ring-1 ring-black/10 px-4 py-3 font-medium text-sm hover:bg-zinc-50">View Invoices</button>
                  </div>
                  <button onClick={unpair} className="mt-6 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-600">
                    <Lock className="size-3.5" /> Unpair this terminal
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        ) : pair && !expired ? (
          <motion.div key="waiting" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="p-8 text-center">
              <div className="mx-auto size-14 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                <KeyRound className="size-7" />
              </div>
              <p className="text-sm text-zinc-500 mb-2">Enter this code on the admin Devices page to approve pairing</p>
              <div className="font-mono text-6xl font-bold tracking-[0.3em] text-zinc-900 my-4 select-all">
                {pair.code}
              </div>
              <div className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" />
                Waiting for administrator approval · expires in{" "}
                <span className="font-mono font-semibold text-zinc-700 tabular-nums">
                  {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, "0")}
                </span>
              </div>
              <div className="mt-6 flex justify-center gap-2">
                <button onClick={cancel} className="px-4 py-2 text-sm rounded-md text-zinc-600 hover:bg-zinc-100 inline-flex items-center gap-1.5">
                  <XCircle className="size-4" /> Cancel
                </button>
                <button onClick={requestCode} disabled={creating} className="px-4 py-2 text-sm rounded-md bg-white ring-1 ring-black/10 hover:bg-zinc-50 inline-flex items-center gap-1.5">
                  <RefreshCw className="size-4" /> New code
                </button>
              </div>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="start" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="p-8 text-center">
              <div className="mx-auto size-14 rounded-xl bg-zinc-100 text-zinc-500 flex items-center justify-center mb-4">
                <Smartphone className="size-7" />
              </div>
              <h2 className="text-lg font-semibold">Terminal not paired</h2>
              <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
                {expired ? "Your previous code expired. " : ""}
                Generate a 6-digit pairing code and ask an administrator to approve it from the Devices page.
              </p>
              <button onClick={requestCode} disabled={creating} className="mt-6 inline-flex items-center gap-2 bg-brand text-white px-5 py-2.5 rounded-md text-sm font-medium shadow-sm shadow-brand/20 hover:brightness-110 disabled:opacity-50">
                {creating ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {creating ? "Generating…" : "Generate pairing code"}
              </button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {pair?.status === "approved" && pairedDeviceId && (
        <div className="text-center text-xs text-emerald-600 inline-flex items-center gap-1.5 justify-center w-full">
          <CheckCircle2 className="size-3.5" /> Approved at {new Date(pair.created_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
