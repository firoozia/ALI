// Company-editable catalogs — design codes, PVC/membrane colors, MDF
// thickness options, and grain directions. These are the "each company
// enters their own codes" lists referenced from the Designs / Catalog
// screen, and are what the Door Order Table's select editors and the
// validators (core/validators.ts) read from.
//
// Every catalog entry carries an `active` flag rather than being deleted
// outright, so historical orders that reference a retired code still
// display correctly — only new rows are restricted to active entries.

// `id` is a stable internal identifier, generated once when a row is
// created and never edited by the user — unlike `code`, which the user
// freely retypes. UI lists must key/look up rows by `id`, not `code`:
// keying by `code` breaks mid-edit (React remounts the row, and its input
// loses focus, the instant the user's first keystroke changes the key).
export interface DesignCatalogItem {
  id: string;
  code: string;
  name: string;
  family: string;
  description: string;
  minWidthMm: number;
  maxWidthMm: number;
  minHeightMm: number;
  maxHeightMm: number;
  /** Auto-filled into a Door Order row's Unit Price when this design is selected; 0 = no default, row keeps its own value. Still editable per-row afterward. */
  defaultUnitPrice: number;
  /** Auto-filled into a Door Order row's MDF Thickness when this design is selected — must match an mdfThickness option's formatted label (e.g. "18 mm"); "" = no default. */
  defaultMdfThickness: string;
  active: boolean;
}

export interface PvcCatalogItem {
  id: string;
  code: string;
  color: string;
  category: string;
  finish: string;
  /** Auto-filled into a Door Order row's Grain Direction when this color is selected — must match a grainDirections option's label; "" = no default. */
  defaultGrain: string;
  active: boolean;
}

export interface MdfThicknessOption {
  thicknessMm: number;
  active: boolean;
}

export interface GrainDirectionOption {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

/** Generates a stable id for a new catalog row. Never derived from `code`. */
export function nextCatalogItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Backfills `id` (and any newer fields) on catalog entries loaded from storage/import before those fields existed. */
export function ensureCatalogIds(catalog: Catalog): Catalog {
  const withId = <T extends { id?: string }>(items: T[]): T[] =>
    items.map((item) => (item.id ? item : { ...item, id: nextCatalogItemId() }));
  const designs = withId(catalog.designs).map((d) => ({
    ...d,
    defaultUnitPrice: d.defaultUnitPrice ?? 0,
    defaultMdfThickness: d.defaultMdfThickness ?? "",
  }));
  const pvcColors = withId(catalog.pvcColors).map((p) => ({
    ...p,
    defaultGrain: p.defaultGrain ?? "",
  }));
  return {
    ...catalog,
    designs,
    pvcColors,
    grainDirections: withId(catalog.grainDirections),
  };
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
  { id: "seed-zd001", code: "ZD001", name: "Classic Offset Door", family: "Offset", description: "Single offset panel with routed edge.", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1200, defaultUnitPrice: 185, defaultMdfThickness: "18 mm", active: true },
  { id: "seed-zd002", code: "ZD002", name: "Double Offset Door", family: "Offset", description: "Twin offset panel groove.", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1200, defaultUnitPrice: 165, defaultMdfThickness: "18 mm", active: true },
  { id: "seed-zd003", code: "ZD003", name: "Modern Groove Door", family: "Groove", description: "Horizontal modern groove line.", minWidthMm: 350, maxWidthMm: 800, minHeightMm: 600, maxHeightMm: 1300, defaultUnitPrice: 210, defaultMdfThickness: "18 mm", active: true },
  { id: "seed-zd004", code: "ZD004", name: "Shaker V-Groove", family: "Shaker", description: "Classic shaker frame with V-groove center.", minWidthMm: 300, maxWidthMm: 650, minHeightMm: 600, maxHeightMm: 1200, defaultUnitPrice: 195, defaultMdfThickness: "22 mm", active: true },
  { id: "seed-zd005", code: "ZD005", name: "Raised Panel Classic", family: "Classic", description: "Traditional raised center panel.", minWidthMm: 300, maxWidthMm: 700, minHeightMm: 600, maxHeightMm: 1250, defaultUnitPrice: 220, defaultMdfThickness: "22 mm", active: true },
];

const DEFAULT_PVC_COLORS: PvcCatalogItem[] = [
  { id: "seed-pvc-101", code: "PVC-101", color: "Walnut", category: "Wood Tone", finish: "Matte", defaultGrain: "Vertical", active: true },
  { id: "seed-pvc-202", code: "PVC-202", color: "Oak", category: "Wood Tone", finish: "Matte", defaultGrain: "Vertical", active: true },
  { id: "seed-pvc-305", code: "PVC-305", color: "Stone Gray", category: "Solid", finish: "Matte", defaultGrain: "Horizontal", active: true },
  { id: "seed-pvc-410", code: "PVC-410", color: "Matte White", category: "Solid", finish: "Matte", defaultGrain: "Horizontal", active: true },
  { id: "seed-pvc-512", code: "PVC-512", color: "Graphite", category: "Solid", finish: "Gloss", defaultGrain: "Vertical", active: true },
];

const DEFAULT_MDF_THICKNESS: MdfThicknessOption[] = [
  { thicknessMm: 16, active: true },
  { thicknessMm: 18, active: true },
  { thicknessMm: 22, active: true },
  { thicknessMm: 25, active: true },
];

const DEFAULT_GRAIN_DIRECTIONS: GrainDirectionOption[] = [
  { id: "seed-vertical", code: "vertical", label: "Vertical", active: true },
  { id: "seed-horizontal", code: "horizontal", label: "Horizontal", active: true },
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
  return { ok: true, catalog: ensureCatalogIds(candidate.catalog) };
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
