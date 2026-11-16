import { type ReactNode } from "react";
import { motion } from "framer-motion";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="text-sm text-zinc-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-xl ring-1 ring-black/5 shadow-sm ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function StatCard({ label, value, delta, deltaTone = "neutral", sub }: { label: string; value: string; delta?: string; deltaTone?: "positive" | "negative" | "neutral"; sub?: string }) {
  const toneClass = deltaTone === "positive" ? "text-emerald-700 bg-emerald-50" : deltaTone === "negative" ? "text-red-700 bg-red-50" : "text-zinc-600 bg-zinc-100";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white p-5 rounded-xl ring-1 ring-black/5 shadow-sm space-y-3"
    >
      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {delta && <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${toneClass}`}>{delta}</span>}
      </div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </motion.div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "neutral" | "info" }) {
  const map = {
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
    info: "bg-blue-50 text-blue-700",
    neutral: "bg-zinc-100 text-zinc-700",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${map[tone]}`}>{children}</span>;
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="size-14 rounded-full bg-brand-light mx-auto flex items-center justify-center text-brand text-2xl">✦</div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-zinc-500 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse bg-zinc-200/60 rounded ${className}`} />;
}
