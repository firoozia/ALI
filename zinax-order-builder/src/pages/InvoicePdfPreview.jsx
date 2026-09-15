import { useState } from "react";
import { Hammer } from "lucide-react";
import PdfActionsBar from "../components/pdf/PdfActionsBar";
import Toast from "../components/ui/Toast";
import { lineDiscountAmount, lineVatAmount, lineTotal, formatCurrency } from "../lib/calc";

export default function InvoicePdfPreview({ order, onBack }) {
  const [toast, setToast] = useState("");
  if (!order) return null;
  const { header, rows, invoice, totals } = order;
  const currency = invoice.currency || header.currency;
  const balanceDue = totals.grandTotal - (Number(invoice.paidAmount) || 0);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  return (
    <div className="min-h-full bg-ink-100">
      <PdfActionsBar
        title="Proforma Invoice"
        subtitle={`${invoice.invoiceNo} — Preview`}
        onBack={onBack}
        onDownload={() => flash("Invoice PDF download simulated (mock).")}
        onPrint={() => flash("Print dialog simulated (mock).")}
        accent="gold"
      />

      <div className="flex justify-center px-3 py-5 sm:px-6 sm:py-10">
        <div className="w-full max-w-[1000px] rounded-sm bg-white p-5 shadow-panel sm:p-8 lg:p-12 print:shadow-none">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-gold-500 pb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-navy-950 text-gold-400">
                <Hammer className="h-7 w-7" strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-lg font-extrabold tracking-wide text-navy-950">ZINAX / ARYAK</p>
                <p className="text-xs font-medium uppercase tracking-widest text-ink-400">
                  Cabinet &amp; Membrane Door Production
                </p>
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-2xl font-extrabold text-ink-900">Proforma Invoice</h1>
              <p className="mt-1 text-sm text-ink-500">Invoice No. <span className="font-semibold text-ink-800">{invoice.invoiceNo}</span></p>
              <p className="text-sm text-ink-500">Order No. <span className="font-semibold text-ink-800">{header.orderNo}</span></p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <InfoField label="Invoice Date" value={invoice.invoiceDate} />
            <InfoField label="Due Date" value={invoice.dueDate} />
            <InfoField label="Payment Terms" value={invoice.paymentTerms} />
            <InfoField label="Currency" value={currency} />
          </div>

          {/* Customer section */}
          <div className="mt-6 rounded-xl border border-ink-200 bg-ink-50/50 p-4">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-400">Bill To</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <InfoField label="Customer Name" value={header.customerName} />
              <InfoField label="Company" value={header.companyName} />
              <InfoField label="Phone" value={header.phone} />
              <InfoField label="Project" value={header.projectName} />
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
                {rows.map((row, idx) => (
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
                      {formatCurrency(lineDiscountAmount(row), currency)}
                    </td>
                    <td className="border-b border-ink-100 px-3 py-2 text-right tabular-nums">
                      {formatCurrency(lineVatAmount(row), currency)}
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
              <TotalRow label="Subtotal" value={formatCurrency(totals.subtotal, currency)} />
              <TotalRow label="Discount" value={`- ${formatCurrency(totals.totalDiscount, currency)}`} />
              <TotalRow label="VAT" value={formatCurrency(totals.vatAmount, currency)} />
              <div className="my-1.5 h-px bg-ink-200" />
              <TotalRow label="Grand Total" value={formatCurrency(totals.grandTotal, currency)} strong />
              <TotalRow label="Paid Amount" value={formatCurrency(invoice.paidAmount, currency)} />
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
            <InfoField label="Bank Details" value={invoice.bankDetails} />
            <InfoField label="Notes" value={invoice.notes} />
          </div>

          <div className="mt-10 grid grid-cols-3 gap-8 text-sm">
            <SignatureBox label="Authorized Signature" />
            <SignatureBox label="Customer Signature" />
            <SignatureBox label="Company Stamp" />
          </div>
        </div>
      </div>

      <Toast message={toast} />
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink-700">{value || " "}</p>
    </div>
  );
}

function TotalRow({ label, value, strong, tone }) {
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

function SignatureBox({ label }) {
  return (
    <div className="pt-10">
      <div className="h-px w-full bg-ink-300" />
      <p className="mt-2 text-xs font-medium text-ink-500">{label}</p>
    </div>
  );
}
