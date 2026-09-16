import { useRef, useState, type ChangeEvent } from "react";
import {
  Settings as SettingsIcon,
  Cpu,
  Monitor,
  Globe2,
  Plus,
  Trash2,
  Download,
  Upload,
  Image as ImageIcon,
} from "lucide-react";
import { ARCHITECTURE_NOTE } from "../core/exportContracts";
import type { AppSettings } from "../core/settingsSchema";
import { serializeSettings, settingsFileName, parseSettingsFile, mergeSettings, replaceSettings } from "../core/settingsSchema";
import type { CompanyProfile } from "../core/companyProfile";
import type { DesignCatalogItem, PvcCatalogItem } from "../core/catalogSchema";
import { CURRENCIES } from "../core/mockData";
import { downloadJsonFile, readFileAsText } from "../lib/download";
import Toast, { type ToastTone } from "../components/ui/Toast";

interface SettingsProps {
  settings: AppSettings;
  onChangeSettings: (settings: AppSettings) => void;
}

export default function Settings({ settings, onChangeSettings }: SettingsProps) {
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  const [pendingImport, setPendingImport] = useState<AppSettings | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const updateProfile = (patch: Partial<CompanyProfile>) => {
    onChangeSettings({ ...settings, companyProfile: { ...settings.companyProfile, ...patch } });
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateProfile({ logoUrl: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  };

  const handleExportSettings = () => {
    downloadJsonFile(settingsFileName(), serializeSettings(settings));
    flash("Settings exported.");
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const result = parseSettingsFile(text);
      if (!result.ok) {
        flash(`Cannot import settings: ${result.error}`, "error");
        return;
      }
      setPendingImport(result.settings);
    } catch (err) {
      flash(`Cannot import settings: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  const applyImport = (mode: "merge" | "replace") => {
    if (!pendingImport) return;
    const next = mode === "merge" ? mergeSettings(settings, pendingImport) : replaceSettings(settings, pendingImport);
    onChangeSettings(next);
    setPendingImport(null);
    flash(mode === "merge" ? "Settings merged." : "Settings replaced.");
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">Settings</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Saved automatically in this browser. Export a file to move settings to another install.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportSettings} className="zx-btn-secondary">
            <Download className="h-4 w-4" />
            Export Settings
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="zx-btn-secondary">
            <Upload className="h-4 w-4" />
            Import Settings
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {pendingImport && (
        <div className="zx-card mb-5 border-gold-300 p-4 ring-1 ring-gold-300">
          <p className="text-sm font-semibold text-ink-800">
            Import ready — {pendingImport.catalog.designs.length} designs, {pendingImport.catalog.pvcColors.length}{" "}
            PVC colors found in this file.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Merge adds/updates catalog entries and keeps everything else. Replace discards current settings entirely.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => applyImport("merge")} className="zx-btn-primary !py-1.5">
              Merge
            </button>
            <button onClick={() => applyImport("replace")} className="zx-btn-secondary !py-1.5">
              Replace
            </button>
            <button onClick={() => setPendingImport(null)} className="zx-btn-ghost !py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="zx-card mb-5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800/10 text-navy-800">
            <Cpu className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-ink-900">System Architecture</h3>
        </div>
        <p className="rounded-lg bg-navy-50 p-3 text-sm font-medium text-navy-800 ring-1 ring-navy-100">
          {ARCHITECTURE_NOTE}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg border border-ink-100 p-3">
            <Globe2 className="h-4 w-4 shrink-0 text-navy-700" />
            <div>
              <p className="text-sm font-semibold text-ink-800">Web Edition</p>
              <p className="text-2xs text-ink-500">React frontend + FastAPI backend</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-ink-100 p-3">
            <Monitor className="h-4 w-4 shrink-0 text-navy-700" />
            <div>
              <p className="text-sm font-semibold text-ink-800">Windows Edition</p>
              <p className="text-2xs text-ink-500">PySide6, same shared order core</p>
            </div>
          </div>
        </div>
      </div>

      <div className="zx-card mb-5 p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-500/15 text-gold-600">
            <SettingsIcon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-ink-900">Company Profile</h3>
        </div>

        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-ink-200 bg-ink-50">
            {settings.companyProfile.logoUrl ? (
              <img src={settings.companyProfile.logoUrl} alt="Company logo" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-6 w-6 text-ink-300" />
            )}
          </div>
          <label className="zx-btn-secondary cursor-pointer !py-1.5">
            Upload Logo
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <TextField label="Company Name" value={settings.companyProfile.companyName} onChange={(v) => updateProfile({ companyName: v })} />
          <TextField label="Brand Name" value={settings.companyProfile.brandName} onChange={(v) => updateProfile({ brandName: v })} />
          <TextField label="Tax / TRN Number" value={settings.companyProfile.taxNumber} onChange={(v) => updateProfile({ taxNumber: v })} />
          <TextField label="Address" value={settings.companyProfile.address} onChange={(v) => updateProfile({ address: v })} className="xl:col-span-2" />
          <TextField label="Phone" value={settings.companyProfile.phone} onChange={(v) => updateProfile({ phone: v })} />
          <TextField label="WhatsApp" value={settings.companyProfile.whatsapp} onChange={(v) => updateProfile({ whatsapp: v })} />
          <TextField label="Email" value={settings.companyProfile.email} onChange={(v) => updateProfile({ email: v })} />
          <TextField label="Bank Details" value={settings.companyProfile.bankDetails} onChange={(v) => updateProfile({ bankDetails: v })} className="sm:col-span-2 xl:col-span-3" />

          <div>
            <label className="zx-label">Default Currency</label>
            <select
              value={settings.companyProfile.defaultCurrency}
              onChange={(e) => updateProfile({ defaultCurrency: e.target.value })}
              className="zx-select"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label="Default VAT %"
            type="number"
            value={String(settings.companyProfile.defaultVatPercent)}
            onChange={(v) => updateProfile({ defaultVatPercent: Number(v) || 0 })}
          />
          <TextField label="Default Salesperson" value={settings.companyProfile.defaultSalesperson} onChange={(v) => updateProfile({ defaultSalesperson: v })} />
          <TextField
            label="Default Payment Terms"
            value={settings.companyProfile.defaultPaymentTerms}
            onChange={(v) => updateProfile({ defaultPaymentTerms: v })}
            className="sm:col-span-2 xl:col-span-3"
          />
        </div>
      </div>

      <div className="zx-card mb-5 p-5">
        <h3 className="mb-4 text-sm font-bold text-ink-900">Design Catalog</h3>
        <DesignListEditor
          rows={settings.catalog.designs}
          onChange={(designs) => onChangeSettings({ ...settings, catalog: { ...settings.catalog, designs } })}
        />
      </div>

      <div className="zx-card mb-5 p-5">
        <h3 className="mb-4 text-sm font-bold text-ink-900">PVC / Membrane Color Catalog</h3>
        <PvcColorListEditor
          rows={settings.catalog.pvcColors}
          onChange={(pvcColors) => onChangeSettings({ ...settings, catalog: { ...settings.catalog, pvcColors } })}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="zx-card p-5">
          <h3 className="mb-4 text-sm font-bold text-ink-900">MDF Thickness Options</h3>
          <StringListEditor
            items={settings.catalog.mdfThickness}
            onChange={(mdfThickness) => onChangeSettings({ ...settings, catalog: { ...settings.catalog, mdfThickness } })}
          />
        </div>
        <div className="zx-card p-5">
          <h3 className="mb-4 text-sm font-bold text-ink-900">Grain Direction Options</h3>
          <StringListEditor
            items={settings.catalog.grainDirections}
            onChange={(grainDirections) => onChangeSettings({ ...settings, catalog: { ...settings.catalog, grainDirections } })}
          />
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
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="zx-label">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="zx-input" />
    </div>
  );
}

function DesignListEditor({
  rows,
  onChange,
}: {
  rows: DesignCatalogItem[];
  onChange: (rows: DesignCatalogItem[]) => void;
}) {
  const updateRow = (index: number, patch: Partial<DesignCatalogItem>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRow = () => onChange([...rows, { code: "", name: "" }]);
  const deleteRow = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={row.code}
            onChange={(e) => updateRow(index, { code: e.target.value })}
            placeholder="Code"
            className="zx-input w-32"
          />
          <input
            value={row.name}
            onChange={(e) => updateRow(index, { name: e.target.value })}
            placeholder="Design Name"
            className="zx-input flex-1"
          />
          <button onClick={() => deleteRow(index)} className="zx-btn-danger !px-2 !py-2">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={addRow} className="zx-btn-secondary !py-1.5">
        <Plus className="h-4 w-4" />
        Add Row
      </button>
    </div>
  );
}

function PvcColorListEditor({
  rows,
  onChange,
}: {
  rows: PvcCatalogItem[];
  onChange: (rows: PvcCatalogItem[]) => void;
}) {
  const updateRow = (index: number, patch: Partial<PvcCatalogItem>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRow = () => onChange([...rows, { code: "", color: "" }]);
  const deleteRow = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={row.code}
            onChange={(e) => updateRow(index, { code: e.target.value })}
            placeholder="Code"
            className="zx-input w-32"
          />
          <input
            value={row.color}
            onChange={(e) => updateRow(index, { color: e.target.value })}
            placeholder="Color Name"
            className="zx-input flex-1"
          />
          <button onClick={() => deleteRow(index)} className="zx-btn-danger !px-2 !py-2">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={addRow} className="zx-btn-secondary !py-1.5">
        <Plus className="h-4 w-4" />
        Add Row
      </button>
    </div>
  );
}

function StringListEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const updateItem = (index: number, value: string) => {
    onChange(items.map((item, i) => (i === index ? value : item)));
  };
  const addItem = () => onChange([...items, ""]);
  const deleteItem = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={item}
            onChange={(e) => updateItem(index, e.target.value)}
            className="zx-input flex-1"
          />
          <button onClick={() => deleteItem(index)} className="zx-btn-danger !px-2 !py-2">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={addItem} className="zx-btn-secondary !py-1.5">
        <Plus className="h-4 w-4" />
        Add Option
      </button>
    </div>
  );
}
