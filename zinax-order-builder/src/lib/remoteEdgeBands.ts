import { supabase } from "./supabaseClient";
import type { EdgeBandCatalogItem } from "../core/melamine";
import type { PublicEdgeBand } from "../core/publicCatalogSchema";

/** True when the error means the edge_bands table has not been created on this backend yet. */
export function isMissingEdgeBandTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /edge_bands/.test(e.message ?? "")));
}

/** Publishes the factory's edge-band codes to its public customer portal (same pattern as colors). */
export async function publishEdgeBandsToPortal(tenantId: string, bands: EdgeBandCatalogItem[]): Promise<void> {
  if (!supabase) return;

  const rows = bands
    .filter((b) => b.code.trim() !== "")
    .map((b) => ({
      tenant_id: tenantId,
      code: b.code,
      name: b.name,
      thickness_mm: b.thicknessMm,
      active: b.active,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("edge_bands").upsert(rows, { onConflict: "tenant_id,code" });
    if (error) throw error;
  }

  const { data: existing, error: listError } = await supabase.from("edge_bands").select("code").eq("tenant_id", tenantId);
  if (listError) throw listError;
  const currentCodes = new Set(rows.map((r) => r.code));
  const staleCodes = (existing as { code: string }[]).map((r) => r.code).filter((code) => !currentCodes.has(code));
  if (staleCodes.length > 0) {
    const { error: deleteError } = await supabase
      .from("edge_bands")
      .delete()
      .eq("tenant_id", tenantId)
      .in("code", staleCodes);
    if (deleteError) throw deleteError;
  }
}

/** Public read of a factory's active edge bands. An older backend without the table returns []. */
export async function fetchPublicEdgeBands(tenantId: string): Promise<PublicEdgeBand[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("edge_bands")
    .select()
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code");
  if (error) {
    if (isMissingEdgeBandTable(error)) return [];
    throw error;
  }
  return (data as { code: string; name: string; thickness_mm: number; active: boolean }[]).map((row) => ({
    code: row.code,
    name: row.name,
    thicknessMm: Number(row.thickness_mm),
    active: row.active,
  }));
}
