import { supabase } from "./supabaseClient";

export interface TenantSession {
  userId: string;
  email: string;
  tenantId: string;
  companyName: string;
  slug: string;
}

/** Signs up a brand-new factory account and creates its tenant row. */
export async function signUpTenant(
  email: string,
  password: string,
  companyName: string
): Promise<TenantSession> {
  if (!supabase) throw new Error("Backend is not configured.");

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) throw signUpError;
  const userId = signUpData.user?.id;
  if (!userId) throw new Error("Sign-up did not return a user.");

  const slug = slugify(companyName) + "-" + userId.slice(0, 6);
  const { data: tenantRow, error: tenantError } = await supabase
    .from("tenants")
    .insert({ owner_user_id: userId, company_name: companyName, slug })
    .select()
    .single();
  if (tenantError) throw tenantError;

  return { userId, email, tenantId: tenantRow.id, companyName: tenantRow.company_name, slug: tenantRow.slug };
}

/** Signs in an existing factory account and loads its tenant row. */
export async function signInTenant(email: string, password: string): Promise<TenantSession> {
  if (!supabase) throw new Error("Backend is not configured.");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const userId = data.user.id;

  const { data: tenantRow, error: tenantError } = await supabase
    .from("tenants")
    .select()
    .eq("owner_user_id", userId)
    .single();
  if (tenantError) throw tenantError;

  return {
    userId,
    email: data.user.email ?? email,
    tenantId: tenantRow.id,
    companyName: tenantRow.company_name,
    slug: tenantRow.slug,
  };
}

export async function signOutTenant(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** Restores the session on app load (e.g. after a page refresh), if any. */
export async function restoreTenantSession(): Promise<TenantSession | null> {
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;

  const { data: tenantRow, error } = await supabase.from("tenants").select().eq("owner_user_id", user.id).single();
  if (error || !tenantRow) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    tenantId: tenantRow.id,
    companyName: tenantRow.company_name,
    slug: tenantRow.slug,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tenant";
}
