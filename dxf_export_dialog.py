"""
FIROO CAM - DXF Export Dialog  (v2 — Solid Edge exact replica)

Matches s13 screenshot exactly:
  Left side options | Right side: Preview panel with navigation
  - Output Nested Parts group (Parts on Single Layer, Layer Name, Orientation,
    Add Part Labels, Add Nest Statistics)
  - Also Output Sheets? group
  - Multiple Sheet Layouts (radio)
  - Compatibility Options (Export Using dropdown + 3 checkboxes)
  - Loop Direction (Outers / Inners dropdowns)
  - Export Units (Inches / Millimeters radio)
  - Dxf Version dropdown (AutoCAD 2000/2002 default)
  Right:
  - Preview (black canvas with DXF outline)
  - Show Preview checkbox
  - < 1 of N > navigation
  Bottom: Export | Cancel
"""
from __future__ import annotations
from pathlib import Path
from typing import List, Optional

from PySide6.QtCore  import Qt
from PySide6.QtGui   import QColor, QPainter, QPen, QPixmap, QBrush
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QVBoxLayout, QFormLayout,
    QGroupBox, QLabel, QLineEdit, QComboBox, QCheckBox,
    QRadioButton, QButtonGroup, QPushButton, QDialogButtonBox,
    QFrame, QFileDialog, QScrollArea, QSizePolicy
)

from config import config

C_BG     = QColor("#1e1e1e")
C_PANEL  = QColor("#252526")
C_BORDER = QColor("#3e3e42")
C_ACCENT = QColor("#0078d4")
C_TEXT   = QColor("#cccccc")
C_DIM    = QColor("#858585")


class DXFExportDialog(QDialog):
    """Export Nest dialog — exact Solid Edge 2D Nesting layout."""

    def __init__(self, sheets=None, parent=None):
        super().__init__(parent)
        self._sheets      = sheets or []
        self._preview_page = 0
        self.setWindowTitle("Export Nest")
        self.setModal(True)
        self.setFixedSize(720, 600)
        self._build()
        self._apply_style()
        self._draw_preview()

    def _build(self):
        # Root: horizontal split — left options | right preview
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        # ── LEFT: scrollable options ──────────────────────────
        left_scroll = QScrollArea()
        left_scroll.setWidgetResizable(True)
        left_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        left_scroll.setFixedWidth(380)
        left_scroll.setStyleSheet("border:none;")

        left_widget = QFrame()
        left = QVBoxLayout(left_widget)
        left.setContentsMargins(12, 12, 12, 12)
        left.setSpacing(8)
        left_scroll.setWidget(left_widget)

        # ── Group 1: Output Nested Parts ─────────────────────
        grp1 = QGroupBox("Output Nested Parts")
        g1   = QFormLayout(grp1)
        g1.setSpacing(5)

        row_single = QHBoxLayout()
        self._chk_single_layer = QCheckBox("Parts on Single Layer")
        self._chk_single_layer.setChecked(False)
        row_single.addWidget(self._chk_single_layer)
        row_single.addStretch()

        self._txt_parts_layer = QLineEdit("-NestedParts-")
        self._cmb_orientation = QComboBox()
        for v in ["0", "90", "180", "270"]:
            self._cmb_orientation.addItem(v)

        row_labels = QHBoxLayout()
        self._chk_part_labels = QCheckBox("Add Part Labels")
        self._chk_part_labels.setChecked(False)
        row_labels.addWidget(self._chk_part_labels)
        row_labels.addStretch()

        row_stats = QHBoxLayout()
        self._chk_nest_stats = QCheckBox("Add Nest Statistics")
        self._chk_nest_stats.setChecked(False)
        row_stats.addWidget(self._chk_nest_stats)
        row_stats.addStretch()

        g1.addRow(row_single)
        g1.addRow("Parts Layer Name:", self._txt_parts_layer)
        g1.addRow("Nest Orientation:", self._cmb_orientation)
        g1.addRow(row_labels)
        g1.addRow(row_stats)
        left.addWidget(grp1)

        # ── Group 2: Also Output Sheets ───────────────────────
        grp2 = QGroupBox("Also Output Sheets?")
        g2   = QFormLayout(grp2)
        g2.setSpacing(5)

        row_sheet = QHBoxLayout()
        self._chk_output_sheet = QCheckBox("Yes, Output Sheets")
        self._chk_output_sheet.setChecked(True)
        row_sheet.addWidget(self._chk_output_sheet)
        row_sheet.addStretch()

        self._txt_sheet_layer = QLineEdit("sheet")
        g2.addRow(row_sheet)
        g2.addRow("Sheet Layer Name:", self._txt_sheet_layer)
        left.addWidget(grp2)

        # ── Group 3: Multiple Sheet Layouts ───────────────────
        grp3 = QGroupBox("Multiple Sheet Layouts")
        g3   = QVBoxLayout(grp3)
        g3.setSpacing(3)
        self._bg_multi       = QButtonGroup(self)
        self._rb_single_file = QRadioButton("Output to Single File")
        self._rb_multi_file  = QRadioButton("Output to Multiple Files")
        self._rb_single_file.setChecked(True)
        self._bg_multi.addButton(self._rb_single_file, 0)
        self._bg_multi.addButton(self._rb_multi_file,  1)
        g3.addWidget(self._rb_single_file)
        g3.addWidget(self._rb_multi_file)
        left.addWidget(grp3)

        # ── Group 4: Compatibility Options ────────────────────
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

        for chk in [self._chk_parts_blocks,
                    self._chk_nests_blocks,
                    self._chk_remove_common]:
            row = QHBoxLayout()
            row.addWidget(chk)
            row.addStretch()
            g4.addRow(row)
        left.addWidget(grp4)

        # ── Group 5: Loop Direction ───────────────────────────
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

        # ── Group 6: Export Units ─────────────────────────────
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

        # ── Group 7: DXF Version ──────────────────────────────
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

        left.addStretch()

        body.addWidget(left_scroll)

        # ── RIGHT: Preview ────────────────────────────────────
        right = QVBoxLayout()
        right.setContentsMargins(8, 8, 8, 8)
        right.setSpacing(6)

        prev_lbl = QLabel("Preview")
        prev_lbl.setStyleSheet(
            f"color:{C_DIM.name()}; font-size:11px; font-weight:600;")
        right.addWidget(prev_lbl)

        self._preview = QLabel()
        self._preview.setMinimumSize(300, 400)
        self._preview.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Expanding)
        self._preview.setStyleSheet(
            f"background:#000000; border:1px solid {C_BORDER.name()};")
        self._preview.setAlignment(Qt.AlignCenter)
        right.addWidget(self._preview, 1)

        # Show Preview checkbox
        self._chk_show_preview = QCheckBox("Show Preview")
        self._chk_show_preview.setChecked(True)
        self._chk_show_preview.toggled.connect(self._draw_preview)
        right.addWidget(self._chk_show_preview)

        # Navigation row
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

        right_w = QWidget()
        right_w.setLayout(right)
        right_w.setMinimumWidth(320)
        body.addWidget(right_w, 1)

        root.addLayout(body, 1)

        # ── Bottom: Export | Cancel ───────────────────────────
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
        if not self._chk_show_preview.isChecked():
            self._preview.clear()
            self._preview.setText("Preview disabled")
            return

        pw = max(280, self._preview.width() - 4)
        ph = max(380, self._preview.height() - 4)
        pix = QPixmap(pw, ph)
        pix.fill(QColor("#000000"))

        if self._sheets and self._preview_page < len(self._sheets):
            sheet = self._sheets[self._preview_page]
            p = QPainter(pix)
            p.setRenderHint(QPainter.Antialiasing, False)
            sw, sh = sheet.width, sheet.height
            margin = 10
            scale = min((pw - 2*margin) / sw, (ph - 2*margin) / sh)
            ox = (pw - sw * scale) / 2
            oy = (ph - sh * scale) / 2

            # Sheet outline
            p.setPen(QPen(QColor("#ffffff"), 1))
            p.drawRect(int(ox), int(oy), int(sw*scale), int(sh*scale))

            # Parts
            for part in sheet.parts[:50]:
                x  = ox + part.x * scale
                y  = oy + (sh - part.y - part.actual_height()) * scale
                pw_ = part.actual_width() * scale
                ph_ = part.actual_height() * scale
                p.setPen(QPen(QColor("#ffffff"), 0.5))
                p.setBrush(QBrush(QColor(30, 30, 30)))
                p.drawRect(int(x)+1, int(y)+1, int(pw_)-1, int(ph_)-1)
            p.end()

        self._preview.setPixmap(pix)
        n = max(1, len(self._sheets))
        self._lbl_page.setText(f"{self._preview_page+1} of {n}")

    def _prev_page(self):
        if self._preview_page > 0:
            self._preview_page -= 1
            self._draw_preview()

    def _next_page(self):
        if self._preview_page < len(self._sheets) - 1:
            self._preview_page += 1
            self._draw_preview()

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
        }

    def _apply_style(self):
        self.setStyleSheet(f"""
        QDialog {{
            background: {C_BG.name()};
        }}
        QWidget {{
            background: {C_BG.name()};
            color: {C_TEXT.name()};
            font-family: "Segoe UI", Tahoma, sans-serif;
            font-size: 12px;
        }}
        QGroupBox {{
            background: transparent;
            border: 1px solid {C_BORDER.name()};
            border-radius: 3px;
            margin-top: 6px;
            padding-top: 6px;
            color: {C_DIM.name()};
            font-size: 11px;
            font-weight: 600;
        }}
        QGroupBox::title {{
            subcontrol-origin: margin;
            left: 8px;
            padding: 0 4px;
        }}
        QLineEdit, QComboBox {{
            background: #1a1a1a;
            border: 1px solid {C_BORDER.name()};
            border-radius: 3px;
            padding: 3px 6px;
            color: {C_TEXT.name()};
        }}
        QLineEdit:focus, QComboBox:focus {{
            border-color: {C_ACCENT.name()};
        }}
        QCheckBox, QRadioButton {{
            color: {C_TEXT.name()};
            spacing: 6px;
        }}
        QCheckBox::indicator, QRadioButton::indicator {{
            width: 13px; height: 13px;
            border: 1px solid {C_BORDER.name()};
            border-radius: 2px;
            background: #1a1a1a;
        }}
        QRadioButton::indicator {{
            border-radius: 7px;
        }}
        QCheckBox::indicator:checked, QRadioButton::indicator:checked {{
            background: {C_ACCENT.name()};
            border-color: {C_ACCENT.name()};
        }}
        QPushButton {{
            background: {C_PANEL.name()};
            border: 1px solid {C_BORDER.name()};
            border-radius: 3px;
            padding: 3px 10px;
            color: {C_TEXT.name()};
        }}
        QPushButton:hover {{
            background: #3e3e42;
            border-color: {C_ACCENT.name()};
        }}
        QScrollBar:vertical {{
            background: {C_PANEL.name()}; width: 8px; border: none;
        }}
        QScrollBar::handle:vertical {{
            background: {C_BORDER.name()}; border-radius: 4px; min-height: 20px;
        }}
        QScrollArea {{
            border: none;
        }}
        """)
