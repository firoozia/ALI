import { Receipt } from "lucide-react";
import { CURRENCIES } from "../../data/mockData";
import { formatCurrency } from "../../lib/calc";

function Field({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="zx-label">{label}</label>
      {children}
    </div>
  );
}

export default function InvoicePanel({ invoice, onChange, totals, currency }) {
  const set = (key) => (e) => onChange({ ...invoice, [key]: e.target.value });

  const balanceDue = totals.grandTotal - (Number(invoice.paidAmount) || 0);

  return (
    <div className="zx-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-500/15 text-gold-600">
          <Receipt className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-bold text-ink-900">Proforma Invoice Details</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Invoice No.">
          <input value={invoice.invoiceNo} readOnly className="zx-input" />
        </Field>
        <Field label="Invoice Date">
          <input type="date" value={invoice.invoiceDate} onChange={set("invoiceDate")} className="zx-input" />
        </Field>
        <Field label="Due Date">
          <input type="date" value={invoice.dueDate} onChange={set("dueDate")} className="zx-input" />
        </Field>
        <Field label="Currency">
          <select value={invoice.currency} onChange={set("currency")} className="zx-select">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Payment Terms" className="sm:col-span-2">
          <input value={invoice.paymentTerms} onChange={set("paymentTerms")} className="zx-input" />
        </Field>
        <Field label="VAT % (default)">
          <input type="number" value={invoice.vat} onChange={set("vat")} className="zx-input" />
        </Field>
        <Field label="Paid Amount">
          <input type="number" value={invoice.paidAmount} onChange={set("paidAmount")} className="zx-input" />
        </Field>

        <Field label="Bank Details" className="sm:col-span-2 xl:col-span-4">
          <input value={invoice.bankDetails} onChange={set("bankDetails")} className="zx-input" />
        </Field>

        <Field label="Invoice Notes" className="sm:col-span-2 xl:col-span-4">
          <textarea
            value={invoice.notes}
            onChange={set("notes")}
            rows={2}
            className="zx-input resize-none"
          />
        </Field>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-ink-100 bg-ink-50/60 p-4 sm:grid-cols-4 xl:grid-cols-7">
        <SummaryStat label="Subtotal" value={formatCurrency(totals.subtotal, currency)} />
        <SummaryStat label="Total Discount" value={formatCurrency(totals.totalDiscount, currency)} />
        <SummaryStat label="Taxable Amount" value={formatCurrency(totals.taxable, currency)} />
        <SummaryStat label="VAT Amount" value={formatCurrency(totals.vatAmount, currency)} />
        <SummaryStat label="Grand Total" value={formatCurrency(totals.grandTotal, currency)} emphasize />
        <SummaryStat label="Paid Amount" value={formatCurrency(invoice.paidAmount, currency)} />
        <SummaryStat
          label="Balance Due"
          value={formatCurrency(balanceDue, currency)}
          emphasize
          tone={balanceDue > 0 ? "amber" : "emerald"}
        />
      </div>
    </div>
  );
}

function SummaryStat({ label, value, emphasize, tone }) {
  const toneCls =
    tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-700" : "text-ink-900";
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${emphasize ? toneCls : "text-ink-700"}`}>
        {value}
      </p>
    </div>
  );
}
