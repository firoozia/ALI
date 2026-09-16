import { CheckCircle2, AlertTriangle, Info } from "lucide-react";

export type ToastTone = "success" | "error" | "neutral";

interface ToastProps {
  message: string;
  tone?: ToastTone;
}

export default function Toast({ message, tone = "success" }: ToastProps) {
  if (!message) return null;
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-panel ${
        tone === "error" ? "bg-red-600" : tone === "neutral" ? "bg-ink-600" : "bg-ink-900"
      }`}
    >
      {tone === "error" ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
      ) : tone === "neutral" ? (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-200" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      )}
      <span className="whitespace-pre-line">{message}</span>
    </div>
  );
}
