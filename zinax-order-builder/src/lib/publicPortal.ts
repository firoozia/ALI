import { supabase } from "./supabaseClient";
import type { CustomerSubmission, CustomerSubmissionRecord, PublicTenant } from "../core/publicCatalogSchema";

interface SubmissionRow {
  id: string;
  submitted_at: string;
  customer_name: string;
  end_customer_name: string;
  site_name: string;
  items: CustomerSubmissionRecord["items"];
  status: CustomerSubmissionRecord["status"];
}

function toRecord(row: SubmissionRow): CustomerSubmissionRecord {
  return {
    id: row.id,
    submittedAt: row.submitted_at,
    status: row.status,
    customerName: row.customer_name,
    endCustomerName: row.end_customer_name,
    siteName: row.site_name,
    items: row.items,
  };
}

/** Public, unauthenticated lookup — resolves a factory's link slug to its id/name. */
export async function resolveTenantBySlug(slug: string): Promise<PublicTenant | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("tenants").select().eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, slug: data.slug, companyName: data.company_name };
}

/** Public, unauthenticated write — the customer portal's "Submit Order" action. Returns the new row's id, so the portal can remember it for "My Orders". */
export async function submitCustomerOrder(tenantId: string, submission: CustomerSubmission): Promise<string> {
  if (!supabase) throw new Error("Backend is not configured.");
  const { data, error } = await supabase
    .from("customer_submissions")
    .insert({
      tenant_id: tenantId,
      customer_name: submission.customerName,
      end_customer_name: submission.endCustomerName,
      site_name: submission.siteName,
      items: submission.items,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Public, unauthenticated read of specific past submissions by id — used
 * by "My Orders" on the customer portal. Only ever returns the exact ids
 * passed in (see get_customer_submissions in schema.sql); it can never be
 * used to list or browse anyone else's orders.
 */
export async function fetchMyCustomerSubmissions(submissionIds: string[]): Promise<CustomerSubmissionRecord[]> {
  if (!supabase || submissionIds.length === 0) return [];
  const { data, error } = await supabase.rpc("get_customer_submissions", { submission_ids: submissionIds });
  if (error) throw error;
  return (data as SubmissionRow[]).map(toRecord);
}

/**
 * Public, unauthenticated edit of one of the customer's own past
 * submissions — only takes effect while the factory hasn't picked it up
 * yet (status still "new"; see update_customer_submission in schema.sql).
 * Returns null if it's already been imported/dismissed.
 */
export async function updateMyCustomerSubmission(
  submissionId: string,
  submission: CustomerSubmission
): Promise<CustomerSubmissionRecord | null> {
  if (!supabase) throw new Error("Backend is not configured.");
  const { data, error } = await supabase.rpc("update_customer_submission", {
    submission_id: submissionId,
    new_customer_name: submission.customerName,
    new_end_customer_name: submission.endCustomerName,
    new_site_name: submission.siteName,
    new_items: submission.items,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? toRecord(row as SubmissionRow) : null;
}
