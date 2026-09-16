import { useState } from "react";
import { Save, FileSpreadsheet, FileText, Receipt, Printer, FilePlus2, FlaskConical } from "lucide-react";
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
import { generateOrderNo, type OrderHeader, type OrderRow } from "../core/orderSchema";
import { generateInvoiceNo, type Invoice } from "../core/invoiceSchema";
import type { OrderPreviewData, InvoicePreviewData } from "../core/pdfSchema";
import type { AppSettings } from "../core/settingsSchema";
import type { CompanyProfile } from "../core/companyProfile";
import type { Customer } from "../core/customerSchema";
import { downloadCsvFile, downloadJsonFile, readFileAsText } from "../lib/download";
import { nextOrderSequence, nextInvoiceSequence } from "../lib/orderSequence";

interface NewOrderBuilderProps {
  settings: AppSettings;
  customers: Customer[];
  onPreviewOrder: (data: OrderPreviewData) => void;
  onPreviewInvoice: (data: InvoicePreviewData) => void;
}

function makeBlankHeader(companyProfile: CompanyProfile): OrderHeader {
  return {
    orderNo: generateOrderNo(new Date().getFullYear(), nextOrderSequence()),
    orderDate: new Date().toISOString().slice(0, 10),
    customerName: "",
    companyName: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    taxNumber: "",
    projectName: "",
    salesperson: companyProfile.defaultSalesperson,
    deliveryDate: "",
    currency: companyProfile.defaultCurrency,
    notes: "",
  };
}

function makeBlankInvoice(companyProfile: CompanyProfile): Invoice {
  return {
    invoiceNo: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    paymentTerms: companyProfile.defaultPaymentTerms,
    vat: companyProfile.defaultVatPercent,
    currency: companyProfile.defaultCurrency,
    bankDetails: companyProfile.bankDetails,
    paidAmount: 0,
    notes: "",
  };
}

export default function NewOrderBuilder({ settings, customers, onPreviewOrder, onPreviewInvoice }: NewOrderBuilderProps) {
  const [header, setHeader] = useState<OrderHeader>(() => makeBlankHeader(settings.companyProfile));
  const [invoice, setInvoice] = useState<Invoice>(() => makeBlankInvoice(settings.companyProfile));
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");

  const totals = computeOrderTotals(rows);

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
    setHeader(makeBlankHeader(settings.companyProfile));
    setInvoice(makeBlankInvoice(settings.companyProfile));
    setRows([]);
    setInvoiceMode(false);
    flashToast("Started a new blank order.");
  };

  const handleLoadSampleOrder = () => {
    if (!window.confirm("This replaces the current order with sample data. Continue?")) return;
    setHeader(makeInitialHeader());
    setInvoice(makeInitialInvoice());
    setRows(makeInitialRows());
    setInvoiceMode(false);
    flashToast("Sample order loaded.");
  };

  const handleToggleInvoiceMode = (next: boolean) => {
    setInvoiceMode(next);
    if (next && !invoice.invoiceNo) {
      setInvoice((prev) => ({
        ...prev,
        invoiceNo: generateInvoiceNo(new Date().getFullYear(), nextInvoiceSequence()),
      }));
    }
  };

  const handleSelectCustomer = (customer: Customer) => {
    setHeader((prev) => ({
      ...prev,
      customerName: customer.customerName,
      companyName: customer.companyName,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      taxNumber: customer.taxNumber,
    }));
    flashToast(`Loaded ${customer.customerName || customer.customerId} into this order.`);
  };

  const handleExportCsv = async () => {
    if (blockIfInvalid(orderErrors, "export CSV")) return;
    const csv = buildProductionCsvString(header, rows);
    const saved = await downloadCsvFile(productionCsvFileName(header.orderNo), csv);
    if (saved) flashToast(`Production CSV downloaded (${rows.length} rows).`);
  };

  const handleSaveJson = async () => {
    if (blockIfInvalid(orderErrors, "save order")) return;
    const file = buildOrderFile(header, rows, invoiceMode, invoice);
    const saved = await downloadJsonFile(orderFileName(header.orderNo), serializeOrderFile(file));
    if (saved) flashToast("Order file saved.");
  };

  const handleOpenJsonFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const result = parseOrderFile(text);
      if (!result.ok) {
        flashToast(`Cannot open order file: ${result.error}`, "error");
        return;
      }
      setHeader(result.file.header);
      setRows(result.file.rows);
      setInvoiceMode(result.file.invoiceMode);
      setInvoice(result.file.invoice);
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
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={handleNewBlankOrder} className="zx-btn-secondary">
          <FilePlus2 className="h-4 w-4" />
          New Blank Order
        </button>
        <button onClick={handleLoadSampleOrder} className="zx-btn-ghost">
          <FlaskConical className="h-4 w-4" />
          Load Sample Order
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <OrderHeaderForm
            header={header}
            onChange={setHeader}
            customers={customers}
            onSelectCustomer={handleSelectCustomer}
          />
          <DoorOrderTable
            rows={rows}
            onChangeRows={setRows}
            invoiceMode={invoiceMode}
            currency={header.currency}
            catalog={settings.catalog}
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
            onToggleInvoice={handleToggleInvoiceMode}
            onSaveJson={handleSaveJson}
            onOpenJsonFile={handleOpenJsonFile}
            onExportCsv={handleExportCsv}
            onExportOrderPdf={handlePreviewOrder}
            onExportInvoicePdf={handlePreviewInvoice}
            onPrintPreview={handlePreviewOrder}
            invoicePdfDisabled={invoicePdfDisabled}
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
