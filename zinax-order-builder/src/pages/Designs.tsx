import { useRef, useState } from "react";
import { Plus, Trash2, Search, Download, Upload } from "lucide-react";
import {
  type Catalog,
  type DesignCatalogItem,
  type PvcCatalogItem,
  type MdfThicknessOption,
  type GrainDirectionOption,
  buildCatalogFile,
  serializeCatalogFile,
  catalogFileName,
  parseCatalogFile,
  mergeCatalog,
  replaceCatalog,
} from "../core/catalogSchema";
import { downloadJsonFile, readFileAsText } from "../lib/download";
import Toast, { type ToastTone } from "../components/ui/Toast";

interface DesignsProps {
  catalog: Catalog;
  onChangeCatalog: (catalog: Catalog) => void;
}

export default function Designs({ catalog, onChangeCatalog }: DesignsProps) {
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  const [pendingImport, setPendingImport] = useState<Catalog | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const handleExport = async () => {
    const saved = await downloadJsonFile(catalogFileName(), serializeCatalogFile(buildCatalogFile(catalog)));
    if (saved) flash("Catalog exported.");
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const result = parseCatalogFile(text);
      if (!result.ok) {
        flash(`Cannot import catalog: ${result.error}`, "error");
        return;
      }
      setPendingImport(result.catalog);
    } catch (err) {
      flash(`Cannot import catalog: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  const applyImport = (mode: "merge" | "replace") => {
    if (!pendingImport) return;
    const next = mode === "merge" ? mergeCatalog(catalog, pendingImport) : replaceCatalog(catalog, pendingImport);
    onChangeCatalog(next);
    setPendingImport(null);
    flash(mode === "merge" ? "Catalog merged." : "Catalog replaced.");
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">Designs / Catalog</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Only active entries appear in the Door Order Table dropdowns.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="zx-btn-secondary">
            <Download className="h-4 w-4" />
            Export Catalog
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="zx-btn-secondary">
            <Upload className="h-4 w-4" />
            Import Catalog
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
            Import ready — {pendingImport.designs.length} designs, {pendingImport.pvcColors.length} PVC colors found in this file.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Merge adds/updates entries and keeps everything else. Replace discards the current catalog entirely.
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

      <DesignsSection catalog={catalog} onChangeCatalog={onChangeCatalog} />
      <PvcSection catalog={catalog} onChangeCatalog={onChangeCatalog} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <MdfSection catalog={catalog} onChangeCatalog={onChangeCatalog} />
        <GrainSection catalog={catalog} onChangeCatalog={onChangeCatalog} />
      </div>

      <Toast message={toast} tone={toastTone} />
    </div>
  );
}

function SectionSearch({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5">
      <Search className="h-3.5 w-3.5 text-ink-400" />
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter..."
        className="w-full bg-transparent text-xs text-ink-700 placeholder:text-ink-400 outline-none"
      />
    </div>
  );
}

function DesignsSection({ catalog, onChangeCatalog }: DesignsProps) {
  const [query, setQuery] = useState("");
  const designs = catalog.designs;
  const visible = designs.filter((d) =>
    `${d.code} ${d.name} ${d.family}`.toLowerCase().includes(query.toLowerCase())
  );

  const update = (code: string, patch: Partial<DesignCatalogItem>) => {
    onChangeCatalog({ ...catalog, designs: designs.map((d) => (d.code === code ? { ...d, ...patch } : d)) });
  };
  const remove = (code: string) => onChangeCatalog({ ...catalog, designs: designs.filter((d) => d.code !== code) });
  const add = () =>
    onChangeCatalog({
      ...catalog,
      designs: [
        ...designs,
        { code: "", name: "", family: "", description: "", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1200, active: true },
      ],
    });

  return (
    <div className="zx-card mb-5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">Door Designs</h3>
        <button onClick={add} className="zx-btn-secondary !py-1.5">
          <Plus className="h-4 w-4" />
          Add Design
        </button>
      </div>
      <SectionSearch query={query} onChange={setQuery} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="zx-th">Code</th>
              <th className="zx-th">Name</th>
              <th className="zx-th">Family</th>
              <th className="zx-th">Description</th>
              <th className="zx-th text-right">Min W</th>
              <th className="zx-th text-right">Max W</th>
              <th className="zx-th text-right">Min H</th>
              <th className="zx-th text-right">Max H</th>
              <th className="zx-th text-center">Active</th>
              <th className="zx-th"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d, index) => (
              <tr key={d.code || `design-${index}`} className={!d.active ? "opacity-50" : ""}>
                <td className="zx-td p-1"><input value={d.code} onChange={(e) => update(d.code, { code: e.target.value })} className="zx-cell-input w-24" /></td>
                <td className="zx-td p-1"><input value={d.name} onChange={(e) => update(d.code, { name: e.target.value })} className="zx-cell-input" /></td>
                <td className="zx-td p-1"><input value={d.family} onChange={(e) => update(d.code, { family: e.target.value })} className="zx-cell-input w-28" /></td>
                <td className="zx-td p-1"><input value={d.description} onChange={(e) => update(d.code, { description: e.target.value })} className="zx-cell-input" /></td>
                <td className="zx-td p-1"><input type="number" value={d.minWidthMm} onChange={(e) => update(d.code, { minWidthMm: Number(e.target.value) || 0 })} className="zx-cell-input w-20 text-right" /></td>
                <td className="zx-td p-1"><input type="number" value={d.maxWidthMm} onChange={(e) => update(d.code, { maxWidthMm: Number(e.target.value) || 0 })} className="zx-cell-input w-20 text-right" /></td>
                <td className="zx-td p-1"><input type="number" value={d.minHeightMm} onChange={(e) => update(d.code, { minHeightMm: Number(e.target.value) || 0 })} className="zx-cell-input w-20 text-right" /></td>
                <td className="zx-td p-1"><input type="number" value={d.maxHeightMm} onChange={(e) => update(d.code, { maxHeightMm: Number(e.target.value) || 0 })} className="zx-cell-input w-20 text-right" /></td>
                <td className="zx-td text-center">
                  <input type="checkbox" checked={d.active} onChange={(e) => update(d.code, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
                </td>
                <td className="zx-td">
                  <button onClick={() => remove(d.code)} className="zx-btn-danger !px-2 !py-1.5"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PvcSection({ catalog, onChangeCatalog }: DesignsProps) {
  const [query, setQuery] = useState("");
  const items = catalog.pvcColors;
  const visible = items.filter((p) => `${p.code} ${p.color} ${p.category}`.toLowerCase().includes(query.toLowerCase()));

  const update = (code: string, patch: Partial<PvcCatalogItem>) => {
    onChangeCatalog({ ...catalog, pvcColors: items.map((p) => (p.code === code ? { ...p, ...patch } : p)) });
  };
  const remove = (code: string) => onChangeCatalog({ ...catalog, pvcColors: items.filter((p) => p.code !== code) });
  const add = () =>
    onChangeCatalog({ ...catalog, pvcColors: [...items, { code: "", color: "", category: "", finish: "", active: true }] });

  return (
    <div className="zx-card mb-5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">PVC / Membrane Colors</h3>
        <button onClick={add} className="zx-btn-secondary !py-1.5">
          <Plus className="h-4 w-4" />
          Add Color
        </button>
      </div>
      <SectionSearch query={query} onChange={setQuery} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="zx-th">Code</th>
              <th className="zx-th">Color</th>
              <th className="zx-th">Category</th>
              <th className="zx-th">Finish</th>
              <th className="zx-th text-center">Active</th>
              <th className="zx-th"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, index) => (
              <tr key={p.code || `pvc-${index}`} className={!p.active ? "opacity-50" : ""}>
                <td className="zx-td p-1"><input value={p.code} onChange={(e) => update(p.code, { code: e.target.value })} className="zx-cell-input w-28" /></td>
                <td className="zx-td p-1"><input value={p.color} onChange={(e) => update(p.code, { color: e.target.value })} className="zx-cell-input" /></td>
                <td className="zx-td p-1"><input value={p.category} onChange={(e) => update(p.code, { category: e.target.value })} className="zx-cell-input w-32" /></td>
                <td className="zx-td p-1"><input value={p.finish} onChange={(e) => update(p.code, { finish: e.target.value })} className="zx-cell-input w-28" /></td>
                <td className="zx-td text-center">
                  <input type="checkbox" checked={p.active} onChange={(e) => update(p.code, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
                </td>
                <td className="zx-td">
                  <button onClick={() => remove(p.code)} className="zx-btn-danger !px-2 !py-1.5"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MdfSection({ catalog, onChangeCatalog }: DesignsProps) {
  const items = catalog.mdfThickness;
  const update = (index: number, patch: Partial<MdfThicknessOption>) => {
    onChangeCatalog({ ...catalog, mdfThickness: items.map((m, i) => (i === index ? { ...m, ...patch } : m)) });
  };
  const remove = (index: number) => onChangeCatalog({ ...catalog, mdfThickness: items.filter((_, i) => i !== index) });
  const add = () => onChangeCatalog({ ...catalog, mdfThickness: [...items, { thicknessMm: 18, active: true }] });

  return (
    <div className="zx-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">MDF Thickness Options</h3>
        <button onClick={add} className="zx-btn-secondary !py-1.5">
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((m, index) => (
          <div key={index} className={`flex items-center gap-2 ${!m.active ? "opacity-50" : ""}`}>
            <input
              type="number"
              value={m.thicknessMm}
              onChange={(e) => update(index, { thicknessMm: Number(e.target.value) || 0 })}
              className="zx-input w-24"
            />
            <span className="text-sm text-ink-500">mm</span>
            <label className="ml-2 flex items-center gap-1.5 text-xs text-ink-600">
              <input type="checkbox" checked={m.active} onChange={(e) => update(index, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
              Active
            </label>
            <button onClick={() => remove(index)} className="zx-btn-danger !ml-auto !px-2 !py-2"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrainSection({ catalog, onChangeCatalog }: DesignsProps) {
  const items = catalog.grainDirections;
  const update = (code: string, patch: Partial<GrainDirectionOption>) => {
    onChangeCatalog({ ...catalog, grainDirections: items.map((g) => (g.code === code ? { ...g, ...patch } : g)) });
  };
  const remove = (code: string) => onChangeCatalog({ ...catalog, grainDirections: items.filter((g) => g.code !== code) });
  const add = () => onChangeCatalog({ ...catalog, grainDirections: [...items, { code: "", label: "", active: true }] });

  return (
    <div className="zx-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">Grain Direction Options</h3>
        <button onClick={add} className="zx-btn-secondary !py-1.5">
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((g, index) => (
          <div key={g.code || `grain-${index}`} className={`flex items-center gap-2 ${!g.active ? "opacity-50" : ""}`}>
            <input value={g.code} onChange={(e) => update(g.code, { code: e.target.value })} placeholder="code" className="zx-input w-28" />
            <input value={g.label} onChange={(e) => update(g.code, { label: e.target.value })} placeholder="Label" className="zx-input flex-1" />
            <label className="flex items-center gap-1.5 text-xs text-ink-600">
              <input type="checkbox" checked={g.active} onChange={(e) => update(g.code, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
              Active
            </label>
            <button onClick={() => remove(g.code)} className="zx-btn-danger !px-2 !py-2"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
