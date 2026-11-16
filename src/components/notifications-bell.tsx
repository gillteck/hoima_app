import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, FileText, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { AnimatePresence, motion } from "framer-motion";

type Notification = {
  id: string;
  title: string;
  message: string | null;
  category: string | null;
  is_read: boolean;
  created_at: string;
};

async function fetchRecent(): Promise<Notification[]> {
  const { data } = await supabase
    .from("notifications")
    .select("id, title, message, category, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data as Notification[]) || [];
}

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.is_read).length;

  useEffect(() => { fetchRecent().then(setItems); }, []);

  // Global realtime: notifications table (DB trigger creates rows for every new invoice/payment)
  useEffect(() => {
    const ch = supabase
      .channel("global-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        const n = payload.new as Notification;
        setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 20)));
        toast.success(n.title, { description: n.message ?? undefined, duration: 6000 });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);


  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const clear = async (id: string) => {
    await supabase.from("notifications").delete().eq("id", id);
    setItems((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative size-9 rounded-md flex items-center justify-center bg-white/5 ring-1 ring-white/10 hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-red-500 text-[9px] font-bold flex items-center justify-center text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 mt-2 w-96 bg-white text-zinc-900 rounded-xl shadow-xl ring-1 ring-black/5 overflow-hidden z-50"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
              <div>
                <div className="text-sm font-semibold">Notifications</div>
                <div className="text-[11px] text-zinc-500">{unread > 0 ? `${unread} unread` : "All caught up"}</div>
              </div>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-brand hover:underline font-medium">Mark all read</button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">No notifications yet.</div>
              ) : (
                items.map((n) => {
                  const invMatch = n.title.match(/New invoice (\S+)/);
                  const body = (
                    <div className={`px-4 py-3 border-b border-zinc-50 hover:bg-zinc-50 group flex gap-3 ${!n.is_read ? "bg-emerald-50/40" : ""}`}>
                      <div className="size-8 rounded-md bg-brand/10 text-brand flex items-center justify-center shrink-0"><FileText className="size-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{n.title}</div>
                        {n.message && <div className="text-xs text-zinc-500 mt-0.5">{n.message}</div>}
                        <div className="text-[10px] text-zinc-400 mt-1 font-mono">{formatDateTime(n.created_at)}</div>
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); clear(n.id); }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 shrink-0"
                        aria-label="Dismiss"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  );
                  if (n.category === "invoice" && invMatch) {
                    return (
                      <Link key={n.id} to="/invoices" onClick={() => setOpen(false)}>{body}</Link>
                    );
                  }
                  return <div key={n.id}>{body}</div>;
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
