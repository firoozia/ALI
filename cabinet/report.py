"""Printable HTML report: the summary + the build reason ("دلیل").

Self-contained HTML (inline CSS, no external files), print-friendly, RTL-aware.
PDF can be added later by printing this HTML; HTML first per the plan.
"""
from __future__ import annotations

import datetime
import html
from typing import List, Optional

from .generator import cut_size
from .library import MaterialLibrary
from .models import GeneratedPart
from .order import Order, build_order
from .summary import Summary, summarize

__all__ = ["render_report_html", "write_report_html"]


def _esc(x) -> str:
    return html.escape(str(x))


def _fmt(x) -> str:
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return _esc(x)
    return str(int(xf)) if xf == int(xf) else f"{xf:g}"


def render_report_html(order: Order, lib: MaterialLibrary,
                       parts: Optional[List[GeneratedPart]] = None,
                       summary: Optional[Summary] = None,
                       lang: str = "fa") -> str:
    if parts is None:
        parts = build_order(order, lib)
    if summary is None:
        summary = summarize(parts, lib)
    rtl = lang in ("fa", "ar")
    T = _TEXTS.get(lang, _TEXTS["en"])
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    out: List[str] = []
    out.append(f"""<!doctype html><html lang="{lang}" dir="{'rtl' if rtl else 'ltr'}">
<head><meta charset="utf-8"><title>{_esc(T['title'])} — {_esc(order.project_name or order.order_no)}</title>
<style>{_CSS}</style></head><body>""")

    # header
    out.append(f"<h1>{_esc(T['title'])}</h1>")
    out.append('<table class="meta"><tbody>')
    out.append(f"<tr><th>{_esc(T['order'])}</th><td>{_esc(order.order_no)}</td>"
               f"<th>{_esc(T['customer'])}</th><td>{_esc(order.customer_name)}</td></tr>")
    out.append(f"<tr><th>{_esc(T['project'])}</th><td>{_esc(order.project_name)}</td>"
               f"<th>{_esc(T['date'])}</th><td class='ltr'>{_esc(now)}</td></tr>")
    out.append("</tbody></table>")

    # summary
    out.append(f"<h2>{_esc(T['summary'])}</h2>")
    out.append(f"<p>{_esc(T['pieces'])}: <b>{summary.total_pieces}</b> "
               f"({_esc(T['melamine'])} {summary.melamine_pieces}، "
               f"{_esc(T['vacuum'])} {summary.vacuum_pieces})</p>")

    if summary.bands:
        out.append(f"<h3>{_esc(T['bands'])}</h3><table><thead><tr>"
                   f"<th>{_esc(T['band'])}</th><th>{_esc(T['meters'])}</th></tr></thead><tbody>")
        for b in summary.bands:
            out.append(f"<tr><td class='code'>{_esc(b.code)}</td><td class='ltr'>{_fmt(b.meters)}</td></tr>")
        out.append("</tbody></table>")

    if summary.materials:
        out.append(f"<h3>{_esc(T['materials'])}</h3><table><thead><tr>"
                   f"<th>{_esc(T['material'])}</th><th>{_esc(T['thickness'])}</th>"
                   f"<th>{_esc(T['pieces'])}</th><th>{_esc(T['area'])}</th>"
                   f"<th>{_esc(T['sheets_est'])}</th></tr></thead><tbody>")
        for m in summary.materials:
            out.append(f"<tr><td class='code'>{_esc(m.pvc_code)}</td>"
                       f"<td class='ltr'>{_fmt(m.thickness_mm)}</td>"
                       f"<td class='ltr'>{m.pieces}</td>"
                       f"<td class='ltr'>{_fmt(m.area_m2)}</td>"
                       f"<td class='ltr'>{'' if m.est_sheets is None else m.est_sheets}</td></tr>")
        out.append("</tbody></table>")
        out.append(f"<p class='note'>{_esc(T['sheets_note'])}</p>")

    # build reason, grouped by unit
    out.append(f"<h2>{_esc(T['reason'])}</h2>")
    for unit in order.units:
        uparts = [p for p in parts if p.unit_name == (unit.name or unit.template.name_en or unit.template.id)]
        pr = ", ".join(f"{k}={_fmt(v)}" for k, v in unit.effective_params().items())
        out.append(f"<h3>{_esc(unit.name or unit.template.name_en)} "
                   f"<span class='dim'>[{_esc(T['method'])}: {_esc(unit.build.back_method)}]</span></h3>")
        out.append(f"<p class='dim'>{_esc(pr)}</p>")
        out.append(_parts_table(uparts, lib, T))

    manual = [p for p in parts if p.part_type == "manual"]
    if manual:
        out.append(f"<h3>{_esc(T['manual'])}</h3>")
        out.append(_parts_table(manual, lib, T))

    out.append("</body></html>")
    return "".join(out)


def _parts_table(parts, lib, T) -> str:
    rows = [f"<table><thead><tr>"
            f"<th>{_esc(T['part'])}</th><th>{_esc(T['qty'])}</th>"
            f"<th>{_esc(T['order_size'])}</th><th>{_esc(T['cut_size'])}</th>"
            f"<th>{_esc(T['thickness'])}</th><th>{_esc(T['material'])}</th>"
            f"<th>{_esc(T['edges'])}</th><th>{_esc(T['formula'])}</th></tr></thead><tbody>"]
    for p in parts:
        cw, ch = cut_size(p, lib)
        edges = " ".join([p.edge_1, p.edge_2, p.edge_3, p.edge_4])
        name = p.name_fa or p.name_en or p.part_type
        trace = f"{p.formula_trace.get('width','')} | {p.formula_trace.get('height','')}"
        rows.append(f"<tr><td>{_esc(name)}</td><td class='ltr'>{p.quantity}</td>"
                    f"<td class='ltr'>{_fmt(p.width_mm)}×{_fmt(p.height_mm)}</td>"
                    f"<td class='ltr'>{_fmt(cw)}×{_fmt(ch)}</td>"
                    f"<td class='ltr'>{_fmt(p.thickness_mm)}</td>"
                    f"<td class='code'>{_esc(p.pvc_code)}</td>"
                    f"<td class='code'>{_esc(edges)}</td>"
                    f"<td class='ltr formula'>{_esc(trace)}</td></tr>")
    rows.append("</tbody></table>")
    return "".join(rows)


def write_report_html(order: Order, lib: MaterialLibrary, path: str,
                      lang: str = "fa") -> str:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render_report_html(order, lib, lang=lang))
    return path


_CSS = """
body{font-family:Tahoma,Arial,sans-serif;font-size:13px;color:#222;margin:24px;}
h1{font-size:20px;margin:0 0 12px;} h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid #999;}
h3{font-size:14px;margin:14px 0 4px;}
table{border-collapse:collapse;margin:4px 0 10px;width:100%;}
th,td{border:1px solid #bbb;padding:3px 7px;text-align:start;vertical-align:top;}
thead th{background:#eee;}
table.meta{width:auto;} table.meta th{background:#f6f6f6;}
.ltr{direction:ltr;unicode-bidi:plaintext;} .code,.formula{font-family:Consolas,monospace;direction:ltr;unicode-bidi:plaintext;}
.dim{color:#666;} .note{color:#777;font-size:12px;}
@media print{body{margin:0;}}
"""

_TEXTS = {
    "fa": {
        "title": "لیست قطعات", "order": "سفارش", "customer": "مشتری", "project": "پروژه",
        "date": "تاریخ", "summary": "خلاصه", "pieces": "تعداد قطعه", "melamine": "ملامین",
        "vacuum": "وکیوم", "bands": "متراژ نوار", "band": "نوار", "meters": "متر",
        "materials": "متریال‌ها", "material": "متریال", "thickness": "ضخامت", "area": "مساحت (m²)",
        "sheets_est": "تخمین ورق", "sheets_note": "* تعداد ورق فقط تخمینِ مساحتی است؛ نست دقیق را زیناکس انجام می‌دهد.",
        "reason": "دلیل (تفکیک ساخت)", "method": "روش", "manual": "قطعه‌های دستی",
        "part": "قطعه", "qty": "تعداد", "order_size": "اندازه سفارش", "cut_size": "اندازه برش",
        "edges": "نوار لبه‌ها", "formula": "فرمول",
    },
    "en": {
        "title": "Cut List", "order": "Order", "customer": "Customer", "project": "Project",
        "date": "Date", "summary": "Summary", "pieces": "Pieces", "melamine": "Melamine",
        "vacuum": "Vacuum", "bands": "Edge-band meters", "band": "Band", "meters": "m",
        "materials": "Materials", "material": "Material", "thickness": "Thickness", "area": "Area (m²)",
        "sheets_est": "Sheets (est.)", "sheets_note": "* Sheet count is an area estimate only; ZINAX does the real nesting.",
        "reason": "Build reason (breakdown)", "method": "method", "manual": "Manual parts",
        "part": "Part", "qty": "Qty", "order_size": "Order size", "cut_size": "Cut size",
        "edges": "Edges", "formula": "Formula",
    },
}
