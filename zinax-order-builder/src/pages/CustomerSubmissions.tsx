import { useEffect, useState } from "react";
import { Inbox, FolderOpen, X, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { fetchCustomerSubmissions, updateSubmissionStatus, deleteSubmission } from "../lib/remoteSubmissions";
import type { CustomerSubmissionRecord } from "../core/publicCatalogSchema";
import type { TenantSession } from "../lib/tenantAuth";
import Badge from "../components/ui/Badge";
import Toast, { type ToastTone } from "../components/ui/Toast";

interface CustomerSubmissionsProps {
  tenantSession: TenantSession | null;
  onImportSubmission: (submission: CustomerSubmissionRecord) => void;
}

export default function CustomerSubmissions({ tenantSession, onImportSubmission }: CustomerSubmissionsProps) {
  const [submissions, setSubmissions] = useState<CustomerSubmissionRecord[]>([]);
  const [loading, setLoading] = useState(() => !!tenantSession);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  useEffect(() => {
    if (!tenantSession) return;
    fetchCustomerSubmissions(tenantSession.tenantId)
      .then(setSubmissions)
      .catch(() => flash("Could not load customer orders.", "error"))
      .finally(() => setLoading(false));
  }, [tenantSession]);

  const handleImport = (submission: CustomerSubmissionRecord) => {
    onImportSubmission(submission);
    updateSubmissionStatus(submission.id, "imported").catch(() => {});
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status: "imported" } : s)));
  };

  const handleDismiss = (submission: CustomerSubmissionRecord) => {
    updateSubmissionStatus(submission.id, "dismissed")
      .then(() => setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status: "dismissed" } : s))))
      .catch(() => flash("Could not update this order.", "error"));
  };

  const handleDelete = (submission: CustomerSubmissionRecord) => {
    deleteSubmission(submission.id)
      .then(() => setSubmissions((prev) => prev.filter((s) => s.id !== submission.id)))
      .catch(() => flash("Could not delete this order.", "error"));
  };

  if (!tenantSession) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <Inbox className="mx-auto h-10 w-10 text-ink-300" />
        <h2 className="mt-4 text-lg font-bold text-ink-900">Sign in to see online customer orders</h2>
        <p className="mt-1 text-sm text-ink-500">
          Orders your customers submit through your public portal link land here once you are signed in to your
          factory account.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-ink-900">Customer Orders</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          Orders submitted online through your customer portal. Import one into New Order to start production, or
          dismiss it if it's a duplicate or a mistake.
        </p>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-ink-500">Loading…</p>
      ) : submissions.length === 0 ? (
        <div className="zx-card flex flex-col items-center px-6 py-16 text-center">
          <Inbox className="h-8 w-8 text-ink-300" />
          <p className="mt-3 text-sm text-ink-500">
            No customer orders yet — share your factory's portal link (see the Designs page) so customers can order
            directly.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((submission) => {
            const expanded = expandedId === submission.id;
            return (
              <div key={submission.id} className="zx-card overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : submission.id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-ink-900">
                        {submission.customerName || "Unnamed customer"}
                      </span>
                      <Badge status={submission.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {submission.endCustomerName || "—"} · {submission.siteName || "—"} · {submission.items.length}{" "}
                      item(s) · {new Date(submission.submittedAt).toLocaleString()}
                    </p>
                  </div>
                  {expanded ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-ink-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
                  )}
                </button>

                {expanded && (
                  <div className="border-t border-ink-100 px-5 py-4">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-sm">
                        <thead>
                          <tr>
                            <th className="zx-th">Door Code</th>
                            <th className="zx-th text-right">Size (mm)</th>
                            <th className="zx-th text-right">Qty</th>
                            <th className="zx-th">Color Code</th>
                            <th className="zx-th">Direction</th>
                          </tr>
                        </thead>
                        <tbody>
                          {submission.items.map((item, i) => (
                            <tr key={i}>
                              <td className="zx-td">{item.designCode || "—"}</td>
                              <td className="zx-td text-right tabular-nums">
                                {item.width} × {item.height}
                              </td>
                              <td className="zx-td text-right tabular-nums">{item.qty}</td>
                              <td className="zx-td">{item.colorCode || "—"}</td>
                              <td className="zx-td">{item.direction || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => handleImport(submission)} className="zx-btn-primary !py-1.5">
                        <FolderOpen className="h-4 w-4" />
                        Import into New Order
                      </button>
                      {submission.status !== "dismissed" && (
                        <button onClick={() => handleDismiss(submission)} className="zx-btn-secondary !py-1.5">
                          <X className="h-4 w-4" />
                          Dismiss
                        </button>
                      )}
                      <button onClick={() => handleDelete(submission)} className="zx-btn-danger !py-1.5">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}
