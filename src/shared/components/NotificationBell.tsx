import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { useAuthStore } from "../auth/AuthStore";
import { supabase } from "../lib/supabaseClient";
import type { Database } from "../lib/database.types";
import { errorMessage } from "../lib/errors";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

export function NotificationBell() {
  const session = useAuthStore((state) => state.session);
  const user = session?.user;
  const userId = user?.id;
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user?.id || !user.tenantId || user.role === "CLIENT") return;
    setLoading(true);
    try {
      const [listResult, unreadResult] = await Promise.all([
        supabase.from("notifications").select("*").eq("recipient_id", user.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).is("read_at", null),
      ]);
      if (listResult.error || unreadResult.error) {
        setError(errorMessage(listResult.error ?? unreadResult.error, "No se pudieron cargar las notificaciones."));
      } else {
        setNotifications(listResult.data ?? []);
        setUnreadCount(unreadResult.count ?? 0);
        setError("");
      }
    } catch (cause) {
      setError(errorMessage(cause, "No se pudieron cargar las notificaciones."));
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.role, user?.tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user?.id || !user.tenantId || user.role === "CLIENT") return;
    const channel = supabase.channel(`user-notifications:${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${user.id}`,
      }, () => { void load(); })
      .subscribe();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [load, user?.id, user?.role, user?.tenantId]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!user?.tenantId || user.role === "CLIENT") return null;

  async function markRead(notification: Notification) {
    if (!userId) return false;
    if (notification.read_at) return true;
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("notifications").update({ read_at: readAt })
      .eq("id", notification.id).eq("recipient_id", userId).is("read_at", null);
    if (updateError) {
      setError(errorMessage(updateError, "No se pudo marcar como leída."));
      return false;
    }
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: readAt } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
    return true;
  }

  async function markAllRead() {
    if (!unreadCount || !userId) return;
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("notifications").update({ read_at: readAt })
      .eq("recipient_id", userId).is("read_at", null);
    if (updateError) {
      setError(errorMessage(updateError, "No se pudieron marcar como leídas."));
      return;
    }
    setNotifications((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }));
    setUnreadCount(0);
    setError("");
  }

  async function openNotification(notification: Notification) {
    await markRead(notification);
    setOpen(false);
    if (notification.action_path) navigate(notification.action_path);
  }

  return <div className="relative" ref={panelRef}>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-label={unreadCount ? `${unreadCount} notificaciones sin leer` : "Notificaciones"}
      aria-expanded={open} aria-controls="notification-panel" className="relative grid h-11 w-11 place-items-center rounded-xl border border-line text-stone-300 hover:border-brass/40 hover:text-brass">
      <Bell size={18}/>{unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </button>
    {open && <section id="notification-panel" aria-label="Notificaciones" className="absolute right-0 top-14 z-50 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3"><div><h2 className="text-sm font-semibold">Notificaciones</h2><p className="mt-0.5 text-xs text-muted">{unreadCount ? `${unreadCount} sin leer` : "Todo al día"}</p></div>{unreadCount > 0 && <button type="button" onClick={() => void markAllRead()} className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-brass hover:bg-white/5"><CheckCheck size={14}/>Marcar leídas</button>}</header>
      {error && <p role="alert" className="border-b border-line px-4 py-2 text-xs text-danger">{error}</p>}
      <div className="max-h-[min(28rem,70vh)] overflow-y-auto">{loading && !notifications.length ? <p className="px-4 py-8 text-center text-sm text-muted">Cargando…</p> : notifications.length ? notifications.map((notification) => <button type="button" key={notification.id} onClick={() => void openNotification(notification)} className={`block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-white/[.04] ${notification.read_at ? "" : "bg-brass/[.04]"}`}>
        <span className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.read_at ? "bg-transparent" : "bg-brass"}`}/><span className="min-w-0 flex-1"><b className="block text-sm">{notification.title}</b><span className="mt-1 block text-xs leading-5 text-muted">{notification.message}</span><time className="mt-1 block text-[10px] text-muted" dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })}</time></span></span>
      </button>) : <p className="px-4 py-8 text-center text-sm text-muted">No tienes notificaciones todavía.</p>}</div>
      <footer className="border-t border-line px-4 py-2"><button type="button" onClick={() => void load()} className="min-h-9 w-full text-xs text-muted hover:text-white">Actualizar</button></footer>
    </section>}
  </div>;
}
