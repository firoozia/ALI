import { useRef, useState } from "react";
import { Plus, Trash2, Search, Download, Upload, Users } from "lucide-react";
import {
  type Customer,
  makeDefaultCustomer,
  searchCustomers,
  buildCustomersFile,
  serializeCustomersFile,
  customersFileName,
  parseCustomersFile,
  mergeCustomers,
  replaceCustomers,
} from "../core/customerSchema";
import { downloadJsonFile, readFileAsText } from "../lib/download";
import Toast, { type ToastTone } from "../components/ui/Toast";

interface CustomersProps {
  customers: Customer[];
  onChangeCustomers: (customers: Customer[]) => void;
}

export default function Customers({ customers, onChangeCustomers }: CustomersProps) {
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  const [pendingImport, setPendingImport] = useState<Customer[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const visible = searchCustomers(customers, query);

  const updateCustomer = (customerId: string, patch: Partial<Customer>) => {
    onChangeCustomers(customers.map((c) => (c.customerId === customerId ? { ...c, ...patch } : c)));
  };

  const addCustomer = () => onChangeCustomers([makeDefaultCustomer(), ...customers]);

  const deleteCustomer = (customerId: string) => {
    onChangeCustomers(customers.filter((c) => c.customerId !== customerId));
  };

  const handleExport = async () => {
    const saved = await downloadJsonFile(customersFileName(), serializeCustomersFile(buildCustomersFile(customers)));
    if (saved) flash("Customers exported.");
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const result = parseCustomersFile(text);
      if (!result.ok) {
        flash(`Cannot import customers: ${result.error}`, "error");
        return;
      }
      setPendingImport(result.customers);
    } catch (err) {
      flash(`Cannot import customers: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  const applyImport = (mode: "merge" | "replace") => {
    if (!pendingImport) return;
    const next = mode === "merge" ? mergeCustomers(customers, pendingImport) : replaceCustomers(customers, pendingImport);
    onChangeCustomers(next);
    setPendingImport(null);
    flash(mode === "merge" ? "Customers merged." : "Customers replaced.");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">Customers</h2>
          <p className="mt-0.5 text-sm text-ink-500">{customers.length} customers saved in this browser.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="zx-btn-secondary">
            <Download className="h-4 w-4" />
            Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="zx-btn-secondary">
            <Upload className="h-4 w-4" />
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
          <button onClick={addCustomer} className="zx-btn-primary">
            <Plus className="h-4 w-4" />
            Add Customer
          </button>
        </div>
      </div>

      {pendingImport && (
        <div className="zx-card mb-5 border-gold-300 p-4 ring-1 ring-gold-300">
          <p className="text-sm font-semibold text-ink-800">Import ready — {pendingImport.length} customers found in this file.</p>
          <p className="mt-1 text-xs text-ink-500">
            Merge adds/updates customers by ID and keeps everyone else. Replace discards the current list entirely.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => applyImport("merge")} className="zx-btn-primary !py-1.5">
              Merge
            </button>
            <button onClick={() => applyImport("replace")} className="zx-btn-secondary !py-1.5">
              Replace
            </button>
            <button onClick={() => setPendingImport(null)} className="zx-btn-ghost !py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, company, phone, or email..."
          className="w-full bg-transparent text-sm text-ink-700 placeholder:text-ink-400 outline-none"
        />
      </div>

      {visible.length === 0 ? (
        <div className="zx-card flex flex-col items-center px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-800/10 text-navy-800">
            <Users className="h-7 w-7" strokeWidth={1.8} />
          </div>
          <p className="mt-4 text-sm text-ink-500">
            {customers.length === 0 ? "No customers yet — add your first one." : "No customers match your search."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((customer) => (
            <div key={customer.customerId} className="zx-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-2xs font-semibold uppercase tracking-wide text-ink-400">{customer.customerId}</span>
                <button onClick={() => deleteCustomer(customer.customerId)} className="zx-btn-danger !px-2 !py-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Customer Name" value={customer.customerName} onChange={(v) => updateCustomer(customer.customerId, { customerName: v })} />
                <Field label="Company Name" value={customer.companyName} onChange={(v) => updateCustomer(customer.customerId, { companyName: v })} />
                <Field label="Phone" value={customer.phone} onChange={(v) => updateCustomer(customer.customerId, { phone: v })} />
                <Field label="WhatsApp" value={customer.whatsapp} onChange={(v) => updateCustomer(customer.customerId, { whatsapp: v })} />
                <Field label="Email" value={customer.email} onChange={(v) => updateCustomer(customer.customerId, { email: v })} />
                <Field label="Tax Number" value={customer.taxNumber} onChange={(v) => updateCustomer(customer.customerId, { taxNumber: v })} />
                <Field label="Address" value={customer.address} onChange={(v) => updateCustomer(customer.customerId, { address: v })} className="sm:col-span-2" />
                <Field label="Notes" value={customer.notes} onChange={(v) => updateCustomer(customer.customerId, { notes: v })} className="sm:col-span-2 xl:col-span-4" />
              </div>
            </div>
          ))}
        </div>
      )}

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="zx-label">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="zx-input" />
    </div>
  );
}
