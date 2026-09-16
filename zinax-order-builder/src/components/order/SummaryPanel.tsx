import { useRef } from "react";
import {
  Save,
  FolderOpen,
  FileSpreadsheet,
  FileText,
  Receipt,
  Printer,
  Info,
} from "lucide-react";
import { formatCurrency, formatNumber, type OrderTotals } from "../../core/calculations";

function Row({ label, value, strong }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-ink-500">{label}</span>
      <span className={`text-sm tabular-nums ${strong ? "font-bold text-ink-900" : "font-medium text-ink-700"}`}>
        {value}
      </span>
    </div>
  );
}

interface SummaryPanelProps {
  totals: OrderTotals;
  currency: string;
  invoiceMode: boolean;
  onToggleInvoice: (mode: boolean) => void;
  onSaveJson: () => void;
  onOpenJsonFile: (file: File) => void;
  onExportCsv: () => void;
  onExportOrderPdf: () => void;
  onExportInvoicePdf: () => void;
  onPrintPreview: () => void;
  invoicePdfDisabled: boolean;
}

export default function SummaryPanel({
  totals,
  currency,
  invoiceMode,
  onToggleInvoice,
  onSaveJson,
  onOpenJsonFile,
  onExportCsv,
  onExportOrderPdf,
  onExportInvoicePdf,
  onPrintPreview,
  invoicePdfDisabled,
}: SummaryPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="zx-card p-5">
        <h3 className="text-sm font-bold text-ink-900">Order Summary</h3>
        <div className="mt-2 divide-y divide-ink-100">
          <Row label="Total Rows" value={totals.totalRows} />
          <Row label="Total Doors" value={totals.totalDoors} />
          <Row label="Total Area" value={`${formatNumber(totals.totalArea)} m²`} />
          <Row label="Est. PVC Consumption" value={`${formatNumber(totals.pvcConsumption)} m²`} />
          <Row label="Currency" value={currency} />
          {invoiceMode && <Row label="Grand Total" value={formatCurrency(totals.grandTotal, currency)} strong />}
        </div>
      </div>

      <div className="zx-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink-900">Proforma Invoice</h3>
            <p className="mt-0.5 text-xs text-ink-500">Enable pricing &amp; VAT columns</p>
          </div>
          <button
            role="switch"
            aria-checked={invoiceMode}
            onClick={() => onToggleInvoice(!invoiceMode)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              invoiceMode ? "bg-navy-800" : "bg-ink-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                invoiceMode ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={invoiceMode}
            onChange={(e) => onToggleInvoice(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-navy-800 focus:ring-navy-500"
          />
          Generate Proforma Invoice
        </label>
      </div>

      <div className="zx-card p-5">
        <h3 className="mb-3 text-sm font-bold text-ink-900">Export Actions</h3>
        <div className="flex flex-col gap-2">
          <button onClick={onSaveJson} className="zx-btn-secondary w-full justify-start">
            <Save className="h-4 w-4" />
            Save Order (.json)
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="zx-btn-secondary w-full justify-start">
            <FolderOpen className="h-4 w-4" />
            Open Order (.json)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onOpenJsonFile(file);
              e.target.value = "";
            }}
          />
          <button onClick={onExportCsv} className="zx-btn-secondary w-full justify-start">
            <FileSpreadsheet className="h-4 w-4" />
            Export Production CSV
          </button>
          <button onClick={onExportOrderPdf} className="zx-btn-primary w-full justify-start">
            <FileText className="h-4 w-4" />
            Export Order PDF
          </button>
          {invoiceMode && (
            <button
              onClick={onExportInvoicePdf}
              disabled={invoicePdfDisabled}
              className="zx-btn-gold w-full justify-start"
            >
              <Receipt className="h-4 w-4" />
              Export Proforma Invoice PDF
            </button>
          )}
          <button onClick={onPrintPreview} className="zx-btn-ghost w-full justify-start">
            <Printer className="h-4 w-4" />
            Print Preview
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-navy-50 p-3 text-xs text-navy-800 ring-1 ring-navy-100">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>CSV is for FIROO CAM import. PDF is for customer and production approval.</p>
        </div>
      </div>
    </div>
  );
}
