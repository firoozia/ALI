import { supabase } from "./supabaseClient";
import type { DesignCatalogItem } from "../core/catalogSchema";
import type { PublicDesign } from "../core/publicCatalogSchema";

/** Publishes the factory's currently-active designs to its public customer portal. */
export async function publishDesignsToPortal(tenantId: string, designs: DesignCatalogItem[]): Promise<void> {
  if (!supabase) return;

  const rows = designs
    .filter((d) => d.code.trim() !== "")
    .map((d) => ({
      tenant_id: tenantId,
      code: d.code,
      name: d.name,
      price_per_door: d.defaultUnitPrice,
      active: d.active,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("designs").upsert(rows, { onConflict: "tenant_id,code" });
    if (error) throw error;
  }

  // Remove any previously-published code that's no longer in the local
  // catalog (deleted design, or renamed code) — computed client-side so the
  // delete filter never has to interpolate raw code strings into a query.
  const { data: existing, error: listError } = await supabase.from("designs").select("code").eq("tenant_id", tenantId);
  if (listError) throw listError;
  const currentCodes = new Set(rows.map((r) => r.code));
  const staleCodes = (existing as { code: string }[]).map((r) => r.code).filter((code) => !currentCodes.has(code));
  if (staleCodes.length > 0) {
    const { error: deleteError } = await supabase
      .from("designs")
      .delete()
      .eq("tenant_id", tenantId)
      .in("code", staleCodes);
    if (deleteError) throw deleteError;
  }
}

/** Public, unauthenticated read of a factory's active designs — used by the customer portal. */
export async function fetchPublicDesigns(tenantId: string): Promise<PublicDesign[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("designs")
    .select()
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code");
  if (error) throw error;
  return (data as { code: string; name: string; price_per_door: number; active: boolean }[]).map((row) => ({
    code: row.code,
    name: row.name,
    pricePerDoor: row.price_per_door,
    active: row.active,
  }));
}
