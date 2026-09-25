import { useState } from "react";
import { Lock } from "lucide-react";
import { signInTenant, signUpTenant, type TenantSession } from "../lib/tenantAuth";
import { extractErrorMessage } from "../lib/errors";

interface LoginProps {
  onSignedIn: (session: TenantSession) => void;
  onContinueOffline: () => void;
}

export default function Login({ onSignedIn, onContinueOffline }: LoginProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session =
        mode === "sign-up" ? await signUpTenant(email, password, companyName) : await signInTenant(email, password);
      onSignedIn(session);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="zx-card w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gold-400 text-navy-950">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-bold text-ink-900">ZINAX Order Builder</h1>
          <p className="mt-1 text-xs text-ink-500">
            {mode === "sign-in" ? "Sign in to your factory account" : "Create your factory account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "sign-up" && (
            <div>
              <label className="zx-label">Company Name</label>
              <input
                className="zx-input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Al Farsi Interiors LLC"
                required
              />
            </div>
          )}
          <div>
            <label className="zx-label">Email</label>
            <input
              type="email"
              className="zx-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <div>
            <label className="zx-label">Password</label>
            <input
              type="password"
              className="zx-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}

          <button type="submit" className="zx-btn-primary w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "sign-in" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          }}
          className="mt-5 w-full text-center text-xs font-semibold text-navy-700 hover:text-navy-900"
        >
          {mode === "sign-in" ? "New factory? Create an account" : "Already have an account? Sign in"}
        </button>

        <div className="mt-4 border-t border-ink-100 pt-4">
          <button
            type="button"
            onClick={onContinueOffline}
            className="w-full text-center text-xs font-medium text-ink-500 hover:text-ink-700"
          >
            No internet, or don't need an account right now? Continue offline
          </button>
          <p className="mt-1 text-center text-2xs text-ink-400">
            Works locally on this computer only — no order sync or customer portal until you sign in.
          </p>
        </div>
      </div>
    </div>
  );
}
