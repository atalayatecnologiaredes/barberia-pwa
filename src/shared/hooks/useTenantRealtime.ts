import { useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export type TenantRealtimeTable = {
  table: string;
  tenantColumn?: string | null;
};

function isTenantRealtimeTable(value: unknown): value is TenantRealtimeTable {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.table === "string" && (row.tenantColumn === undefined || row.tenantColumn === null || typeof row.tenantColumn === "string");
}

function parseTenantRealtimeTables(serialized: string): TenantRealtimeTable[] {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter(isTenantRealtimeTable) : [];
  } catch {
    return [];
  }
}

export function useTenantRealtime(
  tenantId: string | null | undefined,
  tables: TenantRealtimeTable[],
  refresh: () => void | Promise<void>,
) {
  const tableKey = JSON.stringify(tables);

  useEffect(() => {
    if (!tenantId) return;

    let debounce: number | undefined;
    let realtimeConnected = false;
    const scheduleRefresh = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { void refresh(); }, 120);
    };
    const channel = supabase.channel(`tenant-refresh:${tenantId}:${tableKey}`);
    for (const { table, tenantColumn = "tenant_id" } of parseTenantRealtimeTables(tableKey)) {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        ...(tenantColumn ? { filter: `${tenantColumn}=eq.${tenantId}` } : {}),
      }, scheduleRefresh);
    }

    const onFocus = () => { if (document.visibilityState === "visible") scheduleRefresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", scheduleRefresh);
    const fallback = window.setInterval(() => {
      if (!realtimeConnected && document.visibilityState === "visible") scheduleRefresh();
    }, 60_000);

    channel.subscribe((status) => { realtimeConnected = status === "SUBSCRIBED"; });
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", scheduleRefresh);
      void supabase.removeChannel(channel);
    };
  }, [tenantId, tableKey, refresh]);
}
