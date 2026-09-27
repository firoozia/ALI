import { supabase } from "./supabaseClient";
import type { CustomerSubmissionRecord, CustomerSubmissionStatus } from "../core/publicCatalogSchema";

interface SubmissionRow {
  id: string;
  submitted_at: string;
  customer_name: string;
  end_customer_name: string;
  site_name: string;
  items: CustomerSubmissionRecord["items"];
  status: CustomerSubmissionStatus;
}

/** The factory's own read of the online orders its customers have submitted. */
export async function fetchCustomerSubmissions(tenantId: string): Promise<CustomerSubmissionRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("customer_submissions")
    .select()
    .eq("tenant_id", tenantId)
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return (data as SubmissionRow[]).map((row) => ({
    id: row.id,
    submittedAt: row.submitted_at,
    status: row.status,
    customerName: row.customer_name,
    endCustomerName: row.end_customer_name,
    siteName: row.site_name,
    items: row.items,
  }));
}

export async function updateSubmissionStatus(id: string, status: CustomerSubmissionStatus): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("customer_submissions").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteSubmission(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("customer_submissions").delete().eq("id", id);
  if (error) throw error;
}
