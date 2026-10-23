import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CheckCircle2, CreditCard, LoaderCircle, Minus, Plus, ReceiptText, Smartphone, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { PaymentMethod } from "../../shared/types/events.types";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { supabase } from "../../shared/lib/supabaseClient";
import { errorMessage } from "../../shared/lib/errors";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";

interface OrderLine { id: string; inventory_item_id: string; item_name: string; quantity: number; unit_price: number; }
interface CheckoutOrder {
  id: string;
  client_id: string | null;
  guest_name: string;
  guest_phone: string;
  barber_id: string;
  station_id: string;
  service_id: string;
  service_price: number;
  loyalty_discount: number;
  status: "ready-for-checkout" | "paid";
  ended_at: string | null;
  service: { name: string };
  barber: { name: string };
  order_lines: OrderLine[];
}
interface RetailItem { id: string; name: string; quantity: number; unit: string; retail_price: number; }
interface LoyaltyReward { id: string; name: string; description: string; points_cost: number; }
interface LoyaltyClient { id: string; full_name: string; phone: string; loyalty_points: number; }
type SplitPart = { method: "cash"|"card"|"mobile-transfer"; amount: string; reference: string };
type PaymentReceipt={receipt_code:string;subtotal:number;tax:number;tip:number;total:number;method:string;completed_at:string;loyalty_discount:number;loyalty_redemptions:{points:number;reward:{name:string}|null}[];payment_splits:{method:string;amount:number;reference:string|null}[]};
type ShopReceipt={name:string;phone:string;address:string;receipt_footer:string;tax_rate:number};

const ORDER_SELECT = "id, client_id, guest_name, guest_phone, barber_id, station_id, service_id, service_price, loyalty_discount, status, ended_at, service:services!service_orders_service_id_fkey(name), barber:barbers!service_orders_barber_id_fkey(name), order_lines(id, inventory_item_id, item_name, quantity, unit_price)";
const currency = (value: number) => `$${value.toFixed(2)}`;
const methods: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: "cash", label: "Efectivo", icon: Banknote },
  { id: "card", label: "Tarjeta POS", icon: CreditCard },
  { id: "mobile-transfer", label: "Pago móvil", icon: Smartphone },
  { id: "split", label: "Pago dividido", icon: Wallet },
];

export default function CheckoutApp() {
  const tenantId = useAuthStore((state) => state.session?.user.tenantId);
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);
  const [retail, setRetail] = useState<RetailItem[]>([]);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loyaltyClients, setLoyaltyClients] = useState<LoyaltyClient[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [linkingClient, setLinkingClient] = useState(false);
  const [clientPoints, setClientPoints] = useState<number | null>(null);
  const [rewardId, setRewardId] = useState("");
  const [redeemedRewardName, setRedeemedRewardName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paidOrder, setPaidOrder] = useState<CheckoutOrder | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [receipt,setReceipt]=useState<PaymentReceipt|null>(null);
  const [shop,setShop]=useState<ShopReceipt>({name:"Barber Lounge",phone:"",address:"",receipt_footer:"Gracias por tu visita",tax_rate:0.15});
  const [tipPercent, setTipPercent] = useState(15);
  const [customTip, setCustomTip] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [splitParts, setSplitParts] = useState<SplitPart[]>([{ method: "cash", amount: "", reference: "" }, { method: "card", amount: "", reference: "" }]);
  const [loading, setLoading] = useState(true);
  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const paidOrderId = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    setError("");
    if (!tenantId) { setError("Tu usuario no está asignado a una barbería."); setLoading(false); return; }
    try {
      const [ordersResult, retailResult, shopResult, rewardsResult, clientsResult] = await Promise.all([
        supabase.from("service_orders").select(ORDER_SELECT).eq("tenant_id", tenantId).eq("status", "ready-for-checkout").order("ended_at", { ascending: true }),
        supabase.from("inventory_items").select("id, name, quantity, unit, retail_price").eq("tenant_id", tenantId).eq("category", "Retail").eq("active", true).order("name"),
        supabase.from("tenants").select("name,phone,address,receipt_footer,tax_rate").eq("id", tenantId).single(),
        supabase.from("loyalty_rewards").select("id,name,description,points_cost").eq("tenant_id", tenantId).eq("active", true).order("points_cost"),
        supabase.from("clients").select("id,full_name,phone,loyalty_points").eq("tenant_id", tenantId).order("full_name").limit(500),
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (retailResult.error) throw retailResult.error;
      if (shopResult.error) throw shopResult.error;
      if (rewardsResult.error) throw rewardsResult.error;
      if (clientsResult.error) throw clientsResult.error;
      const nextOrders = (ordersResult.data ?? []).filter((order): order is CheckoutOrder => order.status === "ready-for-checkout");
      setOrders(nextOrders);
      setRetail(retailResult.data ?? []);
      setShop(shopResult.data as ShopReceipt);
      setRewards(rewardsResult.data ?? []);
      setLoyaltyClients(clientsResult.data ?? []);
      setSelectedId((current) => current && (nextOrders.some((order) => order.id === current) || current === paidOrderId.current) ? current : nextOrders[0]?.id ?? null);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudieron cargar las órdenes de caja."));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void loadData(); }, [loadData]);
  useTenantRealtime(tenantId, [
    { table: "service_orders" }, { table: "order_lines", tenantColumn: null },
    { table: "inventory_items" }, { table: "loyalty_rewards" }, { table: "clients" }, { table: "tenants", tenantColumn: "id" },
  ], loadData);

  const shownRetail=retail;
  const order = orders.find((item) => item.id === selectedId) ?? paidOrder;
  const serviceAmount = Number(order?.service_price ?? 0);
  const productAmount = order?.order_lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0) ?? 0;
  const selectedReward = rewards.find((reward) => reward.id === rewardId);
  const serviceDiscount = selectedReward ? serviceAmount : Number(order?.loyalty_discount ?? 0);
  const subtotal = Math.max(0, serviceAmount - serviceDiscount) + productAmount;
  const tax = Number((subtotal * Number(shop.tax_rate)).toFixed(2));
  const tip = customTip !== "" ? Math.max(0, Number(customTip) || 0) : Number((subtotal * tipPercent / 100).toFixed(2));
  const total = Number((subtotal + tax + tip).toFixed(2));
  const splitTotal = Number(splitParts.reduce((sum, part) => sum + (Number(part.amount) || 0), 0).toFixed(2));
  const splitValid = splitParts.length >= 2 && splitParts.every((part) => Number(part.amount) > 0) && splitTotal === total;
  const isPaid = Boolean(order && paidOrder?.id === order.id);
  const selectedOrder = useMemo(() => orders.find((item) => item.id === selectedId) ?? null, [orders, selectedId]);
  const filteredLoyaltyClients = useMemo(() => {
    const normalized = clientSearch.trim().toLocaleLowerCase("es");
    return normalized.length < 2 ? [] : loyaltyClients.filter((client) => `${client.full_name} ${client.phone}`.toLocaleLowerCase("es").includes(normalized)).slice(0, 8);
  }, [clientSearch, loyaltyClients]);

  useEffect(() => {
    let cancelled = false;
    setClientPoints(null);
    if (!selectedOrder?.client_id || !tenantId) { setRewardId(""); return; }
    void supabase.from("clients").select("loyalty_points").eq("id", selectedOrder.client_id).eq("tenant_id", tenantId).maybeSingle()
      .then(({ data, error: clientError }) => {
        if (cancelled) return;
        setClientPoints(clientError || !data ? null : Number(data.loyalty_points));
      });
    return () => { cancelled = true; };
  }, [selectedOrder?.client_id, tenantId]);

  async function setProductQuantity(item: RetailItem, quantity: number) {
    if (!selectedOrder || savingLine) return;
    setSavingLine(item.id);
    setError("");
    try {
      const { error: updateError } = await supabase.rpc("set_checkout_product_quantity", {
        p_order_id: selectedOrder.id, p_item_id: item.id, p_quantity: quantity,
      });
      if (updateError) throw updateError;
      await loadData();
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo agregar el producto a la orden."));
    } finally {
      setSavingLine(null);
    }
  }

  async function linkClient(client: LoyaltyClient) {
    if (!selectedOrder || linkingClient) return;
    setLinkingClient(true); setError("");
    const { error: linkError } = await supabase.rpc("attach_checkout_client", { p_order_id: selectedOrder.id, p_client_id: client.id });
    setLinkingClient(false);
    if (linkError) { setError(errorMessage(linkError, "No se pudo asociar la ficha del cliente.")); return; }
    setOrders((current) => current.map((item) => item.id === selectedOrder.id ? { ...item, client_id: client.id } : item));
    setClientPoints(client.loyalty_points);
    setClientSearch("");
  }

  async function openReceipt(targetPaymentId: string | null = paymentId) {
    if (!targetPaymentId) { setError("No encontramos el identificador del pago para cargar el recibo."); return; }
    const { data, error: receiptError } = await supabase.from("payments")
      .select("receipt_code,subtotal,tax,tip,total,method,completed_at,loyalty_discount,loyalty_redemptions(points,reward:loyalty_rewards!loyalty_redemptions_reward_tenant_fk(name)),payment_splits(method,amount,reference)")
      .eq("id", targetPaymentId).maybeSingle();
    if (receiptError || !data) { setError("El cobro está registrado, pero no se pudo cargar el recibo. Intenta abrirlo nuevamente."); return; }
    setReceipt(data);
    setError("");
    setReceiptOpen(true);
  }

  async function completePayment() {
    if (!selectedOrder || paying) return;
    if (selectedReward && (!selectedOrder.client_id || clientPoints === null || clientPoints < selectedReward.points_cost)) {
      setError("El cliente no tiene puntos suficientes para esta recompensa."); return;
    }
    if (method === "split" && !splitValid) { setError(`Las partes deben sumar ${currency(total)}.`); return; }
    setPaying(true);
    setError("");
    try {
      const checkoutPayload = {
        p_order_id: selectedOrder.id,
        p_subtotal: Number(subtotal.toFixed(2)),
        p_tax: tax,
        p_tip: Number(tip.toFixed(2)),
        p_total: total,
        p_method: total === 0 && selectedReward ? "loyalty" as PaymentMethod : method,
        p_splits: method === "split" ? splitParts.map((part) => ({ method: part.method, amount: Number(part.amount), reference: part.reference || null })) : [],
      };
      const { data, error: rpcError } = selectedReward
        ? await supabase.rpc("complete_checkout_with_loyalty_reward", { ...checkoutPayload, p_reward_id: selectedReward.id })
        : await supabase.rpc("complete_checkout", checkoutPayload);
      if (rpcError) throw rpcError;
      paidOrderId.current = selectedOrder.id;
      setPaidOrder({ ...selectedOrder, loyalty_discount: selectedReward ? serviceAmount : 0, status: "paid" });
      const response = data as string | { payment_id?: string; reward_name?: string; points_balance?: number } | null;
      const newPaymentId = typeof response === "string" ? response : response?.payment_id ?? null;
      if (selectedReward && typeof response === "object" && response) {
        setRedeemedRewardName(response.reward_name ?? selectedReward.name);
        if (typeof response.points_balance === "number") setClientPoints(response.points_balance);
        setRewardId("");
      } else setRedeemedRewardName("");
      setPaymentId(newPaymentId);
      await loadData();
      if(newPaymentId) await openReceipt(newPaymentId); else setError("El cobro se completó, pero no recibimos el identificador del recibo.");
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo completar el cobro."));
    } finally {
      setPaying(false);
    }
  }

  return <main className="min-h-screen bg-obsidian text-stone-100"><div className="mx-auto max-w-[1440px] px-4 pb-10 pt-5 md:px-8">
      <header className="flex items-center justify-between border-b border-line pb-5"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl border border-brass/30 bg-brass/10 text-brass"><ReceiptText size={20}/></div><div><p className="text-[11px] font-bold uppercase tracking-[.24em] text-brass">{shop.name}</p><p className="mt-0.5 text-sm text-muted">Checkout Express · Supabase</p></div></div><span className="flex items-center gap-2 rounded-full border border-electric/20 bg-electric/10 px-3 py-2 text-xs font-semibold text-electric"><span className="h-2 w-2 animate-pulse rounded-full bg-electric"/>{orders.length} por cobrar</span></header>
    {error && <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-red-300">{error}</p>}{redeemedRewardName && <p role="status" className="mt-5 rounded-xl border border-electric/20 bg-electric/10 p-3 text-sm text-electric">Canje aplicado: {redeemedRewardName}. El servicio quedó cubierto por puntos.</p>}
    {loading ? <div className="grid min-h-[60vh] place-items-center text-sm text-muted"><LoaderCircle className="animate-spin"/>Cargando órdenes…</div> : !order ? <section className="grid min-h-[65vh] place-items-center py-12"><div className="max-w-md text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-brass/20 bg-brass/[.07] text-brass"><Wallet size={32}/></div><h1 className="mt-6 text-2xl font-semibold">Caja lista para cobrar</h1><p className="mt-2 text-sm leading-6 text-muted">Las órdenes finalizadas aparecerán aquí al actualizarse en Supabase.</p></div></section> : <>
      <div className="flex flex-wrap items-center justify-between gap-4 py-6"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted">Orden recibida · Silla {order.station_id.replace("chair_", "")}</p><h1 className="mt-2 text-3xl font-semibold">Cobro de {order.guest_name}</h1><p className="mt-1 text-sm text-muted">{order.service?.name} · {order.barber?.name}</p></div>{orders.length > 1 && <label className="text-xs text-muted">Cambiar orden<select value={selectedId ?? ""} onChange={(event) => { setSelectedId(event.target.value); setPaidOrder(null); setPaymentId(null); setReceipt(null); setRedeemedRewardName(""); setRewardId(""); }} className="ml-2 min-h-12 rounded-xl border border-line bg-panel px-3 text-sm text-white">{orders.map((item) => <option key={item.id} value={item.id}>{item.guest_name} · {item.id.slice(0, 8)}</option>)}</select></label>}</div>
      {!isPaid && selectedOrder && !selectedOrder.client_id && <section className="mb-5 rounded-2xl border border-brass/20 bg-panel p-5"><h2 className="font-semibold">Vincular cliente para fidelización</h2><p className="mt-1 text-xs leading-5 text-muted">Esta orden llegó como visita sin ficha. Busca por nombre o teléfono para habilitar puntos y recompensas; la vinculación quedará guardada en la orden.</p><label className="mt-3 block text-xs text-muted">Buscar cliente<input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} autoComplete="off" placeholder="Escribe al menos 2 letras o números" className="mt-1 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-white outline-none"/></label>{filteredLoyaltyClients.length > 0 && <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-obsidian">{filteredLoyaltyClients.map((client) => <button key={client.id} type="button" disabled={linkingClient} onClick={() => void linkClient(client)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line px-3 text-left last:border-0 hover:bg-white/[.04]"><span><span className="block text-sm font-semibold">{client.full_name}</span><span className="mt-1 block text-xs text-muted">{client.phone}</span></span><span className="shrink-0 text-xs text-brass">{client.loyalty_points} pts · Asociar</span></button>)}</div>}{clientSearch.trim().length >= 2 && filteredLoyaltyClients.length === 0 && <p className="mt-2 text-sm text-muted">No hay coincidencias para esta búsqueda.</p>}</section>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]"><section className="space-y-5">
        <article className="rounded-2xl border border-line bg-panel p-5 md:p-6"><h2 className="text-lg font-semibold">Detalle de la cuenta</h2><div className="mt-5 flex justify-between border-b border-line pb-4 text-sm"><span>{order.service?.name ?? "Servicio"}</span><span>{currency(serviceAmount)}</span></div>{order.order_lines.map((line) => <div key={line.id} className="flex items-center justify-between gap-3 border-b border-line py-3 text-sm"><div className="min-w-0"><span className="block truncate">{line.item_name}</span><span className="text-xs text-muted">{currency(Number(line.unit_price))} c/u · {currency(Number(line.quantity) * Number(line.unit_price))}</span></div><div className="flex items-center gap-2"><button disabled={savingLine === line.inventory_item_id} onClick={() => { const item=retail.find((candidate) => candidate.id === line.inventory_item_id); if(item) void setProductQuantity(item, Math.max(0, Number(line.quantity)-1)); }} aria-label={`Quitar una unidad de ${line.item_name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-50"><Minus size={15}/></button><span className="min-w-8 text-center tabular-nums">{line.quantity}</span><button disabled={savingLine === line.inventory_item_id || Number(retail.find((item) => item.id === line.inventory_item_id)?.quantity ?? 0) <= 0} onClick={() => { const item=retail.find((candidate) => candidate.id === line.inventory_item_id); if(item) void setProductQuantity(item, Number(line.quantity)+1); }} aria-label={`Agregar una unidad de ${line.item_name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-50"><Plus size={15}/></button></div></div>)}{serviceDiscount>0 && <div className="mt-3 flex justify-between text-sm font-semibold text-electric"><span>Canje · {selectedReward?.name ?? redeemedRewardName ?? "Servicio gratis"}</span><span>−{currency(serviceDiscount)}</span></div>}<div className="mt-4 space-y-3 text-sm"><div className="flex justify-between text-muted"><span>Subtotal</span><span>{currency(subtotal)}</span></div><div className="flex justify-between text-muted"><span>Impuesto ({(Number(shop.tax_rate) * 100).toFixed(2).replace(/\.00$/, "")}%)</span><span>{currency(tax)}</span></div></div></article>
        {!isPaid && <article className="rounded-2xl border border-line bg-panel p-5 md:p-6"><div><h2 className="text-lg font-semibold">Productos para venta</h2><p className="mt-1 text-xs text-muted">Se cargan a la orden antes del cobro.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{shownRetail.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-obsidian p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-muted">{currency(Number(item.retail_price))} · Existencia: {item.quantity} {item.unit==="unit"?"unidad(es)":item.unit==="pack"?"paquete(s)":item.unit}</p></div><button disabled={Number(item.quantity) <= Number(selectedOrder?.order_lines.find((line) => line.inventory_item_id === item.id)?.quantity ?? 0) || savingLine === item.id} onClick={() => void setProductQuantity(item, Number(selectedOrder?.order_lines.find((line) => line.inventory_item_id === item.id)?.quantity ?? 0) + 1)} aria-label={`Agregar ${item.name}`} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brass text-obsidian disabled:opacity-40">{savingLine === item.id ? <LoaderCircle size={18} className="animate-spin"/> : <Plus size={18}/>}</button></div>)}</div>{shownRetail.length === 0 && <p className="mt-4 text-sm text-muted">No hay productos activos para venta.</p>}</article>}
        {!isPaid && <article className="rounded-2xl border border-line bg-panel p-5 md:p-6"><h2 className="text-lg font-semibold">Propina</h2><div className="mt-4 grid grid-cols-4 gap-2">{[0, 10, 15, 20].map((percent) => <button key={percent} onClick={() => { setTipPercent(percent); setCustomTip(""); }} className={`min-h-12 rounded-xl border text-sm font-bold ${customTip === "" && tipPercent === percent ? "border-brass bg-brass text-obsidian" : "border-line text-stone-300"}`}>{percent}%</button>)}</div><label className="mt-3 block text-xs text-muted">Monto personalizado<input type="number" min="0" step="0.01" value={customTip} onChange={(event) => setCustomTip(event.target.value)} placeholder="0.00" className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-4 text-sm text-white outline-none focus:border-brass"/></label></article>}
        {!isPaid && selectedOrder?.client_id && rewards.length > 0 && <article className="rounded-2xl border border-brass/20 bg-panel p-5 md:p-6"><div className="flex items-center gap-2"><Wallet size={17} className="text-brass"/><h2 className="text-lg font-semibold">Canjear servicio gratis</h2></div><p className="mt-1 text-xs text-muted">El canje cubre el precio del servicio de esta orden. Los productos agregados y la propina siguen siendo cobrables.</p>{clientPoints === null ? <p className="mt-3 text-sm text-muted">Consultando saldo del cliente…</p> : <><p className="mt-3 text-sm text-stone-300">Saldo disponible: <strong className="text-brass">{clientPoints} puntos</strong></p><select value={rewardId} onChange={(event) => setRewardId(event.target.value)} className="mt-3 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-white"><option value="">No canjear recompensa</option>{rewards.map((reward) => <option key={reward.id} value={reward.id} disabled={clientPoints < reward.points_cost}>{reward.name} · {reward.points_cost} pts{clientPoints < reward.points_cost ? " · saldo insuficiente" : ""}</option>)}</select>{selectedReward && <p className="mt-3 rounded-lg bg-electric/10 p-3 text-xs text-electric">Se descontarán {selectedReward.points_cost} puntos y {currency(serviceAmount)} del subtotal del servicio.</p>}</>}</article>}
        {!isPaid && <article className="rounded-2xl border border-line bg-panel p-5 md:p-6">
          <h2 className="text-lg font-semibold">Método de pago</h2>
          {total === 0 && selectedReward ? (
            <p className="mt-3 rounded-xl border border-electric/20 bg-electric/10 p-4 text-sm font-semibold text-electric">
              La recompensa cubre el total. No se cobrará dinero; el comprobante registrará el canje.
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {methods.map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setMethod(id)} className={`flex min-h-[68px] items-center gap-3 rounded-xl border px-3 text-left ${method === id ? "border-brass/50 bg-brass/[.06] text-brass" : "border-line text-stone-300"}`}>
                    <Icon size={19}/><span className="text-sm font-semibold">{label}</span>
                  </button>
                ))}
              </div>
              {method === "split" && <div className="mt-5 space-y-3 border-t border-line pt-4">
                <div className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold">Partes del pago</p><p className="mt-1 text-xs text-muted">Total dividido: {currency(splitTotal)} / {currency(total)}</p></div>
                  <button onClick={() => setSplitParts(parts => [...parts, { method: "cash", amount: "", reference: "" }])} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold">Agregar parte</button>
                </div>
                {splitParts.map((part, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <select aria-label={`Método de pago ${index + 1}`} value={part.method} onChange={e => setSplitParts(rows => rows.map((row, i) => i === index ? { ...row, method: e.target.value as SplitPart["method"] } : row))} className="min-h-10 rounded-lg border border-line bg-obsidian px-2 text-sm"><option value="cash">Efectivo</option><option value="card">Tarjeta POS</option><option value="mobile-transfer">Pago móvil</option></select>
                  <input aria-label={`Monto parte ${index + 1}`} type="number" min="0.01" step="0.01" value={part.amount} onChange={e => setSplitParts(rows => rows.map((row, i) => i === index ? { ...row, amount: e.target.value } : row))} placeholder="Monto" className="min-h-10 rounded-lg border border-line bg-obsidian px-3 text-sm"/>
                  <input aria-label={`Referencia parte ${index + 1}`} value={part.reference} onChange={e => setSplitParts(rows => rows.map((row, i) => i === index ? { ...row, reference: e.target.value } : row))} placeholder="Referencia opcional" className="min-h-10 rounded-lg border border-line bg-obsidian px-3 text-sm"/>
                  {splitParts.length > 2 && <button aria-label={`Quitar parte ${index + 1}`} onClick={() => setSplitParts(rows => rows.filter((_, i) => i !== index))} className="min-h-10 rounded-lg border border-line px-3 text-xs">Quitar</button>}
                </div>)}
                <p className={`text-xs ${splitValid ? "text-electric" : "text-warning"}`}>{splitValid ? "Las partes cubren el total exacto." : `Falta ${currency(Math.max(0, total - splitTotal))} para completar el pago.`}</p>
              </div>}
            </>
          )}
        </article>}
      </section>
      <aside className="rounded-2xl border border-line bg-panel p-5 md:sticky md:top-5 md:p-6"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-full bg-brass/10 font-bold text-brass">{order.guest_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div><p className="font-semibold">{order.guest_name}</p><p className="mt-1 text-xs text-muted">{order.guest_phone || "Cliente"}</p></div></div><div className="my-6 border-t border-line"/><div className="space-y-4 text-sm"><div className="flex justify-between text-muted"><span>Subtotal</span><span>{currency(subtotal)}</span></div><div className="flex justify-between text-muted"><span>Impuestos</span><span>{currency(tax)}</span></div><div className="flex justify-between text-muted"><span>Propina</span><span>{currency(tip)}</span></div></div>{serviceDiscount>0 && <div className="mt-3 flex justify-between text-xs font-semibold text-electric"><span>Descuento de fidelidad</span><span>−{currency(serviceDiscount)}</span></div>}<div className="mt-5 flex items-end justify-between border-t border-line pt-5"><span className="font-semibold">{total===0 && selectedReward?"Total del canje":"Total"}</span><span className="text-3xl font-bold tabular-nums text-brass">{currency(total)}</span></div><div className="mt-6 flex items-center gap-2 rounded-xl bg-obsidian px-3 py-3 text-xs text-muted"><CheckCircle2 size={15} className="text-electric"/>{"Pago atómico mediante complete_checkout"}</div>{isPaid ? <button onClick={() => void openReceipt()} className="mt-4 min-h-[60px] w-full rounded-xl bg-electric font-bold text-obsidian">{redeemedRewardName ? "Canje completado · Ver comprobante" : "Cobro completado · Ver ticket"}</button> : <button disabled={paying} onClick={() => void completePayment()} className="mt-4 flex min-h-[60px] w-full items-center justify-center gap-3 rounded-xl bg-electric px-5 text-base font-bold text-obsidian disabled:cursor-not-allowed disabled:opacity-50">{paying ? <><LoaderCircle size={20} className="animate-spin"/>Procesando…</> : <>{total === 0 && selectedReward ? "Registrar canje" : "Completar cobro"} · {currency(total)}</>}</button>}</aside></div>
    </>}
    {receiptOpen && order && receipt && <ReceiptModal order={order} receipt={receipt} total={total} paymentId={paymentId} shop={shop} onClose={()=>setReceiptOpen(false)}/>}
  </div></main>;
}

function ReceiptModal({order,receipt,total,paymentId,shop,onClose}:{order:CheckoutOrder;receipt:PaymentReceipt|null;total:number;paymentId:string|null;shop:ShopReceipt;onClose:()=>void}){
  const methodName:Record<string,string>={cash:"Efectivo",card:"Tarjeta POS","mobile-transfer":"Pago móvil",split:"Pago dividido",loyalty:"Recompensa de puntos"};
  const receiptCode=receipt?.receipt_code??paymentId??order.id;
  const paymentSplits=receipt?.payment_splits??[];
  return <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/75 p-4"><section className="receipt-shell w-full max-w-md rounded-3xl border border-line bg-panel p-5"><div id="receipt" className="rounded-2xl bg-white p-6 text-zinc-900"><div className="text-center"><ReceiptText size={28} className="mx-auto"/><h2 className="mt-3 text-lg font-extrabold tracking-[.14em]">{shop.name}</h2><p className="text-xs text-zinc-600">{shop.phone}{shop.phone&&shop.address?" · ":""}{shop.address}</p><p className="text-xs text-zinc-500">{Number(receipt?.total??total)===0?"Comprobante de canje":"Recibo de pago"}</p></div><div className="my-5 border-t border-dashed border-zinc-300"/><p className="text-xs">Recibo <strong>{receiptCode}</strong></p><p className="mt-2 text-xs">Fecha <strong>{new Date(receipt?.completed_at??Date.now()).toLocaleString("es-EC")}</strong></p><p className="mt-2 text-xs">Orden <strong>{order.id}</strong></p><p className="mt-2 text-xs">Cliente <strong>{order.guest_name}</strong></p><div className="my-4 border-t border-dashed border-zinc-300"/><div className="flex justify-between text-xs"><span>{order.service?.name??"Servicio"}</span><span>{currency(Number(order.service_price))}</span></div>{Number(receipt?.loyalty_discount??0)>0 && <div className="mt-2 flex justify-between text-xs font-semibold text-emerald-700"><span>Canje · {receipt?.loyalty_redemptions?.[0]?.reward?.name??"Servicio gratis"} ({receipt?.loyalty_redemptions?.[0]?.points??0} pts)</span><span>−{currency(Number(receipt?.loyalty_discount??0))}</span></div>}{order.order_lines.map(line=><div key={line.id} className="mt-2 flex justify-between text-xs"><span>{line.item_name} × {line.quantity}</span><span>{currency(Number(line.quantity)*Number(line.unit_price))}</span></div>)}<div className="my-4 border-t border-dashed border-zinc-300"/><p className="flex justify-between text-xs"><span>Subtotal</span><span>{currency(Number(receipt?.subtotal??0))}</span></p><p className="mt-2 flex justify-between text-xs"><span>Impuestos ({(Number(shop.tax_rate)*100).toFixed(2).replace(/\.00$/, "")}%)</span><span>{currency(Number(receipt?.tax??0))}</span></p><p className="mt-2 flex justify-between text-xs"><span>Propina</span><span>{currency(Number(receipt?.tip??0))}</span></p><p className="mt-3 flex justify-between font-bold"><span>{Number(receipt?.total??total)===0?"Total cobrado":"Total pagado"}</span><span>{currency(Number(receipt?.total??total))}</span></p><p className="mt-3 text-xs">Método: <strong>{methodName[receipt?.method??""]??"Pago"}</strong></p>{paymentSplits.length>0&&<div className="mt-2 space-y-1">{paymentSplits.map((part,index)=><p key={index} className="flex justify-between text-[10px] text-zinc-600"><span>{methodName[part.method]??part.method}{part.reference?` · ${part.reference}`:""}</span><span>{currency(Number(part.amount))}</span></p>)}</div>}<div className="my-4 border-t border-dashed border-zinc-300"/><p className="text-center text-xs">{shop.receipt_footer}</p><div className="mt-5 flex justify-center"><QRCodeSVG value={receiptCode} size={116} includeMargin/></div><p className="mt-2 text-center text-[10px] text-zinc-500">Código de recibo · {receiptCode}</p></div><div className="mt-4 grid grid-cols-2 gap-3 no-print"><button onClick={()=>window.print()} className="min-h-12 rounded-xl border border-line text-sm font-semibold">Imprimir recibo</button><button onClick={onClose} className="min-h-12 rounded-xl bg-brass text-sm font-bold text-obsidian">Cerrar</button></div></section></div>;
}
