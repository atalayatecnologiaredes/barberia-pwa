import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CircleDollarSign, Clock3, RefreshCw, ShieldCheck, ShieldOff, UsersRound } from "lucide-react";
import { supabase } from "../../shared/lib/supabaseClient";

type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
interface SaasSubscription {
  plan: string;
  status: TenantStatus | "canceled";
  max_barbers: number;
  price_monthly: number;
  current_period_end: string;
}
interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: string;
  saas_subscriptions: SaasSubscription | SaasSubscription[] | null;
}

function subscriptionOf(tenant: TenantRecord): SaasSubscription | null {
  const row = tenant.saas_subscriptions;
  return Array.isArray(row) ? row[0] ?? null : row;
}

function tenantStatus(tenant: TenantRecord): TenantStatus {
  if (!tenant.active) return "suspended";
  const status = subscriptionOf(tenant)?.status;
  if (status === "canceled") return "cancelled";
  return status ?? "trialing";
}

const statusLabel: Record<TenantStatus, string> = { trialing: "En prueba", active: "Activa", past_due: "Pago pendiente", suspended: "Suspendida", cancelled: "Cancelada" };
const statusStyles: Record<TenantStatus, string> = {
  trialing: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  active: "border-electric/30 bg-electric/10 text-green-200",
  past_due: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  suspended: "border-red-400/30 bg-red-400/10 text-red-200",
  cancelled: "border-stone-500/30 bg-stone-500/10 text-stone-300",
};

function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export default function SaasAdminApp() {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.from("tenants")
        .select("id, name, slug, active, created_at, saas_subscriptions(plan, status, max_barbers, price_monthly, current_period_end)")
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      setTenants(data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar las barberías.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTenants(); }, [loadTenants]);

  const stats = useMemo(() => {
    const active = tenants.filter((tenant) => tenantStatus(tenant) === "active");
    const trial = tenants.filter((tenant) => tenantStatus(tenant) === "trialing");
    const mrr = active.reduce((total, tenant) => total + Number(subscriptionOf(tenant)?.price_monthly ?? 0), 0);
    return { mrr, count: tenants.length, active: active.length, trial: trial.length };
  }, [tenants]);

  async function changeAccess(tenant: TenantRecord) {
    const nextActive = !tenant.active;
    setBusyId(tenant.id);
    setError(null);
    try {
      const { error: updateTenantError } = await supabase.from("tenants").update({ active: nextActive }).eq("id", tenant.id);
      if (updateTenantError) throw updateTenantError;
      await loadTenants();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cambiar el acceso de la barbería.");
    } finally {
      setBusyId(null);
    }
  }

  const metrics = [
    { label: "MRR", value: formatUsd(stats.mrr), icon: CircleDollarSign, detail: "Ingresos recurrentes activos" },
    { label: "Barberías", value: String(stats.count), icon: Building2, detail: "Cuentas registradas" },
    { label: "Cuentas activas", value: String(stats.active), icon: ShieldCheck, detail: "Suscripciones activas" },
    { label: "En trial", value: String(stats.trial), icon: Clock3, detail: "Periodos de prueba" },
  ];

  return <div className="min-h-screen bg-obsidian px-4 py-6 text-stone-100 sm:px-7 lg:px-10">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-brass">Consola SaaS</p><h1 className="mt-2 text-3xl font-semibold">Administración de barberías</h1><p className="mt-2 text-sm text-muted">Estado de cuentas, planes y acceso a la plataforma.</p></div><button onClick={() => void loadTenants()} disabled={loading} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-sm font-semibold hover:border-brass/50 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>Actualizar</button></header>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, icon: Icon, detail }) => <article key={label} className="rounded-2xl border border-line bg-panel p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted">{label}</span><Icon size={19} className="text-brass"/></div><p className="mt-4 text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p></article>)}</section>

      {error && <div role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"><strong>Error al consultar:</strong> {error}<p className="mt-1 text-xs text-red-200/80">Verifica las políticas de acceso a tenants y saas_subscriptions para el administrador global.</p></div>}

      <section className="mt-7 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-semibold">Barberías registradas</h2><p className="mt-1 text-xs text-muted">Suspender bloquea acceso a la cuenta; reactivar restablece el acceso.</p></div><UsersRound size={19} className="text-brass"/></div>
        {loading ? <div className="p-8 text-center text-sm text-muted">Cargando cuentas…</div> : tenants.length === 0 ? <div className="p-8 text-center text-sm text-muted">No hay barberías registradas.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-obsidian/70 text-xs uppercase tracking-wide text-muted"><tr><th className="px-5 py-3">Barbería</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3">MRR</th><th className="px-5 py-3">Registro</th><th className="px-5 py-3 text-right">Acceso</th></tr></thead><tbody className="divide-y divide-line">{tenants.map((tenant) => { const status = tenantStatus(tenant); const subscription = subscriptionOf(tenant); return <tr key={tenant.id} className="hover:bg-white/[.02]"><td className="px-5 py-4"><span className="font-semibold">{tenant.name}</span><span className="mt-1 block font-mono text-[10px] text-muted">{tenant.slug}</span></td><td className="px-5 py-4">{subscription?.plan ?? "—"}</td><td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status]}`}>{statusLabel[status]}</span></td><td className="px-5 py-4">{status === "active" ? formatUsd(Number(subscription?.price_monthly ?? 0)) : "—"}</td><td className="px-5 py-4 text-muted">{new Date(tenant.created_at).toLocaleDateString("es-EC")}</td><td className="px-5 py-4 text-right"><button onClick={() => void changeAccess(tenant)} disabled={busyId === tenant.id || status === "cancelled"} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${status === "suspended" ? "border-electric/30 text-green-200 hover:bg-electric/10" : "border-red-400/30 text-red-200 hover:bg-red-500/10"}`}>{status === "suspended" ? <ShieldCheck size={14}/> : <ShieldOff size={14}/ >}{busyId === tenant.id ? "Guardando…" : status === "suspended" ? "Reactivar" : "Suspender"}</button></td></tr>; })}</tbody></table></div>}
      </section>
      <p className="mt-4 text-xs leading-5 text-muted">El MRR suma `price_monthly` para suscripciones activas. La suspensión se controla con `tenants.active`.</p>
    </div>
  </div>;
}
