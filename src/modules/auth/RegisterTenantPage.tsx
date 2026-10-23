import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Scissors } from "lucide-react";
import { supabase } from "../../shared/lib/supabaseClient";

export default function RegisterTenantPage() {
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
          data: {
            full_name: ownerName.trim(),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            signup_type: "shop_owner",
          },
        },
      });
      if (signUpError) throw signUpError;
      if (!data.user) throw new Error("Supabase no devolvió el usuario creado.");

      if (!data.session && !data.user.identities?.length) {
        setSuccess("Si el correo todavía no tiene cuenta, recibirás instrucciones para continuar. Revisa también Spam y Promociones.");
        return;
      }

      setSuccess(data.session
        ? "Tu cuenta está lista. Inicia sesión para terminar de configurar tu barbería.":
          "Cuenta creada. Confirma tu correo desde el enlace que te enviamos y luego inicia sesión para configurar tu barbería.");
      setOwnerName("");
      setEmail("");
      setPhone("");
      setPassword("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const normalized = message.toLowerCase();
      const isDatabaseSignupFailure = normalized.includes("database error saving new user")
        || normalized.includes("database error creating new user");
      setError(isDatabaseSignupFailure
        ? "No se pudo completar el alta en la base de datos. Aplica las migraciones pendientes de supabase/migrations y revisa Authentication → Logs y Database → Logs."
        : message || "No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-obsidian px-4 py-8 text-stone-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <Link to="/login" className="inline-flex min-h-12 items-center gap-2 text-sm text-muted hover:text-brass"><ArrowLeft size={16}/>Volver al acceso</Link>
      <header className="mb-7 mt-5 flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl border border-brass/30 bg-brass/10 text-brass"><Scissors size={25}/></div><div><p className="text-xs font-bold uppercase tracking-[.22em] text-brass">Barber Lounge</p><h1 className="mt-1 text-3xl font-semibold">Crea tu cuenta</h1></div></header>

      <form onSubmit={submit} className="space-y-5 rounded-3xl border border-line bg-panel p-5 sm:p-8">
        <p className="text-sm leading-6 text-muted">Empieza con una cuenta de acceso. Tu barbería se creará con el plan Básico y podrás completar sus datos desde el panel.</p>
        <label className="block text-sm text-stone-300">Nombre completo<input required autoComplete="name" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-4 text-stone-100 outline-none focus:border-brass"/></label>
        <label className="block text-sm text-stone-300">Teléfono <span className="text-muted">(opcional)</span><input autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-4 text-stone-100 outline-none focus:border-brass"/></label>
        <label className="block text-sm text-stone-300">Correo electrónico<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-4 text-stone-100 outline-none focus:border-brass"/></label>
        <label className="block text-sm text-stone-300">Contraseña <span className="text-muted">(mínimo 8 caracteres)</span><input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-obsidian px-4 text-stone-100 outline-none focus:border-brass"/></label>
        {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        {success && <p role="status" className="rounded-xl border border-electric/30 bg-electric/10 p-3 text-sm text-green-200">{success} <Link className="font-semibold underline" to="/login">Ir al acceso</Link></p>}
        <button disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brass px-5 font-bold text-obsidian transition hover:bg-[#e4c454] disabled:cursor-wait disabled:opacity-60">{busy ? "Creando cuenta…" : <>Crear cuenta <ArrowRight size={17}/></>}</button>
        <p className="text-center text-xs leading-5 text-muted">El plan Básico incluye un periodo de prueba de 14 días. No se realiza ningún cobro al registrarte.</p>
      </form>
    </div>
  </main>;
}
