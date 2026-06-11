"""
FIROO CAM - CSV Handler  (v2)

Supports two CSV formats:
  1. FIROO format:   PartCode | Width | Height | Qty | DesignCode | ...
  2. Solid Edge format: Name | Dim X | Dim Y | Area | Cut Distance | Entry Points | Quantity

Auto-detects format from headers.
"""
import csv
import uuid
from pathlib import Path
from typing import List, Tuple

from data_models import Part, Order

# ── Column aliases (FIROO format) ─────────────────────────────
COLUMN_ALIASES = {
    "part_code": ["partcode", "part_code", "code", "کد", "کدقطعه", "name", "part name"],
    "width":     ["width", "w", "x", "dim x", "dimx", "عرض", "پهنا", "length", "طول"],
    "height":    ["height", "h", "y", "dim y", "dimy", "ارتفاع", "عرض"],
    "qty":       ["qty", "quantity", "qyt", "تعداد", "count", "number"],
    "design":    ["designcode", "design", "design code", "طرح", "دیزاین"],
    "customer":  ["customer", "client", "مشتری"],
    "material":  ["material", "mat", "متریال", "جنس"],
    "thickness": ["thickness", "thick", "ضخامت", "t"],
    "label":     ["label", "tag", "لیبل", "برچسب"],
}


def _normalize(s: str) -> str:
    return s.strip().lower().replace(" ", "").replace("_", "")


def detect_column(headers: list, field: str):
    aliases = [_normalize(a) for a in COLUMN_ALIASES.get(field, [])]
    for h in headers:
        if _normalize(h) in aliases:
            return h
    return None


def _is_solid_edge_format(headers: list) -> bool:
    """Detect Solid Edge CSV: has 'Name', 'Dim X', 'Dim Y', 'Quantity' columns."""
    norm = [_normalize(h) for h in headers]
    return ("name" in norm and
            ("dimx" in norm or "dim x" in norm.replace(" ", "")) and
            ("dimy" in norm or "dim y" in norm.replace(" ", "")) and
            ("quantity" in norm or "qty" in norm))


def _parse_solid_edge(reader, headers: list, order: Order, errors: list):
    """
    Parse Solid Edge CSV format:
    Name | Dim X | Dim Y | Area | Cut Distance | Entry Points | Quantity
    """
    # Find columns
    col_name  = next((h for h in headers if _normalize(h) == "name"), None)
    col_dimx  = next((h for h in headers
                      if _normalize(h) in ("dimx", "dim x", "length")), None)
    col_dimy  = next((h for h in headers
                      if _normalize(h) in ("dimy", "dim y", "width", "height")), None)
    col_qty   = next((h for h in headers
                      if _normalize(h) in ("quantity", "qty")), None)

    if not all([col_dimx, col_dimy, col_qty]):
        errors.append("Solid Edge CSV: missing Dim X / Dim Y / Quantity columns")
        return

    for row_num, row in enumerate(reader, start=2):
        try:
            # Solid Edge stores DimX as the longer dimension, DimY as shorter
            dim_x = float(row.get(col_dimx, 0) or 0)
            dim_y = float(row.get(col_dimy, 0) or 0)
            qty   = int(float(row.get(col_qty, 1) or 1))

            if dim_x <= 0 or dim_y <= 0:
                errors.append(f"Row {row_num}: invalid dimensions")
                continue
            if qty <= 0:
                qty = 1

            # Width = larger dim, Height = smaller (standard orientation)
            width  = max(dim_x, dim_y)
            height = min(dim_x, dim_y)

            # Name from Name column, or auto-generate
            name = ""
            if col_name:
                name = str(row.get(col_name, "")).strip()
            if not name:
                name = f"Rectangle ({int(dim_x)} x {int(dim_y)})"

            # Expand by quantity
            for i in range(1, qty + 1):
                part_code = f"{name}_{i}" if qty > 1 else name
                part = Part(
                    part_id    = str(uuid.uuid4())[:8],
                    part_code  = part_code,
                    width      = width,
                    height     = height,
                    thickness  = 18.0,
                    design_code= "cd0",
                    customer   = "",
                    material   = "MDF",
                    label      = "",
                    status     = "pending",
                )
                order.add_part(part)

        except Exception as e:
            errors.append(f"Row {row_num}: {e}")


def _parse_firoo(reader, headers: list, order: Order, errors: list):
    """Parse FIROO CAM CSV format with full column aliases."""
    col = {field: detect_column(headers, field) for field in COLUMN_ALIASES}

    missing = [r for r in ["width", "height", "qty"] if not col[r]]
    if missing:
        errors.append(f"Required columns not found: {missing}")
        return

    for row_num, row in enumerate(reader, start=2):
        try:
            width  = float(row[col["width"]])
            height = float(row[col["height"]])
            qty    = int(float(row[col["qty"]]))
            pc     = (row.get(col["part_code"] or "", "") or
                      f"P{row_num}").strip()
            design = (row.get(col["design"] or "", "") or "cd0").strip()
            customer  = row.get(col["customer"] or "", "") or ""
            material  = row.get(col["material"] or "", "") or "MDF"
            label     = row.get(col["label"]    or "", "") or ""
            try:
                thickness = float(row.get(col["thickness"] or "", 18) or 18)
            except (ValueError, TypeError):
                thickness = 18.0

            if width <= 0 or height <= 0:
                errors.append(f"Row {row_num}: invalid dimensions")
                continue
            if qty <= 0:
                errors.append(f"Row {row_num}: invalid quantity")
                continue

            for i in range(1, qty + 1):
                code = f"{pc}_{i}" if qty > 1 else pc
                part = Part(
                    part_id    = str(uuid.uuid4())[:8],
                    part_code  = code,
                    width      = width,
                    height     = height,
                    thickness  = thickness,
                    design_code= design,
                    customer   = customer,
                    material   = material,
                    label      = label,
                    status     = "pending",
                )
                order.add_part(part)
                if not order.customer and customer:
                    order.customer = customer

        except Exception as e:
            errors.append(f"Row {row_num}: {e}")


def parse_csv(file_path: str) -> Tuple[Order, List[str]]:
    """
    Parse a CSV file (FIROO or Solid Edge format).
    Returns (Order, errors_list).
    """
    errors = []
    order  = Order(order_id=str(uuid.uuid4())[:8])
    path   = Path(file_path)

    if not path.exists():
        return order, [f"File not found: {file_path}"]

    try:
        # Try UTF-8 with BOM first (Excel exports), fallback to cp1256 (Persian)
        for encoding in ["utf-8-sig", "utf-8", "cp1256", "latin-1"]:
            try:
                with open(path, "r", encoding=encoding, newline="") as f:
                    content = f.read()
                break
            except UnicodeDecodeError:
                continue
        else:
            return order, ["Cannot read file: unsupported encoding"]

        reader  = csv.DictReader(content.splitlines())
        headers = reader.fieldnames or []

        if not headers:
            return order, ["CSV file has no headers"]

        # Auto-detect format
        if _is_solid_edge_format(headers):
            _parse_solid_edge(reader, headers, order, errors)
        else:
            _parse_firoo(reader, headers, order, errors)

    except Exception as e:
        errors.append(f"Error reading file: {e}")

    return order, errors


def create_sample_csv(path: str = "sample_order.csv") -> str:
    """Create a sample FIROO format CSV."""
    rows = [
        ["PartCode", "Width", "Height", "Qty", "DesignCode",
         "Customer", "Material", "Thickness", "Label"],
        ["DOOR-001", "900",  "500", "2", "cd1", "Ali", "MDF", "18", "A01"],
        ["DOOR-002", "875",  "543", "1", "cd2", "Ali", "MDF", "18", "A02"],
        ["DOOR-003", "650",  "400", "3", "cd1", "Ali", "MDF", "18", "A03"],
        ["DOOR-004", "1000", "600", "1", "cd7", "Ali", "MDF", "18", "A04"],
        ["DOOR-005", "750",  "450", "2", "cd1", "Ali", "MDF", "18", "A05"],
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)
    print(f"Sample CSV created: {path}")
    return path


# ── Module-level helper: get unique parts from expanded list ──
def get_unique_rows(parts: list) -> list:
    """
    Collapse expanded parts back into unique rows with qty.
    Returns list of dicts for parts_tab display.
    """
    seen = {}
    for p in parts:
        # Use base code (strip _N suffix)
        base = p.part_code.rsplit("_", 1)[0] if "_" in p.part_code else p.part_code
        if base not in seen:
            seen[base] = {
                "part_code":   base,
                "width":       p.width,
                "height":      p.height,
                "qty":         1,
                "thickness":   p.thickness,
                "design_code": p.design_code,
                "material":    p.material,
                "customer":    p.customer,
                "label":       p.label,
            }
        else:
            seen[base]["qty"] += 1
    return list(seen.values())


if __name__ == "__main__":
    import sys

    # Test with sample
    sample = create_sample_csv("sample_order.csv")
    order, errors = parse_csv(sample)
    print(f"Customer: {order.customer}")
    print(f"Parts: {order.total_parts()}")
    for p in order.parts[:5]:
        print(f"  {p.part_code:20} {p.width}x{p.height}  D{p.design_code}")
    if errors:
        print("Errors:")
        for e in errors:
            print(f"  {e}")

    # Test with Solid Edge format
    test_se = "test_se.csv"
    with open(test_se, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Name", "Dim X", "Dim Y", "Area", "Cut Distance",
                    "Entry Points", "Quantity"])
        w.writerow(["Rectangle (349 x 1200)", "1200", "349",
                    "0.41880", "3098", "1", "40"])
        w.writerow(["Rectangle (568 x 1298)", "1298", "568",
                    "0.73726", "3732", "1", "30"])

    order2, errors2 = parse_csv(test_se)
    print(f"\nSolid Edge format: {order2.total_parts()} parts")
    for p in order2.parts[:3]:
        print(f"  {p.part_code:30} {p.width}x{p.height}")
    print("✅ CSV Handler OK")
