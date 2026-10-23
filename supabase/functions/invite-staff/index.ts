import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey || !authHeader) return json({ error: "Function configuration is incomplete" }, 500);

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Authentication required" }, 401);

  let createdUserId: string | null = null;
  let barberId: string | null = null;
  let triggerClientId: string | null = null;
  let safeToDeleteUser = false;
  try {
    const { data: actor, error: actorError } = await admin.from("profiles").select("id,tenant_id,role,active,tenants(active)").eq("id", authData.user.id).single();
    if (actorError || !actor?.active || actor.role !== "SUPER_ADMIN" || !actor.tenant_id) return json({ error: "Only an active shop owner can invite staff" }, 403);
    const body = await req.json() as { email?: string; full_name?: string; role?: string };
    const email = body.email?.trim().toLowerCase();
    const fullName = body.full_name?.trim();
    const role = body.role;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 120 || !["BARBER", "RECEPCION"].includes(role ?? "")) return json({ error: "Invalid invitation details" }, 400);
    const tenant = Array.isArray(actor.tenants) ? actor.tenants[0] : actor.tenants;
    if (!tenant?.active) return json({ error: "Shop is inactive" }, 403);

    // Do not turn an existing Auth account into staff through an email invite.
    // CRM-only clients are safe: the Auth trigger gives their temporary profile
    // a client row without email, avoiding the clients.email unique constraint.
    const { data: existingProfile, error: existingProfileError } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existingProfileError) throw new Error("Could not verify whether this email already has an account");
    if (existingProfile) return json({ error: "Este correo ya tiene una cuenta en el sistema. Usa una dirección distinta o solicita al administrador el proceso de cambio de rol." }, 409);

    if (role === "BARBER") {
      const [{ data: subscription, error: subscriptionError }, { count, error: countError }] = await Promise.all([
        admin.from("saas_subscriptions").select("max_barbers,status").eq("tenant_id", actor.tenant_id).in("status", ["active", "trialing"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("barbers").select("id", { count: "exact", head: true }).eq("tenant_id", actor.tenant_id).eq("active", true),
      ]);
      if (subscriptionError || countError) throw new Error("Could not verify barber capacity");
      if (!subscription || (count ?? 0) >= subscription.max_barbers) return json({ error: "Your plan has reached its active barber limit" }, 409);
    }

    // The invite link must return to the password setup screen. Supabase only
    // redirects to origins present in Authentication → URL Configuration.
    const configuredAppUrl = Deno.env.get("APP_BASE_URL")?.trim();
    const requestOrigin = req.headers.get("origin")?.trim();
    const redirectBase = configuredAppUrl || requestOrigin;
    if (!redirectBase) return json({ error: "No se pudo determinar la URL de la aplicación para completar la invitación." }, 500);
    let appOrigin: string;
    try {
      const parsed = new URL(redirectBase);
      if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
        return json({ error: "APP_BASE_URL debe contener únicamente el origen de la aplicación." }, 500);
      }
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
        return json({ error: "La URL de invitación debe usar HTTPS (HTTP solo se permite en localhost)." }, 500);
      }
      appOrigin = parsed.origin;
    } catch {
      return json({ error: "La URL configurada para la aplicación no es válida." }, 500);
    }
    const redirectTo = new URL("/login/recovery", appOrigin).toString();

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, signup_type: "staff_invitation" },
      redirectTo,
    });
    if (inviteError || !invited.user) throw inviteError ?? new Error("Invitation failed");
    createdUserId = invited.user.id;

    const { data: profile, error: profileError } = await admin.from("profiles").select("id,role,client_id,tenant_id").eq("id", createdUserId).maybeSingle();
    if (profileError || !profile) throw new Error("Auth invitation did not create a profile");
    if (profile.role !== "CLIENT") throw new Error("This email already belongs to a different account");
    if (profile.tenant_id) throw new Error("This account already belongs to a shop");
    triggerClientId = profile.client_id;
    safeToDeleteUser = true;

    if (role === "BARBER") {
      barberId = `barber_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const stationId = `station_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const { error: barberError } = await admin.from("barbers").insert({ id: barberId, tenant_id: actor.tenant_id, name: fullName, title: "Barbero", station_id: stationId });
      if (barberError) throw barberError;
    }
    const { error: updateError } = await admin.from("profiles").update({ role, tenant_id: actor.tenant_id, client_id: null, barber_id: barberId, full_name: fullName }).eq("id", createdUserId).eq("role", "CLIENT");
    if (updateError) throw updateError;
    if (triggerClientId) await admin.from("clients").delete().eq("id", triggerClientId);
    return json({ invited: true, role, email });
  } catch (error) {
    if (barberId) await admin.from("barbers").delete().eq("id", barberId);
    if (createdUserId && safeToDeleteUser) {
      if (triggerClientId) await admin.from("clients").delete().eq("id", triggerClientId);
      await admin.auth.admin.deleteUser(createdUserId);
    }
    console.error("invite-staff failed", error);
    const message = error instanceof Error ? error.message : "Invitation failed";
    if (/database error saving new user/i.test(message)) {
      return json({ error: "Supabase no pudo crear el perfil de acceso. Revisa los registros de Auth y Database; la solicitud no completó la invitación." }, 400);
    }
    return json({ error: message }, 400);
  }
});
