import { CheckCircle2, AlertTriangle } from "lucide-react";

export type ToastTone = "success" | "error";

interface ToastProps {
  message: string;
  tone?: ToastTone;
}

export default function Toast({ message, tone = "success" }: ToastProps) {
  if (!message) return null;
  const isError = tone === "error";
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-panel ${
        isError ? "bg-red-600" : "bg-ink-900"
      }`}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      )}
      <span className="whitespace-pre-line">{message}</span>
    </div>
  );
}
