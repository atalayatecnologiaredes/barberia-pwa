import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { supabase } from "../../shared/lib/supabaseClient";
import { errorMessage } from "../../shared/lib/errors";
import { PageHeading } from "../../shared/ui/PageHeading";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-4 text-stone-100 outline-none focus:border-brass disabled:opacity-60";
const planNames: Record<string, string> = { basic: "Básico", pro: "Pro" };
const subscriptionStates: Record<string, string> = {
  trialing: "En periodo de prueba",
  active: "Activa",
  past_due: "Pago pendiente",
  suspended: "Suspendida",
  cancelled: "Cancelada",
};

export default function TenantSettingsPage() {
  const tenantId = useAuthStore((state) => state.session?.user.tenantId);
  const subscription = useAuthStore((state) => state.session?.subscription ?? null);
  const [shopName, setShopName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxPercent, setTaxPercent] = useState("15");
  const [receiptFooter, setReceiptFooter] = useState("Gracias por tu visita");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadTenant = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    if (!tenantId) {
      setError("Tu cuenta todavía no está vinculada a una barbería.");
      setLoading(false);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from("tenants")
        .select("name,phone,address,tax_rate,receipt_footer")
        .eq("id", tenantId)
        .maybeSingle();
      if (queryError) throw queryError;
      if (!data) throw new Error("No encontramos la barbería asociada a tu cuenta.");

      setShopName(data.name ?? "");
      setPhone(data.phone ?? "");
      setAddress(data.address ?? "");
      setTaxPercent(String(Number(data.tax_rate ?? 0.15) * 100));
      setReceiptFooter(data.receipt_footer ?? "Gracias por tu visita");
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo cargar la configuración de la barbería."));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void loadTenant(); }, [loadTenant]);
  useTenantRealtime(tenantId, [{ table: "tenants", tenantColumn: "id" }], loadTenant);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || loading || error) return;

    const normalizedName = shopName.trim();
    const normalizedTax = Number(taxPercent);
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      setError("El nombre comercial debe tener entre 2 y 120 caracteres.");
      return;
    }
    if (!Number.isFinite(normalizedTax) || normalizedTax < 0 || normalizedTax > 25) {
      setError("El impuesto debe estar entre 0 % y 25 %.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: updateError } = await supabase
        .from("tenants")
        .update({
          name: normalizedName,
          phone: phone.trim(),
          address: address.trim(),
          tax_rate: normalizedTax / 100,
          receipt_footer: receiptFooter.trim(),
        })
        .eq("id", tenantId)
        .select("id")
        .single();
      if (updateError) throw updateError;
      setNotice("Configuración guardada correctamente.");
    } catch (cause) {
      setError(errorMessage(cause, "No se pudieron guardar los cambios."));
    } finally {
      setSaving(false);
    }
  }

  const planCode = subscription?.planCode.toLowerCase() ?? "";
  const planName = planNames[planCode] ?? (planCode ? planCode.toUpperCase() : "Sin plan asignado");
  const statusName = subscription ? subscriptionStates[subscription.status] ?? subscription.status : "Sin suscripción";
  const nextDate = subscription?.status === "trialing"
    ? subscription.trialEndsAt
    : subscription?.currentPeriodEndsAt;

  return <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <PageHeading
      eyebrow="Administración"
      title="Configuración"
      description="Administra los datos comerciales, fiscales y del recibo de tu barbería."
      action={<button onClick={() => void loadTenant()} disabled={loading || saving} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/>Actualizar</button>}
    />

    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 rounded-xl border border-electric/20 bg-electric/10 p-4 text-sm text-electric"><CheckCircle2 size={16}/>{notice}</p>}

    {loading ? <div className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">Cargando configuración…</div> : error ? (
      <section className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">Revisa el error y vuelve a intentar cargar la configuración.</section>
    ) : <>
      <form onSubmit={(event) => void save(event)} className="rounded-2xl border border-line bg-panel p-5 md:p-6">
        <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brass/10 text-brass"><Building2 size={19}/></span><div><h2 className="font-semibold">Identidad del negocio</h2><p className="mt-1 text-sm text-muted">Estos datos aparecerán en el panel y en los recibos.</p></div></div>
        <label className="mt-5 block text-sm text-stone-300">Nombre comercial<input required minLength={2} maxLength={120} value={shopName} onChange={(event) => setShopName(event.target.value)} className={fieldClass}/></label>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-stone-300">Teléfono del negocio<input type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} className={fieldClass}/></label>
          <label className="block text-sm text-stone-300">Dirección<input maxLength={200} value={address} onChange={(event) => setAddress(event.target.value)} className={fieldClass}/></label>
          <label className="block text-sm text-stone-300">Impuesto en caja (%)<input required type="number" min="0" max="25" step="0.01" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} className={fieldClass}/><small className="mt-1 block text-xs text-muted">Se calcula y valida nuevamente al procesar el cobro.</small></label>
          <label className="block text-sm text-stone-300">Pie del recibo<input maxLength={180} value={receiptFooter} onChange={(event) => setReceiptFooter(event.target.value)} className={fieldClass}/></label>
        </div>
        <div className="mt-5 flex justify-end"><button disabled={saving || loading || !tenantId || !!error} className="min-h-12 rounded-xl bg-brass px-4 text-sm font-bold text-obsidian disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button></div>
      </form>

      <section className="rounded-2xl border border-line bg-panel p-5 md:p-6"><div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brass/10 text-brass"><Sparkles size={19}/></span><div><h2 className="font-semibold">Plan y suscripción</h2><p className="mt-1 text-sm text-muted">Plan: <strong className="text-stone-200">{planName}</strong> · Estado: <strong className="text-stone-200">{statusName}</strong></p>{nextDate && <p className="mt-1 text-sm text-muted">{subscription?.status === "trialing" ? "Fin de prueba" : "Próximo vencimiento"}: {new Date(nextDate).toLocaleDateString("es-EC")}</p>}<p className="mt-2 text-xs text-muted">La administración de planes y pagos todavía no está disponible en este panel.</p></div></div></section>
    </>}
  </div>;
}
