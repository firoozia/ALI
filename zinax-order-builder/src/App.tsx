import { useEffect, useState, type ReactNode } from "react";
import AppLayout from "./components/layout/AppLayout";
import Login from "./pages/Login";
import CustomerPortal from "./pages/CustomerPortal";
import CustomerAppEntry from "./pages/CustomerAppEntry";
import Dashboard from "./pages/Dashboard";
import NewOrderBuilder from "./pages/NewOrderBuilder";
import OrderPdfPreview from "./pages/OrderPdfPreview";
import InvoicePdfPreview from "./pages/InvoicePdfPreview";
import ExportSchemaPreview from "./pages/ExportSchemaPreview";
import Settings from "./pages/Settings";
import Customers from "./pages/Customers";
import Designs from "./pages/Designs";
import PdfTemplates from "./pages/PdfTemplates";
import type { OrderHeader, OrderRow } from "./core/orderSchema";
import type { Invoice } from "./core/invoiceSchema";
import { loadSettingsFromStorage, saveSettingsToStorage, type AppSettings } from "./core/settingsSchema";
import { loadCustomersFromStorage, saveCustomersToStorage, type Customer } from "./core/customerSchema";
import type { Catalog } from "./core/catalogSchema";
import type { OrderPreviewData, InvoicePreviewData } from "./core/pdfSchema";
import {
  makeOrderRecord,
  upsertOrderRecord,
  loadOrderHistoryFromStorage,
  saveOrderHistoryToStorage,
  type OrderRecord,
  type OrderStatus,
} from "./core/orderHistorySchema";
import { makeBlankDraft, duplicateOrderRecord, loadOrderDraftFromStorage, saveOrderDraftToStorage } from "./lib/orderDraft";
import { isBackendConfigured } from "./lib/supabaseClient";
import { restoreTenantSession, signOutTenant, type TenantSession } from "./lib/tenantAuth";
import { loadRemoteOrderHistory, upsertRemoteOrder } from "./lib/remoteOrderHistory";
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
  // A factory's customer opens this without ever logging in, and the
  // standalone customer desktop build (VITE_APP_ROLE=customer, set at build
  // time in the Windows workflow) never shows the factory's own
  // Login/Dashboard at all — both cases are decided here, before the
  // factory app's own hooks run, so neither depends on being signed in.
  const portalSlug = new URLSearchParams(window.location.search).get("factory");
  if (import.meta.env.VITE_APP_ROLE === "customer") {
    return <CustomerAppEntry urlSlug={portalSlug} />;
  }
  if (portalSlug) {
    return <CustomerPortal slug={portalSlug} />;
  }
  return <FactoryApp />;
}

function FactoryApp() {
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
  // closing the app, until "New Blank Order" resets it.
  const [orderDraft, setOrderDraft] = useState(() => loadOrderDraftFromStorage() ?? makeBlankDraft(settings.companyProfile));
  // Also lifted here rather than living inside OrderHeaderForm — that
  // component (and NewOrderBuilder itself) unmounts on every screen
  // switch, which was resetting the collapsed Order Header back open every
  // time you left and returned to New Order.
  const [orderHeaderOpen, setOrderHeaderOpen] = useState(true);
  // The running history of every order that's been saved/exported at
  // least once — this is what gives the Dashboard real stats and a real
  // "Recent Orders" list instead of static mock data.
  const [orderHistory, setOrderHistory] = useState<OrderRecord[]>(loadOrderHistoryFromStorage);

  // Multi-tenant backend (Supabase) is optional — when it isn't configured
  // (no VITE_SUPABASE_URL/ANON_KEY), authChecked starts true and
  // tenantSession stays null forever, so the app behaves exactly as the
  // local-only, no-login prototype it always was.
  const [tenantSession, setTenantSession] = useState<TenantSession | null>(null);
  const [authChecked, setAuthChecked] = useState(!isBackendConfigured());
  // A factory floor may have no reliable internet — "Continue offline" on
  // the login screen skips signing in for this launch and falls back to
  // the same local-only behavior as when no backend is configured at all.
  const [offlineChosen, setOfflineChosen] = useState(false);

  useEffect(() => {
    if (!isBackendConfigured()) return;
    restoreTenantSession().then((session) => {
      setTenantSession(session);
      setAuthChecked(true);
      if (session) loadRemoteOrderHistory(session.tenantId).then(setOrderHistory);
    });
  }, []);

  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  useEffect(() => {
    saveCustomersToStorage(customers);
  }, [customers]);

  useEffect(() => {
    saveOrderDraftToStorage(orderDraft);
  }, [orderDraft]);

  useEffect(() => {
    // Once signed in to a tenant, the backend is the source of truth —
    // writes go through handleRecordOrderEvent/upsertRemoteOrder instead.
    if (tenantSession) return;
    saveOrderHistoryToStorage(orderHistory);
  }, [orderHistory, tenantSession]);

  const setHeader = (header: OrderHeader) => setOrderDraft((prev) => ({ ...prev, header }));
  const setRows = (rows: OrderRow[]) => setOrderDraft((prev) => ({ ...prev, rows }));
  const setInvoice = (invoice: Invoice) => setOrderDraft((prev) => ({ ...prev, invoice }));
  const setInvoiceMode = (invoiceMode: boolean) => setOrderDraft((prev) => ({ ...prev, invoiceMode }));

  const handleNavigate = (key: ScreenKey) => setScreen(key);

  const handleChangeCatalog = (catalog: Catalog) => setSettings({ ...settings, catalog });

  const handleRecordOrderEvent = (status: OrderStatus, totalDoors: number) => {
    const record = makeOrderRecord(orderDraft.header, orderDraft.rows, orderDraft.invoice, orderDraft.invoiceMode, status, totalDoors);
    setOrderHistory((prev) => upsertOrderRecord(prev, record));
    if (tenantSession) upsertRemoteOrder(tenantSession.tenantId, record).catch(() => {});
  };

  const handleSignedIn = (session: TenantSession) => {
    setTenantSession(session);
    loadRemoteOrderHistory(session.tenantId).then(setOrderHistory);
  };

  const handleSignOut = () => {
    signOutTenant().then(() => {
      setTenantSession(null);
      setOrderHistory(loadOrderHistoryFromStorage());
      setScreen("dashboard");
    });
  };

  const handleOpenOrderFromDashboard = (order: OrderRecord) => {
    setOrderDraft({ header: order.header, rows: order.rows, invoice: order.invoice, invoiceMode: order.invoiceMode });
    setScreen("new-order");
  };

  const handleDuplicateOrderFromDashboard = (order: OrderRecord) => {
    setOrderDraft(duplicateOrderRecord(order));
    setScreen("new-order");
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
      content = (
        <Dashboard
          onNavigate={handleNavigate}
          orders={orderHistory}
          onOpenOrder={handleOpenOrderFromDashboard}
          onDuplicateOrder={handleDuplicateOrderFromDashboard}
        />
      );
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
          orderHeaderOpen={orderHeaderOpen}
          onToggleOrderHeaderOpen={setOrderHeaderOpen}
          onRecordOrderEvent={handleRecordOrderEvent}
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
      content = (
        <Designs catalog={settings.catalog} onChangeCatalog={handleChangeCatalog} tenantSession={tenantSession} />
      );
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
      content = (
        <Dashboard
          onNavigate={handleNavigate}
          orders={orderHistory}
          onOpenOrder={handleOpenOrderFromDashboard}
          onDuplicateOrder={handleDuplicateOrderFromDashboard}
        />
      );
  }

  const sidebarActive: ScreenKey = SIDEBAR_SCREENS.includes(screen) ? screen : "new-order";

  if (!authChecked) return null;
  if (isBackendConfigured() && !tenantSession && !offlineChosen) {
    return <Login onSignedIn={handleSignedIn} onContinueOffline={() => setOfflineChosen(true)} />;
  }

  return (
    <AppLayout
      sidebarActive={sidebarActive}
      topbarActive={screen}
      onNavigate={handleNavigate}
      tenantName={tenantSession?.companyName}
      onSignOut={tenantSession ? handleSignOut : undefined}
    >
      {content}
    </AppLayout>
  );
}
