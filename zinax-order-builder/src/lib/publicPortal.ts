import { supabase } from "./supabaseClient";
import type { CustomerSubmission, PublicTenant } from "../core/publicCatalogSchema";

/** Public, unauthenticated lookup — resolves a factory's link slug to its id/name. */
export async function resolveTenantBySlug(slug: string): Promise<PublicTenant | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("tenants").select().eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, slug: data.slug, companyName: data.company_name };
}

/** Public, unauthenticated write — the customer portal's "Submit Order" action. */
export async function submitCustomerOrder(tenantId: string, submission: CustomerSubmission): Promise<void> {
  if (!supabase) throw new Error("Backend is not configured.");
  const { error } = await supabase.from("customer_submissions").insert({
    tenant_id: tenantId,
    customer_name: submission.customerName,
    end_customer_name: submission.endCustomerName,
    site_name: submission.siteName,
    items: submission.items,
  });
  if (error) throw error;
}
