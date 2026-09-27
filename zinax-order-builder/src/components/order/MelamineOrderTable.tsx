import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Plus, Copy, Trash2, AlertTriangle, Lock, RotateCw } from "lucide-react";
import { makeDefaultRow, type OrderRow } from "../../core/orderSchema";
import { makeMelamineRow } from "../../core/melamineRows";
import { isEdgeInvalid } from "../../core/validators";
import { lineTotal, formatNumber } from "../../core/calculations";
import { formatMdfThickness, type Catalog } from "../../core/catalogSchema";
import { EDGE_KEYS, EDGE_LABELS, edgeOptions, parseEdge, type EdgeKey } from "../../core/melamine";

type NumberField = "width" | "height" | "qty" | "unitPrice" | "discount" | "vat";
type TextField = "designName" | "pvcCode" | "pvcColor" | "notes";
type SelectField = "designCode" | "mdfThickness" | "rotation" | EdgeKey;
type Field = NumberField | TextField | SelectField;

const HOP_ORDER: NumberField[] = ["width", "height", "qty"];

/** Edge numbering, seen from the front — the same picture ZINAX CAM uses. */
export function EdgeLegend() {
  return (
    <svg viewBox="0 0 132 78" className="h-[60px] w-[102px] shrink-0" role="img" aria-label="Edge 1 bottom, 2 top, 3 left, 4 right">
      <rect x="30" y="14" width="72" height="44" rx="2" className="fill-white stroke-ink-300" strokeWidth="1.5" />
      <line x1="30" y1="58" x2="102" y2="58" className="stroke-gold-500" strokeWidth="3" />
      <line x1="30" y1="14" x2="102" y2="14" className="stroke-gold-500" strokeWidth="3" />
      <line x1="30" y1="14" x2="30" y2="58" className="stroke-navy-600" strokeWidth="3" />
      <line x1="102" y1="14" x2="102" y2="58" className="stroke-navy-600" strokeWidth="3" />
      <text x="66" y="74" textAnchor="middle" className="fill-ink-700 text-[10px] font-semibold">E1 bottom</text>
      <text x="66" y="10" textAnchor="middle" className="fill-ink-700 text-[10px] font-semibold">E2 top</text>
      <text x="26" y="40" textAnchor="end" className="fill-ink-700 text-[10px] font-semibold">E3</text>
      <text x="106" y="40" className="fill-ink-700 text-[10px] font-semibold">E4</text>
    </svg>
  );
}

interface MelamineOrderTableProps {
  rows: OrderRow[];
  onChangeRows: (rows: OrderRow[]) => void;
  invoiceMode: boolean;
  currency: string;
  catalog: Catalog;
}

export default function MelamineOrderTable({ rows, onChangeRows, invoiceMode, currency, catalog }: MelamineOrderTableProps) {
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusRowId = useRef<string | null>(null);
  const bands = catalog.edgeBands ?? [];
  const options = edgeOptions(bands);

  useEffect(() => {
    const id = pendingFocusRowId.current;
    if (!id) return;
    inputRefs.current.get(`${id}:width`)?.focus();
    pendingFocusRowId.current = null;
  }, [rows]);

  const registerRef = (rowId: string, field: Field) => (el: HTMLInputElement | null) => {
    const key = `${rowId}:${field}`;
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  };

  const update = (id: string, field: Field, value: string) => {
    onChangeRows(
      rows.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value } as OrderRow;
        if (field === "designCode") {
          const match = catalog.designs.find((d) => d.code === value);
          if (match && !r.designName) next.designName = match.name;
        }
        // Store the canonical spelling (s/p1 → S/P1) when the code is known.
        if ((EDGE_KEYS as readonly string[]).includes(field)) {
          const parsed = parseEdge(value, bands);
          if (parsed.known) next[field as EdgeKey] = parsed.text;
        }
        return next;
      })
    );
  };

  const addRow = () => {
    const row = makeMelamineRow(rows[rows.length - 1]);
    onChangeRows([...rows, row]);
    pendingFocusRowId.current = row.id;
  };

  const duplicateRow = (id: string) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const copy = makeDefaultRow({ ...rows[idx], id: undefined });
    const next = [...rows];
    next.splice(idx + 1, 0, copy);
    onChangeRows(next);
  };

  const deleteRow = (id: string) => onChangeRows(rows.filter((r) => r.id !== id));

  /** Every edge of the row set to one value — the common "band all round" case. */
  const setAllEdges = (id: string, value: string) =>
    onChangeRows(rows.map((r) => (r.id === id ? { ...r, edge1: value, edge2: value, edge3: value, edge4: value } : r)));

  const setAllRotation = (value: "Y" | "N") => onChangeRows(rows.map((r) => ({ ...r, rotation: value })));

  const numberInput = (row: OrderRow, field: NumberField, minW: string) => {
    const hop = HOP_ORDER.includes(field) ? field : null;
    const onKeyDown = hop
      ? (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const nextIdx = HOP_ORDER.indexOf(hop) + 1;
          if (nextIdx < HOP_ORDER.length) inputRefs.current.get(`${row.id}:${HOP_ORDER[nextIdx]}`)?.focus();
          else addRow();
        }
      : undefined;
    const value = row[field];
    const required = field === "width" || field === "height" || field === "qty";
    const invalid = required && (value === "" || Number(value) <= 0);
    return (
      <input
        ref={hop ? registerRef(row.id, hop) : undefined}
        type="number"
        value={value}
        onChange={(e) => update(row.id, field, e.target.value)}
        onKeyDown={onKeyDown}
        className={`zx-cell-input text-right ${minW} ${invalid ? "invalid" : ""}`}
      />
    );
  };

  const textInput = (row: OrderRow, field: TextField, minW = "") => (
    <input value={row[field]} onChange={(e) => update(row.id, field, e.target.value)} className={`zx-cell-input ${minW}`} />
  );

  const edgeSelect = (row: OrderRow, key: EdgeKey) => {
    const value = row[key] || "N";
    const invalid = isEdgeInvalid(row, key, catalog);
    // Keep an unknown or inactive stored code visible instead of blanking the select.
    const list = options.includes(value) ? options : [...options, value];
    const hasBand = parseEdge(value, bands).band !== null;
    return (
      <select
        value={value}
        title={invalid ? `"${value}" is not in the edge band list` : `${EDGE_LABELS[key].side} edge`}
        onChange={(e) => update(row.id, key, e.target.value)}
        className={`zx-cell-input min-w-[76px] ${invalid ? "invalid" : ""} ${hasBand ? "font-semibold text-navy-700" : ""}`}
      >
        {list.map((o) => (
          <option key={o} value={o}>
            {o === value && invalid ? `Unknown: ${o}` : o}
          </option>
        ))}
      </select>
    );
  };

  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalLine = rows.reduce((s, r) => s + lineTotal(r), 0);
  const hasInvalid = rows.some(
    (r) =>
      r.width === "" || Number(r.width) <= 0 || r.height === "" || Number(r.height) <= 0 || r.qty === "" || Number(r.qty) <= 0 ||
      EDGE_KEYS.some((k) => isEdgeInvalid(r, k, catalog)) || (r.rotation !== "Y" && r.rotation !== "N")
  );
  const activeDesigns = catalog.designs.filter((d) => d.active);
  const allLocked = rows.length > 0 && rows.every((r) => r.rotation === "N");

  return (
    <div className="zx-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div className="flex items-center gap-4">
          <EdgeLegend />
          <div>
            <h3 className="text-sm font-bold text-ink-900">Melamine Panels</h3>
            <p className="mt-0.5 max-w-[560px] text-xs text-ink-500">
              Enter the finished size. Each edge is N (none), a band code (P1…), S (groove mark) or S/P1 (groove + band).
              ZINAX CAM subtracts the band thickness for the cut size. Rotation: Y may turn 90° on the sheet, N stays as drawn.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasInvalid && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-2xs font-semibold text-red-600 ring-1 ring-red-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Check highlighted cells
            </span>
          )}
          {rows.length > 0 && (
            <button onClick={() => setAllRotation(allLocked ? "Y" : "N")} className="zx-btn-secondary !py-1.5" title="Set rotation for every panel">
              {allLocked ? <RotateCw className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {allLocked ? "All may rotate" : "Lock all"}
            </button>
          )}
          <button onClick={addRow} className="zx-btn-primary !py-1.5">
            <Plus className="h-4 w-4" />
            Add Panel
          </button>
        </div>
      </div>

      <div className="max-h-[480px] overflow-auto">
        <table className="border-collapse">
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="zx-th sticky left-0 z-20 w-12 bg-ink-50">No.</th>
              <th className="zx-th min-w-[120px]">Part name</th>
              <th className="zx-th min-w-[88px] text-right">Width mm</th>
              <th className="zx-th min-w-[88px] text-right">Height mm</th>
              <th className="zx-th min-w-[72px] text-right">Qty</th>
              <th className="zx-th">Thickness</th>
              <th className="zx-th min-w-[100px]">Color code</th>
              <th className="zx-th">Color</th>
              {EDGE_KEYS.map((k) => (
                <th key={k} className="zx-th" title={`${EDGE_LABELS[k].side} edge`}>
                  {EDGE_LABELS[k].short} <span className="font-normal text-ink-400">{EDGE_LABELS[k].side}</span>
                </th>
              ))}
              <th className="zx-th min-w-[124px]">Rotation</th>
              <th className="zx-th min-w-[96px]" title="Optional — blank is a plain panel">Design</th>
              {invoiceMode && (
                <>
                  <th className="zx-th min-w-[96px] text-right">Price</th>
                  <th className="zx-th min-w-[80px] text-right">Disc %</th>
                  <th className="zx-th min-w-[72px] text-right">VAT %</th>
                  <th className="zx-th w-32 text-right">Line Total ({currency})</th>
                </>
              )}
              <th className="zx-th w-48">Notes</th>
              <th className="zx-th sticky right-0 z-20 w-24 bg-ink-50 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} className="group hover:bg-navy-50/30">
                <td className="zx-td sticky left-0 z-10 bg-white text-center font-semibold text-ink-500 group-hover:bg-navy-50/30">{idx + 1}</td>
                <td className="zx-td p-1">{textInput(row, "designName", "min-w-[120px]")}</td>
                <td className="zx-td p-1">{numberInput(row, "width", "min-w-[88px]")}</td>
                <td className="zx-td p-1">{numberInput(row, "height", "min-w-[88px]")}</td>
                <td className="zx-td p-1">{numberInput(row, "qty", "min-w-[72px]")}</td>
                <td className="zx-td p-1">
                  <select value={row.mdfThickness} onChange={(e) => update(row.id, "mdfThickness", e.target.value)} className="zx-cell-input">
                    {catalog.mdfThickness
                      .filter((m) => m.active)
                      .map((m) => (
                        <option key={m.thicknessMm} value={formatMdfThickness(m)}>
                          {formatMdfThickness(m)}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="zx-td p-1">{textInput(row, "pvcCode", "min-w-[100px]")}</td>
                <td className="zx-td p-1">{textInput(row, "pvcColor")}</td>
                {EDGE_KEYS.map((k, i) => (
                  <td key={k} className="zx-td p-1">
                    <div className="flex items-center gap-0.5">
                      {edgeSelect(row, k)}
                      {i === 0 && (
                        <button
                          onClick={() => setAllEdges(row.id, row.edge1 || "N")}
                          title="Copy E1 to all four edges"
                          className="zx-btn-ghost !px-1 !py-0.5 text-2xs"
                        >
                          ×4
                        </button>
                      )}
                    </div>
                  </td>
                ))}
                <td className="zx-td p-1">
                  <select
                    value={row.rotation}
                    onChange={(e) => update(row.id, "rotation", e.target.value)}
                    className={`zx-cell-input min-w-[124px] ${row.rotation !== "Y" && row.rotation !== "N" ? "invalid" : ""}`}
                  >
                    <option value="Y">Y · rotate</option>
                    <option value="N">N · locked</option>
                    {row.rotation !== "Y" && row.rotation !== "N" && <option value={row.rotation}>Unknown: {row.rotation}</option>}
                  </select>
                </td>
                <td className="zx-td p-1">
                  <select value={row.designCode} onChange={(e) => update(row.id, "designCode", e.target.value)} className="zx-cell-input min-w-[96px]">
                    <option value="">Plain</option>
                    {activeDesigns.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.code}
                      </option>
                    ))}
                    {row.designCode && !activeDesigns.some((d) => d.code === row.designCode) && (
                      <option value={row.designCode}>{row.designCode} (inactive)</option>
                    )}
                  </select>
                </td>
                {invoiceMode && (
                  <>
                    <td className="zx-td p-1">{numberInput(row, "unitPrice", "min-w-[96px]")}</td>
                    <td className="zx-td p-1">{numberInput(row, "discount", "min-w-[80px]")}</td>
                    <td className="zx-td p-1">{numberInput(row, "vat", "min-w-[72px]")}</td>
                    <td className="zx-td text-right font-semibold tabular-nums text-ink-900">{formatNumber(lineTotal(row))}</td>
                  </>
                )}
                <td className="zx-td p-1">{textInput(row, "notes")}</td>
                <td className="zx-td sticky right-0 z-10 bg-white text-right group-hover:bg-navy-50/30">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => duplicateRow(row.id)} title="Duplicate panel" className="zx-btn-ghost !px-1.5 !py-1">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteRow(row.id)} title="Delete panel" className="zx-btn-danger !px-1.5 !py-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={16} className="px-5 py-10 text-center text-sm text-ink-400">
                  No melamine panels yet. Click "Add Panel" to start.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 bg-ink-50 font-semibold">
                <td className="zx-td sticky left-0 bg-ink-50 text-ink-700" colSpan={4}>
                  Total
                </td>
                <td className="zx-td text-right tabular-nums text-ink-900">{totalQty}</td>
                <td className="zx-td" colSpan={9}></td>
                {invoiceMode && <td className="zx-td" colSpan={3}></td>}
                {invoiceMode && (
                  <td className="zx-td text-right tabular-nums text-ink-900">
                    {currency} {formatNumber(totalLine)}
                  </td>
                )}
                <td className="zx-td"></td>
                <td className="zx-td sticky right-0 bg-ink-50"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
