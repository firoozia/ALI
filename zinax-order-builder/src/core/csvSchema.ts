// Production CSV contract — for FIROO CAM import only.
// This column list is intentionally free of any invoice/pricing field.
// Do NOT add unit_price, discount, VAT, invoice totals, payment status,
// bank details, tool numbers, or any CNC/machine data here — those belong
// to core/invoiceSchema.ts and must never leak into the production file.
import type { OrderHeader, OrderRow } from "./orderSchema";

export interface CsvColumn {
  key: string;
  header: string;
}

export const PRODUCTION_CSV_COLUMNS: CsvColumn[] = [
  { key: "order_id", header: "order_id" },
  { key: "order_no", header: "order_no" },
  { key: "order_date", header: "order_date" },
  { key: "customer_name", header: "customer_name" },
  { key: "project_name", header: "project_name" },
  { key: "phone", header: "phone" },
  { key: "salesperson", header: "salesperson" },
  { key: "line_no", header: "line_no" },
  { key: "design_code", header: "design_code" },
  { key: "design_name", header: "design_name" },
  { key: "width_mm", header: "width_mm" },
  { key: "height_mm", header: "height_mm" },
  { key: "quantity", header: "quantity" },
  { key: "mdf_thickness_mm", header: "mdf_thickness_mm" },
  { key: "pvc_code", header: "pvc_code" },
  { key: "pvc_color", header: "pvc_color" },
  { key: "grain_direction", header: "grain_direction" },
  { key: "notes", header: "notes" },
];

export type ProductionCsvRow = Record<string, string | number>;

function parseThicknessMm(mdfThickness: string): number {
  const match = /(\d+(\.\d+)?)/.exec(mdfThickness);
  return match ? Number(match[1]) : 0;
}

/**
 * Builds the exact rows that would be written to the Production CSV.
 * Both the Web edition and the Windows edition call the equivalent of this
 * function from zinax_order_core so FIROO CAM always sees the same shape.
 */
export function buildProductionCsvRows(header: OrderHeader, rows: OrderRow[]): ProductionCsvRow[] {
  return rows.map((row, index) => ({
    order_id: header.orderNo,
    order_no: header.orderNo,
    order_date: header.orderDate,
    customer_name: header.customerName,
    project_name: header.projectName,
    phone: header.phone,
    salesperson: header.salesperson,
    line_no: index + 1,
    design_code: row.designCode,
    design_name: row.designName,
    width_mm: row.width,
    height_mm: row.height,
    quantity: row.qty,
    mdf_thickness_mm: parseThicknessMm(row.mdfThickness),
    pvc_code: row.pvcCode,
    pvc_color: row.pvcColor,
    grain_direction: row.grain,
    notes: row.notes,
  }));
}
