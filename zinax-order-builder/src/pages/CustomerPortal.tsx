import { useEffect, useState } from "react";
import { Lock, Plus, Trash2, CheckCircle2, Download, FileText, Printer } from "lucide-react";
import { resolveTenantBySlug, submitCustomerOrder } from "../lib/publicPortal";
import { fetchPublicDesigns } from "../lib/remoteDesigns";
import type { PublicTenant, PublicDesign, CustomerPortalItem, CustomerSubmission } from "../core/publicCatalogSchema";
import {
  buildCustomerSubmissionFile,
  serializeCustomerSubmissionFile,
  customerSubmissionFileName,
} from "../core/customerSubmissionFile";
import { downloadJsonFile } from "../lib/download";
import { exportCustomerOrderPdf } from "../lib/pdf/exportCustomerOrderPdf";

interface CustomerPortalProps {
  slug: string;
}

export default function CustomerPortal({ slug }: CustomerPortalProps) {
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [designs, setDesigns] = useState<PublicDesign[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">("loading");

  const [customerName, setCustomerName] = useState("");
  const [endCustomerName, setEndCustomerName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [items, setItems] = useState<CustomerPortalItem[]>([]);

  const [draft, setDraft] = useState<CustomerPortalItem>({
    designCode: "",
    width: 0,
    height: 0,
    qty: 1,
    colorCode: "",
    direction: "Vertical",
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolveTenantBySlug(slug).then(async (t) => {
      if (!t) {
        setLoadState("not-found");
        return;
      }
      setTenant(t);
      const list = await fetchPublicDesigns(t.id).catch(() => []);
      setDesigns(list);
      if (list.length > 0) setDraft((d) => ({ ...d, designCode: list[0].code }));
      setLoadState("ready");
    });
  }, [slug]);

  const addItem = () => {
    if (!draft.designCode || draft.width <= 0 || draft.height <= 0 || draft.qty <= 0) return;
    setItems((prev) => [...prev, draft]);
    setDraft((d) => ({ ...d, width: 0, height: 0, qty: 1 }));
  };

  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const currentSubmission = (): CustomerSubmission => ({ customerName, endCustomerName, siteName, items });

  const handleDownloadFile = async () => {
    if (items.length === 0) return;
    const file = buildCustomerSubmissionFile(currentSubmission());
    await downloadJsonFile(customerSubmissionFileName(customerName), serializeCustomerSubmissionFile(file));
  };

  const handleDownloadPdf = async () => {
    if (items.length === 0 || !tenant) return;
    await exportCustomerOrderPdf(tenant.companyName, currentSubmission());
  };

  const handleSubmit = async () => {
    if (!tenant || items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCustomerOrder(tenant.id, { customerName, endCustomerName, siteName, items });
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="border-b border-ink-100 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-400 text-navy-950">
            {tenant?.companyName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900">{tenant?.companyName}</p>
            <p className="text-xs text-ink-500">Customer Order Form</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        <div className="zx-card mb-5 p-5">
          <h2 className="mb-1 text-base font-bold text-ink-900">Order Details</h2>
          <p className="mb-4 text-xs text-ink-500">Only the information production needs to build your order.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="zx-label">Customer Name</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="zx-input" placeholder="e.g. Khalid Al Farsi" />
            </div>
            <div>
              <label className="zx-label">End Customer Name</label>
              <input value={endCustomerName} onChange={(e) => setEndCustomerName(e.target.value)} className="zx-input" placeholder="e.g. Marina Residence" />
            </div>
            <div>
              <label className="zx-label">Installation Unit / Site</label>
              <input value={siteName} onChange={(e) => setSiteName(e.target.value)} className="zx-input" placeholder="e.g. Unit 12, Tower A" />
            </div>
          </div>
        </div>

        <div className="zx-card mb-5 p-5">
          <h2 className="mb-1 text-base font-bold text-ink-900">Add Item</h2>
          <p className="mb-4 text-xs text-ink-500">
            {designs.length === 0
              ? "This factory hasn't published any design codes yet."
              : "Pick a design code and enter the size."}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="zx-label">Door Code</label>
              <select
                value={draft.designCode}
                onChange={(e) => setDraft((d) => ({ ...d, designCode: e.target.value }))}
                className="zx-select"
                disabled={designs.length === 0}
              >
                {designs.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="zx-label">Width (mm)</label>
              <input type="number" value={draft.width || ""} onChange={(e) => setDraft((d) => ({ ...d, width: Number(e.target.value) || 0 }))} className="zx-input" />
            </div>
            <div>
              <label className="zx-label">Height (mm)</label>
              <input type="number" value={draft.height || ""} onChange={(e) => setDraft((d) => ({ ...d, height: Number(e.target.value) || 0 }))} className="zx-input" />
            </div>
            <div>
              <label className="zx-label">Qty</label>
              <input type="number" value={draft.qty} onChange={(e) => setDraft((d) => ({ ...d, qty: Number(e.target.value) || 1 }))} className="zx-input" />
            </div>
            <div>
              <label className="zx-label">Color Code</label>
              <input value={draft.colorCode} onChange={(e) => setDraft((d) => ({ ...d, colorCode: e.target.value }))} className="zx-input" placeholder="e.g. PVC-101" />
            </div>
            <div>
              <label className="zx-label">Direction</label>
              <select value={draft.direction} onChange={(e) => setDraft((d) => ({ ...d, direction: e.target.value }))} className="zx-select">
                <option>Vertical</option>
                <option>Horizontal</option>
              </select>
            </div>
          </div>
          <button onClick={addItem} disabled={designs.length === 0} className="zx-btn-secondary mt-4 w-full">
            <Plus className="h-4 w-4" />
            Add Item to List
          </button>
        </div>

        {items.length > 0 && (
          <div className="zx-card mb-5 p-5">
            <h2 className="mb-3 text-base font-bold text-ink-900">Order Items ({items.length})</h2>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-navy-50 px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold text-navy-900">
                      {item.width} × {item.height} mm
                    </span>{" "}
                    <span className="text-ink-500">
                      — Qty {item.qty} · {item.designCode} · {item.colorCode || "—"} · {item.direction}
                    </span>
                  </div>
                  <button onClick={() => removeItem(i)} className="zx-btn-ghost !p-1.5">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mb-3 text-sm font-medium text-red-600">{error}</p>}

        <button onClick={handleSubmit} disabled={items.length === 0 || submitting} className="zx-btn-primary w-full">
          {submitting ? "Sending…" : "Submit Order to Factory"}
        </button>

        <button
          onClick={handleDownloadFile}
          disabled={items.length === 0}
          className="zx-btn-secondary mt-2 w-full"
        >
          <Download className="h-4 w-4" />
          Download as File Instead
        </button>
        <p className="mt-1.5 text-center text-2xs text-ink-400">
          For when the factory is offline — send them this file directly (WhatsApp, email) and they can import it.
        </p>

        <button
          onClick={handleDownloadPdf}
          disabled={items.length === 0}
          className="zx-btn-secondary mt-2 w-full"
        >
          <Printer className="h-4 w-4" />
          Download / Print a Copy for Yourself
        </button>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-2xs text-ink-400">
          <Lock className="h-3 w-3" />
          Your details are sent directly and privately to {tenant?.companyName}.
        </p>
      </div>
    </div>
  );
}
