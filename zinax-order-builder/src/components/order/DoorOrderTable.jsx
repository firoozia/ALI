import { Plus, Copy, Trash2, AlertTriangle } from "lucide-react";
import {
  DESIGN_LIBRARY,
  GRAIN_DIRECTIONS,
  MDF_THICKNESS,
  PVC_COLORS,
  makeDefaultRow,
} from "../../data/mockData";
import { lineTotal, formatNumber } from "../../lib/calc";

const REQUIRED_FIELDS = ["designCode", "width", "height", "qty"];

function isInvalid(row, field) {
  const value = row[field];
  return REQUIRED_FIELDS.includes(field) && (value === "" || value === null || value === undefined);
}

function CellInput({ row, field, type = "text", onChange, className = "", ...rest }) {
  const invalid = isInvalid(row, field);
  return (
    <input
      type={type}
      value={row[field]}
      onChange={(e) => onChange(row.id, field, e.target.value)}
      className={`zx-cell-input ${invalid ? "invalid" : ""} ${className}`}
      {...rest}
    />
  );
}

export default function DoorOrderTable({ rows, onChangeRows, invoiceMode, currency }) {
  const updateField = (id, field, value) => {
    onChangeRows(
      rows.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        if (field === "designCode") {
          const match = DESIGN_LIBRARY.find((d) => d.code === value);
          if (match) next.designName = match.name;
        }
        if (field === "pvcCode") {
          const match = PVC_COLORS.find((p) => p.code === value);
          if (match) next.pvcColor = match.color;
        }
        return next;
      })
    );
  };

  const addRow = () => onChangeRows([...rows, makeDefaultRow()]);

  const duplicateRow = (id) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const copy = makeDefaultRow({ ...rows[idx], id: undefined });
    const next = [...rows];
    next.splice(idx + 1, 0, copy);
    onChangeRows(next);
  };

  const deleteRow = (id) => onChangeRows(rows.filter((r) => r.id !== id));

  const hasInvalid = rows.some((r) => REQUIRED_FIELDS.some((f) => isInvalid(r, f)));
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalLine = rows.reduce((s, r) => s + lineTotal(r), 0);

  return (
    <div className="zx-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900">Door Order Table</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Spreadsheet-style entry — click any cell to edit inline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasInvalid && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-2xs font-semibold text-red-600 ring-1 ring-red-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Missing required fields
            </span>
          )}
          <button onClick={addRow} className="zx-btn-primary !py-1.5">
            <Plus className="h-4 w-4" />
            Add Row
          </button>
        </div>
      </div>

      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[1500px] border-collapse">
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="zx-th sticky left-0 z-20 w-12 bg-ink-50">No.</th>
              <th className="zx-th w-28">Design Code</th>
              <th className="zx-th w-48">Design Name</th>
              <th className="zx-th w-24 text-right">Width mm</th>
              <th className="zx-th w-24 text-right">Height mm</th>
              <th className="zx-th w-16 text-right">Qty</th>
              <th className="zx-th w-28">MDF Thickness</th>
              <th className="zx-th w-24">PVC Code</th>
              <th className="zx-th w-32">PVC Color</th>
              <th className="zx-th w-28">Grain Direction</th>
              {invoiceMode && (
                <>
                  <th className="zx-th w-28 text-right">Unit Price</th>
                  <th className="zx-th w-20 text-right">Discount %</th>
                  <th className="zx-th w-20 text-right">VAT %</th>
                  <th className="zx-th w-32 text-right">Line Total</th>
                </>
              )}
              <th className="zx-th w-48">Notes</th>
              <th className="zx-th sticky right-0 z-20 w-24 bg-ink-50 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} className="group hover:bg-navy-50/30">
                <td className="zx-td sticky left-0 z-10 bg-white text-center font-semibold text-ink-500 group-hover:bg-navy-50/30">
                  {idx + 1}
                </td>
                <td className="zx-td p-1">
                  <select
                    value={row.designCode}
                    onChange={(e) => updateField(row.id, "designCode", e.target.value)}
                    className={`zx-cell-input ${isInvalid(row, "designCode") ? "invalid" : ""}`}
                  >
                    <option value="">Select...</option>
                    {DESIGN_LIBRARY.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="zx-td p-1">
                  <CellInput row={row} field="designName" onChange={updateField} />
                </td>
                <td className="zx-td p-1">
                  <CellInput row={row} field="width" type="number" onChange={updateField} className="text-right" />
                </td>
                <td className="zx-td p-1">
                  <CellInput row={row} field="height" type="number" onChange={updateField} className="text-right" />
                </td>
                <td className="zx-td p-1">
                  <CellInput row={row} field="qty" type="number" onChange={updateField} className="text-right" />
                </td>
                <td className="zx-td p-1">
                  <select
                    value={row.mdfThickness}
                    onChange={(e) => updateField(row.id, "mdfThickness", e.target.value)}
                    className="zx-cell-input"
                  >
                    {MDF_THICKNESS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="zx-td p-1">
                  <select
                    value={row.pvcCode}
                    onChange={(e) => updateField(row.id, "pvcCode", e.target.value)}
                    className="zx-cell-input"
                  >
                    <option value="">Select...</option>
                    {PVC_COLORS.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="zx-td p-1">
                  <CellInput row={row} field="pvcColor" onChange={updateField} />
                </td>
                <td className="zx-td p-1">
                  <select
                    value={row.grain}
                    onChange={(e) => updateField(row.id, "grain", e.target.value)}
                    className="zx-cell-input"
                  >
                    {GRAIN_DIRECTIONS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </td>

                {invoiceMode && (
                  <>
                    <td className="zx-td p-1">
                      <CellInput row={row} field="unitPrice" type="number" onChange={updateField} className="text-right" />
                    </td>
                    <td className="zx-td p-1">
                      <CellInput row={row} field="discount" type="number" onChange={updateField} className="text-right" />
                    </td>
                    <td className="zx-td p-1">
                      <CellInput row={row} field="vat" type="number" onChange={updateField} className="text-right" />
                    </td>
                    <td className="zx-td text-right font-semibold text-ink-900 tabular-nums">
                      {currency} {formatNumber(lineTotal(row))}
                    </td>
                  </>
                )}

                <td className="zx-td p-1">
                  <CellInput row={row} field="notes" onChange={updateField} />
                </td>
                <td className="zx-td sticky right-0 z-10 bg-white text-right group-hover:bg-navy-50/30">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => duplicateRow(row.id)} title="Duplicate row" className="zx-btn-ghost !px-1.5 !py-1">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteRow(row.id)} title="Delete row" className="zx-btn-danger !px-1.5 !py-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={16} className="px-5 py-10 text-center text-sm text-ink-400">
                  No rows yet. Click "Add Row" to start building this order.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 bg-ink-50 font-semibold">
                <td className="zx-td sticky left-0 bg-ink-50 text-ink-700" colSpan={5}>
                  Total
                </td>
                <td className="zx-td text-right text-ink-900 tabular-nums">{totalQty}</td>
                <td className="zx-td" colSpan={4}></td>
                {invoiceMode && (
                  <>
                    <td className="zx-td" colSpan={3}></td>
                    <td className="zx-td text-right text-ink-900 tabular-nums">
                      {currency} {formatNumber(totalLine)}
                    </td>
                  </>
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
