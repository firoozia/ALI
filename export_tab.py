"""
FIROO CAM - Export Tab  (v2)
Solid Edge 2D Nesting Export tab — exact replica.

Toolbar: Solid Edge | DXF/DWG | G-code | Summary Report | Detailed Report
DXF Dialog: fully replaced with Solid Edge exact layout (s13 screenshot)
"""
from __future__ import annotations
import os
from pathlib import Path
from typing import List, Optional

from PySide6.QtCore  import Qt, Signal, QThread
from PySide6.QtGui   import (QColor, QPainter, QBrush, QPen, QPixmap)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFrame, QLabel,
    QPushButton, QDialog, QDialogButtonBox, QFormLayout,
    QLineEdit, QComboBox, QCheckBox, QGroupBox, QRadioButton,
    QButtonGroup, QFileDialog, QMessageBox, QScrollArea,
    QApplication, QProgressBar, QTextEdit, QSplitter,
    QSpinBox, QSizePolicy
)

from language_manager import lang
from config import config

C_BG     = QColor("#1e1e1e")
C_PANEL  = QColor("#252526")
C_BORDER = QColor("#3e3e42")
C_ACCENT = QColor("#0078d4")
C_TEXT   = QColor("#cccccc")
C_DIM    = QColor("#858585")
C_GOOD   = QColor("#4ec9b0")


# ═══════════════════════════════════════════════════════════════
# DXF Export Dialog  — Solid Edge exact replica (s13 screenshot)
# ═══════════════════════════════════════════════════════════════
class DXFExportDialog(QDialog):
    """
    Export Nest dialog matching Solid Edge 2D Nesting exactly.
    Left: all option groups | Right: black preview + navigation
    Bottom: Export | Cancel
    """

    def __init__(self, sheets=None, parent=None):
        super().__init__(parent)
        self._sheets       = sheets or []
        self._preview_page = 0
        self.setWindowTitle("Export Nest")
        self.setModal(True)
        self.setMinimumSize(720, 580)
        self._build()
        self._apply_style()
        self._draw_preview()

    # ── Build ─────────────────────────────────────────────────
    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Body: left options | right preview
        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        # ── LEFT: scrollable option panels ───────────────────
        left_scroll = QScrollArea()
        left_scroll.setWidgetResizable(True)
        left_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        left_scroll.setFixedWidth(370)
        left_scroll.setStyleSheet("border:none;")

        left_w = QFrame()
        left   = QVBoxLayout(left_w)
        left.setContentsMargins(12, 12, 12, 12)
        left.setSpacing(8)
        left_scroll.setWidget(left_w)

        # Group 1 ─ Output Nested Parts
        grp1 = QGroupBox("Output Nested Parts")
        g1   = QFormLayout(grp1)
        g1.setSpacing(5)

        self._chk_single_layer = QCheckBox("Parts on Single Layer")
        self._chk_single_layer.setChecked(False)
        self._txt_parts_layer  = QLineEdit("-NestedParts-")
        self._cmb_orientation  = QComboBox()
        for v in ["0", "90", "180", "270"]:
            self._cmb_orientation.addItem(v)
        self._chk_part_labels = QCheckBox("Add Part Labels")
        self._chk_part_labels.setChecked(False)
        self._chk_nest_stats  = QCheckBox("Add Nest Statistics")
        self._chk_nest_stats.setChecked(False)

        g1.addRow(self._chk_single_layer)
        g1.addRow("Parts Layer Name:", self._txt_parts_layer)
        g1.addRow("Nest Orientation:", self._cmb_orientation)
        g1.addRow(self._chk_part_labels)
        g1.addRow(self._chk_nest_stats)
        left.addWidget(grp1)

        # Group 2 ─ Also Output Sheets
        grp2 = QGroupBox("Also Output Sheets?")
        g2   = QFormLayout(grp2)
        g2.setSpacing(5)
        self._chk_output_sheet = QCheckBox("Yes, Output Sheets")
        self._chk_output_sheet.setChecked(True)
        self._txt_sheet_layer  = QLineEdit("sheet")
        g2.addRow(self._chk_output_sheet)
        g2.addRow("Sheet Layer Name:", self._txt_sheet_layer)
        left.addWidget(grp2)

        # Group 3 ─ Multiple Sheet Layouts
        grp3 = QGroupBox("Multiple Sheet Layouts")
        g3   = QVBoxLayout(grp3)
        g3.setSpacing(4)
        self._bg_multi       = QButtonGroup(self)
        self._rb_single_file = QRadioButton("Output to Single File")
        self._rb_multi_file  = QRadioButton("Output to Multiple Files")
        self._rb_single_file.setChecked(True)
        self._bg_multi.addButton(self._rb_single_file, 0)
        self._bg_multi.addButton(self._rb_multi_file,  1)
        g3.addWidget(self._rb_single_file)
        g3.addWidget(self._rb_multi_file)
        left.addWidget(grp3)

        # Group 4 ─ Compatibility Options
        grp4 = QGroupBox("Compatibility Options")
        g4   = QFormLayout(grp4)
        g4.setSpacing(5)
        self._cmb_export_using = QComboBox()
        for v in ["Basic Lines/Arcs", "Polylines", "Splines"]:
            self._cmb_export_using.addItem(v)
        self._chk_parts_blocks  = QCheckBox("Export Parts as Blocks")
        self._chk_nests_blocks  = QCheckBox("Export Nests as Blocks")
        self._chk_remove_common = QCheckBox("Remove Common Edges")
        g4.addRow("Export Using:", self._cmb_export_using)
        g4.addRow(self._chk_parts_blocks)
        g4.addRow(self._chk_nests_blocks)
        g4.addRow(self._chk_remove_common)
        left.addWidget(grp4)

        # Group 5 ─ Loop Direction
        grp5 = QGroupBox("Loop Direction")
        g5   = QFormLayout(grp5)
        g5.setSpacing(5)
        self._cmb_outers = QComboBox()
        self._cmb_inners = QComboBox()
        for cmb in [self._cmb_outers, self._cmb_inners]:
            cmb.addItem("Counter-Clockwise")
            cmb.addItem("Clockwise")
        g5.addRow("Outers:", self._cmb_outers)
        g5.addRow("Inners:", self._cmb_inners)
        left.addWidget(grp5)

        # Group 6 ─ Export Units
        grp6 = QGroupBox("Export Units")
        g6   = QHBoxLayout(grp6)
        self._bg_units  = QButtonGroup(self)
        self._rb_inches = QRadioButton("Inches")
        self._rb_mm     = QRadioButton("Millimeters")
        self._rb_mm.setChecked(True)
        self._bg_units.addButton(self._rb_inches, 0)
        self._bg_units.addButton(self._rb_mm,     1)
        g6.addWidget(self._rb_inches)
        g6.addWidget(self._rb_mm)
        g6.addStretch()
        left.addWidget(grp6)

        # Group 7 ─ Dxf Version
        grp7 = QGroupBox("Dxf Version")
        g7   = QVBoxLayout(grp7)
        self._cmb_dxf_ver = QComboBox()
        for v in ["AutoCAD 2000 / 2002",
                  "AutoCAD 2004 / 2006",
                  "AutoCAD 2007 / 2009",
                  "AutoCAD 2010 / 2012",
                  "AutoCAD 2013 / 2014",
                  "AutoCAD 2018+"]:
            self._cmb_dxf_ver.addItem(v)
        g7.addWidget(self._cmb_dxf_ver)
        left.addWidget(grp7)

        # Output folder row
        path_row = QHBoxLayout()
        path_row.addWidget(QLabel("Output Folder:"))
        self._txt_output = QLineEdit(config.output_folder)
        self._btn_browse = QPushButton("Browse...")
        self._btn_browse.setFixedWidth(70)
        self._btn_browse.clicked.connect(self._browse)
        path_row.addWidget(self._txt_output, 1)
        path_row.addWidget(self._btn_browse)
        left.addLayout(path_row)

        left.addStretch()
        body.addWidget(left_scroll)

        # ── RIGHT: Preview panel ──────────────────────────────
        right_w = QWidget()
        right_w.setMinimumWidth(300)
        right   = QVBoxLayout(right_w)
        right.setContentsMargins(8, 8, 8, 8)
        right.setSpacing(6)

        prev_lbl = QLabel("Preview")
        prev_lbl.setStyleSheet(
            f"color:{C_DIM.name()}; font-size:11px; font-weight:600;")
        right.addWidget(prev_lbl)

        self._preview = QLabel()
        self._preview.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Expanding)
        self._preview.setStyleSheet(
            f"background:#000000; border:1px solid {C_BORDER.name()};")
        self._preview.setAlignment(Qt.AlignCenter)
        self._preview.setMinimumSize(260, 360)
        right.addWidget(self._preview, 1)

        # Show Preview checkbox
        self._chk_show_preview = QCheckBox("Show Preview")
        self._chk_show_preview.setChecked(True)
        self._chk_show_preview.toggled.connect(self._draw_preview)
        right.addWidget(self._chk_show_preview)

        # Navigation  < 1 of N >
        nav_row = QHBoxLayout()
        self._btn_prev_page = QPushButton("<")
        self._btn_next_page = QPushButton(">")
        self._lbl_page = QLabel("1 of 1")
        self._lbl_page.setAlignment(Qt.AlignCenter)
        self._lbl_page.setStyleSheet(f"color:{C_DIM.name()};")
        for b in [self._btn_prev_page, self._btn_next_page]:
            b.setFixedSize(28, 22)
        self._btn_prev_page.clicked.connect(self._prev_page)
        self._btn_next_page.clicked.connect(self._next_page)
        nav_row.addWidget(self._btn_prev_page)
        nav_row.addWidget(self._lbl_page, 1)
        nav_row.addWidget(self._btn_next_page)
        right.addLayout(nav_row)

        body.addWidget(right_w, 1)
        root.addLayout(body, 1)

        # ── Bottom button bar ─────────────────────────────────
        btn_bar = QFrame()
        btn_bar.setFixedHeight(46)
        btn_bar.setStyleSheet(
            f"background:{C_PANEL.name()};"
            f"border-top:1px solid {C_BORDER.name()};")
        btn_lay = QHBoxLayout(btn_bar)
        btn_lay.setContentsMargins(12, 8, 12, 8)
        btn_lay.addStretch()

        self._btn_export = QPushButton("Export")
        self._btn_cancel = QPushButton("Cancel")
        self._btn_export.setFixedSize(80, 28)
        self._btn_cancel.setFixedSize(70, 28)
        self._btn_export.setStyleSheet(
            f"background:{C_ACCENT.name()}; border:1px solid {C_ACCENT.name()};"
            f"border-radius:3px; color:white; font-weight:600;")
        self._btn_export.clicked.connect(self.accept)
        self._btn_cancel.clicked.connect(self.reject)
        btn_lay.addWidget(self._btn_export)
        btn_lay.addWidget(self._btn_cancel)
        root.addWidget(btn_bar)

    # ── Preview ───────────────────────────────────────────────
    def _draw_preview(self):
        pw = max(260, self._preview.width()  - 4)
        ph = max(360, self._preview.height() - 4)

        if not self._chk_show_preview.isChecked() or not self._sheets:
            pix = QPixmap(pw, ph)
            pix.fill(QColor("#000000"))
            p = QPainter(pix)
            p.setPen(QPen(QColor(C_DIM)))
            p.drawText(pix.rect(), Qt.AlignCenter, "No layout")
            p.end()
            self._preview.setPixmap(pix)
            n = max(1, len(self._sheets))
            self._lbl_page.setText(f"{self._preview_page+1} of {n}")
            return

        sheet = self._sheets[self._preview_page]
        pix   = QPixmap(pw, ph)
        pix.fill(QColor("#000000"))
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing, False)

        sw, sh   = sheet.width, sheet.height
        margin   = 12
        scale    = min((pw - 2*margin) / sw, (ph - 2*margin) / sh)
        ox       = (pw - sw * scale) / 2
        oy       = (ph - sh * scale) / 2

        # Sheet outline
        p.setPen(QPen(QColor("#ffffff"), 1))
        p.setBrush(QBrush(QColor(20, 20, 20)))
        p.drawRect(int(ox), int(oy), int(sw*scale), int(sh*scale))

        # Parts
        for part in sheet.parts[:60]:
            x  = ox + part.x * scale
            y  = oy + (sh - part.y - part.actual_height()) * scale
            pw_ = part.actual_width()  * scale
            ph_ = part.actual_height() * scale
            p.setPen(QPen(QColor("#ffffff"), 0.5))
            p.setBrush(QBrush(QColor(40, 40, 40)))
            p.drawRect(int(x)+1, int(y)+1, max(1,int(pw_)-1), max(1,int(ph_)-1))

        p.end()
        self._preview.setPixmap(pix)
        n = max(1, len(self._sheets))
        self._lbl_page.setText(f"{self._preview_page+1} of {n}")

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        self._draw_preview()

    def _prev_page(self):
        if self._preview_page > 0:
            self._preview_page -= 1
            self._draw_preview()

    def _next_page(self):
        if self._preview_page < len(self._sheets) - 1:
            self._preview_page += 1
            self._draw_preview()

    def _browse(self):
        path = QFileDialog.getExistingDirectory(
            self, "Output Folder", self._txt_output.text())
        if path:
            self._txt_output.setText(path)

    # ── Settings ──────────────────────────────────────────────
    def get_settings(self) -> dict:
        return {
            "single_layer":    self._chk_single_layer.isChecked(),
            "parts_layer":     self._txt_parts_layer.text(),
            "orientation":     self._cmb_orientation.currentText(),
            "add_labels":      self._chk_part_labels.isChecked(),
            "add_stats":       self._chk_nest_stats.isChecked(),
            "output_sheet":    self._chk_output_sheet.isChecked(),
            "sheet_layer":     self._txt_sheet_layer.text(),
            "multi_file":      self._rb_multi_file.isChecked(),
            "export_using":    self._cmb_export_using.currentText(),
            "parts_as_blocks": self._chk_parts_blocks.isChecked(),
            "nests_as_blocks": self._chk_nests_blocks.isChecked(),
            "remove_common":   self._chk_remove_common.isChecked(),
            "outers_cw":       self._cmb_outers.currentIndex() == 1,
            "inners_cw":       self._cmb_inners.currentIndex() == 1,
            "units_mm":        self._rb_mm.isChecked(),
            "dxf_version":     self._cmb_dxf_ver.currentText(),
            "output_folder":   self._txt_output.text(),
        }

    def _apply_style(self):
        self.setStyleSheet(f"""
        QDialog, QWidget {{
            background:{C_BG.name()};
            color:{C_TEXT.name()};
            font-family:"Segoe UI",Tahoma,sans-serif;
            font-size:12px;
        }}
        QGroupBox {{
            background:transparent;
            border:1px solid {C_BORDER.name()};
            border-radius:3px;
            margin-top:6px; padding-top:6px;
            color:{C_DIM.name()}; font-size:11px; font-weight:600;
        }}
        QGroupBox::title {{
            subcontrol-origin:margin; left:8px; padding:0 4px;
        }}
        QLineEdit, QComboBox {{
            background:#1a1a1a; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:3px 6px; color:{C_TEXT.name()};
        }}
        QLineEdit:focus, QComboBox:focus {{
            border-color:{C_ACCENT.name()};
        }}
        QCheckBox, QRadioButton {{
            color:{C_TEXT.name()}; spacing:6px;
        }}
        QCheckBox::indicator {{
            width:13px; height:13px;
            border:1px solid {C_BORDER.name()}; border-radius:2px;
            background:#1a1a1a;
        }}
        QCheckBox::indicator:checked {{
            background:{C_ACCENT.name()}; border-color:{C_ACCENT.name()};
        }}
        QRadioButton::indicator {{
            width:13px; height:13px;
            border:1px solid {C_BORDER.name()}; border-radius:7px;
            background:#1a1a1a;
        }}
        QRadioButton::indicator:checked {{
            background:{C_ACCENT.name()}; border-color:{C_ACCENT.name()};
        }}
        QPushButton {{
            background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:3px 10px; color:{C_TEXT.name()};
        }}
        QPushButton:hover {{
            background:#3e3e42; border-color:{C_ACCENT.name()};
        }}
        QScrollBar:vertical {{
            background:{C_PANEL.name()}; width:8px; border:none;
        }}
        QScrollBar::handle:vertical {{
            background:{C_BORDER.name()}; border-radius:4px; min-height:20px;
        }}
        QScrollArea {{ border:none; }}
        """)


# ═══════════════════════════════════════════════════════════════
# G-code Export Dialog
# ═══════════════════════════════════════════════════════════════
class GCodeExportDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Export G-code")
        self.setModal(True)
        self.setFixedWidth(420)
        self._build()

    def _build(self):
        lay  = QVBoxLayout(self)
        lay.setSpacing(8)
        lay.setContentsMargins(12, 12, 12, 12)

        # ── Post Processor selection ──────────────────────────
        grp_pp = QGroupBox("Post Processor / Machine Controller")
        g_pp   = QVBoxLayout(grp_pp)

        # ComboBox loaded from post_processor_bank.json
        self._cmb_pp = QComboBox()
        self._pp_ids = []  # parallel list of pp.id values
        self._pp_lbl = QLabel("")
        self._pp_lbl.setStyleSheet("color:#858585; font-size:11px;")
        self._pp_lbl.setWordWrap(True)

        try:
            from post_processor_manager import PostProcessorManager
            mgr = PostProcessorManager()
            for pp in mgr.all():
                label = pp.name
                badge = pp.badge()
                ext   = pp.file_extension
                display = f"{label}  (.{ext})"
                if badge: display += f"  [{badge}]"
                self._cmb_pp.addItem(display)
                self._pp_ids.append(pp.id)
            # Select active
            try:
                active = mgr.active
                if active and active.id in self._pp_ids:
                    self._cmb_pp.setCurrentIndex(self._pp_ids.index(active.id))
            except Exception:
                pass
        except Exception as e:
            # Fallback hardcoded list
            fallback = [
                ("Generic G-code mm",    "generic_mm",  "tap"),
                ("Syntec ATC mm",        "syntec_atc",  "nc"),
                ("Mach3 ATC mm",         "mach3_atc",   "tap"),
                ("Mach3 No ATC",         "mach3_noatc", "tap"),
                ("Fanuc ISO",            "fanuc",       "nc"),
                ("Siemens 840D",         "siemens",     "mpf"),
                ("RichAuto DSP",         "richauto",    "nc"),
                ("NCStudio",             "ncstudio",    "nc"),
                ("OSAI",                 "osai",        "iso"),
            ]
            for name, pid, ext in fallback:
                self._cmb_pp.addItem(f"{name}  (.{ext})")
                self._pp_ids.append(pid)

        self._cmb_pp.currentIndexChanged.connect(self._on_pp_change)
        g_pp.addWidget(self._cmb_pp)
        g_pp.addWidget(self._pp_lbl)
        lay.addWidget(grp_pp)
        self._on_pp_change(0)

        # ── Other settings ────────────────────────────────────
        grp2 = QGroupBox("Output Settings")
        form = QFormLayout(grp2)
        form.setSpacing(8)

        self._cmb_origin = QComboBox()
        for o in ["Front Left (0,0)","Rear Right (X,Y)",
                  "Rear Left (0,Y)","Front Right (X,0)"]:
            self._cmb_origin.addItem(o)

        self._txt_out    = QLineEdit(config.output_folder)
        self._btn_browse = QPushButton("Browse...")
        self._btn_browse.clicked.connect(
            lambda: self._txt_out.setText(
                QFileDialog.getExistingDirectory(
                    self, "Output Folder", self._txt_out.text())
                or self._txt_out.text()))
        path_row = QHBoxLayout()
        path_row.addWidget(self._txt_out, 1)
        path_row.addWidget(self._btn_browse)

        form.addRow("Origin:",        self._cmb_origin)
        form.addRow("Output Folder:", path_row)
        lay.addWidget(grp2)

        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.accepted.connect(self.accept)
        btns.rejected.connect(self.reject)
        lay.addWidget(btns)

    def _on_pp_change(self, idx: int):
        """Show post processor description when selection changes."""
        if not self._pp_ids or idx < 0 or idx >= len(self._pp_ids):
            return
        try:
            from post_processor_manager import PostProcessorManager
            mgr = PostProcessorManager()
            pp  = mgr.get(self._pp_ids[idx])
            if pp:
                info = f".{pp.file_extension}  |  {pp.units.upper()}"
                if pp.has_atc:   info += "  |  ATC"
                if pp.has_arcs:  info += "  |  Arcs"
                if pp.machines:  info += f"  |  {pp.machines[0]}"
                self._pp_lbl.setText(info)
        except Exception:
            pass

    def get_settings(self) -> dict:
        pp_id = self._pp_ids[self._cmb_pp.currentIndex()] if self._pp_ids else "generic_mm"
        # Determine format from post processor
        fmt = "tap"
        try:
            from post_processor_manager import PostProcessorManager
            pp = PostProcessorManager().get(pp_id)
            if pp: fmt = pp.file_extension
        except Exception:
            pass
        atc = False
        try:
            from post_processor_manager import PostProcessorManager
            pp = PostProcessorManager().get(pp_id)
            if pp: atc = pp.has_atc
        except Exception:
            pass
        return {
            "post_processor_id": pp_id,
            "format":            fmt,
            "origin_index":      self._cmb_origin.currentIndex(),
            "atc":               atc,
            "output_folder":     self._txt_out.text(),
        }


# ═══════════════════════════════════════════════════════════════
# Export Worker Thread
# ═══════════════════════════════════════════════════════════════
class ExportWorker(QThread):
    sig_progress = Signal(int, str)
    sig_done     = Signal(list)
    sig_error    = Signal(str)

    def __init__(self, task, sheets, settings, parent=None):
        super().__init__(parent)
        self._task     = task
        self._sheets   = sheets
        self._settings = settings

    def run(self):
        try:
            if self._task == "dxf":
                self._export_dxf()
            elif self._task == "gcode":
                self._export_gcode()
            elif self._task in ("report_summary", "report_detailed"):
                self._export_report()
        except Exception as e:
            import traceback
            self.sig_error.emit(str(e) + "\n" + traceback.format_exc())

    def _export_dxf(self):
        try:
            import ezdxf
        except ImportError:
            self.sig_error.emit(
                "ezdxf not installed. Run: pip install ezdxf")
            return

        out_dir     = Path(self._settings.get("output_folder",
                                              config.output_folder))
        out_dir.mkdir(parents=True, exist_ok=True)

        parts_layer = self._settings.get("parts_layer", "-NestedParts-")
        sheet_layer = self._settings.get("sheet_layer", "sheet")
        add_labels  = self._settings.get("add_labels",  False)
        output_sheet= self._settings.get("output_sheet", True)
        multi_file  = self._settings.get("multi_file",  False)

        ver_map = {
            "AutoCAD 2000 / 2002": "R2000",
            "AutoCAD 2004 / 2006": "R2004",
            "AutoCAD 2007 / 2009": "R2007",
            "AutoCAD 2010 / 2012": "R2010",
            "AutoCAD 2013 / 2014": "R2013",
            "AutoCAD 2018+":       "R2018",
        }
        dxf_ver = ver_map.get(
            self._settings.get("dxf_version", "AutoCAD 2000 / 2002"), "R2000")

        # Load design resolver so we can draw per-layer geometry
        resolver = None
        try:
            from design_resolver import get_resolver
            resolver = get_resolver()
        except Exception:
            pass

        # DXF standard color palette (1=red,2=yellow,3=green,4=cyan,5=blue,6=magenta,7=white,…)
        _LAYER_COLORS = [1, 2, 3, 4, 5, 6, 30, 40, 50, 140, 150, 170, 190, 210, 230]

        def _make_doc():
            doc = ezdxf.new(dxf_ver)
            try:
                doc.units = ezdxf.units.MM
            except Exception:
                pass
            doc.header["$INSUNITS"]    = 4   # millimeters
            doc.header["$MEASUREMENT"] = 1   # metric
            doc.header["$LUNITS"]      = 2   # decimal
            doc.header["$LUPREC"]      = 3   # 0.001
            return doc

        def _ensure_layer(doc, name, color_idx):
            if name not in doc.layers:
                doc.layers.add(name, color=color_idx)

        def _draw_sheet(doc, msp, sheet, ox=0.0, oy=0.0):
            sw, sh = sheet.width, sheet.height

            if output_sheet:
                _ensure_layer(doc, sheet_layer, 7)
                msp.add_lwpolyline(
                    [(ox, oy), (ox+sw, oy), (ox+sw, oy+sh), (ox, oy+sh), (ox, oy)],
                    dxfattribs={"layer": sheet_layer, "closed": True})

            _ensure_layer(doc, parts_layer, 1)
            for part in sheet.parts:
                px = ox + part.x
                py = oy + part.y
                pw = part.actual_width()
                ph = part.actual_height()

                # Outer boundary on parts_layer
                msp.add_lwpolyline(
                    [(px, py), (px+pw, py), (px+pw, py+ph), (px, py+ph), (px, py)],
                    dxfattribs={"layer": parts_layer, "closed": True})

                if add_labels:
                    dc = getattr(part, "design_code", "") or ""
                    label = f"{int(pw)}x{int(ph)}"
                    if dc and dc not in ("cd0", "0"):
                        label += f" {dc}"
                    txt_h  = max(min(min(pw, ph) * 0.012, 5.0), 2.0)
                    margin = txt_h * 0.8
                    msp.add_text(
                        label,
                        dxfattribs={
                            "layer":  parts_layer,
                            "height": txt_h,
                            "insert": (px + margin, py + margin),
                        })

                # Design layers from .fdr file
                if not resolver:
                    continue
                dc = getattr(part, "design_code", "") or ""
                if not dc or dc in ("cd0", "0", ""):
                    continue
                try:
                    design = resolver.load(dc, width=pw, height=ph)
                except Exception:
                    continue
                if design is None:
                    continue

                for i, lyr in enumerate(design.layers or []):
                    if not lyr.get("enabled", True):
                        continue
                    lname  = lyr.get("name", f"L{lyr.get('id', i)}")
                    offset = float(lyr.get("offset_mm", 0) or 0)
                    depth  = float(lyr.get("depth_mm",  0) or 0)
                    ltype  = lyr.get("type", "groove")

                    # Profile with depth=0 is the cut outline — still draw it
                    if depth <= 0 and ltype != "profile":
                        continue

                    color_idx = _LAYER_COLORS[i % len(_LAYER_COLORS)]
                    _ensure_layer(doc, lname, color_idx)

                    lx0 = px + offset
                    ly0 = py + offset
                    lx1 = px + pw - offset
                    ly1 = py + ph - offset

                    if lx1 <= lx0 or ly1 <= ly0:
                        continue

                    msp.add_lwpolyline(
                        [(lx0, ly0), (lx1, ly0), (lx1, ly1), (lx0, ly1), (lx0, ly0)],
                        dxfattribs={"layer": lname, "closed": True})

        saved = []
        total = len(self._sheets)

        if multi_file:
            # One DXF per sheet
            for i, sheet in enumerate(self._sheets):
                self.sig_progress.emit(
                    int((i + 1) / max(total, 1) * 100),
                    f"Exporting sheet {i+1}/{total}...")
                doc = _make_doc()
                msp = doc.modelspace()
                _draw_sheet(doc, msp, sheet)
                fpath = out_dir / f"Sheet_{i+1}.dxf"
                doc.saveas(str(fpath))
                saved.append(str(fpath))
        else:
            # All sheets in one file, stacked vertically with 100mm gap
            doc = _make_doc()
            msp = doc.modelspace()
            y_offset = 0.0
            for i, sheet in enumerate(self._sheets):
                self.sig_progress.emit(
                    int((i + 1) / max(total, 1) * 100),
                    f"Processing sheet {i+1}/{total}...")
                _draw_sheet(doc, msp, sheet, ox=0.0, oy=y_offset)
                y_offset += sheet.height + 100.0
            fpath = out_dir / "Nesting_Export.dxf"
            doc.saveas(str(fpath))
            saved.append(str(fpath))

        self.sig_done.emit(saved)

    def _export_gcode(self):
        """Real G-code generation using GCodeGenerator v2."""
        try:
            from gcode_generator import GCodeGenerator
        except ImportError as e:
            self.sig_error.emit(f"Cannot import GCodeGenerator: {e}")
            return

        pp_id    = self._settings.get("post_processor_id", "generic_mm")
        customer = self._settings.get("customer", "ORDER")
        out_dir  = self._settings.get("output_folder", None)

        try:
            gen = GCodeGenerator(post_processor_id=pp_id)
            if out_dir:
                from pathlib import Path
                gen.output_dir = Path(out_dir)

            # Validation first
            self.sig_progress.emit(5, "Validating designs and tools...")
            warnings = gen.validate_sheets(self._sheets)
            if warnings:
                warn_msg = "\n".join(warnings[:10])
                if len(warnings) > 10:
                    warn_msg += f"\n... and {len(warnings)-10} more"
                self.sig_progress.emit(10, f"Warnings: {len(warnings)} issue(s)")
                # Continue anyway — just warn

            # Generate
            total = len(self._sheets)
            saved = []
            for i, sheet in enumerate(self._sheets, 1):
                self.sig_progress.emit(
                    int(10 + 80 * i / total),
                    f"Generating Sheet {i}/{total}...")
                files = gen.generate_sheet(sheet, customer, i)
                saved.extend(files)

            self.sig_progress.emit(100, "G-code complete")
            result = [str(f) for f in saved]
            if warnings:
                result.insert(0, f"__warnings__:{chr(10).join(warnings[:5])}")
            self.sig_done.emit(result)

        except Exception as e:
            import traceback
            self.sig_error.emit(str(e) + "\n" + traceback.format_exc())

    def _export_report(self):
        self.sig_progress.emit(30, "Generating report...")
        out_dir  = Path(self._settings.get("output_folder",
                                           config.output_folder))
        out_dir.mkdir(parents=True, exist_ok=True)
        detailed = (self._task == "report_detailed")
        fname    = "Detailed_Report.html" if detailed else "Summary_Report.html"
        fpath    = out_dir / fname

        total_parts = sum(s.part_count() for s in self._sheets)
        avg_util    = (sum(s.utilization() for s in self._sheets)
                       / max(len(self._sheets), 1))

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>FIROO CAM Nesting Report</title>
<style>
body{{font-family:Segoe UI,sans-serif;background:#f5f5f5;
     color:#333;margin:0;padding:20px;}}
h1{{color:#0078d4;border-bottom:2px solid #0078d4;padding-bottom:8px;}}
h2{{color:#555;font-size:14px;margin-top:20px;}}
table{{width:100%;border-collapse:collapse;background:#fff;
       box-shadow:0 1px 3px rgba(0,0,0,.1);}}
th{{background:#0078d4;color:white;padding:8px 12px;
    text-align:left;font-size:12px;}}
td{{padding:6px 12px;border-bottom:1px solid #eee;font-size:12px;}}
tr:nth-child(even){{background:#f9f9f9;}}
.stat{{display:inline-block;background:#fff;border:1px solid #ddd;
       border-radius:4px;padding:12px 20px;margin:6px;text-align:center;}}
.stat-val{{font-size:22px;font-weight:bold;color:#0078d4;}}
.stat-lbl{{font-size:11px;color:#888;margin-top:4px;}}
.sheet-box{{background:#fff;border:1px solid #ddd;border-radius:4px;
            padding:12px;margin:10px 0;}}
</style></head><body>
<h1>🔧 FIROO CAM — Nesting Report</h1>
<div>
  <div class="stat"><div class="stat-val">{len(self._sheets)}</div>
    <div class="stat-lbl">Sheets Used</div></div>
  <div class="stat"><div class="stat-val">{total_parts}</div>
    <div class="stat-lbl">Parts Nested</div></div>
  <div class="stat"><div class="stat-val">{avg_util:.1f}%</div>
    <div class="stat-lbl">Avg Utilization</div></div>
</div>
"""
        for i, sheet in enumerate(self._sheets):
            html += f"""
<div class="sheet-box">
  <h2>Sheet {i+1} — {sheet.width:.0f}×{sheet.height:.0f} mm
      &nbsp;|&nbsp; {sheet.utilization():.2f}% utilization
      &nbsp;|&nbsp; {sheet.part_count()} parts</h2>
"""
            if detailed:
                html += """<table>
<tr><th>ID</th><th>Part Code</th><th>Width</th><th>Length</th>
    <th>Cut Length</th><th>Area (m²)</th>
    <th>X</th><th>Y</th><th>Rotated</th></tr>"""
                for j, p in enumerate(sheet.parts):
                    area     = p.actual_width() * p.actual_height() / 1e6
                    cut_len  = 2 * (p.actual_width() + p.actual_height())
                    html += (f"<tr><td>{j+1}</td><td>{p.part_code}</td>"
                             f"<td>{p.actual_width():.0f}</td>"
                             f"<td>{p.actual_height():.0f}</td>"
                             f"<td>{cut_len:.0f}</td>"
                             f"<td>{area:.5f}</td>"
                             f"<td>{p.x:.1f}</td><td>{p.y:.1f}</td>"
                             f"<td>{'Yes' if p.rotated else 'No'}</td></tr>")
                html += "</table>"
            html += "</div>"

        html += "</body></html>"
        fpath.write_text(html, encoding="utf-8")
        self.sig_progress.emit(100, "Report saved.")
        self.sig_done.emit([str(fpath)])


# ═══════════════════════════════════════════════════════════════
# EXPORT TAB
# ═══════════════════════════════════════════════════════════════
class ExportTab(QWidget):
    """Solid Edge Export tab — toolbar + summary panel + log."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._sheets: list = []
        self._worker: Optional[ExportWorker] = None
        lang.on_change(lambda c, d: None)
        self._build_ui()
        self._apply_style()

    def set_sheets(self, sheets: list):
        self._sheets = sheets
        self._update_summary()

    # ══════════════════════════════════════════════════════════
    # BUILD
    # ══════════════════════════════════════════════════════════
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        root.addWidget(self._build_toolbar())

        sep = QFrame(); sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet(f"background:{C_BORDER.name()};")
        sep.setFixedHeight(1)
        root.addWidget(sep)

        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(self._build_left_panel())
        splitter.addWidget(self._build_right_panel())
        splitter.setSizes([400, 700])
        root.addWidget(splitter, 1)

        # Progress bar
        self._progress = QProgressBar()
        self._progress.setFixedHeight(3)
        self._progress.setRange(0, 100)
        self._progress.setTextVisible(False)
        self._progress.hide()
        self._progress.setStyleSheet(
            f"QProgressBar{{background:{C_PANEL.name()};border:none;}}"
            f"QProgressBar::chunk{{background:{C_ACCENT.name()};}}")
        root.addWidget(self._progress)

        # Status bar
        self._status = QLabel("  Ready to export")
        self._status.setFixedHeight(22)
        self._status.setStyleSheet(
            f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
            f"padding:0 8px; font-size:11px;"
            f"border-top:1px solid {C_BORDER.name()};")
        root.addWidget(self._status)

    def _build_toolbar(self) -> QFrame:
        tb = QFrame()
        tb.setFixedHeight(56)
        tb.setStyleSheet(
            f"background:{C_PANEL.name()};"
            f"border-bottom:1px solid {C_BORDER.name()};")
        tl = QHBoxLayout(tb)
        tl.setContentsMargins(6, 4, 6, 4)
        tl.setSpacing(2)

        def btn(icon, label, tooltip, w=80):
            b = QPushButton(f"{icon}\n{label}")
            b.setToolTip(tooltip)
            b.setFixedSize(w, 44)
            b.setStyleSheet(
                f"background:{C_PANEL.name()}; border:none;"
                f"color:{C_TEXT.name()}; font-size:11px;"
                f"border-right:1px solid {C_BORDER.name()};"
                f"padding:2px 4px; text-align:center;")
            return b

        self._btn_dxf_dwg         = btn("📄", "DXF/DWG",          "Export DXF/DWG files", 70)
        self._btn_gcode           = btn("⚙",  "G-code",           "Generate G-code files", 70)
        div1 = self._vdiv()
        lbl1 = self._group_lbl("Export")

        self._btn_summary_report  = btn("🖨",  "Summary\nReport",  "Generate summary report",  80)
        self._btn_detailed_report = btn("📋", "Detailed\nReport", "Generate detailed report",  80)
        div2 = self._vdiv()
        lbl2 = self._group_lbl("Reports")

        for w in [self._btn_dxf_dwg, self._btn_gcode]:
            tl.addWidget(w)
        tl.addWidget(lbl1); tl.addWidget(div1)
        for w in [self._btn_summary_report, self._btn_detailed_report]:
            tl.addWidget(w)
        tl.addWidget(lbl2); tl.addWidget(div2)
        tl.addStretch()

        self._btn_dxf_dwg.clicked.connect(self._export_dxf)
        self._btn_gcode.clicked.connect(self._export_gcode)
        self._btn_summary_report.clicked.connect(
            lambda: self._export_report(detailed=False))
        self._btn_detailed_report.clicked.connect(
            lambda: self._export_report(detailed=True))

        return tb

    def _build_left_panel(self) -> QWidget:
        w   = QWidget(); w.setFixedWidth(380)
        lay = QVBoxLayout(w)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)

        # Nesting summary
        self._grp_summary = QGroupBox("Nesting Summary")
        gs = QFormLayout(self._grp_summary)
        gs.setSpacing(5)
        self._lbl_sheets   = QLabel("—")
        self._lbl_parts    = QLabel("—")
        self._lbl_util     = QLabel("—")
        self._lbl_unplaced = QLabel("—")
        for lbl in [self._lbl_sheets, self._lbl_parts,
                    self._lbl_util, self._lbl_unplaced]:
            lbl.setStyleSheet(f"color:{C_TEXT.name()}; font-weight:600;")
        gs.addRow("Sheets used:",     self._lbl_sheets)
        gs.addRow("Parts nested:",    self._lbl_parts)
        gs.addRow("Avg utilization:", self._lbl_util)
        gs.addRow("Unplaced parts:",  self._lbl_unplaced)
        lay.addWidget(self._grp_summary)

        # Quick export
        grp2 = QGroupBox("Quick Export")
        gq   = QVBoxLayout(grp2)

        def qbtn(text):
            b = QPushButton(text)
            b.setFixedHeight(32)
            b.setStyleSheet(
                f"background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};"
                f"border-radius:3px; color:{C_TEXT.name()}; text-align:left;"
                f"padding:0 12px;")
            return b

        self._btn_q_dxf    = qbtn("📄  Export DXF (default settings)")
        self._btn_q_gcode  = qbtn("⚙   Export G-code")
        self._btn_q_report = qbtn("📋  Summary Report (HTML)")
        self._btn_q_open   = qbtn("📂  Open Output Folder")

        for b in [self._btn_q_dxf, self._btn_q_gcode,
                  self._btn_q_report, self._btn_q_open]:
            gq.addWidget(b)

        lay.addWidget(grp2)
        lay.addStretch()

        self._btn_q_dxf.clicked.connect(self._quick_dxf)
        self._btn_q_gcode.clicked.connect(self._export_gcode)
        self._btn_q_report.clicked.connect(
            lambda: self._export_report(detailed=False))
        self._btn_q_open.clicked.connect(self._open_output_folder)

        return w

    def _build_right_panel(self) -> QWidget:
        w   = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        hdr = QLabel("  Export Log")
        hdr.setFixedHeight(26)
        hdr.setStyleSheet(
            f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
            f"font-size:11px; font-weight:600;"
            f"border-bottom:1px solid {C_BORDER.name()};")
        lay.addWidget(hdr)

        self._log = QTextEdit()
        self._log.setReadOnly(True)
        self._log.setStyleSheet(
            f"background:#1a1a1a; border:none; color:{C_TEXT.name()};"
            f"font-family:Consolas,monospace; font-size:11px;")
        self._log.setPlaceholderText("Export log will appear here...")
        lay.addWidget(self._log, 1)
        return w

    # ══════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════
    def _update_summary(self):
        n     = len(self._sheets)
        parts = sum(s.part_count() for s in self._sheets)
        util  = (sum(s.utilization() for s in self._sheets) / max(n, 1))
        self._lbl_sheets.setText(str(n))
        self._lbl_parts.setText(str(parts))
        self._lbl_util.setText(f"{util:.2f}%")
        self._lbl_unplaced.setText("0")

    # ══════════════════════════════════════════════════════════
    # ACTIONS
    # ══════════════════════════════════════════════════════════
    def _export_dxf(self):
        if not self._sheets:
            self._warn_no_sheets(); return
        dlg = DXFExportDialog(self._sheets, parent=self)
        if dlg.exec() == QDialog.Accepted:
            settings = dlg.get_settings()
            self._run_export("dxf", settings)

    def _quick_dxf(self):
        if not self._sheets:
            self._warn_no_sheets(); return
        settings = {
            "single_layer":    False,
            "parts_layer":     "-NestedParts-",
            "sheet_layer":     "sheet",
            "orientation":     "0",
            "add_labels":      True,
            "add_stats":       False,
            "output_sheet":    True,
            "multi_file":      False,
            "export_using":    "Basic Lines/Arcs",
            "parts_as_blocks": False,
            "nests_as_blocks": False,
            "remove_common":   False,
            "outers_cw":       False,
            "inners_cw":       False,
            "units_mm":        True,
            "dxf_version":     "AutoCAD 2000 / 2002",
            "output_folder":   config.output_folder,
        }
        self._run_export("dxf", settings)

    def _export_gcode(self):
        if not self._sheets:
            self._warn_no_sheets(); return
        dlg = GCodeExportDialog(parent=self)
        if dlg.exec() == QDialog.Accepted:
            settings = dlg.get_settings()
            settings["output_folder"] = settings.get(
                "output_folder", config.output_folder)
            self._run_export("gcode", settings)

    def _export_gcode_dialog(self):
        """Public entry point — called from toolbar or main menu."""
        self._export_gcode()

    def _export_report(self, detailed=False):
        if not self._sheets:
            self._warn_no_sheets(); return
        settings = {"output_folder": config.output_folder}
        self._run_export(
            "report_detailed" if detailed else "report_summary",
            settings)

    def _open_output_folder(self):
        folder = config.output_folder
        Path(folder).mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(folder)
        else:
            os.system(f'xdg-open "{folder}"')

    def _run_export(self, task: str, settings: dict):
        self._progress.show()
        self._progress.setValue(0)
        self._log_msg(f"Starting {task} export...")
        self._worker = ExportWorker(task, self._sheets, settings, self)
        self._worker.sig_progress.connect(
            lambda pct, msg: (self._progress.setValue(pct),
                              self._status.setText(f"  {msg}")))
        self._worker.sig_done.connect(self._on_export_done)
        self._worker.sig_error.connect(self._on_export_error)
        self._worker.start()

    def _on_export_done(self, files: list):
        self._progress.hide()
        real_files = []
        for f in files:
            if f.startswith("__warnings__:"):
                for w in f[13:].split("\n"):
                    if w: self._log_msg(f"⚠  {w}")
            else:
                real_files.append(f)
                self._log_msg(f"✅  Saved: {f}")
        n = len(real_files)
        if n:
            self._status.setText(f"  Export complete — {n} file(s) saved")
        else:
            self._log_msg("✅  Export complete (no files — check warnings)")
            self._status.setText("  Export complete")

    def _on_export_error(self, msg: str):
        self._progress.hide()
        self._log_msg(f"❌  Error: {msg[:200]}")
        self._status.setText("  Export failed")
        QMessageBox.critical(self, "Export Error", msg[:500])

    def _log_msg(self, msg: str):
        from datetime import datetime
        ts = datetime.now().strftime("%H:%M:%S")
        self._log.append(f"[{ts}]  {msg}")

    def _warn_no_sheets(self):
        QMessageBox.warning(self, "No Layout",
                            "Run nesting first to generate a layout.")

    # ── Style ─────────────────────────────────────────────────
    def _apply_style(self):
        self.setStyleSheet(f"""
        * {{ font-family:"Segoe UI",Tahoma,sans-serif; font-size:12px; }}
        QWidget {{ background:{C_BG.name()}; color:{C_TEXT.name()}; }}
        QGroupBox {{
            background:transparent; border:1px solid {C_BORDER.name()};
            border-radius:3px; margin-top:6px; padding-top:8px;
            color:{C_DIM.name()}; font-size:11px; font-weight:600;
        }}
        QGroupBox::title {{
            subcontrol-origin:margin; left:6px; padding:0 3px;
        }}
        QComboBox, QLineEdit {{
            background:#1a1a1a; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:2px 5px; color:{C_TEXT.name()};
        }}
        QComboBox:focus, QLineEdit:focus {{
            border-color:{C_ACCENT.name()};
        }}
        QSplitter::handle {{ background:{C_BORDER.name()}; width:1px; }}
        QPushButton {{
            background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:3px 8px; color:{C_TEXT.name()};
        }}
        QPushButton:hover {{
            background:#3e3e42; border-color:{C_ACCENT.name()};
        }}
        QScrollBar:vertical {{
            background:{C_PANEL.name()}; width:8px; border:none;
        }}
        QScrollBar::handle:vertical {{
            background:{C_BORDER.name()}; border-radius:4px; min-height:20px;
        }}
        """)

    @staticmethod
    def _vdiv() -> QFrame:
        d = QFrame(); d.setFrameShape(QFrame.VLine)
        d.setFixedWidth(1)
        d.setStyleSheet(f"background:{C_BORDER.name()}; margin:4px 4px;")
        return d

    @staticmethod
    def _group_lbl(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet(
            f"color:{C_DIM.name()}; font-size:10px; "
            f"border-left:1px solid {C_BORDER.name()}; padding-left:4px;")
        lbl.setFixedHeight(44)
        return lbl


# ═══════════════════════════════════════════════════════════════
# Test
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    w = QWidget()
    w.setWindowTitle("FIROO CAM — Export Tab v2")
    w.resize(1100, 700)
    from PySide6.QtWidgets import QVBoxLayout
    vl = QVBoxLayout(w); vl.setContentsMargins(0, 0, 0, 0)
    tab = ExportTab()
    vl.addWidget(tab)
    w.show()
    sys.exit(app.exec())