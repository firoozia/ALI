import { useEffect, useState } from "react";
import { Lock, CheckCircle2, Download, FileText, Printer, ClipboardList, FilePlus2, ArrowLeft } from "lucide-react";
import { resolveTenantBySlug, submitCustomerOrder, fetchMyCustomerSubmissions } from "../lib/publicPortal";
import { fetchPublicDesigns } from "../lib/remoteDesigns";
import { fetchPublicColors } from "../lib/remoteColors";
import { rememberSubmission, listRememberedSubmissions } from "../lib/customerOrderHistory";
import type {
  PublicTenant,
  PublicDesign,
  PublicColor,
  CustomerPortalItem,
  CustomerSubmission,
  CustomerSubmissionRecord,
} from "../core/publicCatalogSchema";
import {
  buildCustomerSubmissionFile,
  serializeCustomerSubmissionFile,
  customerSubmissionFileName,
} from "../core/customerSubmissionFile";
import { downloadJsonFile } from "../lib/download";
import { exportCustomerOrderPdf } from "../lib/pdf/exportCustomerOrderPdf";
import CustomerItemsTable from "../components/customerPortal/CustomerItemsTable";
import Badge from "../components/ui/Badge";
import Toast, { type ToastTone } from "../components/ui/Toast";

interface CustomerPortalProps {
  slug: string;
}

function blankItems(designs: PublicDesign[], colors: PublicColor[]): CustomerPortalItem[] {
  return [
    {
      designCode: designs[0]?.code ?? "",
      width: 0,
      height: 0,
      qty: 1,
      colorCode: colors[0]?.code ?? "",
      direction: "Vertical",
    },
  ];
}

export default function CustomerPortal({ slug }: CustomerPortalProps) {
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [designs, setDesigns] = useState<PublicDesign[]>([]);
  const [colors, setColors] = useState<PublicColor[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">("loading");

  const [view, setView] = useState<"form" | "history">("form");
  const [activeSubmission, setActiveSubmission] = useState<CustomerSubmissionRecord | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [endCustomerName, setEndCustomerName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [items, setItems] = useState<CustomerPortalItem[]>([]);

  const [history, setHistory] = useState<CustomerSubmissionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  useEffect(() => {
    resolveTenantBySlug(slug).then(async (t) => {
      if (!t) {
        setLoadState("not-found");
        return;
      }
      setTenant(t);
      let failed = false;
      const [designList, colorList] = await Promise.all([
        fetchPublicDesigns(t.id).catch(() => {
          failed = true;
          return [];
        }),
        fetchPublicColors(t.id).catch(() => {
          failed = true;
          return [];
        }),
      ]);
      setCatalogError(failed);
      setDesigns(designList);
      setColors(colorList);
      setItems(blankItems(designList, colorList));
      setLoadState("ready");
    });
  }, [slug]);

  const loadHistory = () => {
    setHistoryLoading(true);
    const ids = listRememberedSubmissions(slug).map((r) => r.id);
    fetchMyCustomerSubmissions(ids)
      .then((records) => {
        const order = new Map(ids.map((id, i) => [id, i]));
        setHistory([...records].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
      })
      .catch(() => flash("Could not load your past orders.", "error"))
      .finally(() => setHistoryLoading(false));
  };

  const openMyOrders = () => {
    setView("history");
    loadHistory();
  };

  const startNewOrder = () => {
    setActiveSubmission(null);
    setCustomerName("");
    setEndCustomerName("");
    setSiteName("");
    setItems(blankItems(designs, colors));
    setError(null);
    setView("form");
  };

  const openSubmission = (record: CustomerSubmissionRecord) => {
    setActiveSubmission(record);
    setCustomerName(record.customerName);
    setEndCustomerName(record.endCustomerName);
    setSiteName(record.siteName);
    setItems(record.items);
    setError(null);
    setView("form");
  };

  const currentSubmission = (): CustomerSubmission => ({ customerName, endCustomerName, siteName, items });

  const validItems = items.filter((it) => it.designCode && it.width > 0 && it.height > 0 && it.qty > 0);

  const handleDownloadFile = async () => {
    if (validItems.length === 0) return;
    const file = buildCustomerSubmissionFile({ ...currentSubmission(), items: validItems });
    await downloadJsonFile(customerSubmissionFileName(customerName), serializeCustomerSubmissionFile(file));
  };

  const handleDownloadPdf = async () => {
    if (validItems.length === 0 || !tenant) return;
    await exportCustomerOrderPdf(tenant.companyName, { ...currentSubmission(), items: validItems });
  };

  const handleSubmit = async () => {
    if (!tenant || validItems.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const submission = { ...currentSubmission(), items: validItems };
      const id = await submitCustomerOrder(tenant.id, submission);
      rememberSubmission(slug, id);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-ink-50 text-sm text-ink-500">Loading…</div>;
  }

  if (loadState === "not-found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 text-center">
        <div>
          <p className="text-lg font-bold text-ink-900">Factory not found</p>
          <p className="mt-1 text-sm text-ink-500">Please double-check the link your factory gave you.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
        <div className="zx-card max-w-sm p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-4 text-lg font-bold text-ink-900">Order Sent</h1>
          <p className="mt-2 text-sm text-ink-500">
            Your order was sent directly to {tenant?.companyName}. They will contact you to confirm the details.
          </p>
          <button onClick={handleDownloadPdf} className="zx-btn-secondary mt-5 w-full">
            <FileText className="h-4 w-4" />
            Download a Copy for Yourself (PDF)
          </button>
          <button
            onClick={() => {
              setSubmitted(false);
              startNewOrder();
              openMyOrders();
            }}
            className="zx-btn-ghost mt-2 w-full"
          >
            <ClipboardList className="h-4 w-4" />
            View My Orders
          </button>
        </div>
      </div>
    );
  }

  // Editing only happens before an order is sent — once submitted, the
  // customer can view it here but only the factory can change it (from
  // its own Customer Orders inbox).
  const readOnly = activeSubmission !== null;
  const totalDoors = history.reduce((s, r) => s + r.items.reduce((s2, it) => s2 + (Number(it.qty) || 0), 0), 0);

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="border-b border-ink-100 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-400 text-navy-950 font-bold">
              {tenant?.companyName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold text-ink-900">{tenant?.companyName}</p>
              <p className="text-xs text-ink-500">Customer Order Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-ink-50 p-1">
            <button
              onClick={startNewOrder}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                view === "form" ? "bg-white text-navy-800 shadow-sm" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              New Order
            </button>
            <button
              onClick={openMyOrders}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                view === "history" ? "bg-white text-navy-800 shadow-sm" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              My Orders
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
        {view === "history" ? (
          <>
            <div className="mb-5 grid grid-cols-2 gap-4">
              <div className="zx-card p-5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">Orders Sent</p>
                <p className="mt-0.5 text-2xl font-bold text-ink-900">{history.length}</p>
              </div>
              <div className="zx-card p-5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">Total Doors</p>
                <p className="mt-0.5 text-2xl font-bold text-ink-900">{totalDoors}</p>
              </div>
            </div>

            <div className="zx-card overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-sm font-bold text-ink-900">My Orders</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  Tracked on this device only — orders you send from another phone or browser won't show up here.
                </p>
              </div>
              {historyLoading ? (
                <p className="px-5 py-10 text-center text-sm text-ink-500">Loading…</p>
              ) : history.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-400">
                  No orders sent from this device yet. Go to "New Order" to send your first one.
                </p>
              ) : (
                <div className="divide-y divide-ink-100">
                  {history.map((record) => {
                    const qty = record.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
                    return (
                      <button
                        key={record.id}
                        onClick={() => openSubmission(record)}
                        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-ink-50/60"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink-900">
                              {new Date(record.submittedAt).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            <Badge status={record.status} />
                          </div>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {record.items.length} item(s) · {qty} door(s)
                            {record.siteName ? ` · ${record.siteName}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-navy-700">Open →</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {activeSubmission && (
              <button onClick={() => setView("history")} className="zx-btn-ghost mb-4 !py-1.5">
                <ArrowLeft className="h-4 w-4" />
                Back to My Orders
              </button>
            )}

            {readOnly && (
              <div className="zx-card mb-5 p-4 text-sm text-ink-600 ring-1 ring-amber-200">
                This order was already sent — only {tenant?.companyName} can make changes to it now. Contact them
                directly if something needs to change.
              </div>
            )}

            {!readOnly && catalogError && (
              <div className="zx-card mb-5 p-4 text-sm text-red-700 ring-1 ring-red-200">
                Could not load {tenant?.companyName}'s design/color codes — check your internet connection and reopen
                this order form. (This is different from "not published yet": it means the request itself failed.)
              </div>
            )}

            <div className="zx-card mb-5 p-5">
              <h2 className="mb-1 text-base font-bold text-ink-900">Order Details</h2>
              <p className="mb-4 text-xs text-ink-500">Only the information production needs to build your order.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="zx-label">Customer Name</label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="zx-input"
                    placeholder="e.g. Khalid Al Farsi"
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <label className="zx-label">End Customer Name</label>
                  <input
                    value={endCustomerName}
                    onChange={(e) => setEndCustomerName(e.target.value)}
                    className="zx-input"
                    placeholder="e.g. Marina Residence"
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <label className="zx-label">Installation Unit / Site</label>
                  <input
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    className="zx-input"
                    placeholder="e.g. Unit 12, Tower A"
                    disabled={readOnly}
                  />
                </div>
              </div>
            </div>

            <div className="mb-5">
              <CustomerItemsTable items={items} onChangeItems={setItems} designs={designs} colors={colors} readOnly={readOnly} />
            </div>

            {error && <p className="mb-3 text-sm font-medium text-red-600">{error}</p>}

            {!readOnly && (
              <button onClick={handleSubmit} disabled={validItems.length === 0 || submitting} className="zx-btn-primary w-full">
                {submitting ? "Sending…" : "Submit Order to Factory"}
              </button>
            )}

            {!activeSubmission && (
              <button onClick={handleDownloadFile} disabled={validItems.length === 0} className="zx-btn-secondary mt-2 w-full">
                <Download className="h-4 w-4" />
                Download as File Instead
              </button>
            )}
            {!activeSubmission && (
              <p className="mt-1.5 text-center text-2xs text-ink-400">
                For when the factory is offline — send them this file directly (WhatsApp, email) and they can import it.
              </p>
            )}

            <button onClick={handleDownloadPdf} disabled={validItems.length === 0} className="zx-btn-secondary mt-2 w-full">
              <Printer className="h-4 w-4" />
              Download / Print a Copy for Yourself
            </button>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-2xs text-ink-400">
              <Lock className="h-3 w-3" />
              Your details are sent directly and privately to {tenant?.companyName}.
            </p>
          </>
        )}
      </div>

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}
