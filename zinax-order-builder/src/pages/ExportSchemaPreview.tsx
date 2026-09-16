import { Layers, FileSpreadsheet, FileText, Ban, CheckCircle2 } from "lucide-react";
import { PRODUCTION_CSV_COLUMNS } from "../core/csvSchema";
import {
  SHARED_CORE_STATEMENTS,
  PDF_OUTPUTS,
  DISABLED_CNC_FEATURES,
  ARCHITECTURE_NOTE,
} from "../core/exportContracts";

export default function ExportSchemaPreview() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-ink-900">Export Schema Preview</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          Every export button on this product is a thin UI layer over the shared schema below —
          nothing here is hard-coded per screen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Shared Core Status */}
        <div className="zx-card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800/10 text-navy-800">
              <Layers className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-ink-900">Shared Core Status</h3>
          </div>
          <ul className="space-y-2">
            {SHARED_CORE_STATEMENTS.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm text-ink-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {s}
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg bg-navy-50 p-3 text-xs font-medium text-navy-800 ring-1 ring-navy-100">
            {ARCHITECTURE_NOTE}
          </div>
        </div>

        {/* Production CSV Columns */}
        <div className="zx-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900">Production CSV Columns</h3>
              <p className="text-2xs text-ink-500">core/csvSchema.ts — for FIROO CAM import only</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRODUCTION_CSV_COLUMNS.map((col) => (
              <code
                key={col.key}
                className="rounded-md bg-ink-100 px-2 py-1 text-2xs font-semibold text-ink-700"
              >
                {col.header}
              </code>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-500">
            No pricing, VAT, payment, or CNC fields are ever included in this file.
          </p>
        </div>

        {/* PDF Outputs */}
        <div className="zx-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-500/15 text-gold-600">
              <FileText className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-ink-900">PDF Outputs</h3>
          </div>
          <div className="space-y-3">
            {PDF_OUTPUTS.map((pdf) => (
              <div key={pdf.id} className="rounded-lg border border-ink-100 p-3">
                <p className="text-sm font-semibold text-ink-800">
                  {pdf.id === "order-pdf" ? "Order PDF" : "Proforma Invoice PDF"}
                </p>
                <p className="mt-0.5 text-2xs text-ink-500">{pdf.consumer}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pdf.sections.map((s) => (
                    <span key={s} className="rounded-full bg-ink-100 px-2 py-0.5 text-2xs text-ink-600">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Disabled CNC Features */}
        <div className="zx-card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
              <Ban className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900">Disabled CNC Features</h3>
              <p className="text-2xs text-ink-500">
                ZINAX Order Builder is not a CNC/CAM application — these stay out of scope by design.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DISABLED_CNC_FEATURES.map((f) => (
              <span
                key={f}
                className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 ring-1 ring-red-100"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
