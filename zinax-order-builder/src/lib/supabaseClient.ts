import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reads from .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, see
// .env.example) — until a real Supabase project is wired up, both are
// undefined and the app runs exactly as before (localStorage-only), so
// this never breaks the existing offline/demo experience.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export function isBackendConfigured(): boolean {
  return supabase !== null;
}
