import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Camera, ChevronRight, Clock3, Gift, Plus, Search, Star, UserRound, X } from "lucide-react";
import { supabase } from "../../shared/lib/supabaseClient";
import { PageHeading } from "../../shared/ui/PageHeading";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { DemoDataBanner } from "../../shared/ui/DemoDataBanner";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";

interface ClientRecord {
  id: string;
  full_name: string;
  phone: string;
  tier: string;
  loyalty_points: number;
  visit_count: number;
  preferred_barber_id: string | null;
  technical_notes: string;
  email: string | null;
}
interface LoyaltyReward { id: string; name: string; description: string; points_cost: number; active: boolean; }

export default function CrmPage() {
  const tenantId = useAuthStore((state) => state.session?.user.tenantId);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentPoints, setAdjustmentPoints] = useState("");
  const [movementHistory, setMovementHistory] = useState<{ id: string; points: number; entry_type: string; description: string; created_at: string }[]>([]);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [rewardName, setRewardName] = useState("");
  const [rewardDescription, setRewardDescription] = useState("");
  const [rewardCost, setRewardCost] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const role = useAuthStore((state) => state.session?.user.role);
  const isOwner = role === "SUPER_ADMIN";

  const loadClients = useCallback(async (keepSelection = true) => {
    if (!tenantId) { setError("Tu usuario no está asignado a una barbería."); setLoading(false); return; }
    const { data, error: fetchError } = await supabase.from("clients")
      .select("id, full_name, phone, email, tier, loyalty_points, visit_count, preferred_barber_id, technical_notes")
      .eq("tenant_id", tenantId).order("full_name");
    if (fetchError) setError(fetchError.message);
    else {
      const records = data ?? [];
      setClients(records);
      setSelectedId((current) => keepSelection && records.some((client) => client.id === current) ? current : records[0]?.id ?? "");
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void loadClients(false); }, [loadClients]);

  const loadRewards = useCallback(async () => {
    if (!tenantId) return;
    const { data, error: rewardsError } = await supabase.from("loyalty_rewards")
      .select("id, name, description, points_cost, active").eq("tenant_id", tenantId).order("name");
    if (rewardsError) setError(rewardsError.message);
    else setRewards(data ?? []);
  }, [tenantId]);
  useEffect(() => { void loadRewards(); }, [loadRewards]);

  const loadMovementHistory = useCallback(async (clientId: string) => {
    setHistoryLoading(true);
    const { data, error: historyError } = await supabase.from("loyalty_ledger")
      .select("id, points, entry_type, description, created_at")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(50);
    if (historyError) setError(historyError.message);
    else setMovementHistory(data ?? []);
    setHistoryLoading(false);
  }, []);

  const refreshCrm = useCallback(() => {
    void loadClients();
    void loadRewards();
    if (selectedId) void loadMovementHistory(selectedId);
  }, [loadClients, loadRewards, loadMovementHistory, selectedId]);
  useTenantRealtime(tenantId, [{ table: "clients" }, { table: "loyalty_ledger", tenantColumn: null }, { table: "loyalty_rewards" }], refreshCrm);

  const demoMode = import.meta.env.DEV && !loading && !error && clients.length === 0;
  const demoClients: ClientRecord[] = [
    { id: "demo-client-1", full_name: "Valentina Cedeño", phone: "099 555 0101", tier: "Gold", loyalty_points: 420, visit_count: 14, preferred_barber_id: "Mateo Rivera", technical_notes: "Prefiere degradado bajo.", email: "valentina@example.test" },
    { id: "demo-client-2", full_name: "Diego Mendoza", phone: "098 444 0202", tier: "Silver", loyalty_points: 185, visit_count: 7, preferred_barber_id: null, technical_notes: "Corte clásico, laterales a tijera.", email: null },
    { id: "demo-client-3", full_name: "Santiago Vera", phone: "097 333 0303", tier: "Member", loyalty_points: 65, visit_count: 2, preferred_barber_id: null, technical_notes: "", email: null },
  ];
  const shownClients = demoMode ? demoClients : clients;
  const filtered = useMemo(() => shownClients.filter((client) => `${client.full_name} ${client.phone} ${client.id}`.toLowerCase().includes(query.toLowerCase())), [shownClients, query]);
  const selected = shownClients.find((client) => client.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!selected || demoMode) { setMovementHistory([]); return; }
    void loadMovementHistory(selected.id);
  }, [selected?.id, demoMode, loadMovementHistory]);

  function cardUrl(token: string) {
    const url = new URL("/client-pwa", window.location.origin);
    url.searchParams.set("token", token);
    return url.toString();
  }

  async function makeQr() {
    if (!selected || demoMode) return;
    setBusy(true); setError(""); setQrUrl("");
    const { data: token, error: issueError } = await supabase.rpc("issue_client_qr", { p_client_id: selected.id });
    setBusy(false);
    if (issueError || !token) { setError(issueError?.message ?? "No se pudo crear el QR."); return; }
    setQrUrl(cardUrl(String(token)));
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError("");
    const email = String(fields.get("email") ?? "").trim();
    const { data, error: createError } = await supabase.rpc("create_client_with_qr", {
      p_full_name: String(fields.get("full_name") ?? "").trim(),
      p_phone: String(fields.get("phone") ?? "").trim(),
      ...(email ? { p_email: email } : {}),
    });
    setBusy(false);
    if (createError || !data) { setError(createError?.message ?? "No se pudo crear el cliente."); return; }
    const created = data as { client_id: string; token: string };
    const { data: row, error: fetchError } = await supabase.from("clients")
      .select("id, full_name, phone, email, tier, loyalty_points, visit_count, preferred_barber_id, technical_notes")
      .eq("id", created.client_id).single();
    if (fetchError) { setError(fetchError.message); return; }
    setClients((current) => [row as ClientRecord, ...current]);
    setSelectedId(created.client_id);
    setQrUrl(cardUrl(created.token));
    setShowNewClient(false);
  }

  async function revokeQr() {
    if (!selected) return;
    setBusy(true); setError("");
    const { error: revokeError } = await supabase.rpc("revoke_client_qr", { p_client_id: selected.id });
    setBusy(false);
    if (revokeError) setError(revokeError.message);
    else setQrUrl("");
  }

  async function adjustPoints(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const points = Number(adjustmentPoints);
    if (!Number.isInteger(points) || points === 0) { setError("Ingresa un ajuste entero distinto de cero."); return; }
    setBusy(true); setError("");
    const { error: adjustmentError } = await supabase.rpc("adjust_client_loyalty_points", {
      p_client_id: selected.id, p_points: points, p_reason: adjustmentReason.trim(),
    });
    setBusy(false);
    if (adjustmentError) { setError(adjustmentError.message); return; }
    setAdjustmentPoints(""); setAdjustmentReason("");
    await Promise.all([loadClients(), loadMovementHistory(selected.id)]);
  }

  async function saveReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || busy) return;
    const cost = Number(rewardCost);
    if (!Number.isInteger(cost) || cost <= 0) { setError("El costo debe ser un número entero de puntos mayor que cero."); return; }
    setBusy(true); setError("");
    const { data, error: saveError } = await supabase.from("loyalty_rewards").insert({
      tenant_id: tenantId, name: rewardName.trim(), description: rewardDescription.trim(), points_cost: cost,
    }).select("id, name, description, points_cost, active").single();
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    setRewards((current) => [...current, data as LoyaltyReward].sort((a, b) => a.name.localeCompare(b.name)));
    setRewardName(""); setRewardDescription(""); setRewardCost("");
  }

  async function toggleReward(reward: LoyaltyReward) {
    if (!tenantId) { setError("El usuario no está asignado a una barbería."); return; }
    setBusy(true); setError("");
    const { error: updateError } = await supabase.from("loyalty_rewards").update({ active: !reward.active }).eq("id", reward.id).eq("tenant_id", tenantId);
    setBusy(false);
    if (updateError) setError(updateError.message);
    else setRewards((current) => current.map((item) => item.id === reward.id ? { ...item, active: !item.active } : item));
  }

  return <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8"><PageHeading eyebrow="Relación con clientes" title="CRM de clientes" description="Consulta las fichas reales y entrega una tarjeta QR personal para fidelización." action={<button onClick={() => { setError(""); setShowNewClient(true); }} className="flex min-h-12 items-center gap-2 rounded-xl bg-brass px-4 text-sm font-bold text-obsidian"><Plus size={17}/>Nuevo cliente</button>}/>
    <DemoDataBanner active={demoMode}/>
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
    <section className="rounded-2xl border border-line bg-panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brass">Programa de fidelidad</p><h2 className="mt-1 text-lg font-semibold">Recompensas</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Regla vigente: se gana 1 punto por cada dólar pagado. La recompensa se entrega en Caja al completar un cobro; no descuenta dinero de la orden.</p></div><span className="rounded-full border border-line px-3 py-1.5 text-xs text-muted">{rewards.filter((reward) => reward.active).length} activas</span></div>{isOwner && <form onSubmit={(event) => void saveReward(event)} className="mt-4 grid gap-3 rounded-xl border border-line bg-obsidian p-4 sm:grid-cols-[1fr_1.3fr_.55fr_auto]"><label className="text-xs text-muted">Nombre<input required minLength={2} maxLength={100} value={rewardName} onChange={(event) => setRewardName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white" placeholder="Lavado gratis"/></label><label className="text-xs text-muted">Descripción<input maxLength={300} value={rewardDescription} onChange={(event) => setRewardDescription(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white" placeholder="Canjeable por un lavado clásico"/></label><label className="text-xs text-muted">Costo en puntos<input required type="number" min="1" step="1" value={rewardCost} onChange={(event) => setRewardCost(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white" placeholder="100"/></label><button disabled={busy} className="mt-auto min-h-11 rounded-lg bg-brass px-4 text-xs font-bold text-obsidian disabled:opacity-50">Crear</button></form>}<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{rewards.map((reward) => <article key={reward.id} className="flex items-center gap-3 rounded-xl border border-line bg-obsidian p-3"><Gift size={18} className="shrink-0 text-brass"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{reward.name} · {reward.points_cost} pts</p><p className="truncate text-xs text-muted">{reward.description || "Sin descripción"}</p></div>{isOwner && <button type="button" disabled={busy} onClick={() => void toggleReward(reward)} className={`rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${reward.active ? "border-electric/20 text-electric" : "border-line text-muted"}`}>{reward.active ? "Activa" : "Inactiva"}</button>}</article>)}{!rewards.length && <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Aún no hay recompensas configuradas.</p>}</div></section>
    <div className="grid items-start gap-5 xl:grid-cols-[.8fr_1.2fr]"><section className="rounded-2xl border border-line bg-panel p-4 md:p-5"><label className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-obsidian px-3 text-muted"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, teléfono o ID" className="w-full bg-transparent text-sm text-stone-100 outline-none placeholder:text-muted"/></label><div className="mt-3 flex items-center justify-between px-1 text-xs text-muted"><span>{query.trim() ? "Resultados" : "Clientes"}</span><span>{filtered.length} {filtered.length === 1 ? "registro" : "registros"}</span></div><div aria-label="Lista de clientes" className="mt-2 max-h-[25rem] space-y-2 overflow-y-auto overscroll-contain pr-1 md:max-h-[30rem]">{loading ? <p className="p-4 text-sm text-muted">Cargando clientes…</p> : filtered.map((client) => <button key={client.id} onClick={() => { setSelectedId(client.id); setQrUrl(""); }} className={`flex min-h-[76px] w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected?.id === client.id ? "border-brass/30 bg-brass/[.04]" : "border-transparent hover:border-line hover:bg-white/[.025]"}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brass/10 text-sm font-bold text-brass">{client.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{client.full_name}</span><span className="mt-1 block truncate text-xs text-muted">{client.phone} · {client.visit_count} visitas</span></span><ChevronRight size={17} className="text-muted"/></button>)}{!loading && !filtered.length && <p className="p-4 text-sm text-muted">No hay clientes que coincidan con la búsqueda.</p>}</div></section>
      {selected ? <article className="rounded-2xl border border-line bg-panel p-5 md:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-2xl bg-brass/10 text-xl font-bold text-brass">{selected.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div><p className="text-xs font-semibold uppercase tracking-[.17em] text-brass">Cliente {selected.tier} · {selected.id}</p><h2 className="mt-1 text-2xl font-semibold">{selected.full_name}</h2><p className="mt-1 text-sm text-muted">{selected.phone}{selected.email ? ` · ${selected.email}` : ""}</p></div></div><span className="flex items-center gap-1 rounded-full bg-brass/10 px-3 py-2 text-xs font-bold text-brass"><Star size={13} fill="currentColor"/>{selected.tier}</span></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-line bg-obsidian p-4"><p className="text-xs text-muted">Fidelización</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold"><Gift size={15} className="text-brass"/>{selected.loyalty_points.toLocaleString("es-EC")} puntos</p><p className="mt-1 text-xs text-muted">1 punto por cada $1 pagado, sin redondear hacia arriba. {selected.visit_count} visitas.</p></div><div className="rounded-xl border border-line bg-obsidian p-4"><p className="text-xs text-muted">Barbero favorito</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold"><Clock3 size={14} className="text-brass"/>{selected.preferred_barber_id ?? "Sin asignar"}</p><p className="mt-1 text-xs text-muted">ID de cliente · {selected.id}</p></div></div>
        <section className="mt-4 rounded-xl border border-line bg-obsidian p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Movimientos de puntos</h3><p className="mt-1 text-xs text-muted">Registro de compras y ajustes de esta tarjeta.</p></div><button type="button" onClick={() => { void loadClients(); void loadMovementHistory(selected.id); }} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold">Actualizar</button></div>{historyLoading ? <p className="mt-4 text-sm text-muted">Cargando movimientos…</p> : movementHistory.length ? <ul className="mt-3 divide-y divide-line">{movementHistory.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm">{entry.description}</p><p className="mt-1 text-xs text-muted">{new Date(entry.created_at).toLocaleString("es-EC")}</p></div><span className={`text-sm font-bold ${entry.points > 0 ? "text-electric" : "text-red-300"}`}>{entry.points > 0 ? "+" : ""}{entry.points} pts</span></li>)}</ul> : <p className="mt-4 text-sm text-muted">Aún no hay movimientos. Los puntos de compras registradas aparecen después del cobro.</p>}</section>
        {isOwner && !demoMode && <form onSubmit={(event) => void adjustPoints(event)} className="mt-4 rounded-xl border border-brass/20 bg-brass/[.04] p-4"><h3 className="text-sm font-semibold">Ajuste manual del dueño</h3><p className="mt-1 text-xs leading-5 text-muted">El motivo se guarda en el historial. Usa un valor negativo para descontar puntos; el saldo no puede quedar bajo cero.</p><div className="mt-3 grid gap-3 sm:grid-cols-[.55fr_1fr_auto]"><label className="text-xs text-muted">Puntos (+ / −)<input required type="number" step="1" value={adjustmentPoints} onChange={(event) => setAdjustmentPoints(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-white" placeholder="25 o -10"/></label><label className="text-xs text-muted">Motivo<input required minLength={3} maxLength={200} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-obsidian px-3 text-sm text-white" placeholder="Corrección por compra duplicada"/></label><button disabled={busy} className="mt-auto min-h-11 rounded-lg bg-brass px-4 text-xs font-bold text-obsidian disabled:opacity-50">{busy ? "Guardando…" : "Registrar ajuste"}</button></div></form>}
        <div className="mt-4 rounded-xl border border-brass/15 bg-brass/[.04] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-brass">Nota técnica</p><p className="mt-2 text-sm leading-6 text-stone-300">{selected.technical_notes || "Sin notas"}</p></div>
        <button onClick={() => void makeQr()} disabled={busy || demoMode} className="mt-5 flex min-h-12 items-center gap-2 rounded-xl bg-brass px-4 text-sm font-bold text-obsidian disabled:opacity-50"><UserRound size={16}/>{busy ? "Generando QR…" : demoMode ? "QR no disponible en ejemplo" : "Generar / renovar QR personal"}</button>
        {qrUrl && <div className="mt-5 flex flex-col items-center rounded-2xl border border-line bg-obsidian p-5 text-center"><QRCodeSVG value={qrUrl} size={208} includeMargin bgColor="#ffffff"/><p className="mt-4 text-sm font-semibold">Tarjeta de {selected.full_name}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted">Este QR permite consultar su saldo e historial de puntos. Al renovarlo, el anterior deja de funcionar.</p><a href={qrUrl} target="_blank" rel="noreferrer" className="mt-3 break-all text-xs text-brass underline">Abrir tarjeta</a><button onClick={() => void revokeQr()} disabled={busy} className="mt-4 min-h-10 rounded-lg border border-red-400/30 px-3 text-xs font-semibold text-red-200 disabled:opacity-50">{busy ? "Procesando…" : "Revocar este QR"}</button></div>}
      </article> : <article className="grid min-h-72 place-items-center rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted"><div><Camera className="mx-auto mb-3"/>Selecciona un cliente para consultar su tarjeta.</div></article>}</div>
    {qrUrl && <button onClick={() => setQrUrl("")} aria-label="Cerrar QR" className="fixed right-5 top-5 grid h-10 w-10 place-items-center rounded-full border border-line bg-panel text-stone-200"><X size={18}/></button>}
    {showNewClient && <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/75 p-4"><form onSubmit={(event) => void createClient(event)} className="w-full max-w-md rounded-2xl border border-line bg-panel p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-brass">Nuevo miembro</p><h2 className="mt-1 text-xl font-semibold">Crear cliente y su QR</h2></div><button type="button" onClick={() => setShowNewClient(false)} className="grid h-10 w-10 place-items-center rounded-lg border border-line"><X size={17}/></button></div><label className="mt-5 block text-sm text-stone-300">Nombre completo<input required name="full_name" minLength={2} maxLength={100} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-white outline-none focus:border-brass"/></label><label className="mt-4 block text-sm text-stone-300">Teléfono<input required name="phone" type="tel" minLength={7} maxLength={30} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-white outline-none focus:border-brass"/></label><label className="mt-4 block text-sm text-stone-300">Correo (opcional)<input name="email" type="email" className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-3 text-sm text-white outline-none focus:border-brass"/></label>{error && <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}<button disabled={busy} className="mt-5 min-h-12 w-full rounded-xl bg-brass text-sm font-bold text-obsidian disabled:opacity-50">{busy ? "Creando ficha y QR…" : "Guardar y generar QR"}</button><p className="mt-3 text-xs leading-5 text-muted">Al guardar, el QR se muestra una vez. Entrégalo al cliente; funciona como acceso a su tarjeta.</p></form></div>}
  </div>;
}
