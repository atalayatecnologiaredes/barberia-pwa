import { useState } from "react";
import { Archive, MessageCircle } from "lucide-react";
import type { AuthSession } from "./types";
import { supabase } from "../lib/supabaseClient";

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function readAllRows<T>(load: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function ExpiredSubscription({ session }: { session: AuthSession }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tenantId = session.user.tenantId;
  const whatsappNumber = session.subscription?.supportWhatsapp.replace(/\D/g, "") ?? "593989253675";
  const contactText = encodeURIComponent(`Hola, necesito renovar la suscripción de ${session.user.name}.`);

  async function exportAccountBackup() {
    if (!tenantId || session.user.role !== "SUPER_ADMIN") return;
    setLoading(true);
    setError("");
    try {
      const [tenant, subscription, profiles, clients, barbers, services, inventory, appointments, visits, orders, rewards, redemptions, rules, notifications, toolkit] = await Promise.all([
        supabase.from("tenants").select("id,name,slug,email,phone,address,tax_rate,receipt_footer,created_at,updated_at").eq("id", tenantId).maybeSingle(),
        supabase.from("saas_subscriptions").select("*").eq("tenant_id", tenantId).maybeSingle(),
        readAllRows((from, to) => supabase.from("profiles").select("id,role,full_name,email,phone,barber_id,active,created_at").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("clients").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("barbers").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("services").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("inventory_items").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("appointments").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("queue_visits").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("service_orders").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("loyalty_rewards").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("loyalty_redemptions").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("loyalty_program_rules").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("notifications").select("*").eq("tenant_id", tenantId).range(from, to)),
        readAllRows((from, to) => supabase.from("barber_toolkit_items").select("*").eq("tenant_id", tenantId).range(from, to)),
      ]);
      const firstError = [tenant.error, subscription.error].find(Boolean);
      if (firstError) throw new Error(firstError.message);
      const orderIds = orders.map((row) => row.id);
      const clientIds = clients.map((row) => row.id);
      const inventoryIds = inventory.map((row) => row.id);
      const serviceIds = services.map((row) => row.id);
      const profileIds = profiles.map((row) => row.id);
      const [payments, orderLines, commissions, inventoryMovements, loyaltyLedger, restockRequests, serviceInventoryUsage, staffShifts] = await Promise.all([
        orderIds.length ? readAllRows((from, to) => supabase.from("payments").select("*").in("order_id", orderIds).range(from, to)) : Promise.resolve([]),
        orderIds.length ? readAllRows((from, to) => supabase.from("order_lines").select("*").in("order_id", orderIds).range(from, to)) : Promise.resolve([]),
        orderIds.length ? readAllRows((from, to) => supabase.from("commissions").select("*").in("order_id", orderIds).range(from, to)) : Promise.resolve([]),
        inventoryIds.length ? readAllRows((from, to) => supabase.from("inventory_movements").select("*").in("inventory_item_id", inventoryIds).range(from, to)) : Promise.resolve([]),
        clientIds.length ? readAllRows((from, to) => supabase.from("loyalty_ledger").select("*").in("client_id", clientIds).range(from, to)) : Promise.resolve([]),
        inventoryIds.length ? readAllRows((from, to) => supabase.from("restock_requests").select("*").in("inventory_item_id", inventoryIds).range(from, to)) : Promise.resolve([]),
        serviceIds.length ? readAllRows((from, to) => supabase.from("service_inventory_usage").select("*").in("service_id", serviceIds).range(from, to)) : Promise.resolve([]),
        profileIds.length ? readAllRows((from, to) => supabase.from("staff_shifts").select("*").in("profile_id", profileIds).range(from, to)) : Promise.resolve([]),
      ]);
      const paymentIds = payments.map((row) => row.id);
      const paymentSplits = paymentIds.length
        ? await readAllRows((from, to) => supabase.from("payment_splits").select("*").in("payment_id", paymentIds).range(from, to))
        : [];
      const today = new Date().toISOString().slice(0, 10);
      const { error: auditError } = await supabase.from("report_export_audit").insert({
        tenant_id: tenantId,
        profile_id: session.user.id,
        report_key: "account_exit",
        file_format: "json",
        date_from: "2000-01-01",
        date_to: today,
      });
      if (auditError) throw new Error(auditError.message);

      const backup = {
        exported_at: new Date().toISOString(),
        exported_by: session.user.email,
        tenant: tenant.data,
        subscription: subscription.data,
        profiles, clients, barbers, services, service_inventory_usage: serviceInventoryUsage, inventory_items: inventory,
        appointments, queue_visits: visits, service_orders: orders, order_lines: orderLines,
        payments, payment_splits: paymentSplits, commissions, inventory_movements: inventoryMovements,
        loyalty_rewards: rewards, loyalty_redemptions: redemptions, loyalty_program_rules: rules,
        loyalty_ledger: loyaltyLedger, restock_requests: restockRequests, staff_shifts: staffShifts,
        barber_toolkit_items: toolkit, notifications,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `respaldo-barberia-${tenant.data?.slug ?? tenantId}-${today}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear el respaldo de datos.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="mx-auto max-w-2xl p-5 text-stone-100 md:p-10"><section className="rounded-2xl border border-line bg-panel p-6 md:p-8"><p className="text-xs font-bold uppercase tracking-[.2em] text-brass">Plan de suscripción</p><h1 className="mt-3 text-2xl font-semibold">Tu periodo terminó</h1><p className="mt-3 text-sm leading-6 text-muted">Los datos de tu barbería siguen guardados. Contacta a soporte para confirmar el pago y reactivar el servicio.</p><p className="mt-3 font-semibold">{new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(session.subscription?.monthlyPrice ?? 15)} por mes</p><div className="mt-5 flex flex-wrap gap-3"><a href={`https://wa.me/${whatsappNumber}?text=${contactText}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brass px-4 text-sm font-bold text-obsidian"><MessageCircle size={16}/>Contactar por WhatsApp</a>{session.subscription?.supportTelegram && <a href={session.subscription.supportTelegram} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold">Telegram</a>}</div>{session.user.role === "SUPER_ADMIN" && <div className="mt-6 border-t border-line pt-5"><h2 className="font-semibold">Respaldo de tus datos</h2><p className="mt-1 text-sm leading-6 text-muted">Descarga un archivo JSON con los registros de tu barbería, incluso si la suscripción venció.</p><button onClick={() => void exportAccountBackup()} disabled={loading || !tenantId} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold disabled:opacity-50"><Archive size={16}/>{loading ? "Preparando respaldo…" : "Descargar respaldo de datos"}</button></div>}{error && <p role="alert" className="mt-4 break-words rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}</section></main>;
}
