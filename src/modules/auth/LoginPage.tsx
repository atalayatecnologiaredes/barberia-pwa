import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Scissors, ShieldCheck } from "lucide-react";
import { useAuth } from "../../shared/auth/AuthContext";
import { useAuthStore } from "../../shared/auth/AuthStore";
import { ROLE_HOME } from "../../shared/auth/ProtectedRoute";

export default function LoginPage({ recovery = false }: { recovery?: boolean }) {
  const { session, login, requestPasswordReset, updatePassword } = useAuth();
  const authError = useAuthStore((state) => state.error);
  const isLoading = useAuthStore((state) => state.isLoading);
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!recovery && new URLSearchParams(location.search).get("confirmed") === "1") {
      setMessage("Correo confirmado. Ya puedes iniciar sesión con tu contraseña.");
    }
  }, [location.search, recovery]);

  if (isLoading && !session) return <main className="grid min-h-screen place-items-center bg-obsidian text-stone-100"><div className="text-center"><span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-brass/30 border-t-brass"/><p className="mt-4 text-sm text-muted">Conectando con tu cuenta…</p></div></main>;
  if (session && !recovery) return <Navigate to={session.user.isSaasAdmin ? "/saas-admin" : ROLE_HOME[session.user.role]} replace/>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const result = await login(email, password);
    if (result.error) { setError(result.error); return; }
    const active = useAuthStore.getState().session;
    if (active) {
      const destination = (location.state as { from?: string } | null)?.from ?? (active.user.isSaasAdmin ? "/saas-admin" : ROLE_HOME[active.user.role]);
      navigate(destination, { replace: true });
    }
  }

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const result = await requestPasswordReset(email);
    if (result.error) setError(result.error);
    else setMessage("Si el correo pertenece a una cuenta, recibirás instrucciones de recuperación.");
  }

  async function saveNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (newPassword !== confirmPassword) { setError("Las contraseñas no coinciden."); return; }
    const result = await updatePassword(newPassword);
    if (result.error) { setError(result.error); return; }
    setMessage("Contraseña actualizada.");
    if (session) navigate(session.user.isSaasAdmin ? "/saas-admin" : ROLE_HOME[session.user.role], { replace: true });
  }

  return <main className="min-h-screen bg-obsidian text-stone-100"><div className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden border-r border-line bg-[#111113] p-12 lg:flex lg:flex-col lg:justify-between xl:p-16"><div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-brass/[.06] blur-3xl"/><div className="relative"><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl border border-brass/25 bg-brass/10 text-brass"><Scissors size={22}/></span><span><span className="block text-xs font-bold uppercase tracking-[.22em] text-brass">Barber Lounge</span><span className="mt-1 block text-xs text-muted">Manta · Manabí</span></span></div><div className="mt-24 max-w-xl"><p className="text-xs font-bold uppercase tracking-[.24em] text-brass">Cuidado con carácter</p><h1 className="mt-4 text-5xl font-semibold leading-[1.12] tracking-tight xl:text-6xl">El arte del buen corte, en un solo lugar.</h1><p className="mt-6 max-w-lg text-base leading-7 text-muted">Operación, atención y estilo conectados para que cada visita se sienta premium.</p></div></div><div className="relative flex items-center gap-3 border-t border-line pt-6 text-xs text-muted"><ShieldCheck size={16} className="text-electric"/>Acceso gestionado por tu cuenta<span className="ml-auto">© Barber Lounge</span></div></section>

    <section className="flex items-center justify-center p-5 py-10 sm:p-8"><div className="w-full max-w-lg">
      <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="grid h-11 w-11 place-items-center rounded-xl border border-brass/25 bg-brass/10 text-brass"><Scissors size={20}/></span><span className="text-xs font-bold uppercase tracking-[.2em] text-brass">Barber Lounge</span></div>
      {recovery ? <>
        <Link to="/login" className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-muted hover:text-brass"><ArrowLeft size={16}/>Volver al inicio de sesión</Link>
        <h1 className="mt-8 text-3xl font-semibold">{session ? "Establece tu contraseña" : "Recupera tu acceso"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{session ? "El enlace fue validado. Elige una contraseña segura para entrar a tu espacio de trabajo." : "Ingresa el correo asociado a tu cuenta y te enviaremos un enlace para establecer una contraseña."}</p>
        {session ? <form onSubmit={saveNewPassword} className="mt-7 space-y-4">
          <label className="block text-xs font-semibold text-stone-300">Nueva contraseña<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 min-h-14 w-full rounded-xl border border-line bg-panel px-4 text-base outline-none focus:border-brass"/></label>
          <label className="block text-xs font-semibold text-stone-300">Confirmar contraseña<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 min-h-14 w-full rounded-xl border border-line bg-panel px-4 text-base outline-none focus:border-brass"/></label>
          <button disabled={isLoading} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brass text-sm font-bold text-obsidian disabled:opacity-70">Actualizar contraseña <ArrowRight size={17}/></button>
          {(error || authError) && <p role="alert" className="rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-red-300">{error || authError}</p>}
          {message && <p role="status" className="rounded-xl border border-electric/20 bg-electric/10 p-3 text-sm text-electric">{message}</p>}
        </form> : <form onSubmit={requestRecovery} className="mt-7 space-y-4">
          <label className="block text-xs font-semibold text-stone-300">Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" className="mt-2 min-h-14 w-full rounded-xl border border-line bg-panel px-4 text-base outline-none placeholder:text-muted focus:border-brass"/></label>
          <button disabled={isLoading} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brass text-sm font-bold text-obsidian disabled:opacity-70">Enviar instrucciones <ArrowRight size={17}/></button>
          {(error || authError) && <p role="alert" className="rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-red-300">{error || authError}</p>}
          {message && <p role="status" className="rounded-xl border border-electric/20 bg-electric/10 p-3 text-sm text-electric">{message}</p>}
        </form>}
      </> : <>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-brass">Bienvenido de nuevo</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Inicia sesión</h1><p className="mt-2 text-sm text-muted">Ingresa a tu espacio de Barber Lounge.</p>
        <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-xs font-semibold text-stone-300">Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@barberlounge.ec" className="mt-2 min-h-14 w-full rounded-xl border border-line bg-panel px-4 text-base outline-none placeholder:text-muted focus:border-brass"/></label><label className="block text-xs font-semibold text-stone-300">Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" className="mt-2 min-h-14 w-full rounded-xl border border-line bg-panel px-4 text-base outline-none placeholder:text-muted focus:border-brass"/></label>{(error || authError) && <p role="alert" className="rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-red-300">{error || authError}</p>}<div className="flex justify-end"><Link to="/login/recovery" className="inline-flex min-h-11 items-center text-xs font-semibold text-brass hover:text-[#e3c14b]">¿Olvidaste tu contraseña?</Link></div><button type="submit" disabled={isLoading} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brass text-sm font-bold text-obsidian transition hover:bg-[#e3c14b] disabled:cursor-wait disabled:opacity-70">{isLoading ? "Conectando…" : <>Entrar <ArrowRight size={17}/></>}</button></form>
        <p className="mt-7 text-center text-xs leading-5 text-muted">Usa las credenciales de tu cuenta Barber Lounge. <Link to="/register" className="font-semibold text-brass hover:underline">Registra tu barbería</Link></p>
      </>}
    </div></section>
  </div></main>;
}
