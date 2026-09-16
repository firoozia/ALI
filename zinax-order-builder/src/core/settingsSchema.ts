// Settings — company profile + catalogs + PDF template preferences,
// persisted per install. The load/save functions at the bottom are the
// Web edition's persistence adapter (localStorage). The Windows edition
// will implement the same four function signatures against a local
// settings file instead; nothing above that line is web-specific.
import { type CompanyProfile, makeDefaultCompanyProfile } from "./companyProfile";
import { type Catalog, makeDefaultCatalog } from "./catalogSchema";
import { type PdfTemplateSettings, makeDefaultPdfTemplateSettings } from "./pdfTemplateSchema";

export const SETTINGS_SCHEMA_VERSION = "1.1";
export const SETTINGS_APP_ID = "ZINAX_ORDER_BUILDER_SETTINGS";

export interface AppSettings {
  schema_version: string;
  app: string;
  companyProfile: CompanyProfile;
  catalog: Catalog;
  pdfTemplate: PdfTemplateSettings;
}

export function makeDefaultSettings(): AppSettings {
  return {
    schema_version: SETTINGS_SCHEMA_VERSION,
    app: SETTINGS_APP_ID,
    companyProfile: makeDefaultCompanyProfile(),
    catalog: makeDefaultCatalog(),
    pdfTemplate: makeDefaultPdfTemplateSettings(),
  };
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function settingsFileName(): string {
  return "zinax_settings.json";
}

export type ParseSettingsResult = { ok: true; settings: AppSettings } | { ok: false; error: string };

/**
 * Validates and parses a settings file. Tolerant of older exports missing
 * newer fields (e.g. `pdfTemplate` or `companyProfile.stampUrl`) by filling
 * defaults, since a stricter reject-on-missing-field policy would make
 * every additive settings change a breaking one for existing exports.
 */
export function parseSettingsFile(jsonText: string): ParseSettingsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File does not contain a settings object." };
  }

  const candidate = parsed as Partial<AppSettings>;

  if (candidate.app !== SETTINGS_APP_ID) {
    return { ok: false, error: `File is not a ${SETTINGS_APP_ID} settings file.` };
  }
  if (candidate.schema_version !== SETTINGS_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported settings version "${String(candidate.schema_version)}" (expected ${SETTINGS_SCHEMA_VERSION}).`,
    };
  }
  if (!candidate.companyProfile || !candidate.catalog) {
    return { ok: false, error: "File is missing companyProfile or catalog." };
  }

  return {
    ok: true,
    settings: {
      schema_version: candidate.schema_version,
      app: candidate.app,
      companyProfile: { ...makeDefaultCompanyProfile(), ...candidate.companyProfile },
      catalog: { ...makeDefaultCatalog(), ...candidate.catalog },
      pdfTemplate: { ...makeDefaultPdfTemplateSettings(), ...candidate.pdfTemplate },
    },
  };
}

function upsertByCode<T extends { code: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((item) => [item.code, item]));
  for (const item of incoming) map.set(item.code, item);
  return Array.from(map.values());
}

function upsertByThickness<T extends { thicknessMm: number }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((item) => [item.thicknessMm, item]));
  for (const item of incoming) map.set(item.thicknessMm, item);
  return Array.from(map.values());
}

/** Adds/updates catalog entries and overlays profile/template fields, without dropping anything not present in `incoming`. */
export function mergeSettings(current: AppSettings, incoming: AppSettings): AppSettings {
  return {
    schema_version: current.schema_version,
    app: current.app,
    companyProfile: { ...current.companyProfile, ...incoming.companyProfile },
    pdfTemplate: { ...current.pdfTemplate, ...incoming.pdfTemplate },
    catalog: {
      designs: upsertByCode(current.catalog.designs, incoming.catalog.designs),
      pvcColors: upsertByCode(current.catalog.pvcColors, incoming.catalog.pvcColors),
      mdfThickness: upsertByThickness(current.catalog.mdfThickness, incoming.catalog.mdfThickness),
      grainDirections: upsertByCode(current.catalog.grainDirections, incoming.catalog.grainDirections),
    },
  };
}

/** Discards everything currently stored and adopts the incoming file as-is. */
export function replaceSettings(_current: AppSettings, incoming: AppSettings): AppSettings {
  return incoming;
}

// --- Web persistence adapter (localStorage) -----------------------------

const LOCAL_STORAGE_KEY = "zinax_settings_v1";

export function loadSettingsFromStorage(): AppSettings {
  if (typeof window === "undefined") return makeDefaultSettings();
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return makeDefaultSettings();
    const result = parseSettingsFile(raw);
    return result.ok ? result.settings : makeDefaultSettings();
  } catch {
    return makeDefaultSettings();
  }
}

export function saveSettingsToStorage(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeSettings(settings));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — settings just won't persist.
  }
}
