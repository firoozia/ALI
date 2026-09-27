import { useState } from "react";
import { Search, ChevronDown, Globe, Menu, LogOut } from "lucide-react";
import type { ScreenKey } from "../../types";

const TITLES: Record<ScreenKey, string> = {
  dashboard: "Dashboard",
  "new-order": "New Order Builder",
  "order-preview": "Order Sheet Preview",
  "invoice-preview": "Proforma Invoice Preview",
  customers: "Customers",
  submissions: "Customer Orders",
  products: "Designs",
  templates: "PDF Templates",
  "export-schema": "Export Schema Preview",
  settings: "Settings",
};

interface TopbarProps {
  active: ScreenKey;
  onMenuClick: () => void;
  tenantName?: string;
  onSignOut?: () => void;
}

export default function Topbar({ active, onMenuClick, tenantName, onSignOut }: TopbarProps) {
  const [lang, setLang] = useState<"EN" | "AR">("EN");

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white/95 px-3 backdrop-blur sm:gap-4 sm:px-6 print:hidden">
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
            {tenantName ? initials(tenantName) : "AM"}
          </div>
          <div className="hidden text-left leading-tight sm:block">
            <p className="max-w-[10rem] truncate text-sm font-semibold text-ink-800">
              {tenantName || "Ahmed Al Mansoori"}
            </p>
            <p className="text-2xs text-ink-400">{tenantName ? "Factory Account" : "Salesperson"}</p>
          </div>
          {onSignOut && (
            <button
              onClick={onSignOut}
              title="Sign out"
              className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
