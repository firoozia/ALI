import { Calendar, Hash } from "lucide-react";
import { CURRENCIES, SALESPERSONS } from "../../data/mockData";

function Field({ label, children }) {
  return (
    <div>
      <label className="zx-label">{label}</label>
      {children}
    </div>
  );
}

export default function OrderHeaderForm({ header, onChange }) {
  const set = (key) => (e) => onChange({ ...header, [key]: e.target.value });

  return (
    <div className="zx-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">Order Header</h3>
        <span className="zx-badge bg-ink-100 text-ink-600">Draft</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Order No.">
          <div className="relative">
            <Hash className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              value={header.orderNo}
              onChange={set("orderNo")}
              className="zx-input pl-8"
              readOnly
            />
          </div>
        </Field>

        <Field label="Order Date">
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="date"
              value={header.orderDate}
              onChange={set("orderDate")}
              className="zx-input pl-8"
            />
          </div>
        </Field>

        <Field label="Delivery Date">
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="date"
              value={header.deliveryDate}
              onChange={set("deliveryDate")}
              className="zx-input pl-8"
            />
          </div>
        </Field>

        <Field label="Currency">
          <select value={header.currency} onChange={set("currency")} className="zx-select">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Customer Name">
          <input value={header.customerName} onChange={set("customerName")} className="zx-input" placeholder="e.g. Khalid Al Farsi" />
        </Field>

        <Field label="Company Name">
          <input value={header.companyName} onChange={set("companyName")} className="zx-input" placeholder="e.g. Al Farsi Interiors LLC" />
        </Field>

        <Field label="Phone / WhatsApp">
          <input value={header.phone} onChange={set("phone")} className="zx-input" placeholder="+971 5X XXX XXXX" />
        </Field>

        <Field label="Salesperson">
          <select value={header.salesperson} onChange={set("salesperson")} className="zx-select">
            {SALESPERSONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project Name">
          <input
            value={header.projectName}
            onChange={set("projectName")}
            className="zx-input xl:col-span-2"
            placeholder="e.g. Marina Residence Kitchen"
          />
        </Field>

        <div className="sm:col-span-2 xl:col-span-4">
          <label className="zx-label">General Notes</label>
          <textarea
            value={header.notes}
            onChange={set("notes")}
            rows={2}
            className="zx-input resize-none"
            placeholder="Any general remarks for this order..."
          />
        </div>
      </div>
    </div>
  );
}
