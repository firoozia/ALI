import { describe, it, expect } from "vitest";
import {
  edgeBandCodeError,
  edgeOptions,
  makeDefaultEdgeBands,
  normalizeRotation,
  parseEdge,
  parseEdgeBandCodesCsv,
} from "../melamine";
import { buildProductionCsvRows, buildProductionCsvString } from "../csvSchema";
import { ensureOrderRow, makeDefaultRow, type OrderHeader } from "../orderSchema";
import { parseOrderFile } from "../jsonOrderFile";
import { ensureCatalogIds, makeDefaultCatalog } from "../catalogSchema";

const bands = makeDefaultEdgeBands();

const header: OrderHeader = {
  orderNo: "ZX-2026-0007",
  orderDate: "2026-09-27",
  customerName: "Test",
  companyName: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  taxNumber: "",
  projectName: "Kitchen",
  salesperson: "",
  deliveryDate: "",
  currency: "AED",
  notes: "",
};

describe("edge options and parsing (same rules as ZINAX CAM)", () => {
  it("lists N, active bands, S, then S/<band>", () => {
    const list = [...bands, { ...bands[0], id: "x", code: "P9", active: false }];
    expect(edgeOptions(list)).toEqual(["N", "P1", "P2", "P3", "S", "S/P1", "S/P2", "S/P3"]);
  });

  it("parses N, S, bands, and S/<band> case-insensitively into canonical text", () => {
    expect(parseEdge("", bands)).toMatchObject({ known: true, text: "N", band: null, groove: false });
    expect(parseEdge(" s ", bands)).toMatchObject({ known: true, text: "S", groove: true });
    expect(parseEdge("p3", bands)).toMatchObject({ known: true, text: "P3", band: "P3" });
    expect(parseEdge("s/p1", bands)).toMatchObject({ known: true, text: "S/P1", band: "P1", groove: true });
  });

  it("keeps unknown codes as written", () => {
    expect(parseEdge("P9", bands)).toMatchObject({ known: false, text: "P9" });
    expect(parseEdge("X/P1", bands)).toMatchObject({ known: false, text: "X/P1" });
  });

  it("rejects band codes ZINAX CAM would reject", () => {
    expect(edgeBandCodeError("Q1", bands)).toMatch(/start with P/);
    expect(edgeBandCodeError("P 1", bands)).toMatch(/spaces/);
    expect(edgeBandCodeError("P/1", bands)).toMatch(/spaces or "\/"/);
    expect(edgeBandCodeError("p1", bands)).toMatch(/already/);
    expect(edgeBandCodeError("P4", bands)).toBe("");
  });

  it("normalizes rotation to Y/N and keeps unknown text", () => {
    expect(normalizeRotation("")).toBe("Y");
    expect(normalizeRotation("yes")).toBe("Y");
    expect(normalizeRotation("locked")).toBe("N");
    expect(normalizeRotation("sideways")).toBe("sideways");
  });
});

describe("band list exported by ZINAX CAM", () => {
  it("imports code,name,thickness_mm,width_mm,color with CRLF", () => {
    let n = 0;
    const text = "code,name,thickness_mm,width_mm,color\r\nP1,White 0.4,0.4,22,White\r\nP5,Oak 2,2,23,Oak\r\n";
    const { bands: out, errors } = parseEdgeBandCodesCsv(text, () => `id-${n++}`);
    expect(errors).toEqual([]);
    expect(out.map((b) => [b.code, b.name, b.thicknessMm, b.widthMm, b.color])).toEqual([
      ["P1", "White 0.4", 0.4, 22, "White"],
      ["P5", "Oak 2", 2, 23, "Oak"],
    ]);
  });

  it("reports bad rows instead of keeping them", () => {
    const text = "code,thickness_mm\nP1,0.5\nQ2,1\nP3,0\nP1,2\n";
    const { bands: out, errors } = parseEdgeBandCodesCsv(text, () => "id");
    expect(out.map((b) => b.code)).toEqual(["P1"]);
    expect(errors).toHaveLength(3);
  });
});

describe("production CSV for a mixed order", () => {
  it("writes the melamine contract columns; door rows stay vacuum_door with blank edges", () => {
    const rows = [
      makeDefaultRow({ designCode: "cd1", width: 400, height: 800, qty: 2 }),
      makeDefaultRow({
        productType: "melamine", designCode: "cd0", width: 500, height: 400, qty: 1,
        edge1: "P3", edge2: "S/P1", edge3: "N", edge4: "S", rotation: "N",
      }),
    ];
    const [door, mel] = buildProductionCsvRows(header, rows);
    expect([door.product_type, door.edge_1, door.edge_4, door.rotation]).toEqual(["vacuum_door", "", "", ""]);
    expect([mel.product_type, mel.edge_1, mel.edge_2, mel.edge_3, mel.edge_4, mel.rotation])
      .toEqual(["melamine", "P3", "S/P1", "N", "S", "N"]);
    const csv = buildProductionCsvString(header, rows);
    expect(csv.split("\r\n")[0].endsWith(",notes,product_type,edge_1,edge_2,edge_3,edge_4,rotation")).toBe(true);
    expect(csv.split("\r\n")[2].endsWith(",melamine,P3,S/P1,N,S,N")).toBe(true);
  });
});

describe("old files and catalogs", () => {
  it("fills melamine fields on rows saved before this version", () => {
    const old = { ...makeDefaultRow({ designCode: "cd1" }) } as Record<string, unknown>;
    for (const k of ["productType", "edge1", "edge2", "edge3", "edge4", "rotation"]) delete old[k];
    const row = ensureOrderRow(old);
    expect([row.productType, row.edge1, row.edge4, row.rotation]).toEqual(["vacuum_door", "N", "N", "Y"]);
    expect(row.designCode).toBe("cd1");
  });

  it("keeps unknown edge text on load instead of rewriting it", () => {
    const row = ensureOrderRow({ ...makeDefaultRow(), productType: "melamine", edge2: "P9" });
    expect(row.edge2).toBe("P9");
  });

  it("opens an order file whose rows have no melamine fields", () => {
    const old = { ...makeDefaultRow({ designCode: "cd2" }) } as Record<string, unknown>;
    delete old.productType;
    const file = JSON.stringify({
      schema_version: "1.0", app: "ZINAX_ORDER_BUILDER", header, rows: [old], invoiceMode: false,
      invoice: { invoiceNo: "", invoiceDate: "", dueDate: "", paymentTerms: "", vat: 5, currency: "AED",
        bankDetails: "", paidAmount: 0, orderDiscountPercent: 0, documentType: "invoice", notes: "" },
    });
    const result = parseOrderFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.rows[0].productType).toBe("vacuum_door");
  });

  it("gives an old catalog the factory band list", () => {
    const { edgeBands: _drop, ...old } = makeDefaultCatalog();
    const fixed = ensureCatalogIds(old as never);
    expect(fixed.edgeBands.map((b) => b.code)).toEqual(["P1", "P2", "P3"]);
  });
});

describe("melamine validation", () => {
  const catalog = makeDefaultCatalog();
  const okHeader = { ...header, customerName: "C" };
  const mel = (over: Partial<Parameters<typeof makeDefaultRow>[0]> = {}) =>
    makeDefaultRow({
      productType: "melamine", designCode: "", width: 560, height: 720, qty: 2,
      pvcCode: "MEL-W", edge1: "P1", edge2: "P1", edge3: "S/P1", edge4: "N", rotation: "Y", ...over,
    });

  it("accepts a melamine panel with no design code and no PVC catalog color", async () => {
    const { getOrderValidationErrors } = await import("../validators");
    expect(getOrderValidationErrors(okHeader, [mel()], catalog)).toEqual([]);
  });

  it("reports unknown edge codes, inactive bands, and bad rotation with the melamine row number", async () => {
    const { getOrderValidationErrors } = await import("../validators");
    const withInactive = { ...catalog, edgeBands: catalog.edgeBands.map((b) => (b.code === "P2" ? { ...b, active: false } : b)) };
    const errors = getOrderValidationErrors(
      okHeader,
      [makeDefaultRow({ designCode: "ZD001", width: 400, height: 800, qty: 1, pvcCode: "PVC-101" }),
        mel(), mel({ edge2: "P9", edge3: "S/P2", rotation: "sideways" })],
      withInactive
    );
    expect(errors).toEqual([
      'Melamine row 2: E2 (Top) code "P9" is not in the edge band list.',
      'Melamine row 2: E3 (Left) band "P2" is not active.',
      'Melamine row 2: Rotation "sideways" must be Y (may rotate) or N (locked).',
    ]);
  });
});
