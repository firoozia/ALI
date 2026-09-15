import { Download, Printer, ArrowLeft } from "lucide-react";

export default function PdfActionsBar({ title, subtitle, onBack, onDownload, onPrint, accent }) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-6 py-4 backdrop-blur">
      <div>
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="zx-btn-secondary">
          <ArrowLeft className="h-4 w-4" />
          Back to Edit
        </button>
        <button onClick={onPrint} className="zx-btn-secondary">
          <Printer className="h-4 w-4" />
          Print
        </button>
        <button onClick={onDownload} className={accent === "gold" ? "zx-btn-gold" : "zx-btn-primary"}>
          <Download className="h-4 w-4" />
          Download PDF
        </button>
      </div>
    </div>
  );
}
