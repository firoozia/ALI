import { useRef, useState } from "react";
import { Plus, Trash2, Search, Download, Upload, Globe } from "lucide-react";
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
  nextCatalogItemId,
  formatMdfThickness,
} from "../core/catalogSchema";
import { downloadJsonFile, readFileAsText } from "../lib/download";
import { edgeBandCodeError, parseEdgeBandCodesCsv, type EdgeBandCatalogItem } from "../core/melamine";
import { publishDesignsToPortal } from "../lib/remoteDesigns";
import { publishColorsToPortal } from "../lib/remoteColors";
import { isMissingEdgeBandTable, publishEdgeBandsToPortal } from "../lib/remoteEdgeBands";
import type { TenantSession } from "../lib/tenantAuth";
import Toast, { type ToastTone } from "../components/ui/Toast";
import NumberCell from "../components/ui/NumberCell";

interface DesignsProps {
  catalog: Catalog;
  onChangeCatalog: (catalog: Catalog) => void;
  tenantSession?: TenantSession | null;
}

export default function Designs({ catalog, onChangeCatalog, tenantSession }: DesignsProps) {
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone>("success");
  const [pendingImport, setPendingImport] = useState<Catalog | null>(null);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string, tone: ToastTone = "success") => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => setToast(""), tone === "error" ? 4500 : 2500);
  };

  const handleExport = async () => {
    try {
      const saved = await downloadJsonFile(catalogFileName(), serializeCatalogFile(buildCatalogFile(catalog)));
      flash(saved ? "Catalog exported." : "Export cancelled — no file was saved.", saved ? "success" : "neutral");
    } catch {
      flash("Could not save the catalog file. Please try again.", "error");
    }
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

  const handlePublish = async () => {
    if (!tenantSession) return;
    setPublishing(true);
    try {
      await publishDesignsToPortal(tenantSession.tenantId, catalog.designs);
      await publishColorsToPortal(tenantSession.tenantId, catalog.pvcColors);
      try {
        await publishEdgeBandsToPortal(tenantSession.tenantId, catalog.edgeBands ?? []);
      } catch (err) {
        if (!isMissingEdgeBandTable(err)) throw err;
        flash("Designs and colors published. Edge bands were not: run the updated supabase/schema.sql once to add the edge_bands table.", "error");
        return;
      }
      flash("Published — your customer portal now shows these design, color, and edge band codes.");
    } catch (err) {
      flash(`Could not publish: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    } finally {
      setPublishing(false);
    }
  };

  const portalUrl = tenantSession ? `${window.location.origin}${window.location.pathname}?factory=${tenantSession.slug}` : "";

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-4 pb-16 sm:px-6 sm:py-6">
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

      {tenantSession && (
        <div className="zx-card mb-5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4 text-navy-700" />
            <h3 className="text-sm font-bold text-ink-900">Customer Portal</h3>
          </div>
          <p className="mb-3 text-xs text-ink-500">
            Your customers order from a public link — no account needed on their side. It shows only your active
            design and color codes below, and nothing from any other factory.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={portalUrl} onFocus={(e) => e.target.select()} className="zx-input flex-1 !text-xs" />
            <button onClick={handlePublish} disabled={publishing} className="zx-btn-primary !py-1.5">
              {publishing ? "Publishing…" : "Publish Active Designs"}
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

      <EdgeBandSection catalog={catalog} onChangeCatalog={onChangeCatalog} onToast={flash} />

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

  // Keyed by the row's stable internal `id`, never by `code` — `code` is
  // exactly what the user is typing into, and re-keying rows on every
  // keystroke of the field they're editing is what caused the "typing
  // exits the field after one character" bug (React remounts the row and
  // its <input> loses focus the instant `code`, its key, changes).
  const update = (id: string, patch: Partial<DesignCatalogItem>) => {
    onChangeCatalog({ ...catalog, designs: designs.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  };
  const remove = (id: string) => onChangeCatalog({ ...catalog, designs: designs.filter((d) => d.id !== id) });
  const add = () =>
    onChangeCatalog({
      ...catalog,
      designs: [
        ...designs,
        { id: nextCatalogItemId(), code: "", name: "", family: "", description: "", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1200, defaultUnitPrice: 0, defaultMdfThickness: "", active: true },
      ],
    });
  const mdfOptions = catalog.mdfThickness.filter((m) => m.active);

  return (
    <div className="zx-card mb-5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">Door Designs</h3>
        <button onClick={add} className="zx-btn-secondary !py-1.5">
          <Plus className="h-4 w-4" />
          Add Design
        </button>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        Default Price and Default MDF are auto-filled into a Door Order row when this design is picked — the row stays editable afterward.
      </p>
      <SectionSearch query={query} onChange={setQuery} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
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
              <th className="zx-th text-right">Default Price</th>
              <th className="zx-th">Default MDF</th>
              <th className="zx-th text-center">Active</th>
              <th className="zx-th"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id} className={!d.active ? "opacity-50" : ""}>
                <td className="zx-td p-1"><input value={d.code} onChange={(e) => update(d.id, { code: e.target.value })} className="zx-cell-input w-24" /></td>
                <td className="zx-td p-1"><input value={d.name} onChange={(e) => update(d.id, { name: e.target.value })} className="zx-cell-input" /></td>
                <td className="zx-td p-1"><input value={d.family} onChange={(e) => update(d.id, { family: e.target.value })} className="zx-cell-input w-28" /></td>
                <td className="zx-td p-1"><input value={d.description} onChange={(e) => update(d.id, { description: e.target.value })} className="zx-cell-input" /></td>
                <td className="zx-td p-1"><NumberCell value={d.minWidthMm} onCommit={(v) => update(d.id, { minWidthMm: v })} className="w-20" /></td>
                <td className="zx-td p-1"><NumberCell value={d.maxWidthMm} onCommit={(v) => update(d.id, { maxWidthMm: v })} className="w-20" /></td>
                <td className="zx-td p-1"><NumberCell value={d.minHeightMm} onCommit={(v) => update(d.id, { minHeightMm: v })} className="w-20" /></td>
                <td className="zx-td p-1"><NumberCell value={d.maxHeightMm} onCommit={(v) => update(d.id, { maxHeightMm: v })} className="w-20" /></td>
                <td className="zx-td p-1"><NumberCell value={d.defaultUnitPrice} onCommit={(v) => update(d.id, { defaultUnitPrice: v })} className="w-24" /></td>
                <td className="zx-td p-1">
                  <select value={d.defaultMdfThickness} onChange={(e) => update(d.id, { defaultMdfThickness: e.target.value })} className="zx-cell-input w-28">
                    <option value="">—</option>
                    {mdfOptions.map((m) => {
                      const label = formatMdfThickness(m);
                      return (
                        <option key={m.thicknessMm} value={label}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </td>
                <td className="zx-td text-center">
                  <input type="checkbox" checked={d.active} onChange={(e) => update(d.id, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
                </td>
                <td className="zx-td">
                  <button onClick={() => remove(d.id)} className="zx-btn-danger !px-2 !py-1.5"><Trash2 className="h-3.5 w-3.5" /></button>
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

  const update = (id: string, patch: Partial<PvcCatalogItem>) => {
    onChangeCatalog({ ...catalog, pvcColors: items.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };
  const remove = (id: string) => onChangeCatalog({ ...catalog, pvcColors: items.filter((p) => p.id !== id) });
  const add = () =>
    onChangeCatalog({
      ...catalog,
      pvcColors: [...items, { id: nextCatalogItemId(), code: "", color: "", category: "", finish: "", defaultGrain: "", active: true }],
    });
  const grainOptions = catalog.grainDirections.filter((g) => g.active);

  return (
    <div className="zx-card mb-5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">PVC / Membrane Colors</h3>
        <button onClick={add} className="zx-btn-secondary !py-1.5">
          <Plus className="h-4 w-4" />
          Add Color
        </button>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        Default Grain is auto-filled into a Door Order row when this color is picked — the row stays editable afterward.
      </p>
      <SectionSearch query={query} onChange={setQuery} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="zx-th">Code</th>
              <th className="zx-th">Color</th>
              <th className="zx-th">Category</th>
              <th className="zx-th">Finish</th>
              <th className="zx-th">Default Grain</th>
              <th className="zx-th text-center">Active</th>
              <th className="zx-th"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} className={!p.active ? "opacity-50" : ""}>
                <td className="zx-td p-1"><input value={p.code} onChange={(e) => update(p.id, { code: e.target.value })} className="zx-cell-input w-28" /></td>
                <td className="zx-td p-1"><input value={p.color} onChange={(e) => update(p.id, { color: e.target.value })} className="zx-cell-input" /></td>
                <td className="zx-td p-1"><input value={p.category} onChange={(e) => update(p.id, { category: e.target.value })} className="zx-cell-input w-32" /></td>
                <td className="zx-td p-1"><input value={p.finish} onChange={(e) => update(p.id, { finish: e.target.value })} className="zx-cell-input w-28" /></td>
                <td className="zx-td p-1">
                  <select value={p.defaultGrain} onChange={(e) => update(p.id, { defaultGrain: e.target.value })} className="zx-cell-input w-28">
                    <option value="">—</option>
                    {grainOptions.map((g) => (
                      <option key={g.id} value={g.label}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="zx-td text-center">
                  <input type="checkbox" checked={p.active} onChange={(e) => update(p.id, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
                </td>
                <td className="zx-td">
                  <button onClick={() => remove(p.id)} className="zx-btn-danger !px-2 !py-1.5"><Trash2 className="h-3.5 w-3.5" /></button>
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
            <NumberCell value={m.thicknessMm} onCommit={(v) => update(index, { thicknessMm: v })} variant="field" className="w-24" />
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
  const update = (id: string, patch: Partial<GrainDirectionOption>) => {
    onChangeCatalog({ ...catalog, grainDirections: items.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  };
  const remove = (id: string) => onChangeCatalog({ ...catalog, grainDirections: items.filter((g) => g.id !== id) });
  const add = () =>
    onChangeCatalog({ ...catalog, grainDirections: [...items, { id: nextCatalogItemId(), code: "", label: "", active: true }] });

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
        {items.map((g) => (
          <div key={g.id} className={`flex items-center gap-2 ${!g.active ? "opacity-50" : ""}`}>
            <input value={g.code} onChange={(e) => update(g.id, { code: e.target.value })} placeholder="code" className="zx-input w-28" />
            <input value={g.label} onChange={(e) => update(g.id, { label: e.target.value })} placeholder="Label" className="zx-input flex-1" />
            <label className="flex items-center gap-1.5 text-xs text-ink-600">
              <input type="checkbox" checked={g.active} onChange={(e) => update(g.id, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
              Active
            </label>
            <button onClick={() => remove(g.id)} className="zx-btn-danger !px-2 !py-2"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EdgeBandSection({
  catalog,
  onChangeCatalog,
  onToast,
}: DesignsProps & { onToast: (message: string, tone?: ToastTone) => void }) {
  const items = catalog.edgeBands ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<EdgeBandCatalogItem>) => {
    onChangeCatalog({ ...catalog, edgeBands: items.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  };
  const remove = (id: string) => onChangeCatalog({ ...catalog, edgeBands: items.filter((b) => b.id !== id) });
  const add = () => {
    const used = new Set(items.map((b) => b.code.toUpperCase()));
    let n = 1;
    while (used.has(`P${n}`)) n++;
    onChangeCatalog({
      ...catalog,
      edgeBands: [...items, { id: nextCatalogItemId(), code: `P${n}`, name: "", thicknessMm: 1, widthMm: 22, color: "", active: true }],
    });
  };

  /** Adds or updates bands by code from the list ZINAX CAM exports; keeps codes not in the file. */
  const importFromCam = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const { bands, errors } = parseEdgeBandCodesCsv(text, nextCatalogItemId);
      if (bands.length === 0) {
        onToast(`No edge bands imported. ${errors[0] ?? ""}`.trim(), "error");
        return;
      }
      const byCode = new Map(items.map((b) => [b.code.toUpperCase(), b]));
      for (const band of bands) {
        const existing = byCode.get(band.code.toUpperCase());
        byCode.set(band.code.toUpperCase(), existing ? { ...band, id: existing.id } : band);
      }
      onChangeCatalog({ ...catalog, edgeBands: Array.from(byCode.values()) });
      onToast(
        errors.length
          ? `${bands.length} edge band(s) imported, ${errors.length} row(s) skipped: ${errors[0]}`
          : `${bands.length} edge band(s) imported from ZINAX CAM.`,
        errors.length ? "error" : "success"
      );
    } catch (err) {
      onToast(`Cannot import edge bands: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  return (
    <div className="zx-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink-900">Edge Bands (melamine)</h3>
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()} className="zx-btn-secondary !py-1.5" title="CSV from ZINAX CAM → Settings → Edge banding → Export codes…">
            <Upload className="h-4 w-4" />
            Import from ZINAX CAM
          </button>
          <button onClick={add} className="zx-btn-secondary !py-1.5">
            <Plus className="h-4 w-4" />
            Add
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFromCam(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        Codes must match ZINAX CAM (P1, P2, …). ZINAX CAM subtracts the thickness from the cut size; here the codes are only chosen per edge.
      </p>
      <div className="overflow-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="zx-th">Code</th>
              <th className="zx-th">Name</th>
              <th className="zx-th text-right">Thickness mm</th>
              <th className="zx-th text-right">Width mm</th>
              <th className="zx-th">Color</th>
              <th className="zx-th">Active</th>
              <th className="zx-th"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => {
              const codeError = edgeBandCodeError(b.code, items, b.id);
              const thicknessBad = !(b.thicknessMm > 0);
              return (
                <tr key={b.id} className={!b.active ? "opacity-50" : ""}>
                  <td className="zx-td p-1">
                    <input
                      value={b.code}
                      onChange={(e) => update(b.id, { code: e.target.value })}
                      title={codeError || undefined}
                      className={`zx-cell-input w-20 font-semibold ${codeError ? "invalid" : ""}`}
                    />
                  </td>
                  <td className="zx-td p-1"><input value={b.name} onChange={(e) => update(b.id, { name: e.target.value })} className="zx-cell-input w-40" /></td>
                  <td className="zx-td p-1">
                    <NumberCell value={b.thicknessMm} step={0.1} invalid={thicknessBad} onCommit={(v) => update(b.id, { thicknessMm: v })} className="w-24" />
                  </td>
                  <td className="zx-td p-1">
                    <NumberCell value={b.widthMm} onCommit={(v) => update(b.id, { widthMm: v })} className="w-20" />
                  </td>
                  <td className="zx-td p-1"><input value={b.color} onChange={(e) => update(b.id, { color: e.target.value })} className="zx-cell-input w-28" /></td>
                  <td className="zx-td p-1 text-center">
                    <input type="checkbox" checked={b.active} onChange={(e) => update(b.id, { active: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-navy-800" />
                  </td>
                  <td className="zx-td p-1">
                    <button onClick={() => remove(b.id)} className="zx-btn-danger !px-2 !py-1.5" title="Orders that use this code will show it as unknown">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
