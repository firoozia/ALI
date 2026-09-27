// Melamine order lines: product type, edge-band codes, and rotation.
// Mirrors ZINAX CAM's contract (docs/contracts/ORDER_CSV_V2.md in zinax-cam):
// the piece is seen from the front — edge 1 bottom, edge 2 top (parallel to
// the width), edge 3 left, edge 4 right (parallel to the height). Each edge is
// N | <band> | S | S/<band>. S is a groove mark for labels only; the real
// groove comes from a design code in ZINAX CAM. ZINAX CAM is the master of the
// band codes; its Settings → Edge banding → Export codes… file can be imported
// here so both apps use the same list.

export type ProductType = "vacuum_door" | "melamine";
export const PRODUCT_VACUUM: ProductType = "vacuum_door";
export const PRODUCT_MELAMINE: ProductType = "melamine";

export type Rotation = "Y" | "N";

export const EDGE_KEYS = ["edge1", "edge2", "edge3", "edge4"] as const;
export type EdgeKey = (typeof EDGE_KEYS)[number];

/** Short labels for the four edges, in the agreed order. */
export const EDGE_LABELS: Record<EdgeKey, { short: string; side: string }> = {
  edge1: { short: "E1", side: "Bottom" },
  edge2: { short: "E2", side: "Top" },
  edge3: { short: "E3", side: "Left" },
  edge4: { short: "E4", side: "Right" },
};

export interface EdgeBandCatalogItem {
  id: string;
  code: string;
  name: string;
  thicknessMm: number;
  widthMm: number;
  color: string;
  active: boolean;
}

/** Same factory list as ZINAX CAM: P1 0.5 mm, P2 1.0 mm, P3 2.0 mm, 22 mm wide. */
export function makeDefaultEdgeBands(): EdgeBandCatalogItem[] {
  return [
    { id: "seed-edge-p1", code: "P1", name: "P1", thicknessMm: 0.5, widthMm: 22, color: "", active: true },
    { id: "seed-edge-p2", code: "P2", name: "P2", thicknessMm: 1, widthMm: 22, color: "", active: true },
    { id: "seed-edge-p3", code: "P3", name: "P3", thicknessMm: 2, widthMm: 22, color: "", active: true },
  ];
}

/** Returns an error message, or "" when the band can join the list. Same rules as ZINAX CAM. */
export function edgeBandCodeError(code: string, others: EdgeBandCatalogItem[], selfId?: string): string {
  const text = code ?? "";
  if (text.trim() === "") return "Code is required.";
  if (text !== text.trim() || /\s/.test(text) || text.includes("/")) {
    return `Code "${text}" cannot contain spaces or "/".`;
  }
  if (!text.toUpperCase().startsWith("P")) return `Code "${text}" must start with P.`;
  const key = text.toLowerCase();
  if (others.some((b) => b.id !== selfId && b.code.trim().toLowerCase() === key)) {
    return `Code "${text}" is already in the list.`;
  }
  return "";
}

/** N, every active band, S, then S/<band>, in list order. */
export function edgeOptions(bands: EdgeBandCatalogItem[]): string[] {
  const active = bands.filter((b) => b.active).map((b) => b.code);
  return ["N", ...active, "S", ...active.map((c) => `S/${c}`)];
}

export interface ParsedEdge {
  band: string | null;
  groove: boolean;
  known: boolean;
  /** Canonical text when known (e.g. "s/p1" → "S/P1"), the original text otherwise. */
  text: string;
}

/**
 * Case-insensitive, trims spaces. Inactive bands are still known so an old
 * order that uses a retired code keeps its meaning; only new choices are
 * restricted to active codes.
 */
export function parseEdge(value: string | undefined | null, bands: EdgeBandCatalogItem[]): ParsedEdge {
  const text = String(value ?? "").trim();
  if (text === "" || text.toLowerCase() === "n") return { band: null, groove: false, known: true, text: "N" };
  if (text.toLowerCase() === "s") return { band: null, groove: true, known: true, text: "S" };
  let groove = false;
  let code = text;
  if (text.includes("/")) {
    const [left, ...rest] = text.split("/");
    const right = rest.join("/");
    if (left.trim().toLowerCase() !== "s" || right.includes("/")) {
      return { band: null, groove: false, known: false, text };
    }
    groove = true;
    code = right.trim();
  }
  const band = bands.find((b) => b.code.toLowerCase() === code.toLowerCase());
  if (!band) return { band: null, groove, known: false, text };
  return { band: band.code, groove, known: true, text: groove ? `S/${band.code}` : band.code };
}

/** Y/N from anything ZINAX CAM accepts; unknown text is returned unchanged so it is never silently rewritten. */
export function normalizeRotation(value: string | undefined | null): string {
  const text = String(value ?? "").trim();
  const low = text.toLowerCase();
  if (low === "" || ["y", "yes", "1", "true", "90", "allowed"].includes(low)) return "Y";
  if (["n", "no", "0", "false", "none", "locked"].includes(low)) return "N";
  return text;
}

export function isProductType(value: unknown): value is ProductType {
  return value === PRODUCT_VACUUM || value === PRODUCT_MELAMINE;
}

/**
 * Parses the band list written by ZINAX CAM (Settings → Edge banding → Export codes…):
 * header `code,name,thickness_mm,width_mm,color`, UTF-8, CRLF or LF. Header names are
 * matched without regard to case. Rows that break the code rules are reported, not kept.
 */
export function parseEdgeBandCodesCsv(
  text: string,
  makeId: () => string
): { bands: EdgeBandCatalogItem[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { bands: [], errors: ["The file is empty."] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iCode = col("code");
  const iThick = col("thickness_mm");
  if (iCode < 0 || iThick < 0) {
    return { bands: [], errors: ['The file needs at least the columns "code" and "thickness_mm".'] };
  }
  const iName = col("name");
  const iWidth = col("width_mm");
  const iColor = col("color");
  const bands: EdgeBandCatalogItem[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const cells = splitCsvLine(line);
    const code = (cells[iCode] ?? "").trim();
    const thickness = Number((cells[iThick] ?? "").trim());
    const rowNo = index + 2;
    const codeError = edgeBandCodeError(code, bands);
    if (codeError) {
      errors.push(`Row ${rowNo}: ${codeError}`);
      return;
    }
    if (!(thickness > 0)) {
      errors.push(`Row ${rowNo}: thickness for ${code} must be greater than 0.`);
      return;
    }
    const width = iWidth >= 0 ? Number((cells[iWidth] ?? "").trim()) : NaN;
    bands.push({
      id: makeId(),
      code,
      name: iName >= 0 ? (cells[iName] ?? "").trim() || code : code,
      thicknessMm: thickness,
      widthMm: Number.isFinite(width) && width > 0 ? width : 0,
      color: iColor >= 0 ? (cells[iColor] ?? "").trim() : "",
      active: true,
    });
  });
  return { bands, errors };
}

/** Minimal RFC 4180 line split (quoted fields, doubled quotes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
