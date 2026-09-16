import { Settings as SettingsIcon, Cpu, Monitor, Globe2 } from "lucide-react";
import { ARCHITECTURE_NOTE } from "../core/exportContracts";

export default function Settings() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-ink-900">Settings</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          Company details, defaults, and language preferences will live here.
        </p>
      </div>

      <div className="zx-card mb-5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800/10 text-navy-800">
            <Cpu className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-ink-900">System Architecture</h3>
        </div>
        <p className="rounded-lg bg-navy-50 p-3 text-sm font-medium text-navy-800 ring-1 ring-navy-100">
          {ARCHITECTURE_NOTE}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg border border-ink-100 p-3">
            <Globe2 className="h-4 w-4 shrink-0 text-navy-700" />
            <div>
              <p className="text-sm font-semibold text-ink-800">Web Edition</p>
              <p className="text-2xs text-ink-500">React frontend + FastAPI backend</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-ink-100 p-3">
            <Monitor className="h-4 w-4 shrink-0 text-navy-700" />
            <div>
              <p className="text-sm font-semibold text-ink-800">Windows Edition</p>
              <p className="text-2xs text-ink-500">PySide6, same shared order core</p>
            </div>
          </div>
        </div>
      </div>

      <div className="zx-card flex flex-col items-center px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy-800/10 text-navy-800">
          <SettingsIcon className="h-8 w-8" strokeWidth={1.8} />
        </div>
        <h3 className="mt-5 text-lg font-bold text-ink-900">Company &amp; Defaults</h3>
        <p className="mt-2 max-w-md text-sm text-ink-500">
          Company profile, default VAT/currency, salespersons, and design/PVC catalogs will be
          editable here, with export/import to move settings between installs.
        </p>
        <span className="mt-5 zx-badge bg-ink-100 text-ink-500">Coming soon in this prototype</span>
      </div>
    </div>
  );
}
