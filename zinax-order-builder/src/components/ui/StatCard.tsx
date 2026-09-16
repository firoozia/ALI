import type { ComponentType, SVGProps } from "react";

type Accent = "navy" | "gold" | "emerald" | "amber";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent?: Accent;
  suffix?: string;
}

export default function StatCard({ label, value, icon: Icon, accent = "navy", suffix }: StatCardProps) {
  const accents: Record<Accent, string> = {
    navy: "bg-navy-800/10 text-navy-800",
    gold: "bg-gold-500/15 text-gold-600",
    emerald: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-600",
  };
  return (
    <div className="zx-card flex items-center gap-4 p-5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accents[accent]}`}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold text-ink-900">
          {value}
          {suffix && <span className="ml-1 text-sm font-medium text-ink-400">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}
