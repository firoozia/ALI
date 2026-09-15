import { CheckCircle2 } from "lucide-react";

export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-3 text-sm font-medium text-white shadow-panel animate-in">
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
      {message}
    </div>
  );
}
