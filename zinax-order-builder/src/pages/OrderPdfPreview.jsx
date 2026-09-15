import { Hammer } from "lucide-react";
import PdfActionsBar from "../components/pdf/PdfActionsBar";
import Toast from "../components/ui/Toast";
import { useState } from "react";

export default function OrderPdfPreview({ order, onBack }) {
  const [toast, setToast] = useState("");
  if (!order) return null;
  const { header, rows, totals } = order;

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  return (
    <div className="min-h-full bg-ink-100">
      <PdfActionsBar
        title="Order Sheet"
        subtitle={`${header.orderNo} — Preview`}
        onBack={onBack}
        onDownload={() => flash("Order PDF download simulated (mock).")}
        onPrint={() => flash("Print dialog simulated (mock).")}
      />

      <div className="flex justify-center px-3 py-5 sm:px-6 sm:py-10">
        <div className="w-full max-w-[1180px] rounded-sm bg-white p-5 shadow-panel sm:p-8 lg:p-12 print:shadow-none">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-navy-900 pb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-navy-950 text-gold-400">
                <Hammer className="h-7 w-7" strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-lg font-extrabold tracking-wide text-navy-950">ZINAX / ARYAK</p>
                <p className="text-xs font-medium uppercase tracking-widest text-ink-400">
                  Cabinet &amp; Membrane Door Production
                </p>
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-2xl font-extrabold text-ink-900">Order Sheet</h1>
              <p className="mt-1 text-sm text-ink-500">Order No. <span className="font-semibold text-ink-800">{header.orderNo}</span></p>
              <p className="text-sm text-ink-500">Date: <span className="font-semibold text-ink-800">{header.orderDate}</span></p>
            </div>
          </div>

          {/* Info grid */}
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <InfoField label="Customer" value={header.customerName} />
            <InfoField label="Project" value={header.projectName} />
            <InfoField label="Phone / WhatsApp" value={header.phone} />
            <InfoField label="Salesperson" value={header.salesperson} />
          </div>

          {/* Table */}
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-navy-950 text-white">
                  {["No.", "Design Code", "Design Name", "Width", "Height", "Qty", "MDF", "PVC Code", "PVC Color", "Grain", "Notes"].map(
                    (h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.id} className={idx % 2 === 0 ? "bg-white" : "bg-ink-50/60"}>
                    <td className="border-b border-ink-100 px-3 py-2 text-ink-500">{idx + 1}</td>
                    <td className="border-b border-ink-100 px-3 py-2 font-semibold text-navy-800">{row.designCode || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.designName || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.width || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.height || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2 tabular-nums">{row.qty || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.mdfThickness}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.pvcCode || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.pvcColor || "—"}</td>
                    <td className="border-b border-ink-100 px-3 py-2">{row.grain}</td>
                    <td className="border-b border-ink-100 px-3 py-2 text-ink-500">{row.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="mt-10 grid grid-cols-2 gap-8 border-t border-ink-200 pt-6 sm:grid-cols-4">
            <InfoField label="Total Doors" value={totals.totalDoors} strong />
            <InfoField
              label="Total Area"
              value={`${totals.totalArea.toFixed(2)} m²`}
              strong
            />
            <InfoField label="Prepared By" value={header.salesperson} />
            <InfoField label="" value="" />
          </div>

          <div className="mt-10 grid grid-cols-3 gap-8 text-sm">
            <SignatureBox label="Prepared By" />
            <SignatureBox label="Customer Signature" />
            <SignatureBox label="Company Stamp" />
          </div>
        </div>
      </div>

      <Toast message={toast} />
    </div>
  );
}

function InfoField({ label, value, strong }) {
  return (
    <div>
      {label && <p className="text-2xs font-semibold uppercase tracking-wide text-ink-400">{label}</p>}
      <p className={`mt-0.5 text-sm ${strong ? "font-bold text-ink-900" : "font-medium text-ink-700"}`}>
        {value || " "}
      </p>
    </div>
  );
}

function SignatureBox({ label }) {
  return (
    <div className="pt-10">
      <div className="h-px w-full bg-ink-300" />
      <p className="mt-2 text-xs font-medium text-ink-500">{label}</p>
    </div>
  );
}
