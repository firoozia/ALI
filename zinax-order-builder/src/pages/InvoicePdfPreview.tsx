import { useState } from "react";
import { Hammer } from "lucide-react";
import PdfActionsBar from "../components/pdf/PdfActionsBar";
import Toast, { type ToastTone } from "../components/ui/Toast";
import { discountAmount, vatAmount, lineTotal, formatCurrency } from "../core/calculations";
import { buildInvoicePdfModel, type InvoicePreviewData } from "../core/pdfSchema";
import { exportInvoicePdf } from "../lib/pdf/exportInvoicePdf";

interface InvoicePdfPreviewProps {
  order: InvoicePreviewData | null;
  onBack: () => void;
}

export default function InvoicePdfPreview({ order, onBack }: InvoicePdfPreviewProps) {
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  const [exporting, setExporting] = useState(false);

  if (!order) return null;
  const { header, rows, invoice, totals, companyProfile, pdfTemplate } = order;
  const model = buildInvoicePdfModel(header, rows, invoice, totals, companyProfile, pdfTemplate);
  const currency = model.currency;
  const balanceDue = model.balanceDue;
  const t = model.template;

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const handleDownload = async () => {
    setExporting(true);
    try {
      const result = await exportInvoicePdf(order);
      if (result.saved) {
        flash(`Proforma Invoice PDF downloaded (${result.fileName}).`);
      } else {
        flash("Save cancelled — no file was saved.", "neutral");
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
        title={t.invoicePdfTitle}
        subtitle={`${model.invoiceNo} — Preview`}
        onBack={onBack}
        onDownload={handleDownload}
        onPrint={() => window.print()}
        accent="gold"
        exporting={exporting}
      />

      <div className="flex justify-center px-3 py-5 sm:px-6 sm:py-10">
        <div className="w-full max-w-[1000px] rounded-sm bg-white p-5 shadow-panel sm:p-8 lg:p-12 print:shadow-none">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-gold-500 pb-6">
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
                {t.showTaxNumber && model.vendorTaxNumber && (
                  <p className="text-2xs text-ink-400">TRN: {model.vendorTaxNumber}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-2xl font-extrabold text-ink-900">{t.invoicePdfTitle}</h1>
              <p className="mt-1 text-sm text-ink-500">Invoice No. <span className="font-semibold text-ink-800">{model.invoiceNo}</span></p>
              <p className="text-sm text-ink-500">Order No. <span className="font-semibold text-ink-800">{model.orderNo}</span></p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <InfoField label="Invoice Date" value={model.invoiceDate} />
            <InfoField label="Due Date" value={model.dueDate} />
            <InfoField label="Payment Terms" value={model.paymentTerms} />
            <InfoField label="Currency" value={currency} />
          </div>

          {/* Customer section */}
          <div className="mt-6 rounded-xl border border-ink-200 bg-ink-50/50 p-4">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-400">Bill To</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <InfoField label="Customer Name" value={model.customerName} />
              <InfoField label="Company" value={model.companyName} />
              <InfoField label="Phone" value={model.phone} />
              <InfoField label="Project" value={model.project} />
            </div>
          </div>

          {/* Invoice table */}
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead>
                <tr className="bg-navy-950 text-white">
                  {["No.", "Description", "Design Code", "Size", "Qty", "Unit Price", "Discount", "VAT", "Line Total"].map((h) => (
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
                    <td className="border-b border-ink-100 px-3 py-2">{row.designName || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 font-semibold text-navy-800">{row.designCode || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">
                      {row.width || "—"} × {row.height || "—"}
                    </td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.qty || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 text-right tabular-nums">
                      {formatCurrency(row.unitPrice, currency)}
                    </td>
                    <td className="border-b border-ink-100 px-3 py-2 text-right tabular-nums">
                      {formatCurrency(discountAmount(row), currency)}
                    </td>
                    <td className="border-b border-ink-100 px-3 py-2 text-right tabular-nums">
                      {formatCurrency(vatAmount(row), currency)}
                    </td>
                    <td className="border-b border-ink-100 px-3 py-2 text-right font-semibold tabular-nums">
                      {formatCurrency(lineTotal(row), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 rounded-xl border border-ink-200 p-4">
              <TotalRow label="Subtotal" value={formatCurrency(model.totals.subtotal, currency)} />
              <TotalRow label="Discount" value={`- ${formatCurrency(model.totals.totalDiscount, currency)}`} />
              <TotalRow label="VAT" value={formatCurrency(model.totals.vatAmount, currency)} />
              <div className="my-1.5 h-px bg-ink-200" />
              <TotalRow label="Grand Total" value={formatCurrency(model.totals.grandTotal, currency)} strong />
              <TotalRow label="Paid Amount" value={formatCurrency(model.paidAmount, currency)} />
              <TotalRow
                label="Balance Due"
                value={formatCurrency(balanceDue, currency)}
                strong
                tone={balanceDue > 0 ? "amber" : "emerald"}
              />
            </div>
          </div>

          {/* Payment section */}
          <div className="mt-8 grid grid-cols-1 gap-6 border-t border-ink-200 pt-6 sm:grid-cols-2">
            {t.showBankDetails && <InfoField label="Bank Details" value={model.bankDetails} />}
            <InfoField label="Notes" value={model.notes || t.footerNotes} />
          </div>

          {t.showSignatures && (
            <div className="mt-10 grid grid-cols-3 gap-8 text-sm">
              <SignatureBox label="Authorized Signature" />
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

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink-700">{value || " "}</p>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "amber" | "emerald";
}) {
  const toneCls = tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-700" : "text-ink-900";
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${strong ? "font-bold text-ink-900" : "text-ink-500"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${strong ? `font-bold ${toneCls}` : "font-medium text-ink-700"}`}>
        {value}
      </span>
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
