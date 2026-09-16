// Shared order data model.
// In the real product this file (and the rest of src/core) is the mock
// stand-in for `zinax_order_core` — the package the Web edition (React +
// FastAPI) and the Windows edition (PySide6) will both import so that the
// order schema, validation, and calculations never diverge between them.
// UI components must read column/field definitions from here rather than
// hard-coding their own copy.

export type GrainDirection = "Vertical" | "Horizontal";

export interface OrderRow {
  id: string;
  designCode: string;
  designName: string;
  width: number | "";
  height: number | "";
  qty: number | "";
  mdfThickness: string;
  pvcCode: string;
  pvcColor: string;
  grain: GrainDirection;
  unitPrice: number | "";
  discount: number | "";
  vat: number | "";
  notes: string;
}

export interface OrderHeader {
  orderNo: string;
  orderDate: string;
  customerName: string;
  companyName: string;
  phone: string;
  projectName: string;
  salesperson: string;
  deliveryDate: string;
  currency: string;
  notes: string;
}

export type OrderRowEditor =
  | "select-design"
  | "select-pvc"
  | "select-mdf"
  | "select-grain"
  | "text"
  | "number";

export interface OrderRowColumn {
  key: keyof OrderRow;
  label: string;
  editor: OrderRowEditor;
  align?: "left" | "right";
  required?: boolean;
  /** Column only carries meaning when invoice mode is on (pricing/VAT/etc). */
  invoiceOnly?: boolean;
  /** Computed, read-only column (line total). */
  computed?: boolean;
}

/**
 * The Door Order Table schema. Both the on-screen table and the Order PDF /
 * Production CSV projections derive their column list from this array so
 * the three surfaces can never silently drift apart.
 */
export const ORDER_ROW_COLUMNS: OrderRowColumn[] = [
  { key: "designCode", label: "Design Code", editor: "select-design", required: true },
  { key: "designName", label: "Design Name", editor: "text" },
  { key: "width", label: "Width mm", editor: "number", align: "right", required: true },
  { key: "height", label: "Height mm", editor: "number", align: "right", required: true },
  { key: "qty", label: "Qty", editor: "number", align: "right", required: true },
  { key: "mdfThickness", label: "MDF Thickness", editor: "select-mdf" },
  { key: "pvcCode", label: "PVC Code", editor: "select-pvc" },
  { key: "pvcColor", label: "PVC Color", editor: "text" },
  { key: "grain", label: "Grain Direction", editor: "select-grain" },
  { key: "unitPrice", label: "Unit Price", editor: "number", align: "right", invoiceOnly: true },
  { key: "discount", label: "Discount %", editor: "number", align: "right", invoiceOnly: true },
  { key: "vat", label: "VAT %", editor: "number", align: "right", invoiceOnly: true },
  // "Line Total" itself is computed (see core/calculations.ts) and has no
  // OrderRow key of its own — the UI renders it alongside this schema.
];

let rowIdCounter = 1;
export function nextRowId(): string {
  return `row-${rowIdCounter++}`;
}

export function makeDefaultRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: nextRowId(),
    designCode: "",
    designName: "",
    width: "",
    height: "",
    qty: 1,
    mdfThickness: "18 mm",
    pvcCode: "",
    pvcColor: "",
    grain: "Vertical",
    unitPrice: "",
    discount: 0,
    vat: 5,
    notes: "",
    ...overrides,
  };
}

/** Order number structure: ZX-<year>-<4-digit sequence>. */
export function generateOrderNo(year: number, sequence: number): string {
  return `ZX-${year}-${String(sequence).padStart(4, "0")}`;
}
