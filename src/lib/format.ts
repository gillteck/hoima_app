export function formatMoney(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return "UGX " + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function formatDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function initials(s: string | null | undefined) {
  if (!s) return "?";
  return s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
