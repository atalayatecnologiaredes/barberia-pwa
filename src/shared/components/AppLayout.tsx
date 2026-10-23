import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, BookOpen, Building2, CalendarDays, CircleUserRound, ClipboardList, CreditCard, LogOut, Menu, Package, Scissors, Users, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import type { TenantCapability, UserRole } from "../auth/types";
import { hasTenantCapability } from "../auth/AuthStore";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Scissors;
  roles: UserRole[];
  capability?: TenantCapability;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "Operación", items: [
    { to: "/reception", label: "Recepción", icon: Users, roles: ["SUPER_ADMIN", "RECEPCION"], capability: "reception" },
    { to: "/checkout", label: "Caja", icon: CreditCard, roles: ["SUPER_ADMIN", "RECEPCION"], capability: "checkout" },
    { to: "/appointments", label: "Agenda", icon: CalendarDays, roles: ["SUPER_ADMIN", "RECEPCION"], capability: "appointments" },
    { to: "/chair", label: "Mi estación", icon: Scissors, roles: ["BARBER"], capability: "chair" },
  ] },
  { label: "Clientes y recursos", items: [
    { to: "/admin/crm", label: "Clientes", icon: CircleUserRound, roles: ["SUPER_ADMIN", "RECEPCION"], capability: "crm" },
    { to: "/inventory", label: "Inventario", icon: Package, roles: ["SUPER_ADMIN", "RECEPCION", "BARBER"], capability: "inventory" },
  ] },
  { label: "Administración", items: [
    { to: "/admin/staff", label: "Equipo", icon: ClipboardList, roles: ["SUPER_ADMIN"], capability: "staff" },
    { to: "/admin/catalog", label: "Catálogo", icon: BookOpen, roles: ["SUPER_ADMIN"], capability: "catalog" },
    { to: "/admin/analytics", label: "Analítica", icon: BarChart3, roles: ["SUPER_ADMIN"], capability: "analytics" },
    { to: "/admin/settings", label: "Configuración", icon: Building2, roles: ["SUPER_ADMIN"] },
  ] },
];

const roleLabel: Record<UserRole, string> = { SUPER_ADMIN: "Dueño", RECEPCION: "Recepción", BARBER: "Barbero", CLIENT: "Cliente" };

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { session, logout } = useAuth();
  const role = session?.user.role ?? "CLIENT";
  const location = useLocation();
  const tvMode = location.pathname === "/tv";
  const visibleGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role) && (!item.capability || hasTenantCapability(session, item.capability))),
  })).filter((group) => group.items.length > 0);
  const currentItem = navGroups.flatMap((group) => group.items).find((item) => item.to === location.pathname);

  const nav = <nav className="space-y-5" aria-label="Navegación principal">{visibleGroups.map((group) => <div key={group.label}>
    <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-muted">{group.label}</p>
    <div className="space-y-1">{group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end onClick={() => setDrawerOpen(false)} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${isActive ? "bg-brass text-obsidian" : "text-stone-300 hover:bg-white/[.05] hover:text-white"}`}><Icon size={17}/>{label}</NavLink>)}</div>
  </div>)}</nav>;

  if (tvMode) return <Outlet/>;
  return <div className="min-h-screen bg-obsidian text-stone-100 md:flex">
    <aside className="hidden w-64 shrink-0 border-r border-line bg-[#111113] p-4 md:block"><div className="mb-8 flex items-center gap-3 px-2 pt-2"><div className="grid h-10 w-10 place-items-center rounded-xl border border-brass/25 bg-brass/10 text-brass"><Scissors size={19}/></div><div><p className="text-xs font-bold uppercase tracking-[.19em] text-brass">Barber Lounge</p><p className="mt-1 text-[11px] text-muted">{roleLabel[role]}</p></div></div>{nav}</aside>
    {drawerOpen && <div className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => setDrawerOpen(false)}><aside className="h-full w-[min(19rem,85vw)] overflow-y-auto border-r border-line bg-[#111113] p-4" onClick={(event) => event.stopPropagation()}><div className="mb-8 flex items-center justify-between"><strong className="text-sm tracking-[.18em] text-brass">BARBER LOUNGE</strong><button onClick={() => setDrawerOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl border border-line" aria-label="Cerrar menú"><X size={18}/></button></div>{nav}</aside></div>}
    <div className="min-w-0 flex-1"><header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-line bg-charcoal/95 px-4 backdrop-blur md:px-7"><button className="grid h-11 w-11 place-items-center rounded-xl border border-line md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú"><Menu size={19}/></button><div className="min-w-0"><p className="truncate text-sm font-semibold">{currentItem?.label ?? "Barber Lounge"}</p><p className="mt-0.5 hidden text-[11px] text-muted sm:block">{session?.user.name} · {roleLabel[role]}</p></div><button onClick={() => void logout()} className="ml-auto flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold text-stone-300 hover:border-brass/40 hover:text-brass"><LogOut size={15}/><span className="hidden sm:inline">Salir</span></button></header><main className="min-w-0"><Outlet/></main></div>
  </div>;
}
