import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
type Action = "activate" | "deactivate" | "remove_access";

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

  try {
    const { data: actor, error: actorError } = await admin.from("profiles").select("id,tenant_id,role,active,tenants(active)").eq("id", authData.user.id).single();
    if (actorError || !actor?.active || actor.role !== "SUPER_ADMIN" || !actor.tenant_id) return json({ error: "Only an active shop owner can manage staff" }, 403);
    const body = await req.json() as { profile_ids?: unknown; action?: unknown };
    const ids = Array.isArray(body.profile_ids) ? [...new Set(body.profile_ids.filter((id): id is string => typeof id === "string" && id.length <= 64))] : [];
    const action = body.action;
    if (!ids.length || ids.length > 100 || !["activate", "deactivate", "remove_access"].includes(String(action))) return json({ error: "Invalid staff management request" }, 400);
    if (ids.includes(actor.id)) return json({ error: "No puedes modificar tu propia cuenta desde este panel" }, 400);
    const tenant = Array.isArray(actor.tenants) ? actor.tenants[0] : actor.tenants;
    if (!tenant?.active) return json({ error: "Shop is inactive" }, 403);

    const { data: targets, error: targetError } = await admin.from("profiles").select("id,role,barber_id").eq("tenant_id", actor.tenant_id).in("id", ids).in("role", ["BARBER", "RECEPCION"]);
    if (targetError) throw targetError;
    if (!targets || targets.length !== ids.length) return json({ error: "Uno o más integrantes no pertenecen a esta barbería." }, 404);

    const active = action === "activate";
    if (action === "remove_access") {
      for (const target of targets) {
        const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: "876000h" });
        if (error) throw error;
      }
    } else if (active) {
      for (const target of targets) {
        const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: "none" });
        if (error) throw error;
      }
    }

    const { error: profileError } = await admin.from("profiles").update({ active }).in("id", ids).eq("tenant_id", actor.tenant_id);
    if (profileError) throw profileError;
    const barberIds = targets.flatMap((target) => target.barber_id ? [target.barber_id] : []);
    if (barberIds.length) {
      const { error: barberError } = await admin.from("barbers").update({ active }).in("id", barberIds).eq("tenant_id", actor.tenant_id);
      if (barberError) throw barberError;
    }
    return json({ updated: ids.length, active, accessRemoved: action === "remove_access" });
  } catch (error) {
    console.error("manage-staff failed", error);
    return json({ error: error instanceof Error ? error.message : "No se pudo actualizar el equipo." }, 400);
  }
});
