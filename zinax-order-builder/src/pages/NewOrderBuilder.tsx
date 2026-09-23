import { useState } from "react";
import { Save, FileSpreadsheet, FileText, Receipt, Printer, FilePlus2, FlaskConical, PanelRightClose, PanelRightOpen } from "lucide-react";
import OrderHeaderForm from "../components/order/OrderHeaderForm";
import DoorOrderTable from "../components/order/DoorOrderTable";
import InvoicePanel from "../components/order/InvoicePanel";
import SummaryPanel from "../components/order/SummaryPanel";
import Toast, { type ToastTone } from "../components/ui/Toast";
import { makeInitialHeader, makeInitialInvoice, makeInitialRows } from "../core/mockData";
import { computeOrderTotals } from "../core/calculations";
import { buildProductionCsvString, productionCsvFileName } from "../core/csvSchema";
import { buildOrderFile, serializeOrderFile, orderFileName, parseOrderFile } from "../core/jsonOrderFile";
import { getOrderValidationErrors, getInvoiceValidationErrors } from "../core/validators";
import type { OrderHeader, OrderRow } from "../core/orderSchema";
import { type Invoice } from "../core/invoiceSchema";
import type { OrderPreviewData, InvoicePreviewData } from "../core/pdfSchema";
import type { AppSettings } from "../core/settingsSchema";
import type { Customer } from "../core/customerSchema";
import { downloadCsvFile, downloadJsonFile, readFileAsText } from "../lib/download";
import { makeBlankHeader, makeBlankInvoice, nextInvoiceNo } from "../lib/orderDraft";

interface NewOrderBuilderProps {
  settings: AppSettings;
  customers: Customer[];
  header: OrderHeader;
  onChangeHeader: (header: OrderHeader) => void;
  rows: OrderRow[];
  onChangeRows: (rows: OrderRow[]) => void;
  invoice: Invoice;
  onChangeInvoice: (invoice: Invoice) => void;
  invoiceMode: boolean;
  onChangeInvoiceMode: (mode: boolean) => void;
  onPreviewOrder: (data: OrderPreviewData) => void;
  onPreviewInvoice: (data: InvoicePreviewData) => void;
}

export default function NewOrderBuilder({
  settings,
  customers,
  header,
  onChangeHeader,
  rows,
  onChangeRows,
  invoice,
  onChangeInvoice,
  invoiceMode,
  onChangeInvoiceMode,
  onPreviewOrder,
  onPreviewInvoice,
}: NewOrderBuilderProps) {
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  // Collapsing the summary sidebar hands its width back to the Door Order
  // Table so every column is visible without horizontal scrolling —
  // requested after seeing a CAD/CAM tool panel's collapsible-dock pattern
  // (only the open/close mechanic is borrowed, nothing CNC-related).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const totals = computeOrderTotals(rows, invoice.orderDiscountPercent);

  const flashToast = (message: string, tone: ToastTone = "success") => {
    setToast(message);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2200);
  };

  const orderErrors = getOrderValidationErrors(header, rows, settings.catalog);
  const invoiceErrors = invoiceMode
    ? [...orderErrors, ...getInvoiceValidationErrors(invoice, rows, invoiceMode)]
    : [];
  const invoicePdfDisabled = invoiceMode && invoiceErrors.length > 0;

  /** Shows an error toast and returns true if there are validation errors to block on. */
  const blockIfInvalid = (errors: string[], action: string): boolean => {
    if (errors.length === 0) return false;
    flashToast(`Cannot ${action} — fix the following:\n${errors.join("\n")}`, "error");
    return true;
  };

  const handleNewBlankOrder = () => {
    if ((rows.length > 0 || header.customerName) && !window.confirm("This replaces the current order. Continue?")) {
      return;
    }
    onChangeHeader(makeBlankHeader(settings.companyProfile));
    onChangeInvoice(makeBlankInvoice(settings.companyProfile));
    onChangeRows([]);
    onChangeInvoiceMode(false);
    flashToast("Started a new blank order.");
  };

  const handleLoadSampleOrder = () => {
    if (!window.confirm("This replaces the current order with sample data. Continue?")) return;
    onChangeHeader(makeInitialHeader());
    onChangeInvoice(makeInitialInvoice());
    onChangeRows(makeInitialRows());
    onChangeInvoiceMode(false);
    flashToast("Sample order loaded.");
  };

  const handleToggleInvoiceMode = (next: boolean) => {
    onChangeInvoiceMode(next);
    if (next && !invoice.invoiceNo) {
      onChangeInvoice({ ...invoice, invoiceNo: nextInvoiceNo() });
    }
  };

  const handleSelectCustomer = (customer: Customer) => {
    onChangeHeader({
      ...header,
      customerName: customer.customerName,
      companyName: customer.companyName,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      taxNumber: customer.taxNumber,
    });
    flashToast(`Loaded ${customer.customerName || customer.customerId} into this order.`);
  };

  const handleExportCsv = async () => {
    if (blockIfInvalid(orderErrors, "export CSV")) return;
    try {
      const csv = buildProductionCsvString(header, rows);
      const saved = await downloadCsvFile(productionCsvFileName(header.orderNo), csv);
      if (saved) {
        flashToast(`Production CSV downloaded (${rows.length} rows).`);
      } else {
        flashToast("Export cancelled — no file was saved.", "neutral");
      }
    } catch {
      flashToast("Could not save the CSV file. Please try again.", "error");
    }
  };

  const handleSaveJson = async () => {
    if (blockIfInvalid(orderErrors, "save order")) return;
    try {
      const file = buildOrderFile(header, rows, invoiceMode, invoice);
      const saved = await downloadJsonFile(orderFileName(header.orderNo), serializeOrderFile(file));
      if (saved) {
        flashToast("Order file saved.");
      } else {
        flashToast("Save cancelled — no file was saved.", "neutral");
      }
    } catch {
      flashToast("Could not save the order file. Please try again.", "error");
    }
  };

  const handleOpenJsonFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const result = parseOrderFile(text);
      if (!result.ok) {
        flashToast(`Cannot open order file: ${result.error}`, "error");
        return;
      }
      onChangeHeader(result.file.header);
      onChangeRows(result.file.rows);
      onChangeInvoiceMode(result.file.invoiceMode);
      onChangeInvoice(result.file.invoice);
      flashToast(`Order ${result.file.header.orderNo} loaded from file.`);
    } catch (err) {
      flashToast(`Cannot open order file: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  const handlePreviewOrder = () => {
    if (blockIfInvalid(orderErrors, "export Order PDF")) return;
    onPreviewOrder({ header, rows, totals, companyProfile: settings.companyProfile, pdfTemplate: settings.pdfTemplate });
  };

  const handlePreviewInvoice = () => {
    if (blockIfInvalid(invoiceErrors, "export Invoice PDF")) return;
    onPreviewInvoice({
      header,
      rows,
      totals,
      companyProfile: settings.companyProfile,
      pdfTemplate: settings.pdfTemplate,
      invoice,
    });
  };

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-4 pb-24 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button onClick={handleNewBlankOrder} className="zx-btn-secondary">
            <FilePlus2 className="h-4 w-4" />
            New Blank Order
          </button>
          <button onClick={handleLoadSampleOrder} className="zx-btn-ghost">
            <FlaskConical className="h-4 w-4" />
            Load Sample Order
          </button>
        </div>
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? "Show summary panel" : "Hide summary panel"}
          className="hidden items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-50 xl:flex"
        >
          {sidebarCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
          {sidebarCollapsed ? "Show panel" : "Hide panel"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-6">
          <OrderHeaderForm
            header={header}
            onChange={onChangeHeader}
            customers={customers}
            onSelectCustomer={handleSelectCustomer}
          />
          <DoorOrderTable
            rows={rows}
            onChangeRows={onChangeRows}
            invoiceMode={invoiceMode}
            currency={header.currency}
            catalog={settings.catalog}
          />
          {invoiceMode && (
            <InvoicePanel invoice={invoice} onChange={onChangeInvoice} totals={totals} currency={invoice.currency} />
          )}
        </div>

        {!sidebarCollapsed && (
          <div className="w-full xl:w-[360px]">
            <SummaryPanel
              totals={totals}
              currency={header.currency}
              invoiceMode={invoiceMode}
              onToggleInvoice={handleToggleInvoiceMode}
              onSaveJson={handleSaveJson}
              onOpenJsonFile={handleOpenJsonFile}
              onExportCsv={handleExportCsv}
              onExportOrderPdf={handlePreviewOrder}
              onExportInvoicePdf={handlePreviewInvoice}
              onPrintPreview={handlePreviewOrder}
              invoicePdfDisabled={invoicePdfDisabled}
              invoicePdfDisabledReason={invoicePdfDisabled ? `Cannot export yet: ${invoiceErrors[0]}` : undefined}
            />
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-3">
          <p className="hidden truncate text-xs text-ink-500 lg:block">
            {header.orderNo} · {totals.totalDoors} doors · {totals.totalRows} rows
            {invoiceMode ? ` · Grand Total ${header.currency} ${totals.finalTotal.toFixed(2)}` : ""}
          </p>
          <div className="flex flex-1 items-center justify-end gap-1.5 overflow-x-auto sm:gap-2">
            <button onClick={handleSaveJson} className="zx-btn-secondary !px-2.5 sm:!px-3.5">
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">Save (.json)</span>
            </button>
            <button onClick={handleExportCsv} className="zx-btn-secondary !px-2.5 sm:!px-3.5">
              <FileSpreadsheet className="h-4 w-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button onClick={handlePreviewOrder} className="zx-btn-primary !px-2.5 sm:!px-3.5">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Order PDF</span>
            </button>
            {invoiceMode && (
              <button
                onClick={handlePreviewInvoice}
                disabled={invoicePdfDisabled}
                className="zx-btn-gold !px-2.5 sm:!px-3.5"
              >
                <Receipt className="h-4 w-4" />
                <span className="hidden sm:inline">Invoice PDF</span>
              </button>
            )}
            <button onClick={handlePreviewOrder} className="zx-btn-ghost !px-2.5 sm:!px-3.5">
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>
      </div>

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}
