// Supabase throws plain {message, code, ...} objects for auth/database
// errors, not native Error instances, so `err instanceof Error` misses
// them and collapses every real failure (e.g. an RLS violation) into an
// unhelpful "Something went wrong."
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}
