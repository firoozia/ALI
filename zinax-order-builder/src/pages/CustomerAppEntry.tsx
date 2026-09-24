import { useState } from "react";
import { Building2 } from "lucide-react";
import CustomerPortal from "./CustomerPortal";

const STORAGE_KEY = "zinax_customer_factory_slug";

interface CustomerAppEntryProps {
  /** A slug already given via a web link (?factory=slug) takes priority over anything saved locally. */
  urlSlug: string | null;
}

/**
 * Entry screen for the standalone customer desktop app (VITE_APP_ROLE=
 * "customer") — there's no URL bar to carry ?factory=slug there, so the
 * factory code is asked for once and remembered locally instead.
 */
export default function CustomerAppEntry({ urlSlug }: CustomerAppEntryProps) {
  const [savedSlug, setSavedSlug] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [input, setInput] = useState("");

  const activeSlug = urlSlug || savedSlug;

  if (activeSlug) {
    return (
      <div>
        <CustomerPortal slug={activeSlug} />
        {!urlSlug && (
          <button
            onClick={() => {
              try {
                window.localStorage.removeItem(STORAGE_KEY);
              } catch {
                // ignore
              }
              setSavedSlug(null);
            }}
            className="fixed bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-2xs text-ink-400 shadow hover:text-ink-700"
          >
            Not your factory? Change code
          </button>
        )}
      </div>
    );
  }

  const handleContinue = () => {
    const slug = input.trim();
    if (!slug) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, slug);
    } catch {
      // ignore — still proceed for this session
    }
    setSavedSlug(slug);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="zx-card w-full max-w-sm p-7 text-center">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gold-400 text-navy-950 mx-auto">
          <Building2 className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold text-ink-900">ZINAX Customer Order</h1>
        <p className="mt-1 text-xs text-ink-500">Enter the code your factory gave you to continue.</p>

        <div className="mt-5 text-left">
          <label className="zx-label">Factory Code</label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleContinue()}
            className="zx-input"
            placeholder="e.g. al-farsi-interiors"
            autoFocus
          />
        </div>

        <button onClick={handleContinue} disabled={!input.trim()} className="zx-btn-primary mt-4 w-full">
          Continue
        </button>
      </div>
    </div>
  );
}
