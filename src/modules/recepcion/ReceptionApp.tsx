import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, Clock3, Plus, Scissors, ScreenShare, Users, X } from "lucide-react";
import { supabase } from "../../shared/lib/supabaseClient";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { errorMessage } from "../../shared/lib/errors";
import { DemoDataBanner } from "../../shared/ui/DemoDataBanner";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";

type QueueStatus = "waiting" | "called" | "in-chair" | "complete" | "cancelled";
interface ServiceOption { id: string; name: string; duration_minutes: number; price: number; }
interface BarberOption { id: string; name: string; station_id: string; }
interface QueueRow {
  id: string;
  appointment_id: string | null;
  client_id: string | null;
  guest_name: string;
  guest_phone: string;
  service_id: string;
  barber_id: string | null;
  station_id: string | null;
  channel: "walk-in" | "booking" | "qr";
  status: QueueStatus;
  queue_number: number;
  checked_in_at: string;
  started_at: string | null;
  service: ServiceOption | null;
  barber: BarberOption | null;
}

const QUEUE_SELECT = "id, appointment_id, client_id, guest_name, guest_phone, service_id, barber_id, station_id, channel, status, queue_number, checked_in_at, started_at, service:services!queue_visits_service_id_fkey(id, name, duration_minutes, price), barber:barbers!queue_visits_barber_id_fkey(id, name, station_id)";
const columns: { status: "waiting" | "in-chair" | "cancelled"; title: string; subtitle: string; color: string }[] = [
  { status: "waiting", title: "Sala de espera", subtitle: "Esperando o llamado", color: "text-brass" },
  { status: "in-chair", title: "En silla", subtitle: "Servicio en curso", color: "text-electric" },
  { status: "cancelled", title: "Cerrados", subtitle: "Cancelados o completados", color: "text-muted" },
];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
const elapsed = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));

export default function ReceptionApp() {
  const location = useLocation();
  const tenantId = useAuthStore((state) => state.session?.user.tenantId);
  const isTv = location.pathname.endsWith("/tv");
  const [visits, setVisits] = useState<QueueRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [barbers, setBarbers] = useState<BarberOption[]>([]);
  const [activeBarberIds, setActiveBarberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingWalkIn, setSavingWalkIn] = useState(false);
  const walkInSubmission = useRef(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(new Date());

  const loadData = useCallback(async () => {
    setError("");
    if (!tenantId) { setError("Tu usuario no está asignado a una barbería."); setLoading(false); return; }
    try {
      const [queueResult, recentResult, serviceResult, barberResult, activeOrdersResult] = await Promise.all([
        supabase.from("queue_visits").select(QUEUE_SELECT).eq("tenant_id", tenantId).in("status", ["waiting", "called", "in-chair"]).order("queue_number", { ascending: true }).limit(250),
        supabase.from("queue_visits").select(QUEUE_SELECT).eq("tenant_id", tenantId).in("status", ["complete", "cancelled"]).gte("checked_in_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString()).order("queue_number", { ascending: false }).limit(50),
        supabase.from("services").select("id, name, duration_minutes, price").eq("tenant_id", tenantId).eq("active", true).order("name"),
        supabase.from("barbers").select("id, name, station_id").eq("tenant_id", tenantId).eq("active", true).order("name"),
        supabase.from("service_orders").select("barber_id").eq("tenant_id", tenantId).eq("status", "in-service"),
      ]);
      if (queueResult.error) throw queueResult.error;
      if (recentResult.error) throw recentResult.error;
      if (serviceResult.error) throw serviceResult.error;
      if (barberResult.error) throw barberResult.error;
      if (activeOrdersResult.error) throw activeOrdersResult.error;
      setVisits([...(queueResult.data ?? []), ...(recentResult.data ?? [])]);
      setServices(serviceResult.data ?? []);
      setBarbers(barberResult.data ?? []);
      setActiveBarberIds([...new Set((activeOrdersResult.data ?? []).flatMap((order) => order.barber_id ? [order.barber_id] : []))]);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo cargar la cola de recepción."));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    void loadData();
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => { window.clearInterval(timer); };
  }, [loadData, tenantId]);
  useTenantRealtime(tenantId, [{ table: "queue_visits" }, { table: "service_orders" }, { table: "services" }, { table: "barbers" }], loadData);

  const shownServices = services;
  const shownBarbers = barbers;
  const shownVisits = visits;

  const stats = useMemo(() => ({
    waiting: shownVisits.filter((visit) => visit.status === "waiting" || visit.status === "called").length,
    chair: shownVisits.filter((visit) => visit.status === "in-chair").length,
    closed: shownVisits.filter((visit) => visit.status === "cancelled" || visit.status === "complete").length,
  }), [shownVisits]);

  async function updateStatus(visit: QueueRow, status: QueueStatus) {
    setBusyId(visit.id);
    setError("");
    try {
      const { error: transitionError } = await supabase.rpc("transition_queue_visit", { p_visit_id: visit.id, p_status: status });
      if (transitionError) throw transitionError;
      await loadData();
      setToast(status === "called" ? `${visit.guest_name} fue llamado` : status === "in-chair" ? `${visit.guest_name} pasó a silla` : "Estado actualizado");
      window.setTimeout(() => setToast(""), 2500);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo actualizar el turno."));
    } finally {
      setBusyId(null);
    }
  }

  async function assignBarber(visit: QueueRow, barberId: string) {
    if (!barberId || busyId) return;
    setBusyId(visit.id);
    setError("");
    try {
      const { error: assignError } = await supabase.rpc("assign_queue_visit_barber", { p_visit_id: visit.id, p_barber_id: barberId });
      if (assignError) throw assignError;
      await loadData();
      setToast(`Barbero asignado a ${visit.guest_name}; el turno sigue en cola.`);
      window.setTimeout(() => setToast(""), 3000);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo asignar el barbero."));
    } finally {
      setBusyId(null);
    }
  }

  async function addWalkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (walkInSubmission.current) return;
    walkInSubmission.current = true;
    setSavingWalkIn(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const barberId = String(form.get("barber_id") ?? "");
    try {
      const { error: insertError } = await supabase.rpc("create_walk_in", {
        p_guest_name: String(form.get("guest_name") ?? "").trim(),
        p_guest_phone: String(form.get("guest_phone") ?? "").trim(),
        p_service_id: String(form.get("service_id") ?? ""),
        ...(barberId ? { p_barber_id: barberId } : {}),
      });
      if (insertError) throw insertError;
      setShowWalkIn(false);
      setToast("Walk-In agregado a la cola");
      window.setTimeout(() => setToast(""), 2500);
      await loadData();
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo registrar el Walk-In."));
    } finally {
      walkInSubmission.current = false;
      setSavingWalkIn(false);
    }
  }

  if (isTv) return <TvWaitlist visits={shownVisits} clock={clock} loading={loading} error={error} demoMode={false}/>;

  return <main className="min-h-screen bg-obsidian text-stone-100"><div className="mx-auto max-w-[1600px] px-4 pb-8 pt-5 md:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl border border-brass/30 bg-brass/10 text-brass"><Scissors size={20}/></div><div><p className="text-[11px] font-bold uppercase tracking-[.24em] text-brass">Barber Lounge</p><p className="mt-0.5 text-sm text-muted">Recepción · Operaciones</p></div></div><div className="flex items-center gap-2"><a href="/tv" className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-stone-300 hover:border-brass/40 hover:text-brass"><ScreenShare size={17}/>Vista Smart TV</a><button onClick={() => setShowWalkIn(true)} className="flex min-h-12 items-center gap-2 rounded-xl bg-brass px-4 text-sm font-bold text-obsidian"><Plus size={19}/>Nuevo Walk-In</button></div></header>
    <section className="flex flex-wrap items-end justify-between gap-4 py-6"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted">Control de flujo</p><h1 className="mt-2 text-3xl font-semibold md:text-4xl">Sala de servicio</h1><p className="mt-2 text-sm text-muted">Cola sincronizada con la base de datos en tiempo real.</p></div><div className="flex items-center gap-2 text-xs text-muted"><CalendarDays size={15}/>{clock.toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" })}</div></section>
    <section className="mb-6 grid grid-cols-3 gap-3 md:gap-4">{[{ label: "En espera", value: stats.waiting, icon: Clock3, color: "text-brass" }, { label: "En silla", value: stats.chair, icon: Scissors, color: "text-electric" }, { label: "Cerrados", value: stats.closed, icon: CheckCircle2, color: "text-muted" }].map(({ label, value, icon: Icon, color }) => <article key={label} className="rounded-2xl border border-line bg-panel p-4 md:p-5"><div className="flex items-center justify-between"><span className="text-xs text-muted md:text-sm">{label}</span><Icon size={17} className={color}/></div><p className="mt-2 text-2xl font-bold tabular-nums md:text-3xl">{value}</p></article>)}</section>
    {error && <p role="alert" className="mb-4 rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <LoadingState/> : <section className="grid items-start gap-4 lg:grid-cols-2">{columns.filter((column) => column.status !== "cancelled").map((column) => {
      const items = shownVisits.filter((visit) => column.status === "waiting" ? visit.status === "waiting" || visit.status === "called" : column.status === "cancelled" ? visit.status === "cancelled" || visit.status === "complete" : visit.status === column.status).sort((a, b) => a.queue_number - b.queue_number);
      return <section key={column.status} className="min-h-64 rounded-2xl border border-line bg-[#131315] p-3 md:p-4"><div className="mb-3 flex items-center justify-between px-1"><div><h2 className="font-semibold">{column.title}</h2><p className="mt-0.5 text-xs text-muted">{column.subtitle}</p></div><span className={`grid h-8 min-w-8 place-items-center rounded-lg bg-white/5 px-2 text-sm font-bold ${column.color}`}>{items.length}</span></div><div className="space-y-3">{items.map((visit) => <QueueCard key={visit.id} visit={visit} barbers={shownBarbers} activeBarberIds={activeBarberIds} busy={busyId === visit.id} barberBusy={!!visit.barber_id && activeBarberIds.includes(visit.barber_id)} onChange={updateStatus} onAssign={assignBarber}/>)}{items.length === 0 && <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-line px-4 text-center text-xs text-muted">No hay clientes en esta columna.</div>}</div></section>;
    })}</section>}
    {!loading && <section className="mt-4 overflow-hidden rounded-2xl border border-line bg-[#131315]"><button type="button" aria-expanded={showClosed} onClick={() => setShowClosed((open) => !open)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left hover:bg-white/[.02] md:px-5"><span className="flex min-w-0 items-center gap-3"><span className="grid h-9 min-w-9 place-items-center rounded-lg bg-white/5 px-2 text-sm font-bold text-muted">{stats.closed}</span><span><span className="block text-sm font-semibold">Cerrados recientes</span><span className="block text-xs text-muted">Cancelados o completados · últimas 24 horas</span></span></span><ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${showClosed ? "rotate-180" : ""}`}/></button>{showClosed && <div className="max-h-[min(60vh,32rem)] divide-y divide-line overflow-y-auto border-t border-line">{shownVisits.filter((visit) => visit.status === "cancelled" || visit.status === "complete").sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime()).map((visit) => <ClosedVisitRow key={visit.id} visit={visit}/>)}{stats.closed === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No hay turnos cerrados en las últimas 24 horas.</p>}</div>}</section>}
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted"><span className="flex items-center gap-2"><Users size={14}/>{shownVisits.length} registros de cola</span><span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-electric"/>En vivo · {clock.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</span></footer>
  </div>
  {showWalkIn && <WalkInModal services={shownServices} barbers={shownBarbers} activeBarberIds={activeBarberIds} saving={savingWalkIn} onClose={() => setShowWalkIn(false)} onSubmit={addWalkIn}/>}
  {toast && <div role="status" className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel-raised px-4 py-3 text-sm shadow-2xl"><CheckCircle2 size={16} className="text-electric"/>{toast}</div>}
  </main>;
}

function QueueCard({ visit, barbers, activeBarberIds, busy, barberBusy, onChange, onAssign }: { visit: QueueRow; barbers: BarberOption[]; activeBarberIds: string[]; busy: boolean; barberBusy: boolean; onChange: (visit: QueueRow, status: QueueStatus) => void; onAssign: (visit: QueueRow, barberId: string) => void }) {
  const waiting = visit.status === "waiting" || visit.status === "called";
  const closed = visit.status === "complete" || visit.status === "cancelled";
  return <article className="rounded-xl border border-line bg-panel p-4"><div className="flex items-start gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold ${visit.status === "in-chair" ? "bg-electric/10 text-electric" : "bg-brass/10 text-brass"}`}>{initials(visit.guest_name)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold">{visit.guest_name}</h3><span className="rounded bg-brass/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brass">{visit.channel}</span></div><p className="mt-1 truncate text-xs text-muted">{visit.service?.name ?? "Servicio"} · {visit.service?.duration_minutes ?? 0} min</p><div className="mt-1 flex flex-wrap items-center gap-2"><p className="truncate text-xs text-stone-400">{visit.barber?.name ?? "Sin asignar"}{visit.station_id ? ` · Silla ${visit.station_id.replace("chair_", "")}` : ""}</p>{waiting && <label className="sr-only" htmlFor={`queue-barber-${visit.id}`}>Asignar barbero a {visit.guest_name}</label>}{waiting && <select id={`queue-barber-${visit.id}`} value={visit.barber_id ?? ""} disabled={busy} onChange={(event) => { if (event.target.value) onAssign(visit, event.target.value); }} className="min-h-8 max-w-full rounded-md border border-line bg-obsidian px-2 text-[11px] text-stone-200"><option value="" disabled>{visit.barber_id ? "Cambiar barbero" : "Asignar barbero"}</option>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}{activeBarberIds.includes(barber.id) ? " · Ocupado" : " · Disponible"}</option>)}</select>}</div></div></div><div className="mt-4 flex items-center justify-between border-t border-line pt-3"><span className="flex items-center gap-1.5 text-xs text-muted"><Clock3 size={13}/>{closed ? visit.status === "complete" ? "Completado" : "Cancelado" : visit.status === "in-chair" ? `${elapsed(visit.started_at ?? visit.checked_in_at)} min` : `${elapsed(visit.checked_in_at)} min esperando`}</span><div className="flex items-center gap-2">{barberBusy && waiting && <span className="text-[10px] font-semibold text-warning">Barbero ocupado · sigue en espera</span>}{waiting && visit.status === "waiting" && !barberBusy && visit.barber_id && <button disabled={busy} onClick={() => onChange(visit, "called")} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-brass px-3 text-xs font-bold text-obsidian disabled:opacity-50">Llamar <ArrowRight size={15}/></button>}{visit.status === "called" && <button disabled={busy || barberBusy || !visit.barber_id} onClick={() => onChange(visit, "in-chair")} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-electric px-3 text-xs font-bold text-obsidian disabled:opacity-50">{barberBusy ? "Esperar" : !visit.barber_id ? "Asignar" : "Sentar"} {(visit.barber_id && !barberBusy) && <ArrowRight size={15}/>}</button>}{visit.status === "in-chair" && <button disabled={busy} onClick={() => onChange(visit, "cancelled")} className="flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-muted disabled:opacity-50"><X size={15}/>Cancelar</button>}{visit.status === "called" && <button disabled={busy} onClick={() => onChange(visit, "cancelled")} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-line text-muted disabled:opacity-50" aria-label="Cancelar turno"><X size={15}/></button>}</div></div></article>;
}

function ClosedVisitRow({ visit }: { visit: QueueRow }) {
  const completed = visit.status === "complete";
  return <article className="flex items-center gap-3 px-4 py-3 md:px-5"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${completed ? "bg-electric/10 text-electric" : "bg-white/5 text-muted"}`}>{initials(visit.guest_name)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{visit.guest_name}</p><p className="truncate text-xs text-muted">{visit.service?.name ?? "Servicio"} · {visit.barber?.name ?? "Sin asignar"}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${completed ? "bg-electric/10 text-electric" : "bg-white/5 text-muted"}`}>{completed ? "Completado" : "Cancelado"}</span><time className="hidden shrink-0 text-xs tabular-nums text-muted sm:block">{new Date(visit.checked_in_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</time></article>;
}

function WalkInModal({ services, barbers, activeBarberIds, saving, onClose, onSubmit }: { services: ServiceOption[]; barbers: BarberOption[]; activeBarberIds: string[]; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="walkin-title" className="my-auto w-full max-w-xl rounded-3xl border border-line bg-panel p-5 shadow-2xl md:p-7"><header className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-brass">Alta rápida</p><h2 id="walkin-title" className="mt-2 text-2xl font-semibold">Nuevo Walk-In</h2></div><button disabled={saving} onClick={onClose} aria-label="Cerrar formulario" className="grid h-11 w-11 place-items-center rounded-xl border border-line text-muted disabled:opacity-50"><X size={18}/></button></header><form onSubmit={onSubmit} className="mt-6 space-y-4"><label className="block"><span className="mb-2 block text-xs font-semibold text-stone-300">Nombre</span><input autoFocus required name="guest_name" maxLength={100} className="min-h-14 w-full rounded-xl border border-line bg-obsidian px-4 text-base outline-none focus:border-brass"/></label><label className="block"><span className="mb-2 block text-xs font-semibold text-stone-300">Teléfono</span><input name="guest_phone" type="tel" inputMode="tel" maxLength={30} className="min-h-14 w-full rounded-xl border border-line bg-obsidian px-4 text-base outline-none focus:border-brass"/></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-xs font-semibold text-stone-300">Servicio</span><select required name="service_id" defaultValue="" className="min-h-14 w-full rounded-xl border border-line bg-obsidian px-3 text-sm"><option value="" disabled>Selecciona servicio</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label className="block"><span className="mb-2 block text-xs font-semibold text-stone-300">Barbero</span><select name="barber_id" defaultValue="" className="min-h-14 w-full rounded-xl border border-line bg-obsidian px-3 text-sm"><option value="">Asignar luego en recepción</option>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}{activeBarberIds.includes(barber.id) ? " · Ocupado (quedará en espera)" : " · Disponible"}</option>)}</select><small className="mt-1 block text-[11px] text-muted">Puedes dejarlo sin asignar o asignar un barbero ocupado; el cliente permanecerá en espera.</small></label></div><div className="grid grid-cols-2 gap-3 pt-2"><button type="button" disabled={saving} onClick={onClose} className="min-h-14 rounded-xl border border-line text-sm font-semibold disabled:opacity-50">Cancelar</button><button type="submit" disabled={saving} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brass text-sm font-bold text-obsidian disabled:opacity-50"><Plus size={18}/>{saving ? "Agregando…" : "Agregar a espera"}</button></div></form></section></div>;
}

function TvWaitlist({ visits, clock, loading, error, demoMode }: { visits: QueueRow[]; clock: Date; loading: boolean; error: string; demoMode: boolean }) {
  const waiting = visits.filter((visit) => visit.status === "waiting" || visit.status === "called").sort((a, b) => a.queue_number - b.queue_number);
  const active = visits.filter((visit) => visit.status === "in-chair");
  return <main className="min-h-screen bg-obsidian text-stone-100"><div className="mx-auto flex min-h-screen max-w-[1800px] flex-col px-6 py-8 md:px-12 xl:px-20"><header className="flex items-center justify-between border-b border-line pb-7"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl border border-brass/30 bg-brass/10 text-brass"><Scissors size={26}/></div><div><p className="text-sm font-bold uppercase tracking-[.25em] text-brass">Barber Lounge</p><p className="mt-1 text-sm text-muted">Manta · Sala de espera</p></div></div><div className="text-right"><p className="text-3xl font-semibold tabular-nums md:text-5xl">{clock.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</p><p className="mt-1 text-sm text-muted">{clock.toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" })}</p></div></header><div className="mt-4"><DemoDataBanner active={demoMode}/></div>{error && <p className="mt-5 text-center text-red-300">{error}</p>}<div className="grid flex-1 gap-8 py-8 lg:grid-cols-[1.2fr_.8fr]"><section><div className="mb-5 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-brass">Próximos turnos</p><h1 className="mt-2 text-4xl font-semibold md:text-6xl">En espera</h1></div><span className="text-4xl font-bold text-brass">{waiting.length}</span></div>{loading ? <LoadingState/> : <div className="space-y-3">{waiting.map((visit, index) => <article key={visit.id} className="flex items-center gap-5 rounded-2xl border border-line bg-panel px-5 py-4 md:px-7 md:py-5"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brass/10 text-xl font-bold text-brass md:h-20 md:w-20 md:text-3xl">{index + 1}</span><div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold md:text-3xl">{visit.guest_name}</h2><p className="mt-1 truncate text-sm text-muted md:text-lg">{visit.service?.name} · {visit.barber?.name}</p></div><span className="hidden rounded-lg bg-brass/10 px-3 py-2 text-sm font-bold text-brass md:block">{visit.status === "called" ? "LLAMADO" : "EN ESPERA"}</span></article>)}</div>}</section><section className="rounded-3xl border border-line bg-[#131315] p-5 md:p-7"><p className="text-xs font-bold uppercase tracking-[.2em] text-electric">Atendiendo ahora</p><h2 className="mt-2 text-3xl font-semibold md:text-4xl">En silla</h2><div className="mt-5 space-y-3">{active.map((visit) => <article key={visit.id} className="rounded-2xl border border-electric/20 bg-electric/[.04] p-5"><p className="text-2xl font-semibold md:text-3xl">{visit.guest_name}</p><p className="mt-2 text-sm text-muted md:text-lg">{visit.barber?.name} · Silla {visit.station_id?.replace("chair_", "")}</p></article>)}{active.length === 0 && !loading && <p className="py-8 text-sm text-muted">Las sillas están disponibles.</p>}</div><div className="mt-8 rounded-2xl border border-brass/15 bg-brass/[.04] p-5"><p className="text-sm font-semibold text-brass">Bienvenido a Barber Lounge</p><p className="mt-2 text-sm leading-6 text-muted">Gracias por tu visita. Nuestro equipo te atenderá en breve.</p></div></section></div><footer className="border-t border-line pt-5 text-center text-xs text-muted">Actualizado automáticamente · {visits.length} turnos registrados</footer></div></main>;
}

function LoadingState() { return <div className="grid min-h-36 place-items-center rounded-xl border border-line text-sm text-muted">Cargando datos…</div>; }
