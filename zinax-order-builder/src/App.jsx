import { useState } from "react";
import { Users, Blocks, FileStack, Settings as SettingsIcon } from "lucide-react";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import NewOrderBuilder from "./pages/NewOrderBuilder";
import OrderPdfPreview from "./pages/OrderPdfPreview";
import InvoicePdfPreview from "./pages/InvoicePdfPreview";
import PlaceholderPage from "./pages/PlaceholderPage";
import { makeInitialHeader, makeInitialRows } from "./data/mockData";
import { computeOrderTotals } from "./lib/calc";

export default function App() {
  const [screen, setScreen] = useState("dashboard");
  const [orderPreviewData, setOrderPreviewData] = useState(null);
  const [invoicePreviewData, setInvoicePreviewData] = useState(null);

  const navItemsWithBuilder = ["dashboard", "new-order", "customers", "products", "templates", "settings"];

  const handleNavigate = (key) => {
    setScreen(key);
  };

  const handleOpenOrderFromDashboard = (order) => {
    // Populate a mock preview using the recent order's rows + default header/rows for demo purposes.
    const rows = makeInitialRows();
    const header = { ...makeInitialHeader(), orderNo: order.orderNo, customerName: order.customer, projectName: order.project, salesperson: order.salesperson, date: order.date };
    const totals = computeOrderTotals(rows);
    setOrderPreviewData({ header, rows, totals });
    setScreen("order-preview");
  };

  const handlePreviewOrder = (data) => {
    setOrderPreviewData(data);
    setScreen("order-preview");
  };

  const handlePreviewInvoice = (data) => {
    setInvoicePreviewData(data);
    setScreen("invoice-preview");
  };

  let content = null;

  switch (screen) {
    case "dashboard":
      content = <Dashboard onNavigate={handleNavigate} onOpenOrder={handleOpenOrderFromDashboard} />;
      break;
    case "new-order":
      content = <NewOrderBuilder onPreviewOrder={handlePreviewOrder} onPreviewInvoice={handlePreviewInvoice} />;
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
      content = (
        <InvoicePdfPreview
          order={invoicePreviewData}
          onBack={() => setScreen("new-order")}
        />
      );
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
          title="Products / Designs"
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
    case "settings":
      content = (
        <PlaceholderPage
          title="Settings"
          description="Configure company details, default VAT, currencies, salespersons and language preferences."
          icon={SettingsIcon}
        />
      );
      break;
    default:
      content = <Dashboard onNavigate={handleNavigate} onOpenOrder={handleOpenOrderFromDashboard} />;
  }

  const sidebarActive = navItemsWithBuilder.includes(screen) ? screen : "new-order";

  return (
    <AppLayout sidebarActive={sidebarActive} topbarActive={screen} onNavigate={handleNavigate}>
      {content}
    </AppLayout>
  );
}
