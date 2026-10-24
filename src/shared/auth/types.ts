export const USER_ROLES = ["SUPER_ADMIN", "RECEPCION", "BARBER", "CLIENT"] as const;
export type UserRole = typeof USER_ROLES[number];

export type TenantCapability = "reception" | "chair" | "checkout" | "inventory" | "client_pwa" | "crm" | "staff" | "analytics" | "appointments" | "catalog" | "exports";

export interface TenantSubscription {
  planCode: string;
  status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
  capabilities: TenantCapability[];
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  graceDays: number;
  monthlyPrice: number;
  supportWhatsapp: string;
  supportTelegram: string | null;
  exportsEnabledDuringTrial: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  barberId?: string;
  clientId?: string;
  tenantId?: string;
  isSaasAdmin?: boolean;
}

export interface AuthSession {
  user: User;
  accessToken: string;
  expiresAt: number;
  subscription: TenantSubscription | null;
}
