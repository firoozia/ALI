import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Plus, Copy, Trash2 } from "lucide-react";
import { isMelamineItem, type CustomerPortalItem, type PublicDesign, type PublicColor, type PublicEdgeBand } from "../../core/publicCatalogSchema";
import { EDGE_KEYS, EDGE_LABELS, edgeOptions, parseEdge, type EdgeBandCatalogItem } from "../../core/melamine";
import { EdgeLegend } from "../order/MelamineOrderTable";

function makeItem(source?: Partial<CustomerPortalItem>): CustomerPortalItem {
  const item: CustomerPortalItem = {
    designCode: source?.designCode ?? "",
    width: 0,
    height: 0,
    qty: 1,
    colorCode: source?.colorCode ?? "",
    direction: source?.direction ?? "",
  };
  if (source?.productType === "melamine") {
    Object.assign(item, {
      productType: "melamine",
      edge1: source.edge1 ?? "N",
      edge2: source.edge2 ?? "N",
      edge3: source.edge3 ?? "N",
      edge4: source.edge4 ?? "N",
      rotation: source.rotation ?? "Y",
    });
  }
  return item;
}

/** The public band list in the shape the shared edge helpers expect. */
function toCatalogBands(bands: PublicEdgeBand[]): EdgeBandCatalogItem[] {
  return bands.map((b) => ({ id: b.code, code: b.code, name: b.name, thicknessMm: b.thicknessMm, widthMm: 0, color: "", active: b.active }));
}

// Same three-field fast-entry hop as the factory app's Door Order Table:
// Enter in Width/Height jumps to the next field, Enter in Qty moves to the
// next row of the same table (or starts one).
type HopField = "width" | "height" | "qty";
const HOP_ORDER: HopField[] = ["width", "height", "qty"];

/** Which of the portal's two tables this is: vacuum doors or melamine panels. */
export type PortalItemKind = "door" | "melamine";

// Sized for the values they hold: sizes are up to four digits (2440), Qty up to three (999).
const SIZE_COL = "w-[72px] min-w-[72px] !px-2";
const QTY_COL = "w-[56px] min-w-[56px] !px-2";

interface CustomerItemsTableProps {
  /** Every item in the order; this table shows and edits only the ones of its `kind`. */
  items: CustomerPortalItem[];
  onChangeItems: (items: CustomerPortalItem[]) => void;
  kind: PortalItemKind;
  designs: PublicDesign[];
  colors: PublicColor[];
  /** Published edge bands (melamine table only). */
  edgeBands?: PublicEdgeBand[];
  readOnly?: boolean;
}

export default function CustomerItemsTable({ items, onChangeItems, kind, designs, colors, edgeBands = [], readOnly = false }: CustomerItemsTableProps) {
  const melamine = kind === "melamine";
  const bands = toCatalogBands(edgeBands);
  const options = edgeOptions(bands);
  // Indexes into `items` of the rows this table owns, in order.
  const own = items.flatMap((it, i) => (isMelamineItem(it) === melamine ? [i] : []));
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusIndex = useRef<number | null>(null);

  useEffect(() => {
    const idx = pendingFocusIndex.current;
    if (idx === null) return;
    inputRefs.current.get(`${idx}:width`)?.focus();
    pendingFocusIndex.current = null;
  }, [items]);

  const registerRef = (idx: number, field: HopField) => (el: HTMLInputElement | null) => {
    const key = `${idx}:${field}`;
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  };

  const focusField = (idx: number, field: HopField) => {
    inputRefs.current.get(`${idx}:${field}`)?.focus();
  };

  const update = (idx: number, patch: Partial<CustomerPortalItem>) => {
    onChangeItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  /** Carries this table's last row's design/color/direction (and edges) forward and focuses the new row's Width. */
  const addRow = () => {
    const last = own.length > 0 ? items[own[own.length - 1]] : undefined;
    const newItem = makeItem(melamine ? { ...last, productType: "melamine" } : last);
    onChangeItems([...items, newItem]);
    pendingFocusIndex.current = items.length;
  };

  const duplicateRow = (idx: number) => {
    const next = [...items];
    next.splice(idx + 1, 0, { ...items[idx] });
    onChangeItems(next);
  };

  const deleteRow = (idx: number) => onChangeItems(items.filter((_, i) => i !== idx));

  const hopKeyDown = (idx: number, field: HopField) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const nextIdx = HOP_ORDER.indexOf(field) + 1;
    if (nextIdx < HOP_ORDER.length) {
      focusField(idx, HOP_ORDER[nextIdx]);
      return;
    }
    const pos = own.indexOf(idx);
    if (pos === own.length - 1) addRow();
    else focusField(own[pos + 1], "width");
  };

  const totalQty = own.reduce((s, i) => s + (Number(items[i].qty) || 0), 0);
  const inputCls = readOnly ? "zx-cell-input opacity-60" : "zx-cell-input";
  const canAdd = melamine ? edgeBands.length > 0 : designs.length > 0;
  // No. + code + width + height + qty + color + (direction | 4 edges + rotation) + actions
  const columnCount = 6 + (melamine ? 5 : 1) + (readOnly ? 0 : 1);

  let hint: string;
  if (readOnly) hint = "This order can no longer be edited.";
  else if (!canAdd) hint = melamine ? "This factory hasn't published any edge bands yet." : "This factory hasn't published any design codes yet.";
  else hint = "Type sizes and press Enter to move Width → Height → Qty, then start the next row.";

  const numberCell = (idx: number, field: HopField) => (
    <input
      ref={registerRef(idx, field)}
      type="number"
      inputMode="numeric"
      value={items[idx][field] || ""}
      onChange={(e) => update(idx, { [field]: Number(e.target.value) || 0 })}
      onKeyDown={hopKeyDown(idx, field)}
      disabled={readOnly}
      className={`${inputCls} text-right tabular-nums`}
    />
  );

  return (
    <div className="zx-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div className="flex items-center gap-4">
          {melamine && <EdgeLegend />}
          <div>
            <h3 className="text-sm font-bold text-ink-900">{melamine ? "Melamine Panels" : "Vacuum Doors"}</h3>
            <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
          </div>
        </div>
        {!readOnly && (
          <button onClick={addRow} disabled={!canAdd} className="zx-btn-primary !py-1.5">
            <Plus className="h-4 w-4" />
            {melamine ? "Add Panel" : "Add Door"}
          </button>
        )}
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className={`w-full border-collapse ${melamine ? "min-w-[1000px]" : "min-w-[680px]"}`}>
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="zx-th w-10">No.</th>
              <th className={`zx-th ${melamine ? "min-w-[140px]" : "min-w-[160px]"}`}>{melamine ? "Design" : "Door Code"}</th>
              <th className={`zx-th text-right ${SIZE_COL}`}>Width</th>
              <th className={`zx-th text-right ${SIZE_COL}`}>Height</th>
              <th className={`zx-th text-right ${QTY_COL}`}>Qty</th>
              <th className={`zx-th ${melamine ? "min-w-[140px]" : "min-w-[160px]"}`}>Color Code</th>
              {!melamine && <th className="zx-th min-w-[110px]">Direction</th>}
              {melamine &&
                EDGE_KEYS.map((k) => (
                  <th key={k} className="zx-th min-w-[76px]" title={`${EDGE_LABELS[k].side} edge, seen from the front`}>
                    {EDGE_LABELS[k].short} <span className="font-normal text-ink-400">{EDGE_LABELS[k].side}</span>
                  </th>
                ))}
              {melamine && <th className="zx-th min-w-[110px]">Rotation</th>}
              {!readOnly && <th className="zx-th w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {own.map((idx, pos) => {
              const item = items[idx];
              return (
                <tr key={idx} className="group hover:bg-navy-50/30">
                  <td className="zx-td text-center font-semibold text-ink-500">{pos + 1}</td>
                  <td className="zx-td p-1">
                    <select
                      value={item.designCode}
                      onChange={(e) => update(idx, { designCode: e.target.value })}
                      className="zx-cell-input"
                      disabled={readOnly}
                    >
                      <option value="">{melamine ? "Plain panel" : "Select..."}</option>
                      {designs.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="zx-td p-1">{numberCell(idx, "width")}</td>
                  <td className="zx-td p-1">{numberCell(idx, "height")}</td>
                  <td className="zx-td p-1">{numberCell(idx, "qty")}</td>
                  <td className="zx-td p-1">
                    {colors.length > 0 ? (
                      <select
                        value={item.colorCode}
                        onChange={(e) => update(idx, { colorCode: e.target.value })}
                        className="zx-cell-input"
                        disabled={readOnly}
                      >
                        <option value="">Select...</option>
                        {colors.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} — {c.color}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={item.colorCode}
                        onChange={(e) => update(idx, { colorCode: e.target.value })}
                        placeholder="e.g. PVC-101"
                        disabled={readOnly}
                        className={inputCls}
                      />
                    )}
                  </td>
                  {!melamine && (
                    <td className="zx-td p-1">
                      <select
                        value={item.direction}
                        onChange={(e) => update(idx, { direction: e.target.value })}
                        className="zx-cell-input"
                        disabled={readOnly}
                      >
                        <option value="">Select...</option>
                        <option>Vertical</option>
                        <option>Horizontal</option>
                      </select>
                    </td>
                  )}
                  {melamine &&
                    EDGE_KEYS.map((k) => {
                      const value = item[k] || "N";
                      const known = parseEdge(value, bands).known;
                      const list = options.includes(value) ? options : [...options, value];
                      return (
                        <td key={k} className="zx-td p-1">
                          <select
                            value={value}
                            onChange={(e) => update(idx, { [k]: e.target.value })}
                            className={`zx-cell-input ${known ? "" : "invalid"}`}
                            disabled={readOnly}
                          >
                            {list.map((o) => (
                              <option key={o} value={o}>
                                {o === value && !known ? `Unknown: ${o}` : o}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  {melamine && (
                    <td className="zx-td p-1">
                      <select
                        value={item.rotation ?? "Y"}
                        onChange={(e) => update(idx, { rotation: e.target.value })}
                        className="zx-cell-input"
                        disabled={readOnly}
                      >
                        <option value="Y">Y · rotate</option>
                        <option value="N">N · locked</option>
                      </select>
                    </td>
                  )}
                  {!readOnly && (
                    <td className="zx-td">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => duplicateRow(idx)} title="Duplicate row" className="zx-btn-ghost !px-1.5 !py-1">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteRow(idx)} title="Delete row" className="zx-btn-danger !px-1.5 !py-1">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {own.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-5 py-8 text-center text-sm text-ink-400">
                  {readOnly
                    ? "None."
                    : melamine
                      ? 'No melamine panels. Click "Add Panel" if this order has cabinet parts.'
                      : 'No doors yet. Click "Add Door" to start.'}
                </td>
              </tr>
            )}
          </tbody>
          {own.length > 0 && (
            <tfoot>
              <tr className="bg-ink-50 font-semibold">
                <td className="zx-td text-ink-700" colSpan={4}>
                  Total
                </td>
                <td className="zx-td !px-2 text-right text-ink-900 tabular-nums">{totalQty}</td>
                <td className="zx-td" colSpan={columnCount - 5}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
