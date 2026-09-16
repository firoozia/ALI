// Settings — company profile + catalogs, persisted per install.
// The load/save functions at the bottom are the Web edition's persistence
// adapter (localStorage). The Windows edition will implement the same
// four function signatures against a local settings file instead; nothing
// above that line is web-specific.
import { type CompanyProfile, makeDefaultCompanyProfile } from "./companyProfile";
import { type Catalog, makeDefaultCatalog } from "./catalogSchema";

export const SETTINGS_SCHEMA_VERSION = "1.0";
export const SETTINGS_APP_ID = "ZINAX_ORDER_BUILDER_SETTINGS";

export interface AppSettings {
  schema_version: string;
  app: string;
  companyProfile: CompanyProfile;
  catalog: Catalog;
}

export function makeDefaultSettings(): AppSettings {
  return {
    schema_version: SETTINGS_SCHEMA_VERSION,
    app: SETTINGS_APP_ID,
    companyProfile: makeDefaultCompanyProfile(),
    catalog: makeDefaultCatalog(),
  };
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function settingsFileName(): string {
  return "zinax_settings.json";
}

export type ParseSettingsResult = { ok: true; settings: AppSettings } | { ok: false; error: string };

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
      companyProfile: candidate.companyProfile,
      catalog: candidate.catalog,
    },
  };
}

function upsertByCode<T extends { code: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((item) => [item.code, item]));
  for (const item of incoming) map.set(item.code, item);
  return Array.from(map.values());
}

function unionStrings(current: string[], incoming: string[]): string[] {
  return Array.from(new Set([...current, ...incoming]));
}

/** Adds/updates catalog entries and overlays profile fields, without dropping anything not present in `incoming`. */
export function mergeSettings(current: AppSettings, incoming: AppSettings): AppSettings {
  return {
    schema_version: current.schema_version,
    app: current.app,
    companyProfile: { ...current.companyProfile, ...incoming.companyProfile },
    catalog: {
      designs: upsertByCode(current.catalog.designs, incoming.catalog.designs),
      pvcColors: upsertByCode(current.catalog.pvcColors, incoming.catalog.pvcColors),
      mdfThickness: unionStrings(current.catalog.mdfThickness, incoming.catalog.mdfThickness),
      grainDirections: unionStrings(current.catalog.grainDirections, incoming.catalog.grainDirections),
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
