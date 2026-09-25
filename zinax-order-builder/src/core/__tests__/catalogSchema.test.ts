import { describe, it, expect } from "vitest";
import { makeDefaultCatalog, formatMdfThickness, mergeCatalog, replaceCatalog, parseCatalogFile, serializeCatalogFile, buildCatalogFile } from "../catalogSchema";

describe("catalogSchema", () => {
  it("formatMdfThickness renders '<n> mm'", () => {
    expect(formatMdfThickness({ thicknessMm: 18, active: true })).toBe("18 mm");
  });

  it("default catalog only contains active entries out of the box", () => {
    const catalog = makeDefaultCatalog();
    expect(catalog.designs.every((d) => d.active)).toBe(true);
    expect(catalog.pvcColors.every((p) => p.active)).toBe(true);
    expect(catalog.mdfThickness.every((m) => m.active)).toBe(true);
    expect(catalog.grainDirections.every((g) => g.active)).toBe(true);
  });

  it("merge upserts designs/pvc by code and MDF options by thickness", () => {
    const current = makeDefaultCatalog();
    const incoming = makeDefaultCatalog();
    incoming.designs[0] = { ...incoming.designs[0], active: false };
    incoming.mdfThickness = [{ thicknessMm: 30, active: true }];

    const merged = mergeCatalog(current, incoming);
    expect(merged.designs.find((d) => d.code === incoming.designs[0].code)?.active).toBe(false);
    expect(merged.mdfThickness.some((m) => m.thicknessMm === 30)).toBe(true);
    // Original thickness options are preserved, not dropped.
    expect(merged.mdfThickness.length).toBeGreaterThan(1);
  });

  it("replace discards the current catalog entirely", () => {
    const current = makeDefaultCatalog();
    const incoming = { designs: [], pvcColors: [], mdfThickness: [], grainDirections: [] };
    expect(replaceCatalog(current, incoming)).toEqual(incoming);
  });

  it("round-trips through serialize + parse", () => {
    const catalog = makeDefaultCatalog();
    const result = parseCatalogFile(serializeCatalogFile(buildCatalogFile(catalog)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.catalog.designs).toEqual(catalog.designs);
  });

  it("rejects a file from a different app", () => {
    const result = parseCatalogFile(JSON.stringify({ schema_version: "1.0", app: "WRONG" }));
    expect(result.ok).toBe(false);
  });
});
