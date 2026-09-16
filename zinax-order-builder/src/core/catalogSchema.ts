// Company-editable catalogs — design codes, PVC/membrane colors, MDF
// thickness options, and grain directions. These are the "each company
// enters their own codes" lists referenced from the Designs / Catalog
// screen, and are what the Door Order Table's select editors and the
// validators (core/validators.ts) read from.
//
// Every catalog entry carries an `active` flag rather than being deleted
// outright, so historical orders that reference a retired code still
// display correctly — only new rows are restricted to active entries.

export interface DesignCatalogItem {
  code: string;
  name: string;
  family: string;
  description: string;
  minWidthMm: number;
  maxWidthMm: number;
  minHeightMm: number;
  maxHeightMm: number;
  active: boolean;
}

export interface PvcCatalogItem {
  code: string;
  color: string;
  category: string;
  finish: string;
  active: boolean;
}

export interface MdfThicknessOption {
  thicknessMm: number;
  active: boolean;
}

export interface GrainDirectionOption {
  code: string;
  label: string;
  active: boolean;
}

export interface Catalog {
  designs: DesignCatalogItem[];
  pvcColors: PvcCatalogItem[];
  mdfThickness: MdfThicknessOption[];
  grainDirections: GrainDirectionOption[];
}

export function formatMdfThickness(option: MdfThicknessOption): string {
  return `${option.thicknessMm} mm`;
}

const DEFAULT_DESIGNS: DesignCatalogItem[] = [
  { code: "ZD001", name: "Classic Offset Door", family: "Offset", description: "Single offset panel with routed edge.", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1200, active: true },
  { code: "ZD002", name: "Double Offset Door", family: "Offset", description: "Twin offset panel groove.", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1200, active: true },
  { code: "ZD003", name: "Modern Groove Door", family: "Groove", description: "Horizontal modern groove line.", minWidthMm: 350, maxWidthMm: 800, minHeightMm: 600, maxHeightMm: 1300, active: true },
  { code: "ZD004", name: "Shaker V-Groove", family: "Shaker", description: "Classic shaker frame with V-groove center.", minWidthMm: 300, maxWidthMm: 650, minHeightMm: 600, maxHeightMm: 1200, active: true },
  { code: "ZD005", name: "Raised Panel Classic", family: "Classic", description: "Traditional raised center panel.", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1250, active: true },
];

const DEFAULT_PVC_COLORS: PvcCatalogItem[] = [
  { code: "PVC-101", color: "Walnut", category: "Wood Tone", finish: "Matte", active: true },
  { code: "PVC-202", color: "Oak", category: "Wood Tone", finish: "Matte", active: true },
  { code: "PVC-305", color: "Stone Gray", category: "Solid", finish: "Matte", active: true },
  { code: "PVC-410", color: "Matte White", category: "Solid", finish: "Matte", active: true },
  { code: "PVC-512", color: "Graphite", category: "Solid", finish: "Gloss", active: true },
];

const DEFAULT_MDF_THICKNESS: MdfThicknessOption[] = [
  { thicknessMm: 16, active: true },
  { thicknessMm: 18, active: true },
  { thicknessMm: 22, active: true },
  { thicknessMm: 25, active: true },
];

const DEFAULT_GRAIN_DIRECTIONS: GrainDirectionOption[] = [
  { code: "vertical", label: "Vertical", active: true },
  { code: "horizontal", label: "Horizontal", active: true },
];

export function makeDefaultCatalog(): Catalog {
  return {
    designs: DEFAULT_DESIGNS.map((d) => ({ ...d })),
    pvcColors: DEFAULT_PVC_COLORS.map((p) => ({ ...p })),
    mdfThickness: DEFAULT_MDF_THICKNESS.map((m) => ({ ...m })),
    grainDirections: DEFAULT_GRAIN_DIRECTIONS.map((g) => ({ ...g })),
  };
}

// --- Standalone catalog export/import contract --------------------------
// The Designs / Catalog screen can export/import just the catalog, distinct
// from a full Settings export.

export const CATALOG_SCHEMA_VERSION = "1.0";
export const CATALOG_APP_ID = "ZINAX_CATALOG";

export interface CatalogFile {
  schema_version: string;
  app: string;
  catalog: Catalog;
}

export function buildCatalogFile(catalog: Catalog): CatalogFile {
  return { schema_version: CATALOG_SCHEMA_VERSION, app: CATALOG_APP_ID, catalog };
}

export function serializeCatalogFile(file: CatalogFile): string {
  return JSON.stringify(file, null, 2);
}

export function catalogFileName(): string {
  return "zinax_catalog.json";
}

export type ParseCatalogFileResult = { ok: true; catalog: Catalog } | { ok: false; error: string };

export function parseCatalogFile(jsonText: string): ParseCatalogFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File does not contain a catalog object." };
  }
  const candidate = parsed as Partial<CatalogFile>;
  if (candidate.app !== CATALOG_APP_ID) {
    return { ok: false, error: `File is not a ${CATALOG_APP_ID} file.` };
  }
  if (candidate.schema_version !== CATALOG_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported catalog version "${String(candidate.schema_version)}".` };
  }
  if (!candidate.catalog) {
    return { ok: false, error: "File is missing catalog data." };
  }
  return { ok: true, catalog: candidate.catalog };
}

function upsertByCode<T extends { code: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((item) => [item.code, item]));
  for (const item of incoming) map.set(item.code, item);
  return Array.from(map.values());
}

function upsertByThickness(current: MdfThicknessOption[], incoming: MdfThicknessOption[]): MdfThicknessOption[] {
  const map = new Map(current.map((item) => [item.thicknessMm, item]));
  for (const item of incoming) map.set(item.thicknessMm, item);
  return Array.from(map.values());
}

/** Adds/updates catalog entries by code (or thickness), keeping everything not present in `incoming`. */
export function mergeCatalog(current: Catalog, incoming: Catalog): Catalog {
  return {
    designs: upsertByCode(current.designs, incoming.designs),
    pvcColors: upsertByCode(current.pvcColors, incoming.pvcColors),
    mdfThickness: upsertByThickness(current.mdfThickness, incoming.mdfThickness),
    grainDirections: upsertByCode(current.grainDirections, incoming.grainDirections),
  };
}

/** Discards the current catalog entirely and adopts the incoming one. */
export function replaceCatalog(_current: Catalog, incoming: Catalog): Catalog {
  return incoming;
}
