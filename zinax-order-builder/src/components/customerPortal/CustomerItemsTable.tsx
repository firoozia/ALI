import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Plus, Copy, Trash2 } from "lucide-react";
import type { CustomerPortalItem, PublicDesign, PublicColor, PublicEdgeBand } from "../../core/publicCatalogSchema";
import { EDGE_KEYS, EDGE_LABELS, edgeOptions, parseEdge, type EdgeBandCatalogItem } from "../../core/melamine";

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
// Enter in Width/Height jumps to the next field, Enter in Qty starts a new row.
type HopField = "width" | "height" | "qty";
const HOP_ORDER: HopField[] = ["width", "height", "qty"];

interface CustomerItemsTableProps {
  items: CustomerPortalItem[];
  onChangeItems: (items: CustomerPortalItem[]) => void;
  designs: PublicDesign[];
  colors: PublicColor[];
  /** Published edge bands. When there are none, melamine panels are not offered. */
  edgeBands?: PublicEdgeBand[];
  readOnly?: boolean;
}

export default function CustomerItemsTable({ items, onChangeItems, designs, colors, edgeBands = [], readOnly = false }: CustomerItemsTableProps) {
  const bands = toCatalogBands(edgeBands);
  const options = edgeOptions(bands);
  // A submitted order that already has panels still shows them read-only, even if bands were unpublished since.
  const melamineEnabled = edgeBands.length > 0 || items.some((it) => it.productType === "melamine");
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

  const setType = (idx: number, type: "vacuum_door" | "melamine") => {
    if (type === "melamine") {
      update(idx, { productType: "melamine", edge1: "N", edge2: "N", edge3: "N", edge4: "N", rotation: "Y", direction: "" });
    } else {
      onChangeItems(
        items.map((it, i) => {
          if (i !== idx) return it;
          const { productType: _p, edge1: _1, edge2: _2, edge3: _3, edge4: _4, rotation: _r, ...door } = it;
          return door;
        })
      );
    }
  };

  /** Carries the last row's design/color/direction forward and focuses the new row's Width — same fast repeat-entry as the factory app. */
  const addRow = () => {
    const newItem = makeItem(items[items.length - 1]);
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
    } else if (idx === items.length - 1) {
      addRow();
    } else {
      focusField(idx + 1, "width");
    }
  };

  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const inputCls = readOnly ? "zx-cell-input opacity-60" : "zx-cell-input";

  return (
    <div className="zx-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900">Order Items</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {designs.length === 0
              ? "This factory hasn't published any design codes yet."
              : readOnly
                ? "This order can no longer be edited."
                : "Type sizes and press Enter to move Width → Height → Qty, then start the next row."}
          </p>
        </div>
        {!readOnly && (
          <button onClick={addRow} disabled={designs.length === 0 && !melamineEnabled} className="zx-btn-primary !py-1.5">
            <Plus className="h-4 w-4" />
            Add Row
          </button>
        )}
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className={`w-full border-collapse ${melamineEnabled ? "min-w-[1180px]" : "min-w-[680px]"}`}>
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="zx-th w-10">No.</th>
              {melamineEnabled && <th className="zx-th min-w-[120px]">Type</th>}
              <th className="zx-th min-w-[180px]">{melamineEnabled ? "Code" : "Door Code"}</th>
              <th className="zx-th min-w-[90px] text-right">Width</th>
              <th className="zx-th min-w-[90px] text-right">Height</th>
              <th className="zx-th min-w-[72px] text-right">Qty</th>
              <th className="zx-th min-w-[170px]">Color Code</th>
              <th className="zx-th min-w-[110px]">Direction</th>
              {melamineEnabled &&
                EDGE_KEYS.map((k) => (
                  <th key={k} className="zx-th min-w-[84px]" title={`${EDGE_LABELS[k].side} edge, seen from the front`}>
                    {EDGE_LABELS[k].short} <span className="font-normal text-ink-400">{EDGE_LABELS[k].side}</span>
                  </th>
                ))}
              {melamineEnabled && <th className="zx-th min-w-[110px]">Rotation</th>}
              {!readOnly && <th className="zx-th w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="group hover:bg-navy-50/30">
                <td className="zx-td text-center font-semibold text-ink-500">{idx + 1}</td>
                {melamineEnabled && (
                  <td className="zx-td p-1">
                    <select
                      value={item.productType === "melamine" ? "melamine" : "vacuum_door"}
                      onChange={(e) => setType(idx, e.target.value as "vacuum_door" | "melamine")}
                      className="zx-cell-input"
                      disabled={readOnly}
                    >
                      <option value="vacuum_door">Door</option>
                      <option value="melamine">Melamine panel</option>
                    </select>
                  </td>
                )}
                <td className="zx-td p-1">
                  <select
                    value={item.designCode}
                    onChange={(e) => update(idx, { designCode: e.target.value })}
                    className="zx-cell-input"
                    disabled={readOnly}
                  >
                    <option value="">{item.productType === "melamine" ? "Plain panel" : "Select..."}</option>
                    {designs.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="zx-td p-1">
                  <input
                    ref={registerRef(idx, "width")}
                    type="number"
                    value={item.width || ""}
                    onChange={(e) => update(idx, { width: Number(e.target.value) || 0 })}
                    onKeyDown={hopKeyDown(idx, "width")}
                    disabled={readOnly}
                    className={`${inputCls} text-right`}
                  />
                </td>
                <td className="zx-td p-1">
                  <input
                    ref={registerRef(idx, "height")}
                    type="number"
                    value={item.height || ""}
                    onChange={(e) => update(idx, { height: Number(e.target.value) || 0 })}
                    onKeyDown={hopKeyDown(idx, "height")}
                    disabled={readOnly}
                    className={`${inputCls} text-right`}
                  />
                </td>
                <td className="zx-td p-1">
                  <input
                    ref={registerRef(idx, "qty")}
                    type="number"
                    value={item.qty || ""}
                    onChange={(e) => update(idx, { qty: Number(e.target.value) || 0 })}
                    onKeyDown={hopKeyDown(idx, "qty")}
                    disabled={readOnly}
                    className={`${inputCls} text-right`}
                  />
                </td>
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
                <td className="zx-td p-1">
                  {item.productType === "melamine" ? (
                    <span className="px-2 text-ink-400">—</span>
                  ) : (
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
                  )}
                </td>
                {melamineEnabled &&
                  EDGE_KEYS.map((k) => {
                    if (item.productType !== "melamine") {
                      return (
                        <td key={k} className="zx-td p-1 px-2 text-ink-400">
                          —
                        </td>
                      );
                    }
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
                {melamineEnabled && (
                  <td className="zx-td p-1">
                    {item.productType === "melamine" ? (
                      <select
                        value={item.rotation ?? "Y"}
                        onChange={(e) => update(idx, { rotation: e.target.value })}
                        className="zx-cell-input"
                        disabled={readOnly}
                      >
                        <option value="Y">Y · rotate</option>
                        <option value="N">N · locked</option>
                      </select>
                    ) : (
                      <span className="px-2 text-ink-400">—</span>
                    )}
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
            ))}

            {items.length === 0 && (
              <tr>
                <td colSpan={(readOnly ? 7 : 8) + (melamineEnabled ? 6 : 0)} className="px-5 py-10 text-center text-sm text-ink-400">
                  {readOnly ? "No items." : 'No items yet. Click "Add Row" to start building your order.'}
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="bg-ink-50 font-semibold">
                <td className="zx-td text-ink-700" colSpan={melamineEnabled ? 5 : 4}>
                  Total
                </td>
                <td className="zx-td text-right text-ink-900 tabular-nums">{totalQty}</td>
                <td className="zx-td" colSpan={(readOnly ? 2 : 3) + (melamineEnabled ? 5 : 0)}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
