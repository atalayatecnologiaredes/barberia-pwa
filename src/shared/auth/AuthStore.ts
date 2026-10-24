import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { USER_ROLES, type AuthSession, type TenantCapability, type TenantSubscription, type User, type UserRole } from "./types";

interface ProfileRow {
  id: string;
  email: string;
  role: UserRole;
  full_name: string;
  barber_id: string | null;
  client_id: string | null;
  active: boolean;
  tenant_id: string | null;
  tenants: TenantRow | TenantRow[] | null;
}

interface TenantSubscriptionRow {
  plan: string;
  status: string;
  current_period_end: string | null;
}

interface SaaSSettingsRow {
  grace_days: number;
  monthly_price: number;
  whatsapp_number: string;
  telegram_url: string | null;
  exports_enabled_during_trial: boolean;
}

interface TenantRow {
  saas_subscriptions: TenantSubscriptionRow | TenantSubscriptionRow[] | null;
}

const PLAN_CAPABILITIES: Record<string, TenantCapability[]> = {
  BASIC: ["reception", "chair", "checkout", "inventory", "client_pwa", "crm", "appointments", "catalog", "analytics", "exports"],
  PRO: ["reception", "chair", "checkout", "inventory", "client_pwa", "crm", "appointments", "catalog", "staff", "analytics", "exports"],
};

interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  clearError: () => void;
}

let initializationPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;
let profileRequestVersion = 0;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado al autenticar.";
}

function isUserRole(role: unknown): role is UserRole {
  return typeof role === "string" && USER_ROLES.some((value) => value === role);
}

async function createAppSession(authSession: Session | null): Promise<AuthSession | null> {
  if (!authSession) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*, tenants(*, saas_subscriptions(*))")
    .eq("id", authSession.user.id)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(`No se pudo cargar el perfil: ${error.message}`);
  if (!data) {
    throw new Error("Tu cuenta se autenticó, pero todavía no tiene un perfil sincronizado. Intenta nuevamente en unos minutos o contacta a soporte.");
  }
  if (!isUserRole(data.role)) {
    throw new Error("El perfil no tiene un rol válido. Contacta al administrador.");
  }
  if (!data.active) throw new Error("Esta cuenta está desactivada. Contacta al administrador.");

  const tenant = Array.isArray(data.tenants) ? data.tenants[0] ?? null : data.tenants;
  const subscriptionRows = tenant?.saas_subscriptions;
  const rawSubscription = Array.isArray(subscriptionRows) ? subscriptionRows[0] ?? null : subscriptionRows;

  const [{ data: saasAdminData, error: saasAdminError }, { data: settingsData, error: settingsError }] = await Promise.all([supabase
    .from("saas_admins")
    .select("profile_id")
    .eq("profile_id", authSession.user.id)
    .maybeSingle(), supabase.from("saas_settings").select("grace_days,monthly_price,whatsapp_number,telegram_url,exports_enabled_during_trial").eq("singleton", true).maybeSingle<SaaSSettingsRow>()]);
  // Keep ordinary logins working when this optional SaaS table has not been
  // installed yet. Other query failures still indicate a real access problem.
  if (saasAdminError && !/Could not find the table .*saas_admins.*schema cache/i.test(saasAdminError.message)) {
    throw new Error(`No se pudo verificar el acceso administrativo SaaS: ${saasAdminError.message}`);
  }
  if (settingsError) throw new Error(`No se pudo consultar la configuración de suscripción: ${settingsError.message}`);

  const user: User = {
    id: authSession.user.id,
    email: authSession.user.email ?? "",
    name: data.full_name,
    role: data.role,
    ...(data.tenant_id ? { tenantId: data.tenant_id } : {}),
    isSaasAdmin: Boolean(saasAdminData),
    ...(data.barber_id ? { barberId: data.barber_id } : {}),
    ...(data.client_id ? { clientId: data.client_id } : {}),
  };

  const subscription: TenantSubscription | null = rawSubscription ? {
    planCode: rawSubscription.plan.toLowerCase(),
    status: (rawSubscription.status === "canceled" ? "cancelled" : rawSubscription.status) as TenantSubscription["status"],
    capabilities: PLAN_CAPABILITIES[rawSubscription.plan.toUpperCase()] ?? [],
    trialEndsAt: rawSubscription.status === "trialing" ? rawSubscription.current_period_end : null,
    currentPeriodEndsAt: rawSubscription.status === "active" ? rawSubscription.current_period_end : null,
    graceDays: settingsData?.grace_days ?? 0,
    monthlyPrice: Number(settingsData?.monthly_price ?? 15),
    supportWhatsapp: settingsData?.whatsapp_number ?? "593989253675",
    supportTelegram: settingsData?.telegram_url ?? null,
    exportsEnabledDuringTrial: settingsData?.exports_enabled_during_trial ?? true,
  } : null;

  return {
    user,
    accessToken: authSession.access_token,
    expiresAt: (authSession.expires_at ?? 0) * 1000,
    subscription,
  };
}

export function hasTenantCapability(session: AuthSession | null, capability: TenantCapability): boolean {
  if (!session) return false;
  if (session.user.isSaasAdmin) return true;
  // Keep paid admin modules inspectable for the shop owner in local development.
  // Production builds continue to use the subscription capability list below.
  if (import.meta.env.DEV && session.user.role === "SUPER_ADMIN" && (capability === "analytics" || capability === "staff")) return true;
  const status = session.subscription?.status;
  const subscription = session.subscription;
  if (!session.user.tenantId || !subscription || (status !== "active" && status !== "trialing")) return false;
  if (capability === "exports" && status === "trialing" && !subscription.exportsEnabledDuringTrial) return false;
  const expiration = status === "trialing" ? subscription.trialEndsAt : subscription.currentPeriodEndsAt;
  if (expiration && new Date(expiration).getTime() + subscription.graceDays * 86_400_000 <= Date.now()) return false;
  return subscription.capabilities.includes(capability);
}

async function syncSession(authSession: Session | null): Promise<void> {
  const requestVersion = ++profileRequestVersion;
  if (!authSession) {
    useAuthStore.setState({ session: null, isLoading: false, error: null });
    return;
  }

  try {
    const appSession = await createAppSession(authSession);
    if (requestVersion !== profileRequestVersion) return;
    useAuthStore.setState({ session: appSession, isLoading: false, error: null });
  } catch (error) {
    if (requestVersion !== profileRequestVersion) return;
    useAuthStore.setState({ session: null, isLoading: false, error: messageFrom(error) });
  }
}

export const useAuthStore: UseBoundStore<StoreApi<AuthState>> = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  error: null,
  initialize: () => {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      const { data } = supabase.auth.onAuthStateChange((_event, authSession) => {
        queueMicrotask(() => { void syncSession(authSession); });
      });
      authSubscription = data.subscription;

      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) throw error;
      await syncSession(sessionData.session);
    })().catch((error: unknown) => {
      set({ session: null, isLoading: false, error: messageFrom(error) });
    });

    return initializationPromise;
  },
  login: async (email, password): Promise<{ error: string | null }> => {
    set({ isLoading: true, error: null });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      const message = messageFrom(error);
      set({ isLoading: false, error: message });
      return { error: message };
    }

    await syncSession(data.session);
    const profileError = useAuthStore.getState().error;
    return { error: profileError };
  },
  logout: async () => {
    set({ isLoading: true, error: null });
    const { error } = await supabase.auth.signOut();
    if (error) {
      const message = messageFrom(error);
      set({ isLoading: false, error: message });
      return { error: message };
    }

    ++profileRequestVersion;
    set({ session: null, isLoading: false, error: null });
    return { error: null };
  },
  requestPasswordReset: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login/recovery`,
    });
    if (!error) return { error: null };
    const message = messageFrom(error);
    set({ error: message });
    return { error: message };
  },
  updatePassword: async (password) => {
    set({ isLoading: true, error: null });
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) {
      set({ isLoading: false });
      return { error: null };
    }
    const message = messageFrom(error);
    set({ isLoading: false, error: message });
    return { error: message };
  },
  clearError: () => set({ error: null }),
}));

export function disposeAuthSubscription(): void {
  authSubscription?.unsubscribe();
  authSubscription = null;
  initializationPromise = null;
}
