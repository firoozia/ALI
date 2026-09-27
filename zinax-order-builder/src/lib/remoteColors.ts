import { supabase } from "./supabaseClient";
import type { PvcCatalogItem } from "../core/catalogSchema";
import type { PublicColor } from "../core/publicCatalogSchema";

/** Publishes the factory's currently-active PVC/membrane colors to its public customer portal. */
export async function publishColorsToPortal(tenantId: string, colors: PvcCatalogItem[]): Promise<void> {
  if (!supabase) return;

  const rows = colors
    .filter((c) => c.code.trim() !== "")
    .map((c) => ({
      tenant_id: tenantId,
      code: c.code,
      color: c.color,
      active: c.active,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("colors").upsert(rows, { onConflict: "tenant_id,code" });
    if (error) throw error;
  }

  // Remove any previously-published code that's no longer in the local
  // catalog — computed client-side, same as publishDesignsToPortal.
  const { data: existing, error: listError } = await supabase.from("colors").select("code").eq("tenant_id", tenantId);
  if (listError) throw listError;
  const currentCodes = new Set(rows.map((r) => r.code));
  const staleCodes = (existing as { code: string }[]).map((r) => r.code).filter((code) => !currentCodes.has(code));
  if (staleCodes.length > 0) {
    const { error: deleteError } = await supabase
      .from("colors")
      .delete()
      .eq("tenant_id", tenantId)
      .in("code", staleCodes);
    if (deleteError) throw deleteError;
  }
}

/** Public, unauthenticated read of a factory's active colors — used by the customer portal. */
export async function fetchPublicColors(tenantId: string): Promise<PublicColor[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("colors")
    .select()
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code");
  if (error) throw error;
  return (data as { code: string; color: string; active: boolean }[]).map((row) => ({
    code: row.code,
    color: row.color,
    active: row.active,
  }));
}
