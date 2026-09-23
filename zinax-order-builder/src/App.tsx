import { useEffect, useState, type ReactNode } from "react";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import NewOrderBuilder from "./pages/NewOrderBuilder";
import OrderPdfPreview from "./pages/OrderPdfPreview";
import InvoicePdfPreview from "./pages/InvoicePdfPreview";
import ExportSchemaPreview from "./pages/ExportSchemaPreview";
import Settings from "./pages/Settings";
import Customers from "./pages/Customers";
import Designs from "./pages/Designs";
import PdfTemplates from "./pages/PdfTemplates";
import { makeInitialHeader, makeInitialRows, type RecentOrder } from "./core/mockData";
import { computeOrderTotals } from "./core/calculations";
import type { OrderHeader, OrderRow } from "./core/orderSchema";
import type { Invoice } from "./core/invoiceSchema";
import { loadSettingsFromStorage, saveSettingsToStorage, type AppSettings } from "./core/settingsSchema";
import { loadCustomersFromStorage, saveCustomersToStorage, type Customer } from "./core/customerSchema";
import type { Catalog } from "./core/catalogSchema";
import type { OrderPreviewData, InvoicePreviewData } from "./core/pdfSchema";
import { makeBlankDraft, loadOrderDraftFromStorage, saveOrderDraftToStorage } from "./lib/orderDraft";
import type { ScreenKey } from "./types";

const SIDEBAR_SCREENS: ScreenKey[] = [
  "dashboard",
  "new-order",
  "customers",
  "products",
  "templates",
  "export-schema",
  "settings",
];

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [settings, setSettings] = useState<AppSettings>(loadSettingsFromStorage);
  const [customers, setCustomers] = useState<Customer[]>(loadCustomersFromStorage);
  const [orderPreviewData, setOrderPreviewData] = useState<OrderPreviewData | null>(null);
  const [invoicePreviewData, setInvoicePreviewData] = useState<InvoicePreviewData | null>(null);

  // The in-progress New Order draft lives here, in the parent, rather than
  // as local state inside NewOrderBuilder — that component unmounts every
  // time the screen switches to a PDF preview and back, which used to
  // silently wipe the whole order. Keeping it here means it survives that
  // navigation; persisting it to localStorage means it also survives
  // closing the app, until "New Blank Order"/"Load Sample Order" resets it.
  const [orderDraft, setOrderDraft] = useState(() => loadOrderDraftFromStorage() ?? makeBlankDraft(settings.companyProfile));

  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  useEffect(() => {
    saveCustomersToStorage(customers);
  }, [customers]);

  useEffect(() => {
    saveOrderDraftToStorage(orderDraft);
  }, [orderDraft]);

  const setHeader = (header: OrderHeader) => setOrderDraft((prev) => ({ ...prev, header }));
  const setRows = (rows: OrderRow[]) => setOrderDraft((prev) => ({ ...prev, rows }));
  const setInvoice = (invoice: Invoice) => setOrderDraft((prev) => ({ ...prev, invoice }));
  const setInvoiceMode = (invoiceMode: boolean) => setOrderDraft((prev) => ({ ...prev, invoiceMode }));

  const handleNavigate = (key: ScreenKey) => setScreen(key);

  const handleChangeCatalog = (catalog: Catalog) => setSettings({ ...settings, catalog });

  const handleOpenOrderFromDashboard = (order: RecentOrder) => {
    // Populate a mock preview using the recent order's rows + default header/rows for demo purposes.
    const rows = makeInitialRows();
    const header = {
      ...makeInitialHeader(),
      orderNo: order.orderNo,
      orderDate: order.date,
      customerName: order.customer,
      projectName: order.project,
      salesperson: order.salesperson,
    };
    const totals = computeOrderTotals(rows);
    setOrderPreviewData({ header, rows, totals, companyProfile: settings.companyProfile, pdfTemplate: settings.pdfTemplate });
    setScreen("order-preview");
  };

  const handlePreviewOrder = (data: OrderPreviewData) => {
    setOrderPreviewData(data);
    setScreen("order-preview");
  };

  const handlePreviewInvoice = (data: InvoicePreviewData) => {
    setInvoicePreviewData(data);
    setScreen("invoice-preview");
  };

  let content: ReactNode;

  switch (screen) {
    case "dashboard":
      content = <Dashboard onNavigate={handleNavigate} onOpenOrder={handleOpenOrderFromDashboard} />;
      break;
    case "new-order":
      content = (
        <NewOrderBuilder
          settings={settings}
          customers={customers}
          header={orderDraft.header}
          onChangeHeader={setHeader}
          rows={orderDraft.rows}
          onChangeRows={setRows}
          invoice={orderDraft.invoice}
          onChangeInvoice={setInvoice}
          invoiceMode={orderDraft.invoiceMode}
          onChangeInvoiceMode={setInvoiceMode}
          onPreviewOrder={handlePreviewOrder}
          onPreviewInvoice={handlePreviewInvoice}
        />
      );
      break;
    case "order-preview":
      content = (
        <OrderPdfPreview
          order={orderPreviewData}
          onBack={() => setScreen(orderPreviewData ? "new-order" : "dashboard")}
        />
      );
      break;
    case "invoice-preview":
      content = <InvoicePdfPreview order={invoicePreviewData} onBack={() => setScreen("new-order")} />;
      break;
    case "customers":
      content = <Customers customers={customers} onChangeCustomers={setCustomers} />;
      break;
    case "products":
      content = <Designs catalog={settings.catalog} onChangeCatalog={handleChangeCatalog} />;
      break;
    case "templates":
      content = <PdfTemplates settings={settings} onChangeSettings={setSettings} />;
      break;
    case "export-schema":
      content = <ExportSchemaPreview />;
      break;
    case "settings":
      content = <Settings settings={settings} onChangeSettings={setSettings} onNavigate={handleNavigate} />;
      break;
    default:
      content = <Dashboard onNavigate={handleNavigate} onOpenOrder={handleOpenOrderFromDashboard} />;
  }

  const sidebarActive: ScreenKey = SIDEBAR_SCREENS.includes(screen) ? screen : "new-order";

  return (
    <AppLayout sidebarActive={sidebarActive} topbarActive={screen} onNavigate={handleNavigate}>
      {content}
    </AppLayout>
  );
}
