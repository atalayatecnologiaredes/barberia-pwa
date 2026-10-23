import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-brass">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1><p className="mt-2 text-sm text-muted">{description}</p></div>{action}</header>;
}

export function MetricCard({ label, value, detail, icon: Icon, color = "text-brass" }: { label: string; value: string; detail: string; icon: LucideIcon; color?: string }) {
  return <article className="rounded-2xl border border-line bg-panel p-4 md:p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted">{label}</span><Icon size={18} className={color}/></div><p className="mt-4 text-2xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p></article>;
}
