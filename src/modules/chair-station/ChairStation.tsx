import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, LoaderCircle, Scissors, UserRound, Waves } from "lucide-react";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { supabase } from "../../shared/lib/supabaseClient";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";

interface OrderLine { id: string; item_name: string; quantity: number; unit_price: number; }
interface ServiceOrder {
  id: string;
  client_id: string | null;
  guest_name: string;
  guest_phone: string;
  barber_id: string;
  station_id: string;
  service_id: string;
  service_price: number;
  status: "in-service" | "ready-for-checkout" | "paid" | "cancelled";
  started_at: string;
  ended_at: string | null;
  service: { name: string; duration_minutes: number } | null;
  order_lines: OrderLine[];
}

const ORDER_SELECT = "id, client_id, guest_name, guest_phone, barber_id, station_id, service_id, service_price, status, started_at, ended_at, service:services!service_orders_service_id_fkey(name, duration_minutes), order_lines(id, item_name, quantity, unit_price)";
const money = (amount: number) => `$${amount.toFixed(2)}`;

export default function ChairStation() {
  const barberId = useAuthStore((state) => state.session?.user.barberId);
  const tenantId = useAuthStore((state) => state.session?.user.tenantId);
  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());

  const loadOrder = useCallback(async () => {
    if (!barberId) { setOrder(null); setLoading(false); setError("Tu usuario no está vinculado a un barbero. Solicita la asignación de barber_id."); return; }
    setError("");
    try {
      const { data, error: queryError } = await supabase.from("service_orders").select(ORDER_SELECT)
        .eq("barber_id", barberId).eq("status", "in-service").order("started_at", { ascending: true }).limit(1).maybeSingle();
      if (queryError) throw queryError;
      setOrder(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el servicio de la estación.");
    } finally {
      setLoading(false);
    }
  }, [barberId]);

  useEffect(() => {
    void loadOrder();
    if (!barberId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); };
  }, [barberId, loadOrder]);
  useTenantRealtime(tenantId, [{ table: "service_orders" }, { table: "order_lines", tenantColumn: null }], loadOrder);

  const elapsedSeconds = useMemo(() => order ? Math.max(0, Math.floor((now - new Date(order.started_at).getTime()) / 1000)) : 0, [now, order]);
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const subtotal = order ? Number(order.service_price) + order.order_lines.reduce((sum, line) => sum + Number(line.unit_price) * Number(line.quantity), 0) : 0;

  async function finishService() {
    if (!order || finishing) return;
    setFinishing(true);
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("finish_service", { p_order_id: order.id });
      if (rpcError) throw rpcError;
      setNotice("Servicio finalizado y enviado a Checkout. El consumo de insumos fue registrado.");
      setOrder(null);
      await loadOrder();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo finalizar el servicio.");
    } finally {
      setFinishing(false);
    }
  }

  return <main className="min-h-screen bg-obsidian text-stone-100"><div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-5 pb-10 pt-5 md:px-10">
    <header className="flex items-center justify-between border-b border-line pb-5"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl border border-brass/30 bg-brass/10 text-brass"><Scissors size={21}/></div><div><p className="text-[11px] font-semibold uppercase tracking-[.24em] text-brass">Barber Lounge</p><p className="mt-0.5 text-sm text-muted">Chair Station · {order?.station_id ?? "Estación"}</p></div></div><div className="hidden items-center gap-2 rounded-full border border-electric/20 bg-electric/10 px-3 py-2 text-xs font-medium text-electric sm:flex"><span className="h-2 w-2 animate-pulse rounded-full bg-electric"/>{order ? "En servicio" : "Disponible"}</div><span className="grid h-12 w-12 place-items-center rounded-full border border-line bg-panel text-sm font-bold text-brass"><UserRound size={18}/></span></header>
    {error && <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-red-300">{error}</p>}{notice && <p role="status" className="mt-5 rounded-xl border border-electric/20 bg-electric/10 p-3 text-sm text-electric">{notice}</p>}
    {loading ? <div className="grid flex-1 place-items-center text-sm text-muted"><LoaderCircle className="animate-spin"/>Cargando orden de servicio…</div> : !order ? <section className="grid flex-1 place-items-center py-16 text-center"><div><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-brass/20 bg-brass/[.07] text-brass"><Scissors size={30}/></div><h1 className="mt-6 text-2xl font-semibold">Estación disponible</h1><p className="mt-2 max-w-md text-sm leading-6 text-muted">Cuando Recepción asigne un servicio a tu barbero, aparecerá aquí.</p><button onClick={() => void loadOrder()} className="mt-5 min-h-12 rounded-xl border border-line px-4 text-sm font-semibold hover:border-brass/40">Actualizar</button></div></section> : <section className="grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,.85fr)]">
      <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted">Cliente actual</p><h1 className="mt-2 text-3xl font-semibold md:text-4xl">{order.guest_name}</h1><p className="mt-2 text-sm text-muted">{order.guest_phone || "Sin teléfono registrado"} · Orden #{order.id.slice(0, 8)}</p></div>
        <article className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-[#222126] to-[#17171a] p-6 md:p-8"><div className="flex flex-wrap items-start justify-between gap-6"><div><div className="flex items-center gap-2 text-brass"><Scissors size={17}/><span className="text-xs font-semibold uppercase tracking-[.2em]">Servicio en curso</span></div><h2 className="mt-3 text-2xl font-semibold">{order.service?.name ?? "Servicio"}</h2><p className="mt-1 text-sm text-muted">Duración prevista · {order.service?.duration_minutes ?? "—"} min</p><p className="mt-7 text-sm text-stone-300">Iniciado · {new Date(order.started_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</p></div><div className="min-w-[172px] rounded-2xl border border-white/[.07] bg-black/20 p-5"><div className="flex items-center gap-2 text-muted"><Clock3 size={15}/><span className="text-xs uppercase tracking-wider">Tiempo</span></div><div className={`mt-2 font-mono text-4xl font-semibold tabular-nums ${elapsedSeconds > (order.service?.duration_minutes ?? 45) * 60 ? "text-warning" : "text-stone-100"}`}>{elapsedLabel}</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-brass transition-all" style={{ width: `${Math.min(elapsedSeconds / ((order.service?.duration_minutes ?? 45) * 60) * 100, 100)}%` }}/></div></div></div><div className="mt-7 flex items-center justify-between border-t border-white/[.08] pt-5"><div><p className="text-xs text-muted">Barbero asignado</p><p className="mt-1 text-sm font-medium">{barberId}</p></div><span className="rounded-lg border border-electric/20 bg-electric/10 px-3 py-2 text-xs font-semibold text-electric">{order.station_id}</span></div></article>
        <div className="flex items-center gap-4 rounded-2xl border border-warning/20 bg-warning/[.06] p-5"><span className="grid h-11 w-11 place-items-center rounded-xl bg-warning/10 text-warning"><Waves size={20}/></span><div><p className="font-semibold">¿Necesitas insumos?</p><p className="mt-1 text-xs text-muted">Solicita toallas o productos a Recepción.</p></div></div>
      </div>
      <aside className="flex flex-col rounded-3xl border border-line bg-panel p-5 md:p-6"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted">Resumen de cuenta</p><h2 className="mt-2 text-xl font-semibold">Orden #{order.id.slice(0, 8)}</h2></div><div className="mt-6 space-y-4"><div className="flex justify-between gap-3"><span className="text-sm text-stone-300">{order.service?.name ?? "Servicio"}</span><span className="text-sm font-medium">{money(Number(order.service_price))}</span></div>{order.order_lines.map((line) => <div key={line.id} className="flex justify-between gap-3"><span className="text-sm text-stone-300">{line.item_name} × {line.quantity}</span><span className="text-sm">{money(Number(line.unit_price) * Number(line.quantity))}</span></div>)}</div><div className="mt-6 border-t border-line pt-4"><div className="flex justify-between text-lg font-semibold"><span>Subtotal</span><span className="text-brass">{money(subtotal)}</span></div></div><div className="mt-auto pt-6"><button disabled={finishing} onClick={() => void finishService()} className="flex min-h-[60px] w-full items-center justify-center gap-3 rounded-2xl bg-brass px-5 text-base font-bold text-obsidian disabled:cursor-wait disabled:opacity-70">{finishing ? <><LoaderCircle size={20} className="animate-spin"/>Finalizando…</> : <>Finalizar servicio <ArrowRight size={19}/></>}</button><p className="mt-3 text-center text-[11px] text-muted">Finaliza mediante la función segura de la base de datos.</p></div></aside>
    </section>}
    <footer className="border-t border-line pt-4 text-xs text-muted">La orden y el estado de servicio se leen desde Supabase.</footer>
  </div></main>;
}
