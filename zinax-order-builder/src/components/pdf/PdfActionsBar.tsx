import { Download, Printer, ArrowLeft, Loader2 } from "lucide-react";

interface PdfActionsBarProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  onDownload: () => void;
  onPrint: () => void;
  accent?: "gold" | "navy";
  exporting?: boolean;
}

export default function PdfActionsBar({
  title,
  subtitle,
  onBack,
  onDownload,
  onPrint,
  accent,
  exporting = false,
}: PdfActionsBarProps) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold text-ink-900 sm:text-base">{title}</h2>
        {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button onClick={onBack} className="zx-btn-secondary !px-2.5 sm:!px-3.5">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to Edit</span>
        </button>
        <button onClick={onPrint} className="zx-btn-secondary !px-2.5 sm:!px-3.5">
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline">Print</span>
        </button>
        <button
          onClick={onDownload}
          disabled={exporting}
          className={`!px-2.5 sm:!px-3.5 ${accent === "gold" ? "zx-btn-gold" : "zx-btn-primary"}`}
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">{exporting ? "Generating…" : "Download PDF"}</span>
        </button>
      </div>
    </div>
  );
}
