import { describe, it, expect } from "vitest";
import { generateOrderNo } from "../orderSchema";
import { generateInvoiceNo } from "../invoiceSchema";

describe("order/invoice number generation", () => {
  it("generateOrderNo formats as ZX-<year>-<4-digit sequence>", () => {
    expect(generateOrderNo(2026, 1)).toBe("ZX-2026-0001");
    expect(generateOrderNo(2026, 149)).toBe("ZX-2026-0149");
    expect(generateOrderNo(2026, 12345)).toBe("ZX-2026-12345");
  });

  it("generateInvoiceNo formats as INV-<year>-<4-digit sequence>", () => {
    expect(generateInvoiceNo(2026, 1)).toBe("INV-2026-0001");
    expect(generateInvoiceNo(2026, 91)).toBe("INV-2026-0091");
  });
});
