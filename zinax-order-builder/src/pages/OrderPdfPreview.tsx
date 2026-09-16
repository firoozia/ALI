import { useState } from "react";
import { Hammer } from "lucide-react";
import PdfActionsBar from "../components/pdf/PdfActionsBar";
import Toast, { type ToastTone } from "../components/ui/Toast";
import { buildOrderPdfModel, type OrderPreviewData } from "../core/pdfSchema";
import { lineTotal, formatCurrency } from "../core/calculations";
import { exportOrderPdf } from "../lib/pdf/exportOrderPdf";

interface OrderPdfPreviewProps {
  order: OrderPreviewData | null;
  onBack: () => void;
}

export default function OrderPdfPreview({ order, onBack }: OrderPdfPreviewProps) {
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  const [exporting, setExporting] = useState(false);

  if (!order) return null;
  const { header, rows, totals, companyProfile, pdfTemplate } = order;
  const model = buildOrderPdfModel(header, rows, totals, companyProfile, pdfTemplate);
  const showPrices = model.template.showPricesOnOrderPdf;

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const handleDownload = async () => {
    setExporting(true);
    try {
      const result = await exportOrderPdf(order);
      if (result.saved) {
        flash(`Order PDF downloaded (${result.fileName}).`);
      }
    } catch {
      flash("Could not generate the PDF. Please try again.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-full bg-ink-100">
      <PdfActionsBar
        title={model.template.orderPdfTitle}
        subtitle={`${model.orderNo} — Preview`}
        onBack={onBack}
        onDownload={handleDownload}
        onPrint={() => window.print()}
        exporting={exporting}
      />

      <div className="flex justify-center px-3 py-5 sm:px-6 sm:py-10">
        <div className="w-full max-w-[1180px] rounded-sm bg-white p-5 shadow-panel sm:p-8 lg:p-12 print:shadow-none">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-navy-900 pb-6">
            <div className="flex items-center gap-3">
              {model.vendorLogoUrl ? (
                <img src={model.vendorLogoUrl} alt="Logo" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-navy-950 text-gold-400">
                  <Hammer className="h-7 w-7" strokeWidth={2.2} />
                </div>
              )}
              <div>
                <p className="text-lg font-extrabold tracking-wide text-navy-950">{model.vendorBrandName}</p>
                <p className="text-xs font-medium uppercase tracking-widest text-ink-400">
                  Cabinet &amp; Membrane Door Production
                </p>
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-2xl font-extrabold text-ink-900">{model.template.orderPdfTitle}</h1>
              <p className="mt-1 text-sm text-ink-500">Order No. <span className="font-semibold text-ink-800">{model.orderNo}</span></p>
              <p className="text-sm text-ink-500">Date: <span className="font-semibold text-ink-800">{model.date}</span></p>
            </div>
          </div>

          {/* Info grid */}
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <InfoField label="Customer" value={model.customer} />
            <InfoField label="Project" value={model.project} />
            <InfoField label="Phone / WhatsApp" value={model.phone} />
            <InfoField label="Salesperson" value={model.salesperson} />
          </div>

          {/* Table */}
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-navy-950 text-white">
                  {[
                    "No.",
                    "Design Code",
                    "Design Name",
                    "Width",
                    "Height",
                    "Qty",
                    "MDF",
                    "PVC Code",
                    "PVC Color",
                    "Grain",
                    "Notes",
                    ...(showPrices ? ["Unit Price", "Line Total"] : []),
                  ].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((row, idx) => (
                  <tr key={row.id} className={idx % 2 === 0 ? "bg-white" : "bg-ink-50/60"}>
                    <td className="border-b border-ink-100 px-3 py-2 text-ink-500">{idx + 1}</td>
                    <td className="border-b border-ink-100 px-3 py-2 font-semibold text-navy-800">{row.designCode || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.designName || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.width || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.height || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.qty || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.mdfThickness}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.pvcCode || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.pvcColor || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.grain}</td>
                    <td className="border-b border-ink-100 px-3 py-2 whitespace-pre-wrap text-ink-500">{row.notes || "—"}</td>
                    {showPrices && (
                      <>
                        <td className="border-b border-ink-100 px-3 py-2 text-right tabular-nums">
                          {formatCurrency(row.unitPrice, header.currency)}
                        </td>
                        <td className="border-b border-ink-100 px-3 py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(lineTotal(row), header.currency)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {model.notes && (
            <div className="mt-6 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-400">General Notes</p>
              <p className="whitespace-pre-wrap">{model.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-10 grid grid-cols-2 gap-8 border-t border-ink-200 pt-6 sm:grid-cols-4">
            <InfoField label="Total Doors" value={model.totalDoors} strong />
            <InfoField
              label="Total Area"
              value={`${model.totalArea.toFixed(2)} m²`}
              strong
            />
            <InfoField label="Prepared By" value={model.preparedBy} />
            <InfoField label="" value="" />
          </div>

          {model.template.showSignatures && (
            <div className="mt-10 grid grid-cols-3 gap-8 text-sm">
              <SignatureBox label="Prepared By" />
              <SignatureBox label="Customer Signature" />
              <SignatureBox label="Company Stamp" imageUrl={model.vendorStampUrl} />
            </div>
          )}
        </div>
      </div>

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}

function InfoField({ label, value, strong }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div>
      {label && <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>}
      <p className={`mt-0.5 text-sm ${strong ? "font-bold text-ink-900" : "font-medium text-ink-700"}`}>
        {value || " "}
      </p>
    </div>
  );
}

function SignatureBox({ label, imageUrl }: { label: string; imageUrl?: string }) {
  return (
    <div className="pt-10">
      {imageUrl && <img src={imageUrl} alt="" className="mb-2 h-10 w-10 object-contain" />}
      <div className="h-px w-full bg-ink-300" />
      <p className="mt-2 text-xs font-medium text-ink-500">{label}</p>
    </div>
  );
}
