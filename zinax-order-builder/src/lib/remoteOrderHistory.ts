import { supabase } from "./supabaseClient";
import {
  recordToRemoteRow,
  remoteRowToRecord,
  type OrderRecord,
  type RemoteOrderRow,
} from "../core/orderHistorySchema";

export async function loadRemoteOrderHistory(tenantId: string): Promise<OrderRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("orders")
    .select()
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as RemoteOrderRow[]).map(remoteRowToRecord);
}

export async function upsertRemoteOrder(tenantId: string, record: OrderRecord): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("orders")
    .upsert(recordToRemoteRow(tenantId, record), { onConflict: "tenant_id,order_no" });
  if (error) throw error;
}
