import { useState } from "react";
import { Save, FileSpreadsheet, FileText, Receipt, Printer } from "lucide-react";
import OrderHeaderForm from "../components/order/OrderHeaderForm";
import DoorOrderTable from "../components/order/DoorOrderTable";
import InvoicePanel from "../components/order/InvoicePanel";
import SummaryPanel from "../components/order/SummaryPanel";
import Toast from "../components/ui/Toast";
import { makeInitialHeader, makeInitialInvoice, makeInitialRows } from "../core/mockData";
import { computeOrderTotals } from "../core/calculations";
import { PRODUCTION_CSV_COLUMNS } from "../core/csvSchema";

export default function NewOrderBuilder({ onPreviewOrder, onPreviewInvoice }) {
  const [header, setHeader] = useState(makeInitialHeader);
  const [invoice, setInvoice] = useState(makeInitialInvoice);
  const [rows, setRows] = useState(makeInitialRows);
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [toast, setToast] = useState("");

  const totals = computeOrderTotals(rows);

  const flashToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  };

  const handleExport = (kind) => {
    const messages = {
      draft: "Draft saved (mock) — no data was actually persisted.",
      csv: `Production CSV export simulated (${PRODUCTION_CSV_COLUMNS.length} columns) for FIROO CAM import.`,
      print: "Print preview simulated.",
    };
    flashToast(messages[kind] || "Action simulated.");
  };

  const handlePreviewOrder = () => {
    onPreviewOrder({ header, rows, totals });
  };

  const handlePreviewInvoice = () => {
    onPreviewInvoice({ header, rows, invoice, totals });
  };

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-4 pb-24 sm:px-6 sm:py-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <OrderHeaderForm header={header} onChange={setHeader} />
          <DoorOrderTable
            rows={rows}
            onChangeRows={setRows}
            invoiceMode={invoiceMode}
            currency={header.currency}
          />
          {invoiceMode && (
            <InvoicePanel invoice={invoice} onChange={setInvoice} totals={totals} currency={invoice.currency} />
          )}
        </div>

        <div>
          <SummaryPanel
            totals={totals}
            currency={header.currency}
            invoiceMode={invoiceMode}
            onToggleInvoice={setInvoiceMode}
            onExport={handleExport}
            onPreviewOrder={handlePreviewOrder}
            onPreviewInvoice={handlePreviewInvoice}
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-3">
          <p className="hidden truncate text-xs text-ink-500 lg:block">
            {header.orderNo} · {totals.totalDoors} doors · {totals.totalRows} rows
            {invoiceMode ? ` · Grand Total ${header.currency} ${totals.grandTotal.toFixed(2)}` : ""}
          </p>
          <div className="flex flex-1 items-center justify-end gap-1.5 overflow-x-auto sm:gap-2">
            <button onClick={() => handleExport("draft")} className="zx-btn-secondary !px-2.5 sm:!px-3.5">
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">Save Draft</span>
            </button>
            <button onClick={() => handleExport("csv")} className="zx-btn-secondary !px-2.5 sm:!px-3.5">
              <FileSpreadsheet className="h-4 w-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button onClick={handlePreviewOrder} className="zx-btn-primary !px-2.5 sm:!px-3.5">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Order PDF</span>
            </button>
            {invoiceMode && (
              <button onClick={handlePreviewInvoice} className="zx-btn-gold !px-2.5 sm:!px-3.5">
                <Receipt className="h-4 w-4" />
                <span className="hidden sm:inline">Invoice PDF</span>
              </button>
            )}
            <button onClick={() => handleExport("print")} className="zx-btn-ghost !px-2.5 sm:!px-3.5">
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>
      </div>

      <Toast message={toast} />
    </div>
  );
}
