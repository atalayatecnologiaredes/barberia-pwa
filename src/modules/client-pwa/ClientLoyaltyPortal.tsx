import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Clock3, Gift, RefreshCw, Scissors, ShieldAlert, Sparkles, UserRound, XCircle } from "lucide-react";
import { supabase } from "../../shared/lib/supabaseClient";
import type { Json } from "../../shared/lib/database.types";
import { errorMessage } from "../../shared/lib/errors";

interface LoyaltyPortalData {
  client: { name: string; tier: string; points: number; visits: number };
  barber_shop: { name: string };
  ledger: { points: number; entry_type: string; description: string; created_at: string }[];
  queue: null | { id: string; status: string; queue_number: number; position: number; service_name: string; barber_name: string; station_id: string | null; checked_in_at: string };
  history: { service: string | null; barber: string | null; status: string; date: string; amount: number }[];
  services: { id: string; name: string; price: number; duration_minutes: number }[];
  barbers: { id: string; name: string; station_id: string }[];
}
interface ClientAppointment { id:string; starts_at:string; ends_at:string|null; status:string; confirmation_code:string|null; service:string|null; barber:string|null; }
const appointmentStatus:Record<string,string>={confirmed:"Confirmada",waiting:"En recepción", "in-chair":"En silla", complete:"Completada", cancelled:"Cancelada", "no-show":"No asistió"};
const localDateTime=()=>{const date=new Date(Date.now()+60*60*1000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};

type JsonObject = { [key: string]: Json | undefined };
const objectValue = (value: Json | undefined): JsonObject | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
const stringValue = (value: Json | undefined): string | null => typeof value === "string" ? value : null;
const numberValue = (value: Json | undefined): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const nullableString = (value: Json | undefined): string | null | undefined => value === null ? null : stringValue(value) ?? undefined;

function parseArray<T>(value: Json | undefined, parse: (item: Json) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.every((item): item is T => item !== null) ? parsed : null;
}

function parseClientAppointment(value: Json): ClientAppointment | null {
  const row = objectValue(value);
  if (!row) return null;
  const id = stringValue(row.id), startsAt = stringValue(row.starts_at), status = stringValue(row.status);
  const endsAt = nullableString(row.ends_at), confirmationCode = nullableString(row.confirmation_code);
  const service = nullableString(row.service), barber = nullableString(row.barber);
  if (!id || !startsAt || !status || endsAt === undefined || confirmationCode === undefined || service === undefined || barber === undefined) return null;
  return { id, starts_at: startsAt, ends_at: endsAt, status, confirmation_code: confirmationCode, service, barber };
}

function parseLoyaltyPortal(value: Json): LoyaltyPortalData | null {
  const portal = objectValue(value), client = objectValue(portal?.client), shop = objectValue(portal?.barber_shop);
  if (!portal || !client || !shop) return null;
  const name = stringValue(client.name), tier = stringValue(client.tier), points = numberValue(client.points), visits = numberValue(client.visits), shopName = stringValue(shop.name);
  if (!name || !tier || points === null || visits === null || !shopName) return null;
  const ledger = parseArray(portal.ledger, (item) => { const row = objectValue(item); if (!row) return null; const points = numberValue(row.points), entry_type = stringValue(row.entry_type), description = stringValue(row.description), created_at = stringValue(row.created_at); return points === null || !entry_type || description === null || !created_at ? null : { points, entry_type, description, created_at }; });
  const history = parseArray(portal.history, (item) => { const row = objectValue(item); if (!row) return null; const service = nullableString(row.service), barber = nullableString(row.barber), status = stringValue(row.status), date = stringValue(row.date), amount = numberValue(row.amount); return service === undefined || barber === undefined || !status || !date || amount === null ? null : { service, barber, status, date, amount }; });
  const services = parseArray(portal.services, (item) => { const row = objectValue(item); if (!row) return null; const id = stringValue(row.id), name = stringValue(row.name), price = numberValue(row.price), duration_minutes = numberValue(row.duration_minutes); return !id || !name || price === null || duration_minutes === null ? null : { id, name, price, duration_minutes }; });
  const barbers = parseArray(portal.barbers, (item) => { const row = objectValue(item); if (!row) return null; const id = stringValue(row.id), name = stringValue(row.name), station_id = stringValue(row.station_id); return !id || !name || station_id === null ? null : { id, name, station_id }; });
  let queue: LoyaltyPortalData["queue"] = null;
  if (portal.queue !== null) { const row = objectValue(portal.queue); if (!row) return null; const id = stringValue(row.id), status = stringValue(row.status), queue_number = numberValue(row.queue_number), position = numberValue(row.position), service_name = nullableString(row.service_name), barber_name = nullableString(row.barber_name), station_id = nullableString(row.station_id), checked_in_at = stringValue(row.checked_in_at); if (!id || !status || queue_number === null || position === null || service_name === undefined || barber_name === undefined || station_id === undefined || !checked_in_at) return null; queue = { id, status, queue_number, position, service_name: service_name ?? "", barber_name: barber_name ?? "", station_id, checked_in_at }; }
  if (!ledger || !history || !services || !barbers) return null;
  return { client: { name, tier, points, visits }, barber_shop: { name: shopName }, ledger, queue, history, services, barbers };
}

export default function ClientLoyaltyPortal({ token }: { token: string }) {
  const [data, setData] = useState<LoyaltyPortalData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [appointments,setAppointments]=useState<ClientAppointment[]>([]);const [appointmentsError,setAppointmentsError]=useState("");
  const [bookingServiceId,setBookingServiceId]=useState("");const [bookingBarberId,setBookingBarberId]=useState("");const [bookingTime,setBookingTime]=useState("");const [bookingNotes,setBookingNotes]=useState("");const [booking,setBooking]=useState(false);const [bookingError,setBookingError]=useState("");const [bookingMessage,setBookingMessage]=useState("");const [cancelingAppointmentId,setCancelingAppointmentId]=useState<string|null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const [{ data: result, error: rpcError }, appointmentsResult] = await Promise.all([
      supabase.rpc("read_client_loyalty", { p_token: token }),
      supabase.rpc("client_qr_list_appointments", { p_token: token }),
    ]);
    const parsedAppointments = !appointmentsResult.error && appointmentsResult.data ? parseArray(appointmentsResult.data, parseClientAppointment) : null;
    if (parsedAppointments) { setAppointments(parsedAppointments); setAppointmentsError(""); }
    else setAppointmentsError("No se pudieron cargar tus reservas. Actualiza la tarjeta e inténtalo de nuevo.");
    if (rpcError) setError("No se pudo cargar tu tarjeta. Intenta de nuevo más tarde.");
    else if (!result) { setData(null); setError("Este QR ya no es válido. Pide uno actualizado en tu barbería."); }
    else {
      const portal = parseLoyaltyPortal(result);
      if (!portal) { setData(null); setError("No se pudo interpretar la tarjeta. Intenta de nuevo más tarde."); }
      else {
        setData(portal);
        setError("");
        setServiceId((current) => current || portal.services[0]?.id || "");
        setBarberId((current) => current || portal.barbers[0]?.id || "");
        setBookingServiceId((current) => current || portal.services[0]?.id || "");
        setBookingBarberId((current) => current || portal.barbers[0]?.id || "");
        setBookingTime((current) => current || localDateTime());
      }
    }
    if (showLoading) setLoading(false);
  }, [token]);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => { void load(); }, 8_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function checkIn() {
    if (!serviceId || !barberId || checkingIn) return;
    setCheckingIn(true); setError("");
    const { error: checkInError } = await supabase.rpc("client_qr_check_in", { p_token: token, p_service_id: serviceId, p_barber_id: barberId });
    if (checkInError) setError(checkInError.message.includes("no longer valid") ? "Este QR fue revocado. Pide uno nuevo en recepción." : checkInError.message);
    else await load();
    setCheckingIn(false);
  }

  async function bookAppointment(){
    if(!bookingServiceId||!bookingBarberId||!bookingTime||booking)return;
    setBooking(true);setBookingError("");setBookingMessage("");
    try {
      const {data:result,error:bookingErrorResult}=await supabase.rpc("client_qr_book_appointment",{p_token:token,p_service_id:bookingServiceId,p_barber_id:bookingBarberId,p_starts_at:new Date(bookingTime).toISOString(),p_notes:bookingNotes});
      if(bookingErrorResult)throw bookingErrorResult;
      const resultObject = result && typeof result === "object" && !Array.isArray(result) ? result : null;
      const confirmation = resultObject && typeof resultObject.confirmation_code === "string" ? resultObject.confirmation_code : null;
      setBookingMessage(confirmation?`Reserva confirmada. Tu código es ${confirmation}.`:"Reserva confirmada.");
      setBookingNotes("");setBookingTime(localDateTime());
      await load();
    } catch(cause) {
      setBookingError(errorMessage(cause,"No se pudo crear la reserva. Inténtalo de nuevo."));
    } finally { setBooking(false); }
  }

  async function cancelAppointment(appointment:ClientAppointment){
    if(!window.confirm("¿Cancelar esta reserva?"))return;
    setCancelingAppointmentId(appointment.id);setBookingError("");setBookingMessage("");
    try {
      const {data,error:cancelError}=await supabase.rpc("client_qr_cancel_appointment",{p_token:token,p_appointment_id:appointment.id});
      if(cancelError)throw cancelError;
      if(!data)throw new Error("No se pudo cancelar: la cita pudo haber comenzado, vencido o el QR ya no es válido.");
      setBookingMessage("Reserva cancelada.");
      await load();
    } catch(cause) {
      setBookingError(errorMessage(cause,"No se pudo cancelar la reserva."));
    } finally { setCancelingAppointmentId(null); }
  }

  return <main className="min-h-screen bg-[#0d0d0e] px-4 py-8 text-stone-100">
    <div className="mx-auto max-w-lg">
      <header className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl border border-brass/30 bg-brass/10 text-brass"><Scissors size={20}/></span><div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-brass">Barber Lounge Club</p><p className="text-xs text-muted">Tu tarjeta de fidelidad</p></div></header>
      {loading ? <div className="mt-16 text-center text-sm text-muted"><RefreshCw className="mx-auto mb-3 animate-spin" size={22}/>Consultando tu membresía…</div> : error ? <section className="mt-10 rounded-2xl border border-line bg-panel p-6 text-center"><ShieldAlert className="mx-auto text-brass" size={30}/><h1 className="mt-4 text-xl font-semibold">No pudimos abrir tu tarjeta</h1><p className="mt-2 text-sm leading-6 text-muted">{error}</p></section> : data && <>
        <section className="mt-7 rounded-3xl border border-brass/25 bg-gradient-to-br from-[#302a19] via-[#211e17] to-[#17171a] p-6 shadow-brass"><p className="text-xs text-stone-400">{data.barber_shop.name}</p><h1 className="mt-1 text-2xl font-semibold">Hola, {data.client.name}</h1><div className="mt-7 flex items-end justify-between"><div><p className="text-xs text-stone-400">Puntos disponibles</p><p className="mt-1 text-4xl font-bold text-brass">{data.client.points.toLocaleString("es-EC")}</p></div><div className="text-right"><p className="text-xs text-stone-400">Nivel</p><p className="mt-1 font-semibold">{data.client.tier}</p></div></div><div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-sm text-stone-300"><Sparkles size={16} className="text-brass"/>{data.client.visits} visitas registradas</div></section>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        <section className="mt-5 rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2"><Clock3 size={18} className="text-brass"/><h2 className="font-semibold">Tu turno</h2></div>{data.queue ? <div className={`mt-4 rounded-xl border p-4 ${data.queue.status === "complete" ? "border-line bg-obsidian" : "border-electric/20 bg-electric/[.06]"}`}><p className={`text-lg font-bold ${data.queue.status === "complete" ? "text-stone-200" : "text-electric"}`}>{data.queue.status === "in-chair" ? "Ya es tu turno" : data.queue.status === "complete" ? "Turno completado" : `Turno #${data.queue.queue_number} · posición ${data.queue.position}`}</p><p className="mt-1 text-sm text-stone-300">{data.queue.service_name} · {data.queue.barber_name}</p><p className="mt-1 text-xs text-muted">{data.queue.status === "in-chair" ? `Pasa a ${data.queue.station_id ?? "tu silla"}` : data.queue.status === "complete" ? "Gracias por visitarnos. Tu saldo se actualiza al completar el pago." : "Esta pantalla se actualiza automáticamente mientras esperas."}</p></div> : <><p className="mt-2 text-sm text-muted">Escoge un servicio y barbero para registrarte en la fila de hoy.</p><label className="mt-4 block text-xs text-muted">Servicio<select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-stone-100">{data.services.map((service) => <option key={service.id} value={service.id}>{service.name} · ${Number(service.price).toFixed(2)}</option>)}</select></label><label className="mt-3 block text-xs text-muted">Barbero<select value={barberId} onChange={(event) => setBarberId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-stone-100">{data.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label><button onClick={() => void checkIn()} disabled={checkingIn || !data.services.length || !data.barbers.length} className="mt-4 min-h-12 w-full rounded-xl bg-brass px-4 text-sm font-bold text-obsidian disabled:opacity-50">{checkingIn ? "Registrando…" : "Registrarme en la fila"}</button>{(!data.services.length || !data.barbers.length) && <p className="mt-2 text-xs text-muted">La barbería aún no ha publicado servicios o barberos activos.</p>}</>}</section>
        <section className="mt-5 rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2"><CalendarDays size={18} className="text-brass"/><h2 className="font-semibold">Reservar una cita</h2></div><p className="mt-2 text-sm text-muted">Elige horario, servicio y barbero. La reserva se confirma si hay disponibilidad.</p>{bookingError&&<p role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{bookingError}</p>}{bookingMessage&&<p role="status" className="mt-3 rounded-lg border border-electric/20 bg-electric/10 p-3 text-xs text-electric">{bookingMessage}</p>}<label className="mt-4 block text-xs text-muted">Servicio<select value={bookingServiceId} onChange={e=>setBookingServiceId(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-obsidian px-3 text-sm">{data.services.map(s=><option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min · ${Number(s.price).toFixed(2)}</option>)}</select></label><label className="mt-3 block text-xs text-muted">Barbero<select value={bookingBarberId} onChange={e=>setBookingBarberId(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-obsidian px-3 text-sm">{data.barbers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="mt-3 block text-xs text-muted">Fecha y hora<input type="datetime-local" min={localDateTime()} value={bookingTime} onChange={e=>setBookingTime(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-obsidian px-3 text-sm"/></label><label className="mt-3 block text-xs text-muted">Nota (opcional)<input value={bookingNotes} maxLength={500} onChange={e=>setBookingNotes(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-obsidian px-3 text-sm"/></label><button disabled={booking||!bookingTime||!data.services.length||!data.barbers.length} onClick={()=>void bookAppointment()} className="mt-4 min-h-11 w-full rounded-xl bg-brass px-4 text-sm font-bold text-obsidian disabled:opacity-50">{booking?"Reservando…":"Confirmar reserva"}</button><div className="mt-5 border-t border-line pt-4"><h3 className="text-sm font-semibold">Tus próximas reservas</h3>{appointmentsError?<p className="mt-2 text-xs text-red-200">{appointmentsError}</p>:appointments.length===0?<p className="mt-2 text-xs text-muted">No tienes reservas pendientes.</p>:<ul className="mt-2 divide-y divide-line">{appointments.map(a=><li key={a.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><b className="block text-sm">{a.service}</b><small className="text-muted">{new Date(a.starts_at).toLocaleString("es-EC",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} · {a.barber||"Barbero"}</small>{a.confirmation_code&&<small className="block text-muted">Código {a.confirmation_code}</small>}<small className="block text-muted">{appointmentStatus[a.status]??a.status}</small></span>{a.status==="confirmed"&&new Date(a.starts_at)>new Date()&&<button disabled={cancelingAppointmentId===a.id} onClick={()=>void cancelAppointment(a)} aria-label="Cancelar reserva" className="grid min-h-10 w-10 place-items-center rounded-lg border border-line text-muted disabled:opacity-50">{cancelingAppointmentId===a.id?<RefreshCw size={16} className="animate-spin"/>:<XCircle size={17}/>}</button>}</li>)}</ul>}</div></section>
        <section className="mt-5 rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2"><Gift size={18} className="text-brass"/><h2 className="font-semibold">Actividad de puntos</h2></div>{data.ledger.length ? <ul className="mt-4 divide-y divide-line">{data.ledger.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{entry.description || (entry.entry_type === "earned" ? "Puntos acumulados" : "Movimiento de puntos")}</p><p className="mt-1 text-xs text-muted">{new Date(entry.created_at).toLocaleDateString("es-EC", { dateStyle: "medium" })}</p></div><span className={`text-sm font-bold ${entry.points >= 0 ? "text-electric" : "text-red-300"}`}>{entry.points > 0 ? "+" : ""}{entry.points} pts</span></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aún no hay movimientos en tu tarjeta.</p>}</section>
        <section className="mt-5 rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2"><UserRound size={18} className="text-brass"/><h2 className="font-semibold">Visitas recientes</h2></div>{data.history.length ? <ul className="mt-4 divide-y divide-line">{data.history.map((visit, index) => <li key={`${visit.date}-${index}`} className="flex justify-between gap-4 py-3"><div><p className="text-sm font-medium">{visit.service}</p><p className="mt-1 text-xs text-muted">{visit.barber} · {new Date(visit.date).toLocaleDateString("es-EC", { dateStyle: "medium" })}</p></div><span className="text-xs text-muted">{visit.status === "paid" ? "Pagada" : visit.status}</span></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aún no hay visitas finalizadas.</p>}</section>
        <p className="mt-5 text-center text-xs leading-5 text-muted">Tu turno se actualiza automáticamente. Si compartiste o perdiste tu QR, pide a recepción que lo revoque y genere otro.</p>
      </>}
    </div>
  </main>;
}
