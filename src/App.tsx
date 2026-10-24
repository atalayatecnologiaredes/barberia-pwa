import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./shared/components/AppLayout";
import { AuthProvider } from "./shared/auth/AuthContext";
import { ProtectedRoute, ROLE_HOME } from "./shared/auth/ProtectedRoute";
import { useAuthStore } from "./shared/auth/AuthStore";
import type { UserRole } from "./shared/auth/types";

const LoginPage = lazy(() => import("./modules/auth/LoginPage"));
const ReceptionApp = lazy(() => import("./modules/recepcion/ReceptionApp"));
const ChairStation = lazy(() => import("./modules/chair-station/ChairStation"));
const CheckoutApp = lazy(() => import("./modules/checkout/CheckoutApp"));
const InventoryApp = lazy(() => import("./modules/inventario/InventoryApp"));
const ClientApp = lazy(() => import("./modules/client-pwa/ClientApp"));
const AnalyticsPage = lazy(() => import("./modules/analytics/AnalyticsPage"));
const CrmPage = lazy(() => import("./modules/crm-clients/CrmPage"));
const StaffPage = lazy(() => import("./modules/staff-payroll/StaffPage"));
const SaasAdminApp = lazy(() => import("./modules/saas-admin/SaasAdminApp"));
const RegisterTenantPage = lazy(() => import("./modules/auth/RegisterTenantPage"));
const TenantSettingsPage = lazy(() => import("./modules/tenant-settings/TenantSettingsPage"));
const AppointmentsPage = lazy(() => import("./modules/appointments/AppointmentsPage"));
const CatalogPage = lazy(() => import("./modules/catalog/CatalogPage"));
const LandingPage = lazy(() => import("./modules/marketing/LandingPage"));

function RouteFallback() {
  return <main className="grid min-h-screen place-items-center bg-obsidian text-stone-100" aria-live="polite"><div className="text-center"><span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-brass/30 border-t-brass"/><p className="mt-4 text-sm text-muted">Cargando módulo…</p></div></main>;
}

const allRoles: UserRole[] = ["SUPER_ADMIN", "RECEPCION", "BARBER", "CLIENT"];
const frontDeskRoles: UserRole[] = ["SUPER_ADMIN", "RECEPCION"];
const barberRoles: UserRole[] = ["SUPER_ADMIN", "BARBER"];
const ownerRole: UserRole[] = ["SUPER_ADMIN"];
const inventoryRoles: UserRole[] = ["SUPER_ADMIN", "RECEPCION", "BARBER"];

function HomeRedirect() {
  const session = useAuthStore((state) => state.session);
  return <Navigate to={session ? session.user.isSaasAdmin ? "/saas-admin" : ROLE_HOME[session.user.role] : "/login"} replace/>;
}

export default function App() {
  return <AuthProvider><BrowserRouter><Suspense fallback={<RouteFallback/>}><Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/login/recovery" element={<LoginPage recovery/>}/>
    <Route path="/register" element={<RegisterTenantPage/>}/>
    <Route path="/saas-admin" element={<ProtectedRoute allowed={allRoles} requireSaasAdmin><SaasAdminApp/></ProtectedRoute>}/>
    <Route path="/client-pwa" element={<ClientApp/>}/>
    <Route path="/" element={<LandingPage/>}/>
    <Route element={<ProtectedRoute allowed={allRoles}><AppLayout/></ProtectedRoute>}>
      <Route path="reception" element={<ProtectedRoute allowed={frontDeskRoles} capability="reception"><ReceptionApp/></ProtectedRoute>}/>
      <Route path="appointments" element={<ProtectedRoute allowed={frontDeskRoles} capability="appointments"><AppointmentsPage/></ProtectedRoute>}/>
      <Route path="tv" element={<ProtectedRoute allowed={frontDeskRoles} capability="reception"><ReceptionApp/></ProtectedRoute>}/>
      <Route path="chair" element={<ProtectedRoute allowed={barberRoles} capability="chair"><ChairStation/></ProtectedRoute>}/>
      <Route path="checkout" element={<ProtectedRoute allowed={frontDeskRoles} capability="checkout"><CheckoutApp/></ProtectedRoute>}/>
      <Route path="inventory" element={<ProtectedRoute allowed={inventoryRoles} capability="inventory"><InventoryApp/></ProtectedRoute>}/>
      <Route path="admin/analytics" element={<ProtectedRoute allowed={ownerRole} capability="analytics"><AnalyticsPage/></ProtectedRoute>}/>
      <Route path="admin/staff" element={<ProtectedRoute allowed={ownerRole} capability="staff"><StaffPage/></ProtectedRoute>}/>
      <Route path="admin/crm" element={<ProtectedRoute allowed={frontDeskRoles} capability="crm"><CrmPage/></ProtectedRoute>}/>
      <Route path="admin/settings" element={<ProtectedRoute allowed={ownerRole}><TenantSettingsPage/></ProtectedRoute>}/>
      <Route path="admin/catalog" element={<ProtectedRoute allowed={ownerRole} capability="catalog"><CatalogPage/></ProtectedRoute>}/>
    </Route>
    <Route path="*" element={<HomeRedirect/>}/>
  </Routes></Suspense></BrowserRouter></AuthProvider>;
}
