import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Plus, Copy, Trash2 } from "lucide-react";
import type { CustomerPortalItem, PublicDesign, PublicColor } from "../../core/publicCatalogSchema";

function makeItem(source?: Partial<CustomerPortalItem>): CustomerPortalItem {
  return {
    designCode: source?.designCode ?? "",
    width: 0,
    height: 0,
    qty: 1,
    colorCode: source?.colorCode ?? "",
    direction: source?.direction ?? "",
  };
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
  readOnly?: boolean;
}

export default function CustomerItemsTable({ items, onChangeItems, designs, colors, readOnly = false }: CustomerItemsTableProps) {
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
          <button onClick={addRow} disabled={designs.length === 0} className="zx-btn-primary !py-1.5">
            <Plus className="h-4 w-4" />
            Add Row
          </button>
        )}
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="zx-th w-10">No.</th>
              <th className="zx-th min-w-[180px]">Door Code</th>
              <th className="zx-th min-w-[90px] text-right">Width</th>
              <th className="zx-th min-w-[90px] text-right">Height</th>
              <th className="zx-th min-w-[72px] text-right">Qty</th>
              <th className="zx-th min-w-[170px]">Color Code</th>
              <th className="zx-th min-w-[110px]">Direction</th>
              {!readOnly && <th className="zx-th w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="group hover:bg-navy-50/30">
                <td className="zx-td text-center font-semibold text-ink-500">{idx + 1}</td>
                <td className="zx-td p-1">
                  <select
                    value={item.designCode}
                    onChange={(e) => update(idx, { designCode: e.target.value })}
                    className="zx-cell-input"
                    disabled={readOnly}
                  >
                    <option value="">Select...</option>
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
                <td colSpan={readOnly ? 7 : 8} className="px-5 py-10 text-center text-sm text-ink-400">
                  {readOnly ? "No items." : 'No items yet. Click "Add Row" to start building your order.'}
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="bg-ink-50 font-semibold">
                <td className="zx-td text-ink-700" colSpan={4}>
                  Total
                </td>
                <td className="zx-td text-right text-ink-900 tabular-nums">{totalQty}</td>
                <td className="zx-td" colSpan={readOnly ? 2 : 3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
