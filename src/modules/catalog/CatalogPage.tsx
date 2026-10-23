import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Package, Pencil, Plus, RefreshCw, Scissors } from "lucide-react";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { supabase } from "../../shared/lib/supabaseClient";
import { errorMessage } from "../../shared/lib/errors";
import { DemoDataBanner } from "../../shared/ui/DemoDataBanner";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";

type Service = { id: string; name: string; description: string; duration_minutes: number; price: number; active: boolean };
type Barber = { id: string; name: string; title: string; station_id: string; commission_service: number; commission_product: number; active: boolean };
const field = "min-h-11 w-full rounded-xl border border-line bg-obsidian px-3 text-sm outline-none focus:border-brass/50";

export default function CatalogPage() {
  const session = useAuthStore((s) => s.session);
  const tenantId = session?.user.tenantId;
  const canManage = session?.user.role === "SUPER_ADMIN";
  const [tab, setTab] = useState<"services" | "barbers">("services");
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [serviceForm, setServiceForm] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("0");
  const [barberEdit, setBarberEdit] = useState("");
  const [station, setStation] = useState("");
  const [commission, setCommission] = useState("50");
  const [productCommission, setProductCommission] = useState("10");

  const load = useCallback(async () => {
    if (!tenantId) {
      setError("El usuario no está asignado a una barbería.");
      setServices([]);
      setBarbers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [serviceResult, barberResult] = await Promise.all([
        supabase.from("services").select("id,name,description,duration_minutes,price,active").eq("tenant_id", tenantId).order("name"),
        supabase.from("barbers").select("id,name,title,station_id,commission_service,commission_product,active").eq("tenant_id", tenantId).eq("active", true).order("name"),
      ]);
      if (serviceResult.error) throw serviceResult.error;
      if (barberResult.error) throw barberResult.error;
      setServices(serviceResult.data ?? []);
      setBarbers(barberResult.data ?? []);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo cargar el catálogo."));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);
  useTenantRealtime(tenantId, [{ table: "services" }, { table: "barbers" }], load);
  const demoMode = import.meta.env.DEV && !loading && !error && services.length === 0 && barbers.length === 0;
  const shownServices = demoMode ? [
    { id: "demo-service-classic", name: "Corte clásico", description: "Corte y acabado con navaja", duration_minutes: 30, price: 15, active: true },
    { id: "demo-service-beard", name: "Corte + barba", description: "Corte, perfilado y toalla caliente", duration_minutes: 45, price: 25, active: true },
  ] : services;
  const shownBarbers = demoMode ? [
    { id: "demo-barber-mateo", name: "Mateo Rivera", title: "Barbero senior", station_id: "Silla 1", commission_service: 0.5, commission_product: 0.1, active: true },
    { id: "demo-barber-andres", name: "Andrés Vera", title: "Barbero", station_id: "Silla 2", commission_service: 0.5, commission_product: 0.1, active: true },
  ] : barbers;

  function editService(service?: Service) {
    setError(""); setNotice(""); setServiceId(service?.id ?? ""); setServiceName(service?.name ?? "");
    setServiceDescription(service?.description ?? ""); setDuration(String(service?.duration_minutes ?? 30));
    setPrice(String(service?.price ?? 0)); setServiceForm(true);
  }

  async function saveService(event: FormEvent) {
    event.preventDefault();
    if (!tenantId || !canManage) return;
    const minutes = Number(duration); const amount = Number(price); const cleanName = serviceName.trim();
    if (!cleanName || !Number.isInteger(minutes) || minutes < 5 || minutes > 480 || !Number.isFinite(amount) || amount < 0) {
      setError("Revisa el nombre, la duración (5–480 minutos) y el precio (cero o mayor)."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = { name: cleanName, description: serviceDescription.trim(), duration_minutes: minutes, price: amount };
      const result = serviceId
        ? await supabase.from("services").update(payload).eq("id", serviceId).eq("tenant_id", tenantId).select("id").maybeSingle()
        : await supabase.from("services").insert({ ...payload, id: `service_${crypto.randomUUID().replaceAll("-", "")}`, tenant_id: tenantId }).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("No se guardaron cambios. Revisa tus permisos y vuelve a intentar.");
      setServiceForm(false);
      await load();
      setNotice(serviceId ? "Servicio actualizado correctamente." : "Servicio creado correctamente.");
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo guardar el servicio. Puede existir otro con ese nombre."));
    } finally { setSaving(false); }
  }

  async function toggleService(service: Service) {
    if (!tenantId || !canManage) return;
    setError(""); setNotice("");
    const { data, error: updateError } = await supabase.from("services").update({ active: !service.active }).eq("id", service.id).eq("tenant_id", tenantId).select("id").maybeSingle();
    if (updateError || !data) { setError(errorMessage(updateError, "No se aplicó el cambio. Revisa tus permisos.")); return; }
    await load(); setNotice(service.active ? "Servicio desactivado; se conserva en las ventas anteriores." : "Servicio activado.");
  }

  function editBarber(barber: Barber) {
    setError(""); setNotice(""); setBarberEdit(barber.id); setStation(barber.station_id ?? "");
    setCommission(String(Number(barber.commission_service) * 100));
    setProductCommission(String(Number(barber.commission_product) * 100));
  }

  async function saveBarber(id: string) {
    if (!tenantId || !canManage) return;
    const serviceRate = Number(commission); const retailRate = Number(productCommission);
    if (!Number.isFinite(serviceRate) || serviceRate < 0 || serviceRate > 100 || !Number.isFinite(retailRate) || retailRate < 0 || retailRate > 100) {
      setError("Las comisiones deben estar entre 0 % y 100 %."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("barbers").update({ station_id: station.trim(), commission_service: serviceRate / 100, commission_product: retailRate / 100 }).eq("id", id).eq("tenant_id", tenantId).select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("No se guardaron cambios. Revisa tus permisos y vuelve a intentar.");
      setBarberEdit(""); await load(); setNotice("Configuración del barbero guardada.");
    } catch (cause) { setError(errorMessage(cause, "No se pudo actualizar el barbero.")); }
    finally { setSaving(false); }
  }

  async function toggleBarber(barber: Barber) {
    if (!tenantId || !canManage) return;
    setError(""); setNotice("");
    const { data, error: updateError } = await supabase.from("barbers").update({ active: !barber.active }).eq("id", barber.id).eq("tenant_id", tenantId).select("id").maybeSingle();
    if (updateError || !data) { setError(errorMessage(updateError, "No se aplicó el cambio. Revisa tus permisos.")); return; }
    await load(); setNotice(barber.active ? "Barbero desactivado." : "Barbero activado.");
  }

  return <div className="mx-auto max-w-[1450px] space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-brass">Administración</p><h1 className="mt-2 text-3xl font-semibold">Catálogo</h1><p className="mt-2 text-sm text-muted">Servicios, precios, estaciones y comisiones de tu barbería.</p></div><button onClick={() => void load()} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm disabled:opacity-50"><RefreshCw size={15}/>Actualizar</button></header>
    <DemoDataBanner active={demoMode}/>
    {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-electric/20 bg-electric/10 p-4 text-sm text-electric">{notice}</p>}
    {!canManage && <p className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">Vista de consulta. Solo el dueño puede editar servicios, estaciones y comisiones.</p>}
    <div className="flex flex-wrap gap-2"><button onClick={() => setTab("services")} className={`min-h-10 rounded-lg px-4 text-sm ${tab === "services" ? "bg-brass text-obsidian" : "border border-line text-muted"}`}>Servicios · {shownServices.length}</button><button onClick={() => setTab("barbers")} className={`min-h-10 rounded-lg px-4 text-sm ${tab === "barbers" ? "bg-brass text-obsidian" : "border border-line text-muted"}`}>Barberos · {shownBarbers.length}</button></div>
    {tab === "services" && <section className="rounded-2xl border border-line bg-panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Servicios y precios</h2><p className="mt-1 text-xs text-muted">La agenda y Caja usan el servicio y su precio actual. Desactiva los servicios que ya no ofreces.</p></div>{canManage && <button onClick={() => editService()} disabled={demoMode || saving} className="flex min-h-10 items-center gap-2 rounded-lg bg-brass px-3 text-xs font-bold text-obsidian disabled:opacity-50"><Plus size={15}/>Nuevo servicio</button>}</div>
      {serviceForm && canManage && <form onSubmit={(event) => void saveService(event)} className="mt-4 grid gap-3 rounded-xl border border-line p-4 md:grid-cols-2 xl:grid-cols-5"><label className="text-xs text-muted">Nombre<input required maxLength={100} value={serviceName} onChange={(event) => setServiceName(event.target.value)} className={`${field} mt-1`}/></label><label className="text-xs text-muted">Duración (minutos)<input required type="number" min="5" max="480" step="5" value={duration} onChange={(event) => setDuration(event.target.value)} className={`${field} mt-1`}/></label><label className="text-xs text-muted">Precio (USD)<input required type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className={`${field} mt-1`}/></label><label className="text-xs text-muted">Descripción<input maxLength={300} value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} className={`${field} mt-1`}/></label><div className="flex gap-2"><button disabled={saving} className="mt-auto flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg bg-brass text-xs font-bold text-obsidian disabled:opacity-50"><Check size={15}/>{saving ? "Guardando…" : "Guardar"}</button><button type="button" onClick={() => setServiceForm(false)} className="mt-auto min-h-11 rounded-lg border border-line px-3 text-xs">Cancelar</button></div></form>}
      {loading ? <p className="py-10 text-center text-sm text-muted">Cargando servicios…</p> : shownServices.length ? <div className="mt-4 divide-y divide-line">{shownServices.map((service) => <div key={service.id} className="flex flex-wrap items-center gap-3 py-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brass/10 text-brass"><Scissors size={17}/></span><span className="min-w-0 flex-1"><b className="block text-sm">{service.name}</b><small className="text-muted">{service.duration_minutes} min · {service.description || "Sin descripción"}</small></span><b>${Number(service.price).toFixed(2)}</b><span className={`rounded-full px-2 py-1 text-xs ${service.active ? "bg-electric/10 text-electric" : "bg-white/5 text-muted"}`}>{service.active ? "Activo" : "Inactivo"}</span>{canManage && <><button onClick={() => editService(service)} disabled={demoMode || saving} aria-label={`Editar ${service.name}`} className="grid min-h-10 w-10 place-items-center rounded-lg border border-line disabled:opacity-50"><Pencil size={15}/></button><button onClick={() => void toggleService(service)} disabled={demoMode || saving} className="min-h-10 rounded-lg border border-line px-3 text-xs disabled:opacity-50">{service.active ? "Desactivar" : "Activar"}</button></>}</div>)}</div> : <div className="py-10 text-center"><Scissors className="mx-auto text-muted"/><p className="mt-2 text-sm text-muted">Aún no hay servicios. Crea el primero para usarlo en agenda y recepción.</p></div>}
    </section>}
    {tab === "barbers" && <section className="rounded-2xl border border-line bg-panel p-5"><div><h2 className="font-semibold">Equipo de barberos</h2><p className="mt-1 text-xs text-muted">Aquí se configuran estación y porcentajes de comisión. Las invitaciones y los datos de acceso están en Equipo.</p></div>{loading ? <p className="py-10 text-center text-sm text-muted">Cargando barberos…</p> : shownBarbers.length ? <div className="mt-4 divide-y divide-line">{shownBarbers.map((barber) => <div key={barber.id} className="grid gap-3 py-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] md:items-end"><span><b className="block text-sm">{barber.name}</b><small className="text-muted">{barber.title || "Barbero"}</small></span>{barberEdit === barber.id && canManage ? <><label className="text-xs text-muted">Estación<input maxLength={60} value={station} onChange={(event) => setStation(event.target.value)} className={`${field} mt-1`}/></label><label className="text-xs text-muted">Comisión de servicios (%)<input type="number" min="0" max="100" step="0.5" value={commission} onChange={(event) => setCommission(event.target.value)} className={`${field} mt-1`}/></label><label className="text-xs text-muted">Comisión de productos (%)<input type="number" min="0" max="100" step="0.5" value={productCommission} onChange={(event) => setProductCommission(event.target.value)} className={`${field} mt-1`}/></label><button disabled={saving} onClick={() => void saveBarber(barber.id)} className="min-h-11 rounded-lg bg-brass px-3 text-xs font-bold text-obsidian disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button><button disabled={saving} onClick={() => setBarberEdit("")} className="min-h-11 rounded-lg border border-line px-3 text-xs">Cancelar</button></> : <><span className="text-sm text-muted">Estación {barber.station_id || "Sin asignar"}</span><span className="text-sm text-muted">Servicios {Number(barber.commission_service) * 100}% · Productos {Number(barber.commission_product) * 100}%</span><span className="rounded-full bg-electric/10 px-2 py-1 text-xs text-electric">Activo</span>{canManage && <button onClick={() => editBarber(barber)} disabled={demoMode || saving} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-xs disabled:opacity-50"><Pencil size={14}/>Editar</button>}{canManage && <button onClick={() => void toggleBarber(barber)} disabled={demoMode || saving} className="min-h-10 rounded-lg border border-line px-3 text-xs disabled:opacity-50">Desactivar</button>}</>}</div>)}</div> : <p className="py-10 text-center text-sm text-muted">Todavía no hay barberos activos. Invítalos o actívalos desde Equipo.</p>}</section>}
    <aside className="flex gap-3 rounded-2xl border border-line bg-panel p-4"><Package className="mt-0.5 shrink-0 text-brass" size={18}/><p className="text-sm text-muted"><b className="text-white">Productos de venta e insumos:</b> se administran en Inventario para que existencias, costos y ventas se mantengan sincronizados con Caja. Aquí se configuran los precios de servicios y las comisiones del equipo.</p></aside>
  </div>;
}
