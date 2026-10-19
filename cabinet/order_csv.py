"""Write generated parts to a ZINAX ORDER_CSV_V2 file.

Column order follows the real ZINAX sample files
(docs/crosscheck/real_zinax/*/ORDER.csv). ``width_mm``/``height_mm`` are the
order (finished) size; ZINAX applies the edge-band cut-size subtraction and the
band-meter rollup itself on import.
"""
from __future__ import annotations

import csv
import io
from typing import Iterable, List, Optional

from .models import GeneratedPart

__all__ = ["ORDER_CSV_HEADER", "OrderMeta", "to_rows", "write_order_csv", "to_csv_string"]

ORDER_CSV_HEADER = [
    "order_no", "line_no", "customer_name", "project_name", "product_type",
    "width_mm", "height_mm", "quantity", "design_code", "mdf_thickness_mm",
    "pvc_code", "pvc_color", "grain_direction", "rotation",
    "edge_1", "edge_2", "edge_3", "edge_4",
]


class OrderMeta:
    def __init__(self, order_no: str = "SO", customer_name: str = "",
                 project_name: str = ""):
        self.order_no = order_no
        self.customer_name = customer_name
        self.project_name = project_name


def _num(x: float) -> str:
    return str(int(x)) if float(x) == int(x) else f"{x:g}"


def to_rows(parts: Iterable[GeneratedPart], meta: Optional[OrderMeta] = None) -> List[dict]:
    meta = meta or OrderMeta()
    rows: List[dict] = []
    for i, p in enumerate(parts, start=1):
        rows.append({
            "order_no": meta.order_no,
            "line_no": i,
            "customer_name": meta.customer_name,
            "project_name": meta.project_name,
            "product_type": p.product_type,
            "width_mm": _num(p.width_mm),
            "height_mm": _num(p.height_mm),
            "quantity": int(p.quantity),
            "design_code": p.design_code,
            "mdf_thickness_mm": _num(p.thickness_mm),
            "pvc_code": p.pvc_code,
            "pvc_color": p.pvc_color,
            "grain_direction": "",          # stored note only; ZINAX uses its own grain setting
            "rotation": p.rotation,
            "edge_1": p.edge_1,
            "edge_2": p.edge_2,
            "edge_3": p.edge_3,
            "edge_4": p.edge_4,
        })
    return rows


def to_csv_string(parts: Iterable[GeneratedPart], meta: Optional[OrderMeta] = None) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=ORDER_CSV_HEADER, lineterminator="\n")
    writer.writeheader()
    for row in to_rows(parts, meta):
        writer.writerow(row)
    return buf.getvalue()


def write_order_csv(parts: Iterable[GeneratedPart], path: str,
                    meta: Optional[OrderMeta] = None) -> str:
    # utf-8-sig so the BOM matches ZINAX's real sample files.
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write(to_csv_string(parts, meta))
    return path
