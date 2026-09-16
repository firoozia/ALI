// Company-editable catalogs — design codes, PVC/membrane colors, MDF
// thickness options, and grain directions. These are the "each company
// enters their own codes" lists referenced from Settings, and are what
// the Door Order Table's select editors read from (see orderSchema.ts's
// OrderRowColumn.editor kinds).

export interface DesignCatalogItem {
  code: string;
  name: string;
}

export interface PvcCatalogItem {
  code: string;
  color: string;
}

export interface Catalog {
  designs: DesignCatalogItem[];
  pvcColors: PvcCatalogItem[];
  mdfThickness: string[];
  grainDirections: string[];
}

const DEFAULT_DESIGNS: DesignCatalogItem[] = [
  { code: "ZD001", name: "Classic Offset Door" },
  { code: "ZD002", name: "Double Offset Door" },
  { code: "ZD003", name: "Modern Groove Door" },
  { code: "ZD004", name: "Shaker V-Groove" },
  { code: "ZD005", name: "Raised Panel Classic" },
];

const DEFAULT_PVC_COLORS: PvcCatalogItem[] = [
  { code: "PVC-101", color: "Walnut" },
  { code: "PVC-202", color: "Oak" },
  { code: "PVC-305", color: "Stone Gray" },
  { code: "PVC-410", color: "Matte White" },
  { code: "PVC-512", color: "Graphite" },
];

const DEFAULT_MDF_THICKNESS = ["16 mm", "18 mm", "22 mm", "25 mm"];
const DEFAULT_GRAIN_DIRECTIONS = ["Vertical", "Horizontal"];

export function makeDefaultCatalog(): Catalog {
  return {
    designs: DEFAULT_DESIGNS.map((d) => ({ ...d })),
    pvcColors: DEFAULT_PVC_COLORS.map((p) => ({ ...p })),
    mdfThickness: [...DEFAULT_MDF_THICKNESS],
    grainDirections: [...DEFAULT_GRAIN_DIRECTIONS],
  };
}
