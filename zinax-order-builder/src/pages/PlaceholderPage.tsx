import type { ComponentType, SVGProps } from "react";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export default function PlaceholderPage({ title, description, icon: Icon }: PlaceholderPageProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy-800/10 text-navy-800">
        <Icon className="h-8 w-8" strokeWidth={1.8} />
      </div>
      <h2 className="mt-5 text-xl font-bold text-ink-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-ink-500">{description}</p>
      <span className="mt-5 zx-badge bg-ink-100 text-ink-500">Coming soon in this prototype</span>
    </div>
  );
}
