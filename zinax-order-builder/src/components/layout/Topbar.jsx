import { Search, ChevronDown, Globe } from "lucide-react";
import { useState } from "react";

const TITLES = {
  dashboard: "Dashboard",
  "new-order": "New Order Builder",
  "order-preview": "Order Sheet Preview",
  "invoice-preview": "Proforma Invoice Preview",
  customers: "Customers",
  products: "Products / Designs",
  templates: "PDF Templates",
  settings: "Settings",
};

export default function Topbar({ active }) {
  const [lang, setLang] = useState("EN");

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-ink-200 bg-white/95 px-6 backdrop-blur">
      <div className="min-w-0">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">
          ZINAX Order Builder
        </p>
        <h1 className="truncate text-base font-bold text-ink-900">
          {TITLES[active] || "ZINAX Order Builder"}
        </h1>
      </div>

      <div className="ml-4 hidden max-w-md flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 md:flex">
        <Search className="h-4 w-4 text-ink-400" />
        <input
          type="text"
          placeholder="Search orders, customers, projects..."
          className="w-full bg-transparent text-sm text-ink-700 placeholder:text-ink-400 outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={() => setLang(lang === "EN" ? "AR" : "EN")}
          className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-semibold text-ink-600 hover:bg-ink-50"
        >
          <Globe className="h-4 w-4" />
          {lang} / {lang === "EN" ? "AR" : "EN"}
          <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
        </button>

        <div className="flex items-center gap-2.5 rounded-lg border border-ink-200 py-1.5 pl-1.5 pr-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
            AM
          </div>
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-sm font-semibold text-ink-800">Ahmed Al Mansoori</p>
            <p className="text-2xs text-ink-400">Salesperson</p>
          </div>
        </div>
      </div>
    </header>
  );
}
