import { useState, type ChangeEvent, type ReactNode } from "react";
import { Calendar, Hash, UserCheck } from "lucide-react";
import { CURRENCIES, SALESPERSONS } from "../../core/mockData";
import type { OrderHeader } from "../../core/orderSchema";
import type { Customer } from "../../core/customerSchema";
import CollapsibleSection from "../ui/CollapsibleSection";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="zx-label">{label}</label>
      {children}
    </div>
  );
}

interface OrderHeaderFormProps {
  header: OrderHeader;
  onChange: (header: OrderHeader) => void;
  customers: Customer[];
  onSelectCustomer: (customer: Customer) => void;
  /** Controlled so the collapsed/expanded state survives navigating away and back (lifted up to App.tsx). */
  open: boolean;
  onToggleOpen: (open: boolean) => void;
}

type FieldChangeEvent = ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

export default function OrderHeaderForm({ header, onChange, customers, onSelectCustomer, open, onToggleOpen }: OrderHeaderFormProps) {
  const set = (key: keyof OrderHeader) => (e: FieldChangeEvent) =>
    onChange({ ...header, [key]: e.target.value });

  const summary = header.customerName
    ? `${header.customerName}${header.companyName ? ` — ${header.companyName}` : ""}`
    : "No customer yet — click to expand and fill in the order header";

  return (
    <CollapsibleSection
      title="Order Header"
      subtitle={summary}
      open={open}
      onToggle={onToggleOpen}
      headerExtra={<span className="zx-badge bg-ink-100 text-ink-600">Draft</span>}
    >
      {customers.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-navy-100 bg-navy-50 px-3 py-2">
          <UserCheck className="h-4 w-4 shrink-0 text-navy-700" />
          <select
            defaultValue=""
            onChange={(e) => {
              const customer = customers.find((c) => c.customerId === e.target.value);
              if (customer) onSelectCustomer(customer);
              e.target.value = "";
            }}
            className="w-full bg-transparent text-sm text-navy-800 outline-none"
          >
            <option value="" disabled>
              Select existing customer to populate fields...
            </option>
            {customers.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {c.customerName} {c.companyName ? `— ${c.companyName}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

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
          <CustomerNameAutocomplete
            value={header.customerName}
            customers={customers}
            onChange={set("customerName")}
            onSelectCustomer={onSelectCustomer}
          />
        </Field>

        <Field label="Company Name">
          <input value={header.companyName} onChange={set("companyName")} className="zx-input" placeholder="e.g. Al Farsi Interiors LLC" />
        </Field>

        <Field label="Phone">
          <input value={header.phone} onChange={set("phone")} className="zx-input" placeholder="+971 5X XXX XXXX" />
        </Field>

        <Field label="WhatsApp">
          <input value={header.whatsapp} onChange={set("whatsapp")} className="zx-input" placeholder="+971 5X XXX XXXX" />
        </Field>

        <Field label="Email">
          <input value={header.email} onChange={set("email")} className="zx-input" placeholder="customer@example.com" />
        </Field>

        <Field label="Tax / TRN Number">
          <input value={header.taxNumber} onChange={set("taxNumber")} className="zx-input" />
        </Field>

        <Field label="Address">
          <input value={header.address} onChange={set("address")} className="zx-input xl:col-span-2" />
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
    </CollapsibleSection>
  );
}

interface CustomerNameAutocompleteProps {
  value: string;
  customers: Customer[];
  onChange: (e: FieldChangeEvent) => void;
  onSelectCustomer: (customer: Customer) => void;
}

/**
 * Typing into Customer Name used to be completely disconnected from the
 * saved customer list — the only way to reuse a customer's details was the
 * separate dropdown above. This suggests matching customers as you type,
 * so picking one still auto-fills phone/email/address/etc. the same way
 * that dropdown does.
 */
function CustomerNameAutocomplete({ value, customers, onChange, onSelectCustomer }: CustomerNameAutocompleteProps) {
  const [open, setOpen] = useState(false);

  const query = value.trim().toLowerCase();
  const matches = query
    ? customers.filter((c) => c.customerName.toLowerCase().includes(query)).slice(0, 6)
    : [];

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="zx-input"
        placeholder="e.g. Khalid Al Farsi"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-panel">
          {matches.map((c) => (
            <li key={c.customerId}>
              <button
                type="button"
                // Runs before the input's onBlur closes the list, so the click still registers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelectCustomer(c);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-navy-50"
              >
                <span className="text-sm font-medium text-ink-800">{c.customerName || c.customerId}</span>
                {c.companyName && <span className="text-xs text-ink-500">{c.companyName}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
