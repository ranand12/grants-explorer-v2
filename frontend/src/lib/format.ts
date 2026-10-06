// Formatting helpers shared by dashboards and A2UI components.

export const formatCurrency = (val: number | null | undefined) =>
  val != null ? `$${val.toLocaleString()}` : "N/A";

export const formatCompact = (val: number) => {
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val}`;
};

export const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").trim();

export const prettyLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const daysUntil = (dateStr: string | null) => {
  if (!dateStr) return null;
  // Calendar-day difference in local time ("2026-09-24" parses as UTC midnight otherwise)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  const due = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
};

export const timeAgo = (iso?: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
