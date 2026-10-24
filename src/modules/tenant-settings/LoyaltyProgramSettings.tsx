import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarClock, Gift, Trash2 } from "lucide-react";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { useTenantRealtime } from "../../shared/hooks/useTenantRealtime";
import { supabase } from "../../shared/lib/supabaseClient";
import type { LoyaltyRewardType } from "../../shared/types/events.types";

interface LoyaltyReward {
  id: string;
  name: string;
  description: string;
  points_cost: number;
  reward_type: LoyaltyRewardType;
  reward_value: number;
  active: boolean;
  archived_at: string | null;
}

interface LoyaltyRule {
  id: string;
  points_per_dollar: number;
  effective_at: string;
}

const localDateTime = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function LoyaltyProgramSettings() {
  const tenantId = useAuthStore((state) => state.session?.user.tenantId);
  const isOwner = useAuthStore((state) => state.session?.user.role === "SUPER_ADMIN");
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [rules, setRules] = useState<LoyaltyRule[]>([]);
  const [pointsRate, setPointsRate] = useState("1");
  const [ruleEffectiveAt, setRuleEffectiveAt] = useState(() => localDateTime(new Date(Date.now() + 120_000)));
  const [rewardName, setRewardName] = useState("");
  const [rewardDescription, setRewardDescription] = useState("");
  const [rewardCost, setRewardCost] = useState("");
  const [rewardType, setRewardType] = useState<LoyaltyRewardType>("free_service");
  const [rewardValue, setRewardValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProgram = useCallback(async () => {
    if (!tenantId) return;
    const [rewardResult, ruleResult] = await Promise.all([
      supabase.from("loyalty_rewards").select("id,name,description,points_cost,reward_type,reward_value,active,archived_at").eq("tenant_id", tenantId).order("name"),
      supabase.from("loyalty_program_rules").select("id,points_per_dollar,effective_at").eq("tenant_id", tenantId).order("effective_at"),
    ]);
    if (rewardResult.error) setError(rewardResult.error.message);
    else setRewards(rewardResult.data ?? []);
    if (ruleResult.error) setError(ruleResult.error.message);
    else setRules(ruleResult.data ?? []);
  }, [tenantId]);

  useEffect(() => { void loadProgram(); }, [loadProgram]);
  useTenantRealtime(tenantId, [{ table: "loyalty_rewards" }, { table: "loyalty_program_rules" }], loadProgram);

  const currentRule = useMemo(() => [...rules].reverse().find((rule) => new Date(rule.effective_at).getTime() <= Date.now()), [rules]);
  const scheduledRules = useMemo(() => rules.filter((rule) => new Date(rule.effective_at).getTime() > Date.now()), [rules]);

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rate = Number(pointsRate);
    const effectiveAt = new Date(ruleEffectiveAt);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000 || !Number.isFinite(effectiveAt.getTime()) || effectiveAt.getTime() < Date.now() - 60_000) {
      setError("Define una tasa entre 0 y 1000 puntos por dólar y una fecha vigente o futura.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const { error: saveError } = await supabase.rpc("schedule_loyalty_rule", { p_points_per_dollar: rate, p_effective_at: effectiveAt.toISOString() });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice(effectiveAt.getTime() > Date.now() + 30_000 ? "Regla programada para la fecha indicada." : "La nueva regla quedó vigente.");
    await loadProgram();
  }

  async function cancelRule(rule: LoyaltyRule) {
    setBusy(true); setError(""); setNotice("");
    const { error: cancelError } = await supabase.rpc("cancel_scheduled_loyalty_rule", { p_rule_id: rule.id });
    setBusy(false);
    if (cancelError) { setError(cancelError.message); return; }
    setNotice("Regla programada cancelada.");
    await loadProgram();
  }

  async function saveReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || busy) return;
    const cost = Number(rewardCost);
    if (!Number.isInteger(cost) || cost <= 0) { setError("El costo debe ser un número entero de puntos mayor que cero."); return; }
    const value = rewardType === "free_service" ? 0 : Number(rewardValue);
    if (rewardType !== "free_service" && (!Number.isFinite(value) || value <= 0 || (rewardType === "percent_service_discount" && value > 100))) {
      setError(rewardType === "percent_service_discount" ? "El porcentaje debe estar entre 1 y 100." : "El descuento debe ser mayor que cero.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const { data, error: saveError } = await supabase.from("loyalty_rewards").insert({
      tenant_id: tenantId, name: rewardName.trim(), description: rewardDescription.trim(), points_cost: cost, reward_type: rewardType, reward_value: value,
    }).select("id,name,description,points_cost,reward_type,reward_value,active,archived_at").single();
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    setRewards((current) => [...current, data as LoyaltyReward].sort((a, b) => a.name.localeCompare(b.name)));
    setRewardName(""); setRewardDescription(""); setRewardCost(""); setRewardValue("");
    setNotice("Recompensa creada.");
  }

  async function toggleReward(reward: LoyaltyReward) {
    if (!tenantId || reward.archived_at || busy) return;
    setBusy(true); setError(""); setNotice("");
    const { error: updateError } = await supabase.from("loyalty_rewards").update({ active: !reward.active }).eq("id", reward.id).eq("tenant_id", tenantId);
    setBusy(false);
    if (updateError) setError(updateError.message);
    else setRewards((current) => current.map((item) => item.id === reward.id ? { ...item, active: !item.active } : item));
  }

  async function removeReward(reward: LoyaltyReward) {
    if (!window.confirm(`¿Eliminar “${reward.name}”? Si tiene historial, se archivará para conservarlo.`)) return;
    setBusy(true); setError(""); setNotice("");
    const { data, error: removeError } = await supabase.rpc("delete_or_archive_loyalty_reward", { p_reward_id: reward.id });
    setBusy(false);
    if (removeError) { setError(removeError.message); return; }
    if (data === "deleted") {
      setRewards((current) => current.filter((item) => item.id !== reward.id));
      setNotice(`Se eliminó “${reward.name}”.`);
    } else {
      setRewards((current) => current.map((item) => item.id === reward.id ? { ...item, active: false, archived_at: new Date().toISOString() } : item));
      setNotice(`“${reward.name}” se archivó para conservar su historial.`);
    }
  }

  return <section className="space-y-5 rounded-2xl border border-line bg-panel p-5 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-brass">Clientes</p><h2 className="mt-1 text-lg font-semibold">Programa de fidelidad</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Define cómo se acumulan y canjean puntos. Los cambios conservan el historial y no modifican puntos ya ganados.</p></div><span className="rounded-full border border-line px-3 py-1.5 text-xs text-muted">{rewards.filter((reward) => reward.active).length} recompensas activas</span></div>
    {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}{notice && <p role="status" className="rounded-lg border border-electric/20 bg-electric/10 p-3 text-xs text-electric">{notice}</p>}
    <div className="rounded-xl border border-line bg-obsidian p-4"><div className="flex items-start gap-3"><CalendarClock size={18} className="mt-0.5 text-brass"/><div><h3 className="text-sm font-semibold">Acumulación de puntos</h3><p className="mt-1 text-xs text-muted">Se calcula sobre el subtotal después de descuentos, sin impuestos ni propina.</p><p className="mt-1 text-xs text-muted">Regla vigente: {currentRule ? `${Number(currentRule.points_per_dollar).toLocaleString("es-EC")} punto(s) por dólar desde ${new Date(currentRule.effective_at).toLocaleString("es-EC")}` : "Cargando regla…"}</p></div></div>
      {isOwner && <form onSubmit={(event) => void saveRule(event)} className="mt-4 grid gap-3 sm:grid-cols-[.7fr_1fr_auto]"><label className="text-xs text-muted">Puntos por dólar<input required type="number" min="0" max="1000" step="0.01" value={pointsRate} onChange={(event) => setPointsRate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white"/></label><label className="text-xs text-muted">Fecha y hora de inicio<input required type="datetime-local" min={localDateTime(new Date())} value={ruleEffectiveAt} onChange={(event) => setRuleEffectiveAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white"/></label><button disabled={busy} className="mt-auto min-h-11 rounded-lg bg-brass px-4 text-xs font-bold text-obsidian disabled:opacity-50">Programar regla</button></form>}
      {scheduledRules.length > 0 && <div className="mt-4 border-t border-line pt-3"><p className="text-xs font-semibold">Próximas reglas</p>{scheduledRules.map((rule) => <div key={rule.id} className="mt-2 flex items-center justify-between gap-3 text-xs"><span>{Number(rule.points_per_dollar).toLocaleString("es-EC")} pts/$ desde {new Date(rule.effective_at).toLocaleString("es-EC")}</span>{isOwner && <button disabled={busy} onClick={() => void cancelRule(rule)} className="rounded-lg border border-line px-2.5 py-2">Cancelar</button>}</div>)}</div>}
    </div>
    {isOwner && <form onSubmit={(event) => void saveReward(event)} className="grid gap-3 rounded-xl border border-line bg-obsidian p-4 sm:grid-cols-2 xl:grid-cols-5"><label className="text-xs text-muted">Nombre<input required minLength={2} maxLength={100} value={rewardName} onChange={(event) => setRewardName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white" placeholder="Descuento en corte"/></label><label className="text-xs text-muted">Descripción<input maxLength={300} value={rewardDescription} onChange={(event) => setRewardDescription(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white" placeholder="Opcional"/></label><label className="text-xs text-muted">Beneficio<select value={rewardType} onChange={(event) => setRewardType(event.target.value as LoyaltyRewardType)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white"><option value="free_service">Servicio gratis</option><option value="fixed_service_discount">Descuento fijo en servicio</option><option value="percent_service_discount">Porcentaje en servicio</option></select></label>{rewardType !== "free_service" && <label className="text-xs text-muted">{rewardType === "percent_service_discount" ? "Porcentaje (1–100)" : "Descuento ($)"}<input required type="number" min="0.01" max={rewardType === "percent_service_discount" ? 100 : undefined} step="0.01" value={rewardValue} onChange={(event) => setRewardValue(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white"/></label>}<label className="text-xs text-muted">Costo en puntos<input required type="number" min="1" step="1" value={rewardCost} onChange={(event) => setRewardCost(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-white" placeholder="100"/></label><button disabled={busy} className="mt-auto min-h-11 rounded-lg bg-brass px-4 text-xs font-bold text-obsidian disabled:opacity-50">Crear recompensa</button></form>}
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{rewards.map((reward) => { const benefit = reward.reward_type === "free_service" ? "Servicio gratis" : reward.reward_type === "fixed_service_discount" ? `$${Number(reward.reward_value).toFixed(2)} de descuento en servicio` : `${Number(reward.reward_value).toLocaleString("es-EC")}% de descuento en servicio`; return <article key={reward.id} className="flex items-center gap-3 rounded-xl border border-line bg-obsidian p-3"><Gift size={18} className="shrink-0 text-brass"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{reward.name} · {reward.points_cost} pts</p><p className="truncate text-xs text-muted">{benefit} · {reward.description || "Sin descripción"}</p></div>{isOwner && <div className="flex shrink-0 items-center gap-2"><button type="button" disabled={busy || Boolean(reward.archived_at)} onClick={() => void toggleReward(reward)} className={`rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${reward.active ? "border-electric/20 text-electric" : "border-line text-muted"}`}>{reward.archived_at ? "Archivada" : reward.active ? "Activa" : "Inactiva"}</button>{!reward.archived_at && <button type="button" disabled={busy} onClick={() => void removeReward(reward)} aria-label={`Eliminar ${reward.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-danger/30 text-danger"><Trash2 size={15}/></button>}</div>}</article>; })}{!rewards.length && <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Aún no hay recompensas configuradas.</p>}</div>
  </section>;
}
