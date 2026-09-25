import { useState, type ChangeEvent } from "react";
import { FileStack, Image as ImageIcon, Stamp } from "lucide-react";
import type { AppSettings } from "../core/settingsSchema";
import type { PdfTemplateSettings } from "../core/pdfTemplateSchema";
import type { CompanyProfile } from "../core/companyProfile";
import { isPdfSafeImageFile } from "../lib/pdfSafeImage";
import Toast, { type ToastTone } from "../components/ui/Toast";

interface PdfTemplatesProps {
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
}

export default function PdfTemplates({ settings, onChangeSettings }: PdfTemplatesProps) {
  const [previewMode, setPreviewMode] = useState<"order" | "invoice">("order");
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const updateTemplate = (patch: Partial<PdfTemplateSettings>) => {
    onChangeSettings({ ...settings, pdfTemplate: { ...settings.pdfTemplate, ...patch } });
  };

  const updateProfile = (patch: Partial<CompanyProfile>) => {
    onChangeSettings({ ...settings, companyProfile: { ...settings.companyProfile, ...patch } });
  };

  const handleStampUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isPdfSafeImageFile(file)) {
      flash("Stamp must be a PNG or JPG image — this file type can't be placed on the generated PDFs.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateProfile({ stampUrl: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  };

  const t = settings.pdfTemplate;

  return (
    <div className="mx-auto max-w-4xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-ink-900">PDF Templates</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          Titles, visibility toggles, stamp, and footer text used by every generated PDF. Company identity fields
          (name, logo, bank details) live in Settings.
        </p>
      </div>

      <div className="zx-card mb-5 p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800/10 text-navy-800">
            <FileStack className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-ink-900">Titles &amp; Language</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Order PDF Title" value={t.orderPdfTitle} onChange={(v) => updateTemplate({ orderPdfTitle: v })} />
          <TextField label="Invoice PDF Title" value={t.invoicePdfTitle} onChange={(v) => updateTemplate({ invoicePdfTitle: v })} />
          <div>
            <label className="zx-label">PDF Language</label>
            <select
              value={t.language}
              onChange={(e) => updateTemplate({ language: e.target.value as "EN" | "AR" })}
              className="zx-select"
            >
              <option value="EN">English (EN)</option>
              <option value="AR">Arabic (AR) — placeholder, layout not mirrored yet</option>
            </select>
          </div>
        </div>
        <TextField
          label="Footer Notes"
          value={t.footerNotes}
          onChange={(v) => updateTemplate({ footerNotes: v })}
          className="mt-4"
          multiline
        />
      </div>

      <div className="zx-card mb-5 p-5">
        <h3 className="mb-4 text-sm font-bold text-ink-900">Show / Hide on PDF</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Toggle label="Show Company Tax Number" checked={t.showTaxNumber} onChange={(v) => updateTemplate({ showTaxNumber: v })} />
          <Toggle label="Show Bank Details on Invoice" checked={t.showBankDetails} onChange={(v) => updateTemplate({ showBankDetails: v })} />
          <Toggle label="Show Signature Boxes" checked={t.showSignatures} onChange={(v) => updateTemplate({ showSignatures: v })} />
          <Toggle label="Show Prices on Order PDF" checked={t.showPricesOnOrderPdf} onChange={(v) => updateTemplate({ showPricesOnOrderPdf: v })} />
        </div>
      </div>

      <div className="zx-card mb-5 p-5">
        <h3 className="mb-4 text-sm font-bold text-ink-900">Company Stamp</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
            {settings.companyProfile.stampUrl ? (
              <img src={settings.companyProfile.stampUrl} alt="Company stamp" className="h-full w-full object-contain" />
            ) : (
              <Stamp className="h-6 w-6 text-ink-300" />
            )}
          </div>
          <label className="zx-btn-secondary cursor-pointer !py-1.5">
            <ImageIcon className="h-4 w-4" />
            Upload Stamp
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleStampUpload} />
          </label>
          <p className="text-xs text-ink-500">
            PNG or JPG only. Appears in the Company Stamp signature box, when signatures are shown.
          </p>
        </div>
      </div>

      <div className="zx-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink-900">Preview</h3>
          <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
            <button
              onClick={() => setPreviewMode("order")}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${previewMode === "order" ? "bg-white shadow-sm" : "text-ink-500"}`}
            >
              Order PDF
            </button>
            <button
              onClick={() => setPreviewMode("invoice")}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${previewMode === "invoice" ? "bg-white shadow-sm" : "text-ink-500"}`}
            >
              Invoice PDF
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm">
          <p className="font-bold text-ink-900">
            {previewMode === "order" ? t.orderPdfTitle : t.invoicePdfTitle}
          </p>
          <ul className="mt-2 list-disc pl-4 text-xs text-ink-600">
            <li>Tax number: {t.showTaxNumber ? "shown" : "hidden"}</li>
            {previewMode === "invoice" && <li>Bank details: {t.showBankDetails ? "shown" : "hidden"}</li>}
            <li>Signatures: {t.showSignatures ? "shown" : "hidden"}</li>
            {previewMode === "order" && <li>Prices on Order PDF: {t.showPricesOnOrderPdf ? "shown" : "hidden"}</li>}
            <li>Language: {t.language}</li>
          </ul>
          <p className="mt-2 text-xs text-ink-500">
            Open an order and click Export Order PDF / Export Proforma Invoice PDF to see the full generated document
            with these settings applied.
          </p>
        </div>
      </div>

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  className = "",
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  return (
    <div className={className}>
      <label className="zx-label">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="zx-input resize-none" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="zx-input" />
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-ink-100 p-3">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        type="button"
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-navy-800" : "bg-ink-200"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`} />
      </button>
    </label>
  );
}
