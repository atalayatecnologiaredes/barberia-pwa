import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./AuthStore";
import type { TenantCapability, UserRole } from "./types";
import { hasTenantCapability } from "./AuthStore";

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
  if (capability && !hasTenantCapability(session, capability)) return <main className="mx-auto max-w-xl p-8 text-stone-100"><section className="rounded-2xl border border-line bg-panel p-6"><p className="text-xs font-bold uppercase tracking-[.2em] text-brass">Plan de suscripción</p><h1 className="mt-3 text-2xl font-semibold">Función no disponible</h1><p className="mt-2 text-sm leading-6 text-muted">Esta barbería no tiene acceso activo a esta capacidad. Revisa el plan o el estado de la suscripción con el administrador.</p></section></main>;
  return children;
}
