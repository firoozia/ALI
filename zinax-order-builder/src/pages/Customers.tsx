import { useRef, useState } from "react";
import { Plus, Trash2, Search, Download, Upload, Users, ChevronRight, ArrowLeft, Save } from "lucide-react";
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

  // The customer currently open for editing, as a local, uncommitted copy.
  // Nothing here reaches the saved list — or shows up anywhere else in the
  // app — until Save is clicked. A brand-new customer (from "Add
  // Customer") lives only in `draft` too, so it doesn't appear in the list
  // below until it's actually saved.
  const [draft, setDraft] = useState<Customer | null>(null);

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const visible = searchCustomers(customers, query);
  const isNewDraft = draft !== null && !customers.some((c) => c.customerId === draft.customerId);

  const openCustomer = (customer: Customer) => setDraft({ ...customer });
  const openNewCustomer = () => setDraft(makeDefaultCustomer());
  const closeEditor = () => setDraft(null);

  const saveDraft = () => {
    if (!draft) return;
    const exists = customers.some((c) => c.customerId === draft.customerId);
    onChangeCustomers(
      exists ? customers.map((c) => (c.customerId === draft.customerId ? draft : c)) : [draft, ...customers]
    );
    flash(`${draft.customerName || draft.customerId} saved.`);
    setDraft(null);
  };

  const deleteCustomer = (customerId: string) => {
    onChangeCustomers(customers.filter((c) => c.customerId !== customerId));
    if (draft?.customerId === customerId) setDraft(null);
    flash("Customer deleted.");
  };

  const handleExport = async () => {
    const saved = await downloadJsonFile(customersFileName(), serializeCustomersFile(buildCustomersFile(customers)));
    flash(saved ? "Customers exported." : "Export cancelled — no file was saved.", saved ? "success" : "neutral");
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

  if (draft) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
        <button onClick={closeEditor} className="zx-btn-ghost mb-4 !px-2.5">
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </button>

        <div className="zx-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-ink-900">
                {isNewDraft ? "New Customer" : draft.customerName || draft.customerId}
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">{draft.customerId}</p>
            </div>
            {!isNewDraft && (
              <button onClick={() => deleteCustomer(draft.customerId)} className="zx-btn-danger !px-2.5 !py-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Customer Name" value={draft.customerName} onChange={(v) => setDraft({ ...draft, customerName: v })} />
            <Field label="Company Name" value={draft.companyName} onChange={(v) => setDraft({ ...draft, companyName: v })} />
            <Field label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} />
            <Field label="WhatsApp" value={draft.whatsapp} onChange={(v) => setDraft({ ...draft, whatsapp: v })} />
            <Field label="Email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
            <Field label="Tax Number" value={draft.taxNumber} onChange={(v) => setDraft({ ...draft, taxNumber: v })} />
            <Field label="Address" value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} className="sm:col-span-2" />
            <Field label="Notes" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} className="sm:col-span-2 xl:col-span-4" />
          </div>

          <div className="mt-5 flex gap-2 border-t border-ink-100 pt-4">
            <button onClick={saveDraft} className="zx-btn-primary">
              <Save className="h-4 w-4" />
              Save
            </button>
            <button onClick={closeEditor} className="zx-btn-secondary">
              Cancel
            </button>
          </div>
        </div>

        <Toast message={toast} tone={toastTone} />
      </div>
    );
  }

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
          <button onClick={openNewCustomer} className="zx-btn-primary">
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
        <div className="zx-card divide-y divide-ink-100 overflow-hidden">
          {visible.map((customer) => (
            <div key={customer.customerId} className="flex items-center gap-2">
              <button
                onClick={() => openCustomer(customer)}
                className="flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {customer.customerName || customer.customerId}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {[customer.companyName, customer.phone].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
              </button>
              <button
                onClick={() => deleteCustomer(customer.customerId)}
                title="Delete customer"
                className="zx-btn-danger !mr-3 !px-2 !py-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
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
