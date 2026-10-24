import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./AuthStore";
import type { TenantCapability, UserRole } from "./types";
import { hasTenantCapability } from "./AuthStore";
import { ExpiredSubscription } from "./ExpiredSubscription";

export const ROLE_HOME: Record<UserRole, string> = {
  SUPER_ADMIN: "/reception",
  RECEPCION: "/reception",
  BARBER: "/chair",
  CLIENT: "/client-pwa",
};

export function ProtectedRoute({ allowed, capability, requireSaasAdmin = false, children }: { allowed: UserRole[]; capability?: TenantCapability; requireSaasAdmin?: boolean; children: ReactNode }) {
  const session = useAuthStore((state) => state.session);
  const isLoading = useAuthStore((state) => state.isLoading);
  const location = useLocation();
  if (isLoading) {
    return <main className="grid min-h-screen place-items-center bg-obsidian text-stone-100" aria-live="polite">
      <div className="text-center"><span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-brass/30 border-t-brass"/><p className="mt-4 text-sm text-muted">Verificando sesión…</p></div>
    </main>;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }}/>;
  if (!allowed.includes(session.user.role)) return <Navigate to={ROLE_HOME[session.user.role]} replace/>;
  if (requireSaasAdmin && !session.user.isSaasAdmin) return <Navigate to={ROLE_HOME[session.user.role]} replace/>;
  if (capability && !hasTenantCapability(session, capability)) {
    const subscription = session.subscription;
    const periodEnd = subscription?.status === "trialing" ? subscription.trialEndsAt : subscription?.currentPeriodEndsAt;
    const expired = !subscription || (subscription.status !== "active" && subscription.status !== "trialing")
      || Boolean(periodEnd && new Date(periodEnd).getTime() + subscription.graceDays * 86_400_000 <= Date.now());
    if (expired) return <ExpiredSubscription session={session}/>;
    const contactMessage = encodeURIComponent(`Hola, necesito ayuda con la suscripción de ${session.user.name}.`);
    const whatsappNumber = session.subscription?.supportWhatsapp.replace(/\D/g, "") ?? "593989253675";
    return <main className="mx-auto max-w-xl p-8 text-stone-100"><section className="rounded-2xl border border-line bg-panel p-6"><p className="text-xs font-bold uppercase tracking-[.2em] text-brass">Plan de suscripción</p><h1 className="mt-3 text-2xl font-semibold">Función fuera del plan</h1><p className="mt-2 text-sm leading-6 text-muted">Esta función no está incluida en tu suscripción actual. Contacta a soporte para revisar las opciones disponibles.</p><p className="mt-3 text-sm font-semibold">{new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(session.subscription?.monthlyPrice ?? 15)} al mes</p><div className="mt-5 flex flex-wrap gap-3"><a href={`https://wa.me/${whatsappNumber}?text=${contactMessage}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg bg-brass px-4 text-sm font-bold text-obsidian">Contactar por WhatsApp</a>{session.subscription?.supportTelegram && <a href={session.subscription.supportTelegram} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold">Telegram</a>}</div></section></main>;
  }
  return children;
}
