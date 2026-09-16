import { describe, it, expect } from "vitest";
import { makeDefaultSettings, mergeSettings, replaceSettings, parseSettingsFile, serializeSettings } from "../settingsSchema";

describe("settingsSchema", () => {
  it("merge upserts catalog entries by code and keeps existing ones not present in the import", () => {
    const current = makeDefaultSettings();
    const incoming = makeDefaultSettings();
    // Modify one existing design's name and add a brand-new one.
    incoming.catalog.designs[0] = { ...incoming.catalog.designs[0], name: "Updated Name" };
    incoming.catalog.designs.push({
      code: "ZD999",
      name: "Brand New Design",
      family: "Custom",
      description: "",
      minWidthMm: 300,
      maxWidthMm: 700,
      minHeightMm: 600,
      maxHeightMm: 1200,
      active: true,
    });

    const merged = mergeSettings(current, incoming);

    const updated = merged.catalog.designs.find((d) => d.code === incoming.catalog.designs[0].code);
    expect(updated?.name).toBe("Updated Name");

    const added = merged.catalog.designs.find((d) => d.code === "ZD999");
    expect(added?.name).toBe("Brand New Design");

    // Nothing from `current` that wasn't touched should be dropped.
    expect(merged.catalog.designs.length).toBeGreaterThanOrEqual(current.catalog.designs.length);
  });

  it("merge overlays company profile fields from the incoming file", () => {
    const current = makeDefaultSettings();
    const incoming = makeDefaultSettings();
    incoming.companyProfile.companyName = "New Company Name";

    const merged = mergeSettings(current, incoming);
    expect(merged.companyProfile.companyName).toBe("New Company Name");
  });

  it("replace discards the current settings entirely", () => {
    const current = makeDefaultSettings();
    current.companyProfile.companyName = "Old Name";
    const incoming = makeDefaultSettings();
    incoming.companyProfile.companyName = "Fresh Name";
    const onlyDesign = {
      code: "ONLY",
      name: "Only Design",
      family: "Custom",
      description: "",
      minWidthMm: 300,
      maxWidthMm: 700,
      minHeightMm: 600,
      maxHeightMm: 1200,
      active: true,
    };
    incoming.catalog.designs = [onlyDesign];

    const replaced = replaceSettings(current, incoming);
    expect(replaced.companyProfile.companyName).toBe("Fresh Name");
    expect(replaced.catalog.designs).toEqual([onlyDesign]);
  });

  it("round-trips through serialize + parse", () => {
    const settings = makeDefaultSettings();
    const result = parseSettingsFile(serializeSettings(settings));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.companyProfile.companyName).toBe(settings.companyProfile.companyName);
    }
  });

  it("rejects a settings file from a different app", () => {
    const result = parseSettingsFile(JSON.stringify({ schema_version: "1.0", app: "WRONG_APP" }));
    expect(result.ok).toBe(false);
  });

  it("merge overlays pdfTemplate fields from the incoming file", () => {
    const current = makeDefaultSettings();
    const incoming = makeDefaultSettings();
    incoming.pdfTemplate.orderPdfTitle = "Custom Title";
    incoming.pdfTemplate.showSignatures = false;

    const merged = mergeSettings(current, incoming);
    expect(merged.pdfTemplate.orderPdfTitle).toBe("Custom Title");
    expect(merged.pdfTemplate.showSignatures).toBe(false);
  });

  it("fills in a default pdfTemplate when parsing an older export that predates it", () => {
    const settings = makeDefaultSettings();
    const olderExport = { ...settings } as Record<string, unknown>;
    delete olderExport.pdfTemplate;

    const result = parseSettingsFile(JSON.stringify(olderExport));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.pdfTemplate.orderPdfTitle).toBe("Order Sheet");
    }
  });
});
