import { describe, it, expect } from "vitest";
import { makeDefaultSettings, mergeSettings, replaceSettings, parseSettingsFile, serializeSettings } from "../settingsSchema";

describe("settingsSchema", () => {
  it("merge upserts catalog entries by code and keeps existing ones not present in the import", () => {
    const current = makeDefaultSettings();
    const incoming = makeDefaultSettings();
    // Modify one existing design's name and add a brand-new one.
    incoming.catalog.designs[0] = { ...incoming.catalog.designs[0], name: "Updated Name" };
    incoming.catalog.designs.push({ code: "ZD999", name: "Brand New Design" });

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
    incoming.catalog.designs = [{ code: "ONLY", name: "Only Design" }];

    const replaced = replaceSettings(current, incoming);
    expect(replaced.companyProfile.companyName).toBe("Fresh Name");
    expect(replaced.catalog.designs).toEqual([{ code: "ONLY", name: "Only Design" }]);
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
});
