// New melamine rows. Kept apart from melamine.ts because orderSchema imports melamine.ts.
import { makeDefaultRow, type OrderRow } from "./orderSchema";
import { PRODUCT_MELAMINE } from "./melamine";

/** A new panel that repeats the previous panel's thickness, color, edges, rotation, and price. */
export function makeMelamineRow(source: OrderRow | undefined, overrides: Partial<OrderRow> = {}): OrderRow {
  return makeDefaultRow({
    productType: PRODUCT_MELAMINE,
    grain: "None",
    designCode: "",
    mdfThickness: source?.mdfThickness ?? "18 mm",
    pvcCode: source?.pvcCode ?? "",
    pvcColor: source?.pvcColor ?? "",
    edge1: source?.edge1 ?? "N",
    edge2: source?.edge2 ?? "N",
    edge3: source?.edge3 ?? "N",
    edge4: source?.edge4 ?? "N",
    rotation: source?.rotation === "N" ? "N" : "Y",
    unitPrice: source?.unitPrice ?? "",
    ...overrides,
  });
}

