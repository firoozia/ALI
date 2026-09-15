import {
  LayoutDashboard,
  FilePlus2,
  Users,
  Blocks,
  FileStack,
  Settings,
  Hammer,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "new-order", label: "New Order", icon: FilePlus2 },
  { key: "customers", label: "Customers", icon: Users },
  { key: "products", label: "Products / Designs", icon: Blocks },
  { key: "templates", label: "PDF Templates", icon: FileStack },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function Sidebar({ active, onNavigate, open, onClose }) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-64 shrink-0 flex-col border-r border-ink-200 bg-navy-950 text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500 text-navy-950">
            <Hammer className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-bold tracking-wide">ZINAX</p>
            <p className="text-2xs font-medium uppercase tracking-wider text-white/50">Order Builder</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-white/10 text-white shadow-inner"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4.5 w-4.5" strokeWidth={2} />
                <span className="truncate">{item.label}</span>
                {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gold-400" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-2xs text-white/40">ZINAX Order Builder v0.9</p>
          <p className="text-2xs text-white/30">UI Prototype — mock data only</p>
        </div>
      </aside>
    </>
  );
}
