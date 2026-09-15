import { Search, ChevronDown, Globe, Menu } from "lucide-react";
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

export default function Topbar({ active, onMenuClick }) {
  const [lang, setLang] = useState("EN");

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white/95 px-3 backdrop-blur sm:gap-4 sm:px-6">
      <button
        onClick={onMenuClick}
        className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0">
        <p className="hidden text-2xs font-semibold uppercase tracking-wide text-ink-400 sm:block">
          ZINAX Order Builder
        </p>
        <h1 className="truncate text-sm font-bold text-ink-900 sm:text-base">
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

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => setLang(lang === "EN" ? "AR" : "EN")}
          className="flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50 sm:gap-1.5 sm:px-3 sm:text-sm"
        >
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">
            {lang} / {lang === "EN" ? "AR" : "EN"}
          </span>
          <span className="sm:hidden">{lang}</span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-ink-400 sm:inline" />
        </button>

        <div className="flex items-center gap-2.5 rounded-lg border border-ink-200 py-1.5 pl-1.5 pr-1.5 sm:pr-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
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
