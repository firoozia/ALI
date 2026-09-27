// The customer portal has no login, so "My Orders" is tracked entirely on
// this device: the id Supabase assigns each submission this browser has
// created, remembered in localStorage per factory slug. It's not an
// account — clearing browser data or switching devices loses the list
// (the factory's own Customer Orders inbox always has the real copy).
interface StoredOrderRef {
  id: string;
  savedAt: string;
}

const storageKey = (tenantSlug: string) => `zinax_customer_orders_v1:${tenantSlug}`;

export function rememberSubmission(tenantSlug: string, submissionId: string): void {
  if (typeof window === "undefined") return;
  try {
    const refs = listRememberedSubmissions(tenantSlug);
    refs.unshift({ id: submissionId, savedAt: new Date().toISOString() });
    window.localStorage.setItem(storageKey(tenantSlug), JSON.stringify(refs));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — the order was
    // still sent to the factory, it just won't show up in "My Orders".
  }
}

export function listRememberedSubmissions(tenantSlug: string): StoredOrderRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tenantSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is StoredOrderRef => typeof r === "object" && r !== null && typeof (r as StoredOrderRef).id === "string"
    );
  } catch {
    return [];
  }
}

export function forgetSubmission(tenantSlug: string, submissionId: string): void {
  if (typeof window === "undefined") return;
  try {
    const refs = listRememberedSubmissions(tenantSlug).filter((r) => r.id !== submissionId);
    window.localStorage.setItem(storageKey(tenantSlug), JSON.stringify(refs));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
