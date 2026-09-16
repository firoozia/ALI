import { useEffect, useState, type ReactNode } from "react";
import { Users, Blocks, FileStack } from "lucide-react";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import NewOrderBuilder from "./pages/NewOrderBuilder";
import OrderPdfPreview from "./pages/OrderPdfPreview";
import InvoicePdfPreview from "./pages/InvoicePdfPreview";
import ExportSchemaPreview from "./pages/ExportSchemaPreview";
import Settings from "./pages/Settings";
import PlaceholderPage from "./pages/PlaceholderPage";
import { makeInitialHeader, makeInitialRows, type RecentOrder } from "./core/mockData";
import { computeOrderTotals } from "./core/calculations";
import { loadSettingsFromStorage, saveSettingsToStorage, type AppSettings } from "./core/settingsSchema";
import type { OrderPreviewData, InvoicePreviewData } from "./core/pdfSchema";
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
  const [orderPreviewData, setOrderPreviewData] = useState<OrderPreviewData | null>(null);
  const [invoicePreviewData, setInvoicePreviewData] = useState<InvoicePreviewData | null>(null);

  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  const handleNavigate = (key: ScreenKey) => setScreen(key);

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
    setOrderPreviewData({ header, rows, totals, companyProfile: settings.companyProfile });
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
          catalog={settings.catalog}
          companyProfile={settings.companyProfile}
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
      content = (
        <PlaceholderPage
          title="Customers"
          description="Manage your customer directory, contact details and project history. This module is part of the full ZINAX Order Builder release."
          icon={Users}
        />
      );
      break;
    case "products":
      content = (
        <PlaceholderPage
          title="Designs"
          description="Browse and manage your door design library, PVC membrane catalog and pricing presets."
          icon={Blocks}
        />
      );
      break;
    case "templates":
      content = (
        <PlaceholderPage
          title="PDF Templates"
          description="Customize the layout and branding of your Order Sheet and Proforma Invoice PDF exports."
          icon={FileStack}
        />
      );
      break;
    case "export-schema":
      content = <ExportSchemaPreview />;
      break;
    case "settings":
      content = <Settings settings={settings} onChangeSettings={setSettings} />;
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
