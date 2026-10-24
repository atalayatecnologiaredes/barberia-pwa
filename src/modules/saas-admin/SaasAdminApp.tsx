import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, CircleDollarSign, Clock3, RefreshCw, ShieldCheck, ShieldOff, UsersRound, CreditCard, Save, MessageCircle } from "lucide-react";
import { supabase } from "../../shared/lib/supabaseClient";
import { useAuthStore } from "../../shared/auth/AuthStore";

type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled" | "expired";
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
interface SaaSSettings {
  trial_days: number;
  grace_days: number;
  billing_period_months: number;
  monthly_price: number;
  whatsapp_number: string;
  telegram_url: string | null;
  exports_enabled_during_trial: boolean;
}
interface PaymentRecord {
  id: string;
  tenant_id: string;
  amount: number;
  recorded_by: string;
  payment_method: string;
  reference: string | null;
  period_starts_at: string;
  period_ends_at: string;
  created_at: string;
  tenants: { name: string } | { name: string }[] | null;
  profiles: { full_name: string } | { full_name: string }[] | null;
}

function subscriptionOf(tenant: TenantRecord): SaasSubscription | null {
  const row = tenant.saas_subscriptions;
  return Array.isArray(row) ? row[0] ?? null : row;
}

function tenantStatus(tenant: TenantRecord, graceDays: number): TenantStatus {
  if (!tenant.active) return "suspended";
  const subscription = subscriptionOf(tenant);
  const status = subscription?.status;
  if (status === "canceled") return "cancelled";
  if ((status === "active" || status === "trialing") && subscription?.current_period_end
    && new Date(subscription.current_period_end).getTime() + graceDays * 86_400_000 <= Date.now()) return "expired";
  return status ?? "trialing";
}

const statusLabel: Record<TenantStatus, string> = { trialing: "En prueba", active: "Activa", past_due: "Pago pendiente", suspended: "Suspendida", cancelled: "Cancelada", expired: "Vencida" };
const statusStyles: Record<TenantStatus, string> = {
  trialing: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  active: "border-electric/30 bg-electric/10 text-green-200",
  past_due: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  suspended: "border-red-400/30 bg-red-400/10 text-red-200",
  cancelled: "border-stone-500/30 bg-stone-500/10 text-stone-300",
  expired: "border-red-400/30 bg-red-400/10 text-red-200",
};

function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export default function SaasAdminApp() {
  const actorId = useAuthStore((state) => state.session?.user.id);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [settings, setSettings] = useState<SaaSSettings | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"transfer" | "cash">("transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
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

  const loadBilling = useCallback(async () => {
    const [settingsResult, paymentResult] = await Promise.all([
      supabase.from("saas_settings").select("trial_days,grace_days,billing_period_months,monthly_price,whatsapp_number,telegram_url,exports_enabled_during_trial").eq("singleton", true).single(),
      supabase.from("subscription_payment_records").select("id,tenant_id,amount,recorded_by,payment_method,reference,period_starts_at,period_ends_at,created_at,tenants(name),profiles!subscription_payment_records_recorded_by_fkey(full_name)").order("created_at", { ascending: false }).limit(20),
    ]);
    if (settingsResult.error) throw settingsResult.error;
    if (paymentResult.error) throw paymentResult.error;
    setSettings(settingsResult.data);
    setPayments(paymentResult.data ?? []);
  }, []);

  useEffect(() => {
    void loadTenants();
    void loadBilling().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "No se pudo cargar la configuración de cobros."));
  }, [loadTenants, loadBilling]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !actorId) return;
    setSavingSettings(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from("saas_settings").update({ ...settings, updated_at: new Date().toISOString(), updated_by: actorId }).eq("singleton", true);
      if (updateError) throw updateError;
      await loadBilling();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la configuración.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenantId) return;
    setSavingPayment(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("admin_record_subscription_payment", {
        p_tenant_id: selectedTenantId,
        p_payment_method: paymentMethod,
        p_reference: paymentReference.trim() || null,
        p_notes: paymentNotes.trim() || null,
        p_complimentary: false,
      });
      if (rpcError) throw rpcError;
      setSelectedTenantId(null);
      setPaymentReference("");
      setPaymentNotes("");
      await Promise.all([loadTenants(), loadBilling()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo registrar el pago.");
    } finally {
      setSavingPayment(false);
    }
  }

  const stats = useMemo(() => {
    const active = tenants.filter((tenant) => tenantStatus(tenant, settings?.grace_days ?? 0) === "active");
    const trial = tenants.filter((tenant) => tenantStatus(tenant, settings?.grace_days ?? 0) === "trialing");
    const mrr = active.reduce((total, tenant) => total + Number(subscriptionOf(tenant)?.price_monthly ?? 0), 0);
    return { mrr, count: tenants.length, active: active.length, trial: trial.length };
  }, [tenants, settings]);

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
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-brass">Consola SaaS</p><h1 className="mt-2 text-3xl font-semibold">Administración de barberías</h1><p className="mt-2 text-sm text-muted">Pruebas, pagos manuales, suscripciones y acceso a la plataforma.</p></div><button onClick={() => { void loadTenants(); void loadBilling().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "No se pudo actualizar.")); }} disabled={loading} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-sm font-semibold hover:border-brass/50 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>Actualizar</button></header>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, icon: Icon, detail }) => <article key={label} className="rounded-2xl border border-line bg-panel p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted">{label}</span><Icon size={19} className="text-brass"/></div><p className="mt-4 text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p></article>)}</section>

      {error && <div role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"><strong>Error al consultar:</strong> {error}<p className="mt-1 text-xs text-red-200/80">Verifica las políticas de acceso a tenants y saas_subscriptions para el administrador global.</p></div>}

      <section className="mt-7 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-semibold">Barberías registradas</h2><p className="mt-1 text-xs text-muted">Suspender bloquea acceso a la cuenta; reactivar restablece el acceso.</p></div><UsersRound size={19} className="text-brass"/></div>
        {loading ? <div className="p-8 text-center text-sm text-muted">Cargando cuentas…</div> : tenants.length === 0 ? <div className="p-8 text-center text-sm text-muted">No hay barberías registradas.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-obsidian/70 text-xs uppercase tracking-wide text-muted"><tr><th className="px-5 py-3">Barbería</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3">MRR</th><th className="px-5 py-3">Vence</th><th className="px-5 py-3">Registro</th><th className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-line">{tenants.map((tenant) => { const status = tenantStatus(tenant, settings?.grace_days ?? 0); const subscription = subscriptionOf(tenant); return <tr key={tenant.id} className="hover:bg-white/[.02]"><td className="px-5 py-4"><span className="font-semibold">{tenant.name}</span><span className="mt-1 block font-mono text-[10px] text-muted">{tenant.slug}</span></td><td className="px-5 py-4">{subscription?.plan ?? "—"}</td><td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status]}`}>{statusLabel[status]}</span></td><td className="px-5 py-4">{status === "active" ? formatUsd(Number(subscription?.price_monthly ?? 0)) : "—"}</td><td className="px-5 py-4 text-muted">{subscription?.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString("es-EC") : "—"}</td><td className="px-5 py-4 text-muted">{new Date(tenant.created_at).toLocaleDateString("es-EC")}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><button onClick={() => setSelectedTenantId(selectedTenantId === tenant.id ? null : tenant.id)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brass/40 px-3 text-xs font-bold text-brass"><CreditCard size={14}/>Registrar pago</button><button onClick={() => void changeAccess(tenant)} disabled={busyId === tenant.id || status === "cancelled"} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${status === "suspended" ? "border-electric/30 text-green-200 hover:bg-electric/10" : "border-red-400/30 text-red-200 hover:bg-red-500/10"}`}>{status === "suspended" ? <ShieldCheck size={14}/> : <ShieldOff size={14}/ >}{status === "suspended" ? "Reactivar" : "Suspender"}</button></div></td></tr>; })}</tbody></table></div>}
        {selectedTenantId && <form onSubmit={(event) => void recordPayment(event)} className="grid gap-3 border-t border-line p-5 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">Confirmar pago de {tenants.find((tenant) => tenant.id === selectedTenantId)?.name}</h3><label className="text-xs text-muted">Método<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "transfer" | "cash")} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"><option value="transfer">Transferencia</option><option value="cash">Efectivo</option></select></label><label className="text-xs text-muted">Referencia de pago (opcional)<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label><label className="text-xs text-muted sm:col-span-2">Nota interna (opcional)<input value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label><div className="flex items-center justify-between gap-3 sm:col-span-2"><span className="text-xs text-muted">{formatUsd(Number(settings?.monthly_price ?? 15))} · {settings?.billing_period_months ?? 1} mes(es)</span><button disabled={savingPayment} className="min-h-11 rounded-lg bg-brass px-4 text-sm font-bold text-obsidian disabled:opacity-50">{savingPayment ? "Registrando…" : "Confirmar pago y activar"}</button></div></form>}
      </section>
      {settings && <form onSubmit={(event) => void saveSettings(event)} className="mt-7 rounded-2xl border border-line bg-panel p-5"><div className="mb-4"><h2 className="font-semibold">Reglas de suscripción y soporte</h2><p className="mt-1 text-xs text-muted">Los cambios de periodo y precio aplican a nuevas pruebas y renovaciones.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([['trial_days','Días de prueba',1,90],['grace_days','Días de gracia',0,30],['billing_period_months','Meses por pago',1,12]] as const).map(([key,label,min,max])=><label key={key} className="text-xs text-muted">{label}<input type="number" min={min} max={max} value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label>)}<label className="text-xs text-muted">Precio mensual (USD)<input type="number" min="0" step="0.01" value={settings.monthly_price} onChange={(event) => setSettings({ ...settings, monthly_price: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label><label className="text-xs text-muted">WhatsApp de soporte<input value={settings.whatsapp_number} onChange={(event) => setSettings({ ...settings, whatsapp_number: event.target.value.replace(/[^0-9]/g, '') })} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label><label className="text-xs text-muted">Enlace de Telegram (opcional)<input value={settings.telegram_url ?? ""} onChange={(event) => setSettings({ ...settings, telegram_url: event.target.value || null })} placeholder="https://t.me/usuario" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label></div><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.exports_enabled_during_trial} onChange={(event) => setSettings({ ...settings, exports_enabled_during_trial: event.target.checked })}/>Permitir exportaciones durante la prueba</label><div className="mt-4 flex justify-end"><button disabled={savingSettings} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brass px-4 text-sm font-bold text-obsidian disabled:opacity-50"><Save size={15}/>{savingSettings ? "Guardando…" : "Guardar configuración"}</button></div></form>}
      <section className="mt-7 rounded-2xl border border-line bg-panel p-5"><div className="mb-4 flex items-center gap-2"><CreditCard size={18} className="text-brass"/><h2 className="font-semibold">Pagos recientes</h2></div>{payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-muted"><tr><th className="px-3 py-2">Barbería</th><th className="px-3 py-2">Método</th><th className="px-3 py-2">Referencia</th><th className="px-3 py-2">Periodo</th><th className="px-3 py-2">Confirmó</th><th className="px-3 py-2 text-right">Valor</th></tr></thead><tbody className="divide-y divide-line">{payments.map((payment) => { const shop = Array.isArray(payment.tenants) ? payment.tenants[0]?.name : payment.tenants?.name; const profile = Array.isArray(payment.profiles) ? payment.profiles[0]?.full_name : payment.profiles?.full_name; return <tr key={payment.id}><td className="px-3 py-3">{shop ?? payment.tenant_id.slice(0,8)}</td><td className="px-3 py-3">{payment.payment_method === "transfer" ? "Transferencia" : payment.payment_method === "cash" ? "Efectivo" : "Cortesía"}</td><td className="px-3 py-3 text-muted">{payment.reference ?? "—"}</td><td className="px-3 py-3 text-muted">{new Date(payment.period_starts_at).toLocaleDateString("es-EC")} – {new Date(payment.period_ends_at).toLocaleDateString("es-EC")}</td><td className="px-3 py-3 text-muted">{profile ?? payment.recorded_by.slice(0,8)}</td><td className="px-3 py-3 text-right">{formatUsd(Number(payment.amount))}</td></tr>; })}</tbody></table></div> : <p className="text-sm text-muted">Todavía no hay pagos confirmados.</p>}</section>
      <p className="mt-4 flex items-center gap-2 text-xs leading-5 text-muted"><MessageCircle size={14}/>WhatsApp de soporte: {settings?.whatsapp_number ?? "593989253675"}. El MRR estima ingresos a partir de las suscripciones activas; no sustituye los pagos registrados.</p>
    </div>
  </div>;
}
