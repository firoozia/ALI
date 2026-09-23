import { Plus, Copy, Trash2, AlertTriangle } from "lucide-react";
import { ORDER_ROW_COLUMNS, makeDefaultRow, type OrderRow, type OrderRowColumn } from "../../core/orderSchema";
import { isRowFieldInvalid, rowHasErrors } from "../../core/validators";
import { lineTotal, formatNumber } from "../../core/calculations";
import { formatMdfThickness, type Catalog } from "../../core/catalogSchema";

/** Active options, plus the row's current value even if it has since been deactivated (so the select never silently blanks out an existing selection). */
function withCurrentValue<T>(activeItems: T[], currentValue: string, codeOf: (item: T) => string, makeFallback: (code: string) => T): T[] {
  if (!currentValue || activeItems.some((item) => codeOf(item) === currentValue)) return activeItems;
  return [...activeItems, makeFallback(currentValue)];
}

// No., 12 schema-driven columns, computed Line Total, Notes, Actions.
const TOTAL_COLUMN_COUNT = 1 + ORDER_ROW_COLUMNS.length + 1 + 1 + 1;

type UpdateFieldFn = (id: string, field: keyof OrderRow, value: string) => void;

interface CellInputProps {
  row: OrderRow;
  field: keyof OrderRow;
  type?: "text" | "number";
  onChange: UpdateFieldFn;
  className?: string;
  disabled?: boolean;
}

function CellInput({ row, field, type = "text", onChange, className = "", disabled = false }: CellInputProps) {
  const invalid = isRowFieldInvalid(row, field);
  return (
    <input
      type={type}
      value={row[field]}
      disabled={disabled}
      onChange={(e) => onChange(row.id, field, e.target.value)}
      className={`zx-cell-input ${invalid ? "invalid" : ""} ${disabled ? "opacity-40" : ""} ${className}`}
    />
  );
}

function renderEditor(col: OrderRowColumn, row: OrderRow, updateField: UpdateFieldFn, disabled: boolean, catalog: Catalog) {
  const selectClass = `zx-cell-input ${disabled ? "opacity-40" : ""}`;
  switch (col.editor) {
    case "select-design": {
      const options = withCurrentValue(
        catalog.designs.filter((d) => d.active),
        row.designCode,
        (d) => d.code,
        (code) => ({ id: code, code, name: "", family: "", description: "", minWidthMm: 0, maxWidthMm: 0, minHeightMm: 0, maxHeightMm: 0, active: false })
      );
      return (
        <select
          value={row.designCode}
          disabled={disabled}
          onChange={(e) => updateField(row.id, "designCode", e.target.value)}
          className={`${selectClass} ${isRowFieldInvalid(row, "designCode") ? "invalid" : ""}`}
        >
          <option value="">Select...</option>
          {options.map((d) => (
            <option key={d.code} value={d.code}>
              {d.code}
              {!d.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      );
    }
    case "select-pvc": {
      const options = withCurrentValue(
        catalog.pvcColors.filter((p) => p.active),
        row.pvcCode,
        (p) => p.code,
        (code) => ({ id: code, code, color: "", category: "", finish: "", active: false })
      );
      return (
        <select
          value={row.pvcCode}
          disabled={disabled}
          onChange={(e) => updateField(row.id, "pvcCode", e.target.value)}
          className={selectClass}
        >
          <option value="">Select...</option>
          {options.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code}
              {!p.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      );
    }
    case "select-mdf":
      return (
        <select
          value={row.mdfThickness}
          disabled={disabled}
          onChange={(e) => updateField(row.id, "mdfThickness", e.target.value)}
          className={selectClass}
        >
          {catalog.mdfThickness
            .filter((m) => m.active)
            .map((m) => {
              const label = formatMdfThickness(m);
              return (
                <option key={m.thicknessMm} value={label}>
                  {label}
                </option>
              );
            })}
        </select>
      );
    case "select-grain":
      return (
        <select
          value={row.grain}
          disabled={disabled}
          onChange={(e) => updateField(row.id, "grain", e.target.value)}
          className={selectClass}
        >
          {catalog.grainDirections
            .filter((g) => g.active)
            .map((g) => (
              <option key={g.code} value={g.label}>
                {g.label}
              </option>
            ))}
        </select>
      );
    case "number":
      return (
        <CellInput row={row} field={col.key} type="number" onChange={updateField} disabled={disabled} className="text-right" />
      );
    default:
      return <CellInput row={row} field={col.key} onChange={updateField} disabled={disabled} />;
  }
}

interface DoorOrderTableProps {
  rows: OrderRow[];
  onChangeRows: (rows: OrderRow[]) => void;
  invoiceMode: boolean;
  currency: string;
  catalog: Catalog;
}

export default function DoorOrderTable({ rows, onChangeRows, invoiceMode, currency, catalog }: DoorOrderTableProps) {
  const updateField: UpdateFieldFn = (id, field, value) => {
    onChangeRows(
      rows.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value } as OrderRow;
        if (field === "designCode") {
          const match = catalog.designs.find((d) => d.code === value);
          if (match) next.designName = match.name;
        }
        if (field === "pvcCode") {
          const match = catalog.pvcColors.find((p) => p.code === value);
          if (match) next.pvcColor = match.color;
        }
        return next;
      })
    );
  };

  const addRow = () => onChangeRows([...rows, makeDefaultRow()]);

  const duplicateRow = (id: string) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const copy = makeDefaultRow({ ...rows[idx], id: undefined });
    const next = [...rows];
    next.splice(idx + 1, 0, copy);
    onChangeRows(next);
  };

  const deleteRow = (id: string) => onChangeRows(rows.filter((r) => r.id !== id));

  const hasInvalid = rows.some(rowHasErrors);
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
              {ORDER_ROW_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`zx-th ${col.align === "right" ? "text-right" : ""} ${
                    col.invoiceOnly && !invoiceMode ? "text-ink-300" : ""
                  }`}
                >
                  {col.label}
                </th>
              ))}
              <th className={`zx-th w-32 text-right ${!invoiceMode ? "text-ink-300" : ""}`}>Line Total</th>
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
                {ORDER_ROW_COLUMNS.map((col) => {
                  const disabled = Boolean(col.invoiceOnly) && !invoiceMode;
                  return (
                    <td key={col.key} className="zx-td p-1">
                      {renderEditor(col, row, updateField, disabled, catalog)}
                    </td>
                  );
                })}
                <td
                  className={`zx-td text-right font-semibold tabular-nums ${
                    invoiceMode ? "text-ink-900" : "text-ink-300"
                  }`}
                >
                  {currency} {formatNumber(lineTotal(row))}
                </td>
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
                <td colSpan={TOTAL_COLUMN_COUNT} className="px-5 py-10 text-center text-sm text-ink-400">
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
                <td className="zx-td" colSpan={3}></td>
                <td
                  className={`zx-td text-right tabular-nums ${invoiceMode ? "text-ink-900" : "text-ink-300"}`}
                >
                  {currency} {formatNumber(totalLine)}
                </td>
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
