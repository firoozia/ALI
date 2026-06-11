"""
FIROO CAM - Report Generator
Generates Summary and Detailed reports matching Solid Edge Report Viewer.
Output: HTML (printable) + optional PDF via weasyprint/pdfkit.

Report layout (from image 8):
  Header: Nest No | Qty | Sheet Dims | Nest Length | Nest Efficiency | Sheet Utilization | Parts Nested
  Visual: Sheet layout diagram with part IDs
  Table:  ID | Preview | Part Name | Width | Length | Area | Qty in Nest | Prod by Nest | Total in Job
  Footer: Date | File path | Page N of M
"""
from __future__ import annotations
import math
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from config import config


# ═══════════════════════════════════════════════════════════════
# SVG Sheet Renderer  (inline in HTML)
# ═══════════════════════════════════════════════════════════════
def render_sheet_svg(sheet, width=480, height=240) -> str:
    """Render a Sheet as an inline SVG matching the report viewer style."""
    sw, sh = sheet.width, sheet.height
    margin = 8
    scale  = min((width - 2*margin) / sw, (height - 2*margin) / sh)
    ox     = margin + ((width  - 2*margin) - sw*scale) / 2
    oy     = margin + ((height - 2*margin) - sh*scale) / 2

    COLORS = [
        "#c0392b","#e67e22","#27ae60","#2980b9","#8e44ad",
        "#16a085","#d35400","#f39c12","#1abc9c","#7f8c8d",
        "#e74c3c","#3498db","#2ecc71","#9b59b6","#1abc9c",
    ]

    lines = [
        f'<svg width="{width}" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg" '
        f'style="background:#fff;border:1px solid #ccc;">',
        # Sheet border
        f'<rect x="{ox:.1f}" y="{oy:.1f}" '
        f'width="{sw*scale:.1f}" height="{sh*scale:.1f}" '
        f'fill="#f8f8f8" stroke="#999" stroke-width="1.5"/>',
    ]

    # Parts
    for i, part in enumerate(sheet.parts):
        col  = COLORS[i % len(COLORS)]
        px   = ox + part.x * scale
        py   = oy + (sh - part.y - part.actual_height()) * scale
        pw   = part.actual_width()  * scale
        ph   = part.actual_height() * scale
        # Fill
        lines.append(
            f'<rect x="{px:.1f}" y="{py:.1f}" '
            f'width="{pw:.1f}" height="{ph:.1f}" '
            f'fill="{col}" fill-opacity="0.7" '
            f'stroke="{col}" stroke-width="0.8"/>')
        # Part ID label
        if pw > 16 and ph > 10:
            fs = min(10, int(min(pw,ph)*0.35))
            cx = px + pw/2; cy = py + ph/2 + fs*0.35
            lines.append(
                f'<text x="{cx:.1f}" y="{cy:.1f}" '
                f'text-anchor="middle" font-size="{fs}" '
                f'font-family="Segoe UI,sans-serif" '
                f'fill="white" font-weight="bold">'
                f'{i+1}</text>')

    lines.append('</svg>')
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Part color swatch SVG (for table)
# ═══════════════════════════════════════════════════════════════
def part_swatch_svg(w: float, h: float, color: str,
                    sw=36, sh=22) -> str:
    aspect = w / h if h > 0 else 1.0
    if aspect >= sw / sh:
        rw = sw - 4; rh = max(3, int(rw / aspect))
    else:
        rh = sh - 4; rw = max(3, int(rh * aspect))
    rx = (sw - rw) // 2; ry = (sh - rh) // 2
    return (f'<svg width="{sw}" height="{sh}" xmlns="http://www.w3.org/2000/svg">'
            f'<rect x="{rx}" y="{ry}" width="{rw}" height="{rh}" '
            f'fill="{color}" stroke="{color}" stroke-width="0.5"/></svg>')


SWATCH_COLORS = [
    "#c0392b","#e67e22","#27ae60","#2980b9","#8e44ad",
    "#16a085","#d35400","#f39c12","#1abc9c","#7f8c8d",
    "#e74c3c","#3498db","#2ecc71","#9b59b6","#1abc9c",
]


# ═══════════════════════════════════════════════════════════════
# Report Generator
# ═══════════════════════════════════════════════════════════════
class ReportGenerator:
    def __init__(self, sheets: list, all_parts: list,
                 order_id: str = "", customer: str = "",
                 file_path: str = ""):
        self._sheets    = sheets
        self._all_parts = all_parts   # original unexpanded part rows
        self._order_id  = order_id
        self._customer  = customer
        self._file_path = file_path or config.output_folder
        self._date      = datetime.now().strftime("%m/%d/%Y %I:%M:%S %p")

    # ── Public API ────────────────────────────────────────────

    def generate_summary(self, output_path: str = None) -> str:
        return self._generate(detailed=False, output_path=output_path)

    def generate_detailed(self, output_path: str = None) -> str:
        return self._generate(detailed=True, output_path=output_path)

    # ── Internal ──────────────────────────────────────────────

    def _generate(self, detailed: bool, output_path: str = None) -> str:
        total_sheets = len(self._sheets)
        total_parts  = sum(s.part_count() for s in self._sheets)
        avg_util     = (sum(s.utilization() for s in self._sheets)
                        / max(total_sheets, 1))
        avg_eff      = avg_util  # same for rectangular parts

        html = self._html_head(detailed)
        html += self._html_summary_header(
            total_sheets, total_parts, avg_util)

        for sheet_idx, sheet in enumerate(self._sheets):
            html += self._html_sheet_page(
                sheet, sheet_idx+1, total_sheets, detailed)

        html += self._html_foot()

        # Save
        out_dir  = Path(config.output_folder)
        out_dir.mkdir(parents=True, exist_ok=True)
        fname    = ("Detailed_Report.html" if detailed
                    else "Summary_Report.html")
        fpath    = Path(output_path) if output_path else out_dir / fname
        fpath.write_text(html, encoding="utf-8")
        return str(fpath)

    # ── HTML sections ─────────────────────────────────────────

    def _html_head(self, detailed: bool) -> str:
        title = "Detailed Report" if detailed else "Summary Report"
        return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>FIROO CAM — {title}</title>
<style>
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{
    font-family: "Segoe UI", Tahoma, sans-serif;
    font-size: 11px;
    color: #333;
    background: #fff;
}}
.page {{
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 12mm 10mm;
    page-break-after: always;
}}
/* Header bar (matches SE report viewer) */
.page-header {{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 2px solid #0078d4;
}}
.page-header-left {{ font-size:11px; line-height:1.6; }}
.page-header-left b {{ color:#0078d4; }}
.page-header-right {{
    font-size:11px; text-align:right; line-height:1.6;
}}
.nest-stats {{
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
    padding: 6px 10px;
    background: #f5f9ff;
    border: 1px solid #c8dff8;
    border-radius: 3px;
}}
.stat-item {{ text-align:center; }}
.stat-val  {{ font-size:14px; font-weight:700; color:#0078d4; }}
.stat-lbl  {{ font-size:10px; color:#888; }}
/* Sheet diagram */
.sheet-diagram {{
    margin: 8px 0;
    text-align: center;
}}
/* Parts table */
table {{
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 11px;
}}
thead tr {{
    background: #0078d4;
    color: white;
}}
thead th {{
    padding: 5px 8px;
    text-align: left;
    font-weight: 600;
    font-size: 11px;
}}
tbody tr:nth-child(even) {{ background: #f5f5f5; }}
tbody td {{
    padding: 4px 8px;
    border-bottom: 1px solid #eee;
    vertical-align: middle;
}}
.page-footer {{
    position: fixed;
    bottom: 8mm;
    left: 10mm;
    right: 10mm;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #999;
    border-top: 1px solid #eee;
    padding-top: 4px;
}}
.summary-table {{ margin-top:12px; }}
.summary-table th {{ background:#555; }}
@media print {{
    .page {{ margin:0; padding:12mm 10mm; }}
    @page {{ size: A4; margin:0; }}
}}
</style>
</head><body>
"""

    def _html_summary_header(self, total_sheets: int,
                              total_parts: int, avg_util: float) -> str:
        return f"""
<div class="page">
<div class="page-header">
  <div class="page-header-left">
    <b>FIROO CAM</b> — Nesting Report<br>
    Customer: {self._customer or "—"} &nbsp;|&nbsp;
    Order: {self._order_id or "—"}
  </div>
  <div class="page-header-right">
    {self._date}<br>
    {self._file_path}
  </div>
</div>

<div class="nest-stats">
  <div class="stat-item">
    <div class="stat-val">{total_sheets}</div>
    <div class="stat-lbl">Sheets Used</div>
  </div>
  <div class="stat-item">
    <div class="stat-val">{total_parts}</div>
    <div class="stat-lbl">Parts Nested</div>
  </div>
  <div class="stat-item">
    <div class="stat-val">{avg_util:.1f}%</div>
    <div class="stat-lbl">Avg Utilization</div>
  </div>
  <div class="stat-item">
    <div class="stat-val">
      {self._sheets[0].width:.0f}×{self._sheets[0].height:.0f}
    </div>
    <div class="stat-lbl">Sheet Size (mm)</div>
  </div>
</div>
</div>
"""

    def _html_sheet_page(self, sheet, sheet_no: int,
                          total_sheets: int, detailed: bool) -> str:
        util      = sheet.utilization()
        nest_len  = max((p.x + p.actual_width()
                        for p in sheet.parts), default=0)
        nest_eff  = util   # simplified
        area      = sheet.width * sheet.height / 1e6
        part_area = sum(p.actual_width()*p.actual_height()/1e6
                        for p in sheet.parts)

        # Collect unique parts with stats
        from collections import defaultdict
        part_stats = defaultdict(lambda: {
            "width":0,"length":0,"area":0,"qty_in_nest":0,
            "color":"#999","part_code":""})
        for i, p in enumerate(sheet.parts):
            key = p.part_code or f"Part_{i}"
            ps  = part_stats[key]
            ps["part_code"]   = key
            ps["width"]       = p.actual_width()
            ps["length"]      = p.actual_height()
            ps["area"]        = p.actual_width()*p.actual_height()/1e6
            ps["qty_in_nest"] += 1
            ps["color"]       = SWATCH_COLORS[i % len(SWATCH_COLORS)]

        # Total in job per part code
        total_in_job = {}
        for r in self._all_parts:
            code = r.get("part_code","")
            total_in_job[code] = r.get("qty", 1)

        svg = render_sheet_svg(sheet, width=520, height=260)

        # Parts table rows
        table_rows = ""
        for idx, (code, ps) in enumerate(part_stats.items()):
            color   = ps["color"]
            swatch  = part_swatch_svg(ps["width"], ps["length"], color)
            tij     = total_in_job.get(code, ps["qty_in_nest"])
            prod    = ps["qty_in_nest"]
            table_rows += f"""
<tr>
  <td style="text-align:center;font-weight:700;
      background:{color};color:white;width:28px;">{idx+1}</td>
  <td style="text-align:center;">{swatch}</td>
  <td>{code}</td>
  <td style="text-align:right;">{ps['width']:.2f}</td>
  <td style="text-align:right;">{ps['length']:.2f}</td>
  <td style="text-align:right;">{ps['area']:.5f}</td>
  <td style="text-align:center;">{ps['qty_in_nest']}</td>
  <td style="text-align:center;">
    {"- " if prod == 0 else ""}{prod}</td>
  <td style="text-align:center;">{tij}</td>
</tr>"""

        return f"""
<div class="page">
<div class="page-header">
  <div class="page-header-left">
    <b>Nest No: {sheet_no} of {total_sheets}</b>
    &nbsp;&nbsp; Quantity: 1
    &nbsp;&nbsp; Sheet: {sheet.width:.0f}×{sheet.height:.0f}
  </div>
  <div class="page-header-right">
    Sheet Dims: {sheet.width:.2f} x {sheet.height:.2f}
    &nbsp;|&nbsp; Nest Length: {nest_len:.2f}
    &nbsp;|&nbsp; <b>Nest Efficiency: {nest_eff:.2f}%</b>
    &nbsp;|&nbsp; <b>Sheet Utilization: {util:.2f}%</b>
    &nbsp;|&nbsp; Parts Nested: {sheet.part_count()}
  </div>
</div>

<div class="sheet-diagram">{svg}</div>

<table>
<thead>
<tr>
  <th style="width:28px;">ID</th>
  <th style="width:44px;">Preview</th>
  <th>Part Name</th>
  <th style="text-align:right;">Width</th>
  <th style="text-align:right;">Length</th>
  <th style="text-align:right;">Area</th>
  <th style="text-align:center;">Qty in Nest</th>
  <th style="text-align:center;">Prod by Nest</th>
  <th style="text-align:center;">Total in Job</th>
</tr>
</thead>
<tbody>{table_rows}</tbody>
</table>

<div class="page-footer">
  <span>{self._date}</span>
  <span>{self._file_path}</span>
  <span>Page {sheet_no} of {total_sheets}</span>
</div>
</div>
"""

    def _html_foot(self) -> str:
        return "</body></html>\n"


# ═══════════════════════════════════════════════════════════════
# Report Viewer Widget
# ═══════════════════════════════════════════════════════════════
try:
    from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout,
        QLabel, QPushButton, QComboBox, QFrame, QApplication,
        QFileDialog, QMessageBox)
    from PySide6.QtCore import Qt, Signal
    from PySide6.QtGui  import QColor
    try:
        from PySide6.QtWebEngineWidgets import QWebEngineView
        HAS_WEB = True
    except ImportError:
        HAS_WEB = False

    C_BG = QColor("#1e1e1e"); C_PANEL = QColor("#252526")
    C_BORDER = QColor("#3e3e42"); C_TEXT = QColor("#cccccc")
    C_DIM = QColor("#858585"); C_ACCENT = QColor("#0078d4")

    class ReportViewerWidget(QWidget):
        """
        Inline report viewer matching Solid Edge Report Viewer.
        Toolbar: navigation | zoom | part label selector | show file path
        """
        def __init__(self, parent=None):
            super().__init__(parent)
            self._sheets    = []
            self._all_parts = []
            self._html_path = ""
            self._build()
            self._apply_style()

        def set_data(self, sheets, all_parts,
                     order_id="", customer="", file_path=""):
            self._sheets    = sheets
            self._all_parts = all_parts
            self._gen       = ReportGenerator(
                sheets, all_parts, order_id, customer, file_path)

        def show_summary(self):
            if not self._sheets: return
            path = self._gen.generate_summary()
            self._load_html(path)

        def show_detailed(self):
            if not self._sheets: return
            path = self._gen.generate_detailed()
            self._load_html(path)

        def _build(self):
            root = QVBoxLayout(self)
            root.setContentsMargins(0,0,0,0)
            root.setSpacing(0)

            # Toolbar (matches SE report viewer)
            tb = QFrame(); tb.setFixedHeight(32)
            tb.setStyleSheet(
                f"background:{C_PANEL.name()};"
                f"border-bottom:1px solid {C_BORDER.name()};")
            tl = QHBoxLayout(tb)
            tl.setContentsMargins(6,3,6,3); tl.setSpacing(4)

            self._btn_first = QPushButton("|◀"); self._btn_first.setFixedSize(28,24)
            self._btn_prev  = QPushButton("◀");  self._btn_prev.setFixedSize(24,24)
            self._lbl_page  = QLabel("1 of 1")
            self._lbl_page.setStyleSheet(f"color:{C_TEXT.name()};")
            self._btn_next  = QPushButton("▶");  self._btn_next.setFixedSize(24,24)
            self._btn_last  = QPushButton("▶|"); self._btn_last.setFixedSize(28,24)

            self._cmb_zoom  = QComboBox(); self._cmb_zoom.setFixedWidth(70)
            for z in ["75%","100%","125%","150%"]:
                self._cmb_zoom.addItem(z)
            self._cmb_zoom.setCurrentIndex(1)

            tl.addWidget(self._btn_first); tl.addWidget(self._btn_prev)
            tl.addWidget(self._lbl_page)
            tl.addWidget(self._btn_next);  tl.addWidget(self._btn_last)
            tl.addWidget(QLabel(" "))
            tl.addWidget(QLabel("Zoom:")); tl.addWidget(self._cmb_zoom)

            tl.addWidget(QLabel("  Part Label:"))
            self._cmb_label = QComboBox(); self._cmb_label.setFixedWidth(100)
            for v in ["None","ID Number","Part Name"]:
                self._cmb_label.addItem(v)
            self._cmb_label.setCurrentIndex(1)
            tl.addWidget(self._cmb_label)

            self._chk_filepath = QPushButton("Show File Path")
            self._chk_filepath.setCheckable(True)
            self._chk_filepath.setChecked(True)
            tl.addWidget(self._chk_filepath)
            tl.addStretch()

            self._btn_save = QPushButton("💾 Save")
            self._btn_save.clicked.connect(self._save_report)
            tl.addWidget(self._btn_save)
            root.addWidget(tb)

            # Content area
            if HAS_WEB:
                self._view = QWebEngineView()
                root.addWidget(self._view, 1)
            else:
                from PySide6.QtWidgets import QTextBrowser
                self._view = QTextBrowser()
                self._view.setOpenExternalLinks(True)
                root.addWidget(self._view, 1)

        def _load_html(self, path: str):
            self._html_path = path
            if HAS_WEB:
                from PySide6.QtCore import QUrl
                self._view.setUrl(QUrl.fromLocalFile(path))
            else:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        html = f.read()
                    self._view.setHtml(html)
                except Exception as e:
                    self._view.setPlainText(f"Error loading report: {e}")

        def _save_report(self):
            if not self._html_path:
                QMessageBox.warning(self,"No Report","Generate a report first.")
                return
            path, _ = QFileDialog.getSaveFileName(
                self, "Save Report", self._html_path,
                "HTML Files (*.html);;All Files (*)")
            if path:
                import shutil
                shutil.copy2(self._html_path, path)

        def _apply_style(self):
            self.setStyleSheet(f"""
            QWidget {{ background:{C_BG.name()}; color:{C_TEXT.name()};
                      font-family:"Segoe UI",sans-serif; font-size:11px; }}
            QPushButton {{
                background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};
                border-radius:2px; padding:1px 6px; color:{C_TEXT.name()};
            }}
            QPushButton:hover {{ background:#3e3e42; }}
            QPushButton:checked {{
                background:{C_ACCENT.name()}; border-color:{C_ACCENT.name()};
                color:white;
            }}
            QComboBox {{
                background:#1a1a1a; border:1px solid {C_BORDER.name()};
                border-radius:2px; padding:1px 4px; color:{C_TEXT.name()};
            }}
            """)

    HAS_QT = True

except ImportError:
    HAS_QT = False


# ═══════════════════════════════════════════════════════════════
# Test
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))

    # Generate a test report with sample data
    from csv_handler import parse_csv, create_sample_csv
    from nesting_engine import NestingEngine

    sample = create_sample_csv("sample_order.csv")
    order, _ = parse_csv(sample)
    engine = NestingEngine()
    sheets = engine.run(order.parts, generations=5, time_limit=3.0)

    # Build part rows
    seen = {}
    for p in order.parts:
        base = p.part_code.rsplit("_",1)[0] if "_" in p.part_code else p.part_code
        if base not in seen:
            seen[base] = {"part_code":base,"width":p.width,
                          "height":p.height,"qty":1}
        else:
            seen[base]["qty"] += 1
    part_rows = list(seen.values())

    gen = ReportGenerator(sheets, part_rows,
                          order_id=order.order_id,
                          customer=order.customer,
                          file_path="C:/FIROO_CAM/sample.firoo")

    path_s = gen.generate_summary()
    path_d = gen.generate_detailed()
    print(f"✅ Summary Report:  {path_s}")
    print(f"✅ Detailed Report: {path_d}")

    if HAS_QT:
        from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout
        app = QApplication(sys.argv)
        w = QWidget(); w.setWindowTitle("FIROO CAM — Report Viewer")
        w.resize(1050, 800)
        vl = QVBoxLayout(w); vl.setContentsMargins(0,0,0,0)
        viewer = ReportViewerWidget()
        viewer.set_data(sheets, part_rows,
                        order.order_id, order.customer,
                        "C:/FIROO_CAM/sample.firoo")
        vl.addWidget(viewer)
        w.show()
        viewer.show_detailed()
        sys.exit(app.exec())
