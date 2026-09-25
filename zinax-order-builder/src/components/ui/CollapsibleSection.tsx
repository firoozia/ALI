import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Controlled open state — when passed (with onToggle), the section no longer tracks its own open/closed state, so a caller can persist it across remounts. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Rendered to the right of the header, outside the toggle button (e.g. a switch) so it never triggers collapse. */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/**
 * A card whose body can be folded away, leaving just its header row. Used
 * to let the New Order sidebar (Order Summary / Proforma Invoice / Export
 * Actions) shrink out of the way so the Door Order Table can use the
 * freed-up width — the same "dockable, collapsible panel" idea used by
 * CAD/CAM tool panels, borrowed only for this open/close mechanic, not for
 * anything CNC-related.
 */
export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = true,
  open: controlledOpen,
  onToggle,
  headerExtra,
  children,
}: CollapsibleSectionProps) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const toggle = () => (onToggle ? onToggle(!open) : setLocalOpen((o) => !o));

  return (
    <div className="zx-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
          )}
          <div>
            <h3 className="text-sm font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
        </button>
        {headerExtra}
      </div>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
