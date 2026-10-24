import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, Clock3, Package, RefreshCw, ReceiptText, ShoppingBag, Users, ChevronDown, ChevronUp, FileDown, Printer } from "lucide-react";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { supabase } from "../../shared/lib/supabaseClient";
import { errorMessage } from "../../shared/lib/errors";
import { MetricCard, PageHeading } from "../../shared/ui/PageHeading";
import { DemoDataBanner } from "../../shared/ui/DemoDataBanner";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";
import { hasTenantCapability } from "../../shared/auth/AuthStore";

type RangePreset = "today" | "7" | "30" | "90" | "custom";
type Payment = { order_id: string; receipt_code: string | null; total: number; subtotal: number; tax: number; tip: number; loyalty_discount: number; completed_at: string };
type Order = { id: string; service_id: string; barber_id: string; service_price: number; loyalty_discount: number };
type Commission = { order_id: string; barber_id: string; total: number | null };
type LabelRow = { id: string; name: string };
type Range = { from: Date; to: Date; previousFrom: Date; previousTo: Date; label: string };
type RankingMode = "amount" | "count";
type DailyPoint = { date: string; current: number; previous: number };
const money = (n: number) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(n);
const dateInputValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDate = (date: Date) => new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", year: "numeric" }).format(date);

function getRange(preset: RangePreset, customFrom: string, customTo: string): Range | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from: Date;
  let to: Date;
  if (preset === "custom") {
    if (!customFrom || !customTo) return null;
    from = new Date(`${customFrom}T00:00:00`);
    to = new Date(`${customTo}T00:00:00`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return null;
    to.setDate(to.getDate() + 1);
  } else if (preset === "today") {
    from = today;
    to = new Date(today);
    to.setDate(to.getDate() + 1);
  } else {
    const count = Number(preset);
    to = new Date(today);
    to.setDate(to.getDate() + 1);
    from = new Date(to);
    from.setDate(from.getDate() - count);
  }
  const duration = to.getTime() - from.getTime();
  const previousTo = new Date(from);
  const previousFrom = new Date(from.getTime() - duration);
  const endLabel = new Date(to);
  endLabel.setDate(endLabel.getDate() - 1);
  return { from, to, previousFrom, previousTo, label: `${localDate(from)} – ${localDate(endLabel)}` };
}

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-EC", { weekday: "short", day: "numeric", month: "short" }).format(new Date(year, month - 1, day));
}

export default function AnalyticsPage() {
  const session = useAuthStore((s) => s.session);
  const tenantId = session?.user.tenantId;
  const [preset, setPreset] = useState<RangePreset>("7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [previousPayments, setPreviousPayments] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [services, setServices] = useState<LabelRow[]>([]);
  const [barbers, setBarbers] = useState<LabelRow[]>([]);
  const [lowStock, setLowStock] = useState(0);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [rankingMode, setRankingMode] = useState<RankingMode>("amount");
  const [barberFilter, setBarberFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [requestId, setRequestId] = useState(0);
  const range = useMemo(() => getRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const load = useCallback(async (request: number) => {
    if (!tenantId) { setError("Tu usuario no está asignado a una barbería."); setLoading(false); return; }
    if (!range) { setError("Selecciona un rango de fechas válido."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [tenantOrders, stockResult, pendingResult] = await Promise.all([
        supabase.from("service_orders").select("id").eq("tenant_id", tenantId).limit(10000),
        supabase.from("inventory_items").select("quantity,minimum_quantity").eq("tenant_id", tenantId).eq("active", true),
        supabase.from("service_orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "ready-for-checkout"),
      ]);
      if (tenantOrders.error) throw tenantOrders.error;
      if (stockResult.error) throw stockResult.error;
      if (pendingResult.error) throw pendingResult.error;
      const tenantOrderIds = (tenantOrders.data ?? []).map((row) => row.id);
      const fetchPayments = async (from: Date, to: Date) => {
        if (!tenantOrderIds.length) return [];
        const rows: Payment[] = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
        const result = await supabase.from("payments").select("order_id,receipt_code,total,subtotal,tax,tip,loyalty_discount,completed_at")
            .in("order_id", tenantOrderIds).gte("completed_at", from.toISOString()).lt("completed_at", to.toISOString())
            .order("completed_at", { ascending: true }).range(offset, offset + pageSize - 1);
          if (result.error) throw result.error;
          const page = result.data ?? [];
          rows.push(...page);
          if (page.length < pageSize) break;
        }
        return rows;
      };
      const [currentRows, previousRows] = await Promise.all([
        fetchPayments(range.from, range.to),
        fetchPayments(range.previousFrom, range.previousTo),
      ]);
      const ids = [...new Set([...currentRows, ...previousRows].map((p) => p.order_id))];
      const orderRows: Order[] = [];
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const result = await supabase.from("service_orders").select("id,service_id,barber_id,service_price,loyalty_discount")
          .eq("tenant_id", tenantId).in("id", ids.slice(offset, offset + 1000));
        if (result.error) throw result.error;
        orderRows.push(...(result.data ?? []));
      }
      const commissionRows: Commission[] = [];
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const result = await supabase.from("commissions").select("order_id,barber_id,total")
          .in("order_id", ids.slice(offset, offset + 1000));
        if (result.error) throw result.error;
        commissionRows.push(...(result.data ?? []));
      }
      const [serviceResult, barberResult] = await Promise.all([
        supabase.from("services").select("id,name").eq("tenant_id", tenantId),
        supabase.from("barbers").select("id,name").eq("tenant_id", tenantId),
      ]);
      if (serviceResult.error) throw serviceResult.error;
      if (barberResult.error) throw barberResult.error;
      if (request !== requestId) return;
      setPayments(currentRows); setPreviousPayments(previousRows); setOrders(orderRows); setCommissions(commissionRows);
      setServices(serviceResult.data ?? []); setBarbers(barberResult.data ?? []);
      setLowStock((stockResult.data ?? []).filter((item) => Number(item.quantity) <= Number(item.minimum_quantity)).length);
      setPending(pendingResult.count ?? 0); setUpdatedAt(new Date());
    } catch (cause) {
      if (request === requestId) setError(errorMessage(cause, "No se pudieron cargar las métricas."));
    } finally { if (request === requestId) setLoading(false); }
  }, [tenantId, range, requestId]);

  const refresh = useCallback(() => setRequestId((current) => current + 1), []);

  useEffect(() => {
    const request = requestId;
    void load(request);
  }, [load, requestId]);
  useTenantRealtime(tenantId, [{ table: "payments", tenantColumn: null }, { table: "service_orders" }, { table: "commissions", tenantColumn: null }, { table: "inventory_items" }, { table: "services" }, { table: "barbers" }], refresh);

  const metrics = useMemo(() => {
    const serviceById = new Map(services.map((s) => [s.id, s.name]));
    const barberById = new Map(barbers.map((b) => [b.id, b.name]));
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const commissionByOrderAndBarber = new Map(commissions.map((commission) => [`${commission.order_id}:${commission.barber_id}`, commission.total ?? 0]));
    const matchesFilters = (payment: Payment) => {
      const order = orderById.get(payment.order_id);
      return (!barberFilter || order?.barber_id === barberFilter) && (!serviceFilter || order?.service_id === serviceFilter);
    };
    const visiblePayments = payments.filter(matchesFilters);
    const visiblePreviousPayments = previousPayments.filter(matchesFilters);
    const total = visiblePayments.reduce((sum, p) => sum + Number(p.total), 0);
    const previousTotal = visiblePreviousPayments.reduce((sum, p) => sum + Number(p.total), 0);
    const subtotal = visiblePayments.reduce((sum, p) => sum + Number(p.subtotal), 0);
    const tax = visiblePayments.reduce((sum, p) => sum + Number(p.tax), 0);
    const tips = visiblePayments.reduce((sum, p) => sum + Number(p.tip), 0);
    const discounts = visiblePayments.reduce((sum, p) => sum + Number(p.loyalty_discount ?? 0), 0);
    const days = new Map<string, number>();
    const previousDays = new Map<string, number>();
    for (const payment of visiblePayments) {
      const key = dateKey(payment.completed_at);
      days.set(key, (days.get(key) ?? 0) + Number(payment.total));
    }
    for (const payment of visiblePreviousPayments) {
      const key = dateKey(payment.completed_at);
      previousDays.set(key, (previousDays.get(key) ?? 0) + Number(payment.total));
    }
    const daily: DailyPoint[] = [];
    if (range) {
      const dayCount = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);
      for (let index = 0; index < dayCount; index++) {
        const currentDate = new Date(range.from);
        currentDate.setDate(currentDate.getDate() + index);
        const previousDate = new Date(range.previousFrom);
        previousDate.setDate(previousDate.getDate() + index);
        const currentKey = dateInputValue(currentDate);
        daily.push({ date: currentKey, current: days.get(currentKey) ?? 0, previous: previousDays.get(dateInputValue(previousDate)) ?? 0 });
      }
    }
    const top = (key: "service_id" | "barber_id") => {
      const totals = new Map<string, { count: number; amount: number; commission?: number }>();
      visiblePayments.forEach((payment) => {
        const order = orderById.get(payment.order_id);
        const id = order?.[key];
        if (!id) return;
        const entry = totals.get(id) ?? { count: 0, amount: 0 };
        entry.count++;
        const serviceAmount = Math.max(0, Number(order.service_price) - Number(order.loyalty_discount ?? 0));
        entry.amount += serviceAmount;
        if (key === "barber_id") entry.commission = (entry.commission ?? 0) + Number(commissionByOrderAndBarber.get(`${payment.order_id}:${id}`) ?? 0);
        totals.set(id, entry);
      });
      return [...totals.entries()].map(([id, value]) => ({
        id,
        name: (key === "service_id" ? serviceById : barberById).get(id) ?? "Sin asignar",
        ...value,
      })).sort((a, b) => rankingMode === "amount" ? b.amount - a.amount : b.count - a.count).slice(0, 5);
    };
    const change = previousTotal === 0 ? (total === 0 ? 0 : null) : ((total - previousTotal) / previousTotal) * 100;
    const details = [...visiblePayments].sort((a, b) => b.completed_at.localeCompare(a.completed_at)).map((payment) => {
      const order = orderById.get(payment.order_id);
      return { ...payment, service: serviceById.get(order?.service_id ?? "") ?? "Servicio", barber: barberById.get(order?.barber_id ?? "") ?? "Sin asignar" };
    });
    return {
      total, previousTotal, change, discounts, subtotal, tax, tips, paymentCount: visiblePayments.length, details,
      average: visiblePayments.length ? total / visiblePayments.length : 0,
      daily,
      topServices: top("service_id"), topBarbers: top("barber_id"),
    };
  }, [payments, previousPayments, orders, commissions, services, barbers, range, rankingMode, barberFilter, serviceFilter]);

  const demoMode = import.meta.env.DEV && !loading && !error && payments.length === 0 && previousPayments.length === 0 && orders.length === 0 && services.length === 0 && barbers.length === 0 && lowStock === 0 && pending === 0;
  const demoMetrics = {
    ...metrics, total: 642.5, average: 32.13, change: 12.4, discounts: 18, paymentCount: 20,
    subtotal: 558.7, tax: 83.8, tips: 0,
    daily: metrics.daily.map((point, index) => ({ ...point, current: [84, 126.5, 97, 168, 167, 0, 0][index % 7], previous: [75, 102, 110, 120, 132, 80, 70][index % 7] })),
    topServices: [{ id: "demo-cut", name: "Corte clásico", count: 9, amount: 180 }, { id: "demo-beard", name: "Corte + barba", count: 6, amount: 210 }, { id: "demo-fade", name: "Fade", count: 5, amount: 125 }],
    topBarbers: [{ id: "demo-barber-1", name: "Mateo Rivera", count: 11, amount: 354, commission: 177 }, { id: "demo-barber-2", name: "Andrés Vera", count: 9, amount: 288.5, commission: 144.25 }],
  };
  const shown = demoMode ? demoMetrics : metrics;
  const daily = shown.daily as DailyPoint[];
  const rankRows = (rows: { id: string; name: string; count: number; amount: number }[]) => rows.map((row) => ({ ...row, amount: rankingMode === "amount" ? row.amount : row.count }));
  const rangeValid = !!range;

  async function exportReport(fileFormat: "csv" | "pdf") {
    if (!tenantId || !session?.user.id || !hasTenantCapability(session, "exports") || !range) return;
    const { error: auditError } = await supabase.from("report_export_audit").insert({
      tenant_id: tenantId,
      profile_id: session.user.id,
      report_key: "analytics_payments",
      file_format: fileFormat,
      date_from: dateInputValue(range.from),
      date_to: dateInputValue(new Date(range.to.getTime() - 1)),
    });
    if (auditError) {
      setError(`No se pudo registrar la exportación: ${auditError.message}`);
      return;
    }
    if (fileFormat === "pdf") {
      window.print();
      return;
    }
    const columns = ["fecha", "recibo", "servicio", "barbero", "subtotal", "impuesto", "propina", "total"];
    const rows = shown.details.map((payment) => [payment.completed_at, payment.receipt_code ?? payment.order_id.slice(0, 8), payment.service, payment.barber, payment.subtotal, payment.tax, payment.tip, payment.total]);
    const csvCell = (value: string | number) => {
      const raw = String(value);
      const safe = /^[\t\r =+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `barber-lounge-ventas-${dateInputValue(range.from)}-${dateInputValue(new Date(range.to.getTime() - 1))}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8">
    <PageHeading eyebrow="Vista gerencial" title="Analítica" description="Revisa cobros, descuentos y actividad del equipo para el periodo elegido." action={<div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="analytics-range">Periodo</label>
      <select id="analytics-range" aria-label="Periodo" value={preset} onChange={(event) => setPreset(event.target.value as RangePreset)} className="min-h-11 rounded-xl border border-line bg-panel px-3 text-sm">
        <option value="today">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="custom">Personalizado</option>
      </select>
      {hasTenantCapability(session, "exports") && <><button onClick={() => void exportReport("csv")} disabled={loading || !range || demoMode} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm disabled:opacity-50"><FileDown size={15}/>CSV / Excel</button><button onClick={() => void exportReport("pdf")} disabled={loading || !range || demoMode} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm disabled:opacity-50"><Printer size={15}/>PDF</button></>}
      <button onClick={refresh} disabled={loading} className="grid min-h-11 w-11 place-items-center rounded-xl border border-line disabled:opacity-50" aria-label="Actualizar" title="Actualizar"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button>
    </div>}/>
    {preset === "custom" && <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-panel p-4">
      <label className="grid gap-1 text-xs text-muted">Desde<input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} className="min-h-10 rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label>
      <label className="grid gap-1 text-xs text-muted">Hasta<input type="date" value={customTo} min={customFrom || undefined} max={dateInputValue(new Date())} onChange={(event) => setCustomTo(event.target.value)} className="min-h-10 rounded-lg border border-line bg-obsidian px-3 text-sm text-stone-100"/></label>
      {!rangeValid && <p role="alert" className="pb-2 text-xs text-warning">Selecciona fechas válidas para consultar.</p>}
    </section>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span className="inline-flex items-center gap-2"><CalendarDays size={14}/>{range?.label ?? "Elige un rango de fechas"}</span><span className="inline-flex items-center gap-2"><Clock3 size={14}/>{updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}` : "Aún sin actualizar"}</span></div>
    <DemoDataBanner active={demoMode}/>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger"><span>{error}</span><button onClick={refresh} className="min-h-9 rounded-lg border border-danger/30 px-3 font-semibold">Reintentar</button></div>}
    <section aria-label="Resumen del periodo" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Total cobrado" value={loading ? "…" : money(shown.total)} detail="Incluye servicios, productos e impuestos; resta descuentos." icon={Banknote} color="text-electric"/>
      <MetricCard label="Ticket promedio" value={loading ? "…" : money(shown.average)} detail={`${shown.paymentCount} pagos confirmados en el periodo`} icon={ShoppingBag}/>
      <MetricCard label="Pagos confirmados" value={loading ? "…" : String(shown.paymentCount)} detail="Transacciones completadas en el periodo" icon={ReceiptText}/>
      <article className="rounded-2xl border border-line bg-panel p-4 md:p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted">Vs. periodo anterior</span><CalendarDays size={18} className="text-brass"/></div><p className="mt-4 text-2xl font-bold tabular-nums">{loading ? "…" : shown.change === null ? "—" : `${shown.change > 0 ? "+" : ""}${shown.change.toFixed(1)}%`}</p><p className="mt-1 text-xs text-muted">{shown.change === null ? "Sin cobros previos para comparar" : `${money(shown.previousTotal)} cobrados en el periodo anterior`}</p></article>
    </section>
    <section aria-label="Estado operativo" className="grid gap-3 sm:grid-cols-2"><MetricCard label="Órdenes en caja" value={loading ? "…" : String(demoMode ? 3 : pending)} detail="Ahora · servicios finalizados por cobrar" icon={Users}/><MetricCard label="Stock bajo" value={loading ? "…" : String(demoMode ? 2 : lowStock)} detail="Ahora · artículos en o bajo su mínimo" icon={Package} color="text-warning"/></section>
    <details className="group rounded-xl border border-line bg-panel px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium"><span>Composición de cobros</span><span className="text-xs text-muted">Abrir desglose</span></summary><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><Breakdown label="Subtotal neto" value={money(shown.subtotal)}/><Breakdown label="Impuestos" value={money(shown.tax)}/><Breakdown label="Propinas" value={money(shown.tips)}/><Breakdown label="Descuentos" value={money(shown.discounts)}/></div><p className="mt-3 text-xs leading-5 text-muted">El subtotal ya descuenta fidelidad y canjes. El total cobrado incluye subtotal, impuestos y propinas.</p></details>
    <section aria-label="Filtros de análisis" className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="analytics-barber">Filtrar barbero</label><select id="analytics-barber" value={barberFilter} onChange={(event) => setBarberFilter(event.target.value)} className="min-h-10 rounded-lg border border-line bg-panel px-3 text-sm"><option value="">Todos los barberos</option>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select><label className="sr-only" htmlFor="analytics-service">Filtrar servicio</label><select id="analytics-service" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="min-h-10 rounded-lg border border-line bg-panel px-3 text-sm"><option value="">Todos los servicios</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>{(barberFilter || serviceFilter) && <button onClick={() => { setBarberFilter(""); setServiceFilter(""); }} className="min-h-10 rounded-lg px-3 text-xs text-muted underline">Limpiar filtros</button>}</section>
    <section className="grid gap-5 xl:grid-cols-2">
      <article className="rounded-2xl border border-line bg-panel p-5"><h2 className="text-lg font-semibold">Tendencia de cobros</h2><p className="mt-1 text-xs text-muted">Compara cada día con el periodo equivalente anterior · USD</p>{daily.length ? <RevenueChart points={daily} loading={loading}/> : <Empty loading={loading} text="Todavía no hay pagos en este periodo."/>}</article>
      <article className="rounded-2xl border border-line bg-panel p-5"><RankingHeader title="Servicios más vendidos" mode={rankingMode} onModeChange={setRankingMode}/><p className="mt-1 text-xs text-muted">Monto neto del servicio tras descuentos, o cantidad de órdenes cobradas.</p>{shown.topServices.length ? <Rows rows={rankRows(shown.topServices)} mode={rankingMode}/> : <Empty loading={loading} text="Los servicios aparecerán cuando se registren cobros."/>}</article>
    </section>
    <section className="rounded-2xl border border-line bg-panel p-5"><RankingHeader title="Rendimiento por barbero" mode={rankingMode} onModeChange={setRankingMode}/><p className="mt-1 text-xs text-muted">Monto neto de los servicios atendidos; la comisión es un dato separado.</p>{shown.topBarbers.length ? <Rows rows={rankRows(shown.topBarbers)} mode={rankingMode} showCommission/> : <Empty loading={loading} text="El rendimiento aparecerá cuando se registren cobros."/>}</section>
    <section className="overflow-hidden rounded-2xl border border-line bg-panel"><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left"><span className="font-semibold">Detalle de pagos <span className="font-normal text-muted">({shown.details.length})</span></span>{detailsOpen ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>{detailsOpen && <div className="overflow-x-auto border-t border-line"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-muted"><tr><th className="px-5 py-3 font-medium">Fecha</th><th className="px-5 py-3 font-medium">Servicio · barbero</th><th className="px-5 py-3 font-medium">Recibo</th><th className="px-5 py-3 text-right font-medium">Cobrado</th></tr></thead><tbody className="divide-y divide-line">{shown.details.map((payment) => <tr key={payment.order_id}><td className="px-5 py-3 text-muted">{new Date(payment.completed_at).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="px-5 py-3"><span className="block">{payment.service}</span><small className="text-muted">{payment.barber}</small></td><td className="px-5 py-3 text-muted">{payment.receipt_code ?? payment.order_id.slice(0, 8)}</td><td className="px-5 py-3 text-right font-semibold">{money(Number(payment.total))}</td></tr>)}{!shown.details.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">No hay pagos para estos filtros.</td></tr>}</tbody></table></div>}</section>
  </div>;
}

function RevenueChart({ points, loading }: { points: DailyPoint[]; loading: boolean }) {
  const width = 760;
  const height = 220;
  const padding = { left: 42, right: 12, top: 12, bottom: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...points.flatMap((point) => [point.current, point.previous]));
  const coordinates = (value: number, index: number) => ({
    x: padding.left + (points.length < 2 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth),
    y: padding.top + plotHeight - (value / max) * plotHeight,
  });
  const currentLine = points.map((point, index) => { const { x, y } = coordinates(point.current, index); return `${x},${y}`; }).join(" ");
  const previousLine = points.map((point, index) => { const { x, y } = coordinates(point.previous, index); return `${x},${y}`; }).join(" ");
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 5)) === 0);
  return <div className="mt-4">
    <div className="mb-3 flex flex-wrap gap-4 text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-brass"/>Periodo actual</span><span className="flex items-center gap-2 text-muted"><i className="h-2.5 w-2.5 rounded-full bg-electric"/>Periodo anterior</span></div>
    <div className="overflow-x-auto"><svg role="img" aria-label="Comparación de cobros diarios con el periodo anterior" viewBox={`0 0 ${width} ${height}`} className="h-56 min-w-[560px] w-full" preserveAspectRatio="none">
      {[0, 0.5, 1].map((ratio) => { const y = padding.top + plotHeight * ratio; return <g key={ratio}><line x1={padding.left} y1={y} x2={width-padding.right} y2={y} className="stroke-line" strokeWidth="1"/><text x={padding.left-8} y={y+4} textAnchor="end" fontSize="10" className="fill-muted">{money(max*(1-ratio))}</text></g>; })}
      {points.length > 1 && <><polyline points={previousLine} fill="none" className="stroke-electric" strokeWidth="2" strokeDasharray="5 5"/><polyline points={currentLine} fill="none" className="stroke-brass" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/></>}
      {points.map((point,index)=>{const current=coordinates(point.current,index);const previous=coordinates(point.previous,index);return <g key={point.date}><circle cx={current.x} cy={current.y} r="3.5" className="fill-brass"><title>{dateLabel(point.date)}: {money(point.current)}</title></circle>{points.length===1&&<circle cx={previous.x} cy={previous.y} r="3.5" className="fill-electric"/>}</g>;})}
      {labels.map((point)=>{const index=points.indexOf(point);const {x}=coordinates(0,index);return <text key={point.date} x={x} y={height-8} textAnchor="middle" fontSize="10" className="fill-muted">{point.date.slice(5)}</text>;})}
    </svg></div>
    {loading && <p className="mt-2 text-xs text-muted">Actualizando cobros…</p>}
  </div>;
}
function Breakdown({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line/70 px-3 py-2"><span className="block text-xs text-muted">{label}</span><b className="mt-1 block tabular-nums">{value}</b></div>;
}
function RankingHeader({ title, mode, onModeChange }: { title: string; mode: RankingMode; onModeChange: (mode: RankingMode) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><div role="group" aria-label={`Ordenar ${title.toLowerCase()} por`} className="flex rounded-lg border border-line p-1 text-xs"><button aria-pressed={mode === "amount"} onClick={() => onModeChange("amount")} className={`min-h-8 rounded-md px-3 ${mode === "amount" ? "bg-brass text-obsidian" : "text-muted"}`}>Monto</button><button aria-pressed={mode === "count"} onClick={() => onModeChange("count")} className={`min-h-8 rounded-md px-3 ${mode === "count" ? "bg-brass text-obsidian" : "text-muted"}`}>Cantidad</button></div></div>;
}
function Rows({ rows, mode, showCommission = false }: { rows: { id: string; name: string; count: number; amount: number; commission?: number }[]; mode: RankingMode; showCommission?: boolean }) {
  return <div className="mt-4 divide-y divide-line">{rows.map((row) => <div key={row.id} className="flex items-center gap-3 py-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-brass/10 text-xs font-bold text-brass">{row.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}<small className="mt-1 block text-xs text-muted">{row.count} {row.count === 1 ? "servicio" : "servicios"}{showCommission ? ` · comisión ${money(Number(row.commission ?? 0))}` : ""}</small></span><b className="text-sm">{mode === "amount" ? money(row.amount) : row.count}</b></div>)}</div>;
}
function Empty({ loading, text }: { loading: boolean; text: string }) {
  return <p className="py-12 text-center text-sm text-muted">{loading ? "Cargando…" : text}</p>;
}
