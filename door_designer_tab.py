"""
FIROO CAM - Door Design Editor  (Upgraded v2)
Run: python door_designer_tab.py
"""
from __future__ import annotations
import sys, json, math
from pathlib import Path
from dataclasses import asdict
from typing import List, Optional

from PySide6.QtCore import Qt, QRectF, Signal
from PySide6.QtGui import QColor, QPainter, QPen, QFont, QBrush
from PySide6.QtWidgets import (
    QApplication, QWidget, QMainWindow, QVBoxLayout, QHBoxLayout, QFrame,
    QLabel, QPushButton, QLineEdit, QDoubleSpinBox, QSpinBox, QComboBox,
    QTextEdit, QTableWidget, QTableWidgetItem, QHeaderView, QTabWidget,
    QCheckBox, QFileDialog, QMessageBox, QSplitter, QScrollArea, QSizePolicy,
    QGridLayout, QGroupBox,
)

from door_design_engine import (
    OffsetStep, PatternRule, DoorDesign, ToolRef,
    cumulative_totals, generate_pattern_geometry, rect_from_totals,
    design_to_dict, design_from_dict,
    PATTERN_PARAMS, ALL_PATTERN_TYPES,
)

# ── Palette ────────────────────────────────────────────────────────────────────
C_BG     = "#101418"
C_PANEL  = "#1b2228"
C_PANEL2 = "#222a31"
C_BORDER = "#3a444d"
C_TEXT   = "#e6edf3"
C_DIM    = "#9aa7b2"
C_BLUE   = "#00A3FF"
C_ORANGE = "#FF6B00"
C_GREEN  = "#3fb950"
C_RED    = "#ff3333"

RING_COLORS = [
    "#ff3333","#3fb950","#00A3FF","#bf5af2",
    "#ffdf00","#ff9f0a","#00c7be","#ff375f",
    "#64d2ff","#ffd60a","#30d158","#ff6b00",
]
PAT_COLOR = "#ff5722"

# ── Default design factory ─────────────────────────────────────────────────────

def _make_default_design() -> DoorDesign:
    steps = [
        OffsetStep(enabled=True, step_mm=40.0, tool_id="T1", operation="profile_frame",
                   depth_mm=18.0, note="Frame", link=True,
                   step_top=40, step_right=40, step_bottom=40, step_left=40),
        OffsetStep(enabled=True, step_mm=8.0,  tool_id="T2", operation="v_groove",
                   depth_mm=3.0, note="V groove", link=True,
                   step_top=8, step_right=8, step_bottom=8, step_left=8),
        OffsetStep(enabled=True, step_mm=5.0,  tool_id="T6", operation="engrave",
                   depth_mm=1.5, note="Fine line", link=True,
                   step_top=5, step_right=5, step_bottom=5, step_left=5),
        OffsetStep(enabled=True, step_mm=12.0, tool_id="T1", operation="ball_groove",
                   depth_mm=3.0, note="Soft groove", link=True,
                   step_top=12, step_right=12, step_bottom=12, step_left=12),
    ]
    patterns = [
        PatternRule(enabled=True, name="OuterBorder", pattern_type="stepped_border",
                    outer_idx=0, inner_idx=1, tool_id="T1", depth_mm=2.0,
                    pitch_mm=50, step_width_mm=25, start_lead_mm=37.5,
                    spacing_mm=30, spacing_y_mm=30, angle_deg=45,
                    amplitude_mm=5, wavelength_mm=40, passes=1, margin_mm=0),
        PatternRule(enabled=True, name="Diagonals", pattern_type="diagonal",
                    outer_idx=1, inner_idx=2, tool_id="T2", depth_mm=1.5,
                    pitch_mm=50, step_width_mm=25, start_lead_mm=37.5,
                    spacing_mm=25, spacing_y_mm=25, angle_deg=45,
                    amplitude_mm=5, wavelength_mm=40, passes=1, margin_mm=3),
    ]
    return DoorDesign(
        code="F015", name="Master Door – 15 Offset",
        default_width=900.0, default_height=2100.0,
        offset_steps=steps, patterns=patterns,
    )

# ── Canvas ─────────────────────────────────────────────────────────────────────

class DoorCanvas(QWidget):
    """Draws colored cumulative offset rings + orange pattern lines."""

    def __init__(self, mini=False, parent=None):
        super().__init__(parent)
        self._mini = mini
        self._design: Optional[DoorDesign] = None
        self._W = 900.0
        self._H = 2100.0
        self._show_patterns = True
        if mini:
            self.setFixedSize(240, 310)
        else:
            self.setMinimumSize(320, 420)
            self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

    def set_design(self, design: DoorDesign, W: float, H: float):
        self._design = design
        self._W = max(W, 1)
        self._H = max(H, 1)
        self.update()

    def set_show_patterns(self, v: bool):
        self._show_patterns = v
        self.update()

    # coordinate helpers
    def _transform(self, pad):
        aw = max(1, self.width()  - 2*pad)
        ah = max(1, self.height() - 2*pad)
        sc = min(aw / self._W, ah / self._H)
        ox = pad + (aw - self._W*sc) / 2
        oy = pad + (ah - self._H*sc) / 2
        return sc, ox, oy

    def _sx(self, x, sc, ox): return ox + x*sc
    def _sy(self, y, sc, oy): return oy + (self._H - y)*sc

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        try:
            p.fillRect(self.rect(), QColor("#0d1117"))
            if not self._design:
                p.setPen(QColor(C_DIM))
                p.drawText(self.rect(), Qt.AlignCenter, "No Design")
                return

            d = self._design
            pad = 12 if self._mini else 46
            sc, ox, oy = self._transform(pad)

            def sx(x): return self._sx(x, sc, ox)
            def sy(y): return self._sy(y, sc, oy)

            # dimension labels
            if not self._mini:
                p.setPen(QColor(C_DIM))
                fnt = p.font(); fnt.setPointSize(8); p.setFont(fnt)
                p.drawLine(int(sx(0)), int(sy(self._H)-28), int(sx(self._W)), int(sy(self._H)-28))
                p.drawText(QRectF(sx(0), sy(self._H)-46, self._W*sc, 16),
                           Qt.AlignCenter, f"W {self._W:.0f} mm")
                p.drawLine(int(sx(0)-28), int(sy(0)), int(sx(0)-28), int(sy(self._H)))
                p.save()
                p.translate(sx(0)-42, (sy(0)+sy(self._H))/2)
                p.rotate(-90)
                p.drawText(QRectF(-50,-8,100,16), Qt.AlignCenter, f"H {self._H:.0f} mm")
                p.restore()

            # outer panel fill
            p.fillRect(QRectF(sx(0), sy(self._H), self._W*sc, self._H*sc), QColor("#1a1f24"))

            # cumulative rings (from outer to inner)
            en_steps = [s for s in d.offset_steps if s.enabled]
            totals = cumulative_totals(d.offset_steps)

            for i, (step, (t,r,b,l)) in enumerate(zip(en_steps, totals)):
                color = QColor(RING_COLORS[i % len(RING_COLORS)])
                color.setAlpha(200)
                pts = rect_from_totals(self._W, self._H, t, r, b, l)
                if not pts:
                    continue
                lw = 2.5 if not self._mini else 1.5
                pen = QPen(color, lw)
                pen.setStyle(Qt.DashLine if i % 2 else Qt.SolidLine)
                p.setPen(pen)
                poly = [(int(sx(x)), int(sy(y))) for x,y in pts]
                for a, b_ in zip(poly, poly[1:]):
                    p.drawLine(a[0], a[1], b_[0], b_[1])

                # ring label
                if not self._mini:
                    p.setPen(QColor(RING_COLORS[i % len(RING_COLORS)]))
                    fnt2 = p.font(); fnt2.setPointSize(7); p.setFont(fnt2)
                    lx = sx(l) + 3
                    ly = sy(self._H - t) + 3
                    p.drawText(int(lx), int(ly+10),
                               f"Σ{t:.0f}  {step.operation}")

            # patterns
            if self._show_patterns and totals:
                p.setPen(QPen(QColor(PAT_COLOR), 1.0))
                for pat in d.patterns:
                    if not pat.enabled:
                        continue
                    paths = generate_pattern_geometry(pat, self._W, self._H, totals)
                    for path in paths:
                        for a, b_ in zip(path, path[1:]):
                            p.drawLine(int(sx(a[0])), int(sy(a[1])),
                                       int(sx(b_[0])), int(sy(b_[1])))

            # outer border
            p.setPen(QPen(QColor("#b8c1cc"), 1.5))
            p.drawRect(QRectF(sx(0), sy(self._H), self._W*sc, self._H*sc))

        finally:
            p.end()


# ── Main Window ───────────────────────────────────────────────────────────────

class DoorDesignerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self._design = _make_default_design()
        self._block = False
        self._sel_off_row = -1
        self._sel_pat_row = -1
        self.setWindowTitle("FIROO CAM  –  Door Design Editor  v2")
        self.resize(1680, 960)
        self._build_ui()
        self._apply_style()
        self._refresh_all()

    # ── UI build ──────────────────────────────────────────────────────────────

    def _build_ui(self):
        cw = QWidget(); self.setCentralWidget(cw)
        root = QVBoxLayout(cw); root.setContentsMargins(4,4,4,4); root.setSpacing(4)
        root.addWidget(self._build_toolbar())

        splitter = QSplitter(Qt.Horizontal)
        splitter.setHandleWidth(2)
        splitter.addWidget(self._build_left_panel())
        splitter.addWidget(self._build_center_tabs())
        splitter.addWidget(self._build_right_panel())
        splitter.setSizes([260, 820, 440])
        root.addWidget(splitter, 1)
        root.addWidget(self._build_bottom_bar())

    def _btn(self, label, slot=None, fixed_w=None):
        b = QPushButton(label)
        b.setFixedHeight(28)
        if fixed_w: b.setFixedWidth(fixed_w)
        if slot: b.clicked.connect(slot)
        return b

    # toolbar ──────────────────────────────────────────────────────────────────
    def _build_toolbar(self):
        bar = QFrame(); bar.setFixedHeight(44)
        lay = QHBoxLayout(bar); lay.setContentsMargins(8,4,8,4); lay.setSpacing(6)
        for label, slot in [("New", self._new_design), ("Open", self._open_design),
                             ("Save", self._save), ("Save As", self._save_as)]:
            lay.addWidget(self._btn(label, slot))
        lay.addWidget(_sep())
        self._top_code = QLineEdit("F015"); self._top_code.setFixedWidth(90)
        self._top_name = QLineEdit("Master Door"); self._top_name.setFixedWidth(280)
        lay.addWidget(QLabel("Code:")); lay.addWidget(self._top_code)
        lay.addWidget(QLabel("Name:")); lay.addWidget(self._top_name)
        lay.addWidget(_sep())
        lay.addWidget(self._btn("Design Preview"))
        lay.addWidget(self._btn("DXF Preview"))
        lay.addWidget(self._btn("G-Code"))
        lay.addStretch()
        lay.addWidget(self._btn("Close", self.close))
        return bar

    # left panel ───────────────────────────────────────────────────────────────
    def _build_left_panel(self):
        panel = QFrame(); panel.setFixedWidth(262)
        lay = QVBoxLayout(panel); lay.setContentsMargins(10,10,10,10); lay.setSpacing(6)

        lay.addWidget(_hdr("Door Information"))
        self._ed_code = QLineEdit(); self._ed_name = QLineEdit()
        self._ed_desc = QTextEdit(); self._ed_desc.setFixedHeight(56)
        for lbl, w in [("Code", self._ed_code), ("Name", self._ed_name),
                        ("Description", self._ed_desc)]:
            lay.addWidget(QLabel(lbl)); lay.addWidget(w)

        lay.addSpacing(8); lay.addWidget(_hdr("Base Size"))
        self._sp_w = _dspin(100, 5000, 900, " mm"); self._sp_h = _dspin(100, 5000, 2100, " mm")
        self._cmb_mat = QComboBox(); self._cmb_mat.addItems(["MDF","HDF","Plywood","Acrylic","Solid Wood"])
        self._sp_thick = _dspin(1, 80, 18, " mm")
        for lbl, w in [("Width (X)", self._sp_w), ("Height (Y)", self._sp_h),
                        ("Material", self._cmb_mat), ("Thickness", self._sp_thick)]:
            lay.addWidget(QLabel(lbl)); lay.addWidget(w)

        self._sp_w.valueChanged.connect(self._on_size_changed)
        self._sp_h.valueChanged.connect(self._on_size_changed)

        lay.addSpacing(8); lay.addWidget(_hdr("Mini Preview"))
        self._mini_canvas = DoorCanvas(mini=True)
        lay.addWidget(self._mini_canvas)

        lay.addSpacing(4)
        self._lbl_inner = QLabel("Inner Area: –")
        self._lbl_inner.setStyleSheet(f"color:{C_GREEN}; font-weight:600;")
        lay.addWidget(self._lbl_inner)
        lay.addStretch()
        return panel

    # center tabs ──────────────────────────────────────────────────────────────
    def _build_center_tabs(self):
        self._tabs = QTabWidget()
        self._tabs.addTab(self._build_offsets_tab(),  "① Offsets")
        self._tabs.addTab(self._build_patterns_tab(), "② Patterns")
        self._tabs.addTab(self._build_tools_tab(),    "③ Tools")
        self._tabs.addTab(self._build_preview_tab(),  "④ Preview")
        return self._tabs

    # offsets tab ──────────────────────────────────────────────────────────────
    def _build_offsets_tab(self):
        w = QWidget(); lay = QVBoxLayout(w); lay.setContentsMargins(6,6,6,6); lay.setSpacing(4)

        # toolbar row
        tr = QHBoxLayout()
        tr.addWidget(self._btn("Add Row", self._off_add))
        tr.addWidget(self._btn("Duplicate", self._off_dup))
        tr.addWidget(self._btn("Delete", self._off_del))
        tr.addWidget(self._btn("↑", self._off_up,  fixed_w=28))
        tr.addWidget(self._btn("↓", self._off_dn,  fixed_w=28))
        tr.addStretch()
        lay.addLayout(tr)

        # table
        cols = ["✓", "Step mm", "Σ Total", "Operation", "Tool", "Depth mm", "Note", "🔗", "Layer Name", "●"]
        self._off_tbl = QTableWidget(0, len(cols))
        self._off_tbl.setHorizontalHeaderLabels(cols)
        hh = self._off_tbl.horizontalHeader()
        hh.setSectionResizeMode(8, QHeaderView.Stretch)
        for i in [0,1,2,3,4,5,6,7,9]:
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        self._off_tbl.setSelectionBehavior(QTableWidget.SelectRows)
        self._off_tbl.setAlternatingRowColors(True)
        self._off_tbl.itemChanged.connect(self._off_item_changed)
        self._off_tbl.itemSelectionChanged.connect(
            lambda: self._on_off_row_sel(self._off_tbl.currentRow()))
        lay.addWidget(self._off_tbl, 1)

        # detail panel for asymmetric T/R/B/L
        self._off_detail = QGroupBox("Asymmetric Offsets (when 🔗 is OFF)")
        dl = QGridLayout(self._off_detail)
        self._sp_top    = _dspin(0, 2000, 0, " mm")
        self._sp_right  = _dspin(0, 2000, 0, " mm")
        self._sp_bottom = _dspin(0, 2000, 0, " mm")
        self._sp_left   = _dspin(0, 2000, 0, " mm")
        for col, (lbl, sp) in enumerate([("Top", self._sp_top), ("Right", self._sp_right),
                                          ("Bottom", self._sp_bottom), ("Left", self._sp_left)]):
            dl.addWidget(QLabel(lbl), 0, col)
            dl.addWidget(sp, 1, col)
            sp.valueChanged.connect(lambda _, c=col: self._on_asym_changed())
        self._off_detail.setVisible(False)
        lay.addWidget(self._off_detail)

        # summary row
        sr = QHBoxLayout()
        self._lbl_final  = QLabel("Final Offset: –")
        self._lbl_inner2 = QLabel("Inner Area: –")
        self._lbl_final.setStyleSheet(f"color:{C_ORANGE};font-weight:600;")
        self._lbl_inner2.setStyleSheet(f"color:{C_GREEN};font-weight:600;")
        sr.addWidget(self._lbl_final); sr.addSpacing(20); sr.addWidget(self._lbl_inner2)
        sr.addStretch()
        lay.addLayout(sr)
        return w

    # patterns tab ─────────────────────────────────────────────────────────────
    def _build_patterns_tab(self):
        w = QWidget(); lay = QVBoxLayout(w); lay.setContentsMargins(6,6,6,6); lay.setSpacing(4)

        tr = QHBoxLayout()
        tr.addWidget(self._btn("Add Pattern", self._pat_add))
        tr.addWidget(self._btn("Duplicate",   self._pat_dup))
        tr.addWidget(self._btn("Delete",      self._pat_del))
        tr.addWidget(self._btn("↑", self._pat_up, fixed_w=28))
        tr.addWidget(self._btn("↓", self._pat_dn, fixed_w=28))
        tr.addStretch()
        lay.addLayout(tr)

        cols = ["✓", "Name", "Type", "Outer idx", "Inner idx", "Tool", "Depth mm", "●"]
        self._pat_tbl = QTableWidget(0, len(cols))
        self._pat_tbl.setHorizontalHeaderLabels(cols)
        hh = self._pat_tbl.horizontalHeader()
        hh.setSectionResizeMode(1, QHeaderView.Stretch)
        for i in [0,2,3,4,5,6,7]:
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        self._pat_tbl.setSelectionBehavior(QTableWidget.SelectRows)
        self._pat_tbl.setAlternatingRowColors(True)
        self._pat_tbl.itemChanged.connect(self._pat_item_changed)
        self._pat_tbl.itemSelectionChanged.connect(
            lambda: self._on_pat_row_sel(self._pat_tbl.currentRow()))
        lay.addWidget(self._pat_tbl, 1)

        # dynamic parameter panel
        self._pat_params_box = QGroupBox("Pattern Parameters")
        self._pat_params_lay = QGridLayout(self._pat_params_box)
        self._pat_params_box.setVisible(False)
        lay.addWidget(self._pat_params_box)
        self._pat_param_widgets: dict = {}   # key → QDoubleSpinBox/QSpinBox
        return w

    # tools tab ────────────────────────────────────────────────────────────────
    def _build_tools_tab(self):
        w = QWidget(); lay = QVBoxLayout(w)
        lay.addWidget(QLabel("Tool Bank"))
        self._tbl_tools = QTableWidget(0, 8)
        self._tbl_tools.setHorizontalHeaderLabels(
            ["Tool ID","Name","Type","Diam mm","Flutes","Max Depth","RPM","Feed"])
        self._tbl_tools.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        lay.addWidget(self._tbl_tools, 1)
        return w

    # preview tab ──────────────────────────────────────────────────────────────
    def _build_preview_tab(self):
        w = QWidget(); lay = QHBoxLayout(w)
        self._big_canvas = DoorCanvas()
        lay.addWidget(self._big_canvas, 2)
        self._tbl_layers = QTableWidget(0, 4)
        self._tbl_layers.setHorizontalHeaderLabels(["Layer Name","Tool","Operation","Depth"])
        self._tbl_layers.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        lay.addWidget(self._tbl_layers, 1)
        return w

    # right panel ──────────────────────────────────────────────────────────────
    def _build_right_panel(self):
        panel = QFrame()
        lay = QVBoxLayout(panel); lay.setContentsMargins(6,6,6,6); lay.setSpacing(4)

        hr = QHBoxLayout()
        hr.addWidget(_hdr("Live Preview"))
        hr.addStretch()
        self._chk_show_pat = QCheckBox("Show Patterns")
        self._chk_show_pat.setChecked(True)
        self._chk_show_pat.toggled.connect(self._canvas.set_show_patterns if False else lambda v: None)
        hr.addWidget(self._chk_show_pat)
        lay.addLayout(hr)

        self._canvas = DoorCanvas()
        self._chk_show_pat.toggled.connect(self._canvas.set_show_patterns)
        lay.addWidget(self._canvas, 1)
        return panel

    # bottom bar ───────────────────────────────────────────────────────────────
    def _build_bottom_bar(self):
        bar = QFrame(); bar.setFixedHeight(50)
        lay = QHBoxLayout(bar); lay.setContentsMargins(10,6,10,6); lay.setSpacing(8)
        for lbl, slot in [("Save (FDR)", self._save), ("Save As", self._save_as),
                           ("Export DXF", None), ("Generate G-Code", None),
                           ("Print Barcode", None)]:
            lay.addWidget(self._btn(lbl, slot))
        lay.addStretch()
        self._status_lbl = QLabel("Ready")
        self._status_lbl.setStyleSheet(f"color:{C_DIM};")
        lay.addWidget(self._status_lbl)
        lay.addStretch()
        lay.addWidget(self._btn("Close", self.close))
        return bar

    # ── Refresh logic ─────────────────────────────────────────────────────────

    def _refresh_all(self):
        if self._block:
            return
        self._block = True
        d = self._design
        # left panel
        self._ed_code.setText(d.code)
        self._ed_name.setText(d.name)
        self._top_code.setText(d.code)
        self._top_name.setText(d.name)
        self._sp_w.setValue(d.default_width)
        self._sp_h.setValue(d.default_height)
        # offsets table
        self._refresh_off_table()
        # patterns table
        self._refresh_pat_table()
        # tools
        self._refresh_tools_table()
        # canvas
        W, H = self._sp_w.value(), self._sp_h.value()
        self._canvas.set_design(d, W, H)
        self._mini_canvas.set_design(d, W, H)
        self._big_canvas.set_design(d, W, H)
        # inner area
        totals = cumulative_totals(d.offset_steps)
        if totals:
            t,r,b,l = totals[-1]
            iw = max(0, W - r - l)
            ih = max(0, H - t - b)
            self._lbl_inner.setText(f"Inner: {iw:.1f} × {ih:.1f} mm")
            self._lbl_inner2.setText(f"Inner Area: {iw:.1f} × {ih:.1f} mm")
            self._lbl_final.setText(f"Final Offset: Σ{t:.0f} mm")
        else:
            self._lbl_inner.setText("Inner Area: –")
            self._lbl_inner2.setText("Inner Area: –")
            self._lbl_final.setText("Final Offset: –")
        # layers
        self._refresh_layers_table(totals)
        self._block = False

    def _refresh_off_table(self):
        d = self._design
        W, H = self._sp_w.value(), self._sp_h.value()
        totals = cumulative_totals(d.offset_steps)
        self._off_tbl.blockSignals(True)
        self._off_tbl.setRowCount(len(d.offset_steps))
        t_idx = 0
        for r, s in enumerate(d.offset_steps):
            tot_val = totals[t_idx] if s.enabled and t_idx < len(totals) else None
            if s.enabled:
                t_idx += 1
            tot_str = f"{tot_val[0]:.1f}" if tot_val else "–"
            total_top = tot_val[0] if tot_val else 0
            layer = f"{d.code}_{s.tool_id}_{s.operation}_Offset{int(round(total_top)):03d}"
            color_hex = RING_COLORS[r % len(RING_COLORS)]

            # col 0: enabled checkbox
            chk = QTableWidgetItem()
            chk.setCheckState(Qt.Checked if s.enabled else Qt.Unchecked)
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            self._off_tbl.setItem(r, 0, chk)

            # col 1: step mm (editable)
            step_val = s.step_mm if s.link else (s.step_top + s.step_bottom + s.step_right + s.step_left)/4
            self._off_tbl.setItem(r, 1, _cell(f"{step_val:.1f}"))

            # col 2: Σ total (read-only)
            c2 = _cell(tot_str, editable=False)
            c2.setForeground(QColor(C_DIM))
            self._off_tbl.setItem(r, 2, c2)

            # col 3: operation
            self._off_tbl.setItem(r, 3, _cell(s.operation))
            # col 4: tool
            self._off_tbl.setItem(r, 4, _cell(s.tool_id))
            # col 5: depth
            self._off_tbl.setItem(r, 5, _cell(f"{s.depth_mm:.1f}"))
            # col 6: note
            self._off_tbl.setItem(r, 6, _cell(s.note))

            # col 7: link checkbox
            lnk = QTableWidgetItem("🔗" if s.link else "")
            lnk.setCheckState(Qt.Checked if s.link else Qt.Unchecked)
            lnk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            lnk.setTextAlignment(Qt.AlignCenter)
            self._off_tbl.setItem(r, 7, lnk)

            # col 8: layer name (read-only)
            c8 = _cell(layer, editable=False)
            c8.setForeground(QColor(C_DIM))
            self._off_tbl.setItem(r, 8, c8)

            # col 9: color dot
            dot = QTableWidgetItem("●")
            dot.setForeground(QColor(color_hex))
            dot.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled)
            dot.setTextAlignment(Qt.AlignCenter)
            self._off_tbl.setItem(r, 9, dot)

        self._off_tbl.blockSignals(False)

    def _refresh_pat_table(self):
        d = self._design
        self._pat_tbl.blockSignals(True)
        self._pat_tbl.setRowCount(len(d.patterns))
        for r, p in enumerate(d.patterns):
            chk = QTableWidgetItem()
            chk.setCheckState(Qt.Checked if p.enabled else Qt.Unchecked)
            chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            self._pat_tbl.setItem(r, 0, chk)
            self._pat_tbl.setItem(r, 1, _cell(p.name))
            # type combo-like cell
            self._pat_tbl.setItem(r, 2, _cell(p.pattern_type))
            self._pat_tbl.setItem(r, 3, _cell(str(p.outer_idx + 1)))
            self._pat_tbl.setItem(r, 4, _cell(str(p.inner_idx + 1)))
            self._pat_tbl.setItem(r, 5, _cell(p.tool_id))
            self._pat_tbl.setItem(r, 6, _cell(f"{p.depth_mm:.1f}"))
            dot = QTableWidgetItem("●")
            dot.setForeground(QColor(PAT_COLOR))
            dot.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled)
            dot.setTextAlignment(Qt.AlignCenter)
            self._pat_tbl.setItem(r, 7, dot)
        self._pat_tbl.blockSignals(False)

    def _refresh_tools_table(self):
        d = self._design
        tool_ids = sorted({s.tool_id for s in d.offset_steps} | {p.tool_id for p in d.patterns})
        self._tbl_tools.setRowCount(len(tool_ids))
        for r, tid in enumerate(tool_ids):
            for c, v in enumerate([tid, f"Tool {tid}", "End Mill", "6.0", "2", "18.0", "18000", "3000", ""]):
                if c < 8: self._tbl_tools.setItem(r, c, QTableWidgetItem(v))

    def _refresh_layers_table(self, totals):
        d = self._design
        rows = []
        t_idx = 0
        for s in d.offset_steps:
            if not s.enabled:
                continue
            tot = totals[t_idx] if t_idx < len(totals) else (0,0,0,0)
            t_idx += 1
            layer = f"{d.code}_{s.tool_id}_{s.operation}_Offset{int(round(tot[0])):03d}"
            rows.append((layer, s.tool_id, s.operation, s.depth_mm))
        self._tbl_layers.setRowCount(len(rows))
        for r, (ln, tid, op, dep) in enumerate(rows):
            for c, v in enumerate([ln, tid, op, f"{dep:.1f}"]):
                self._tbl_layers.setItem(r, c, QTableWidgetItem(v))

    # ── Offset detail panel ───────────────────────────────────────────────────

    def _on_off_row_sel(self, row):
        self._sel_off_row = row
        if row < 0 or row >= len(self._design.offset_steps):
            self._off_detail.setVisible(False)
            return
        s = self._design.offset_steps[row]
        is_asym = not s.link
        self._off_detail.setVisible(is_asym)
        if is_asym:
            for sp, v in [(self._sp_top, s.step_top), (self._sp_right, s.step_right),
                           (self._sp_bottom, s.step_bottom), (self._sp_left, s.step_left)]:
                sp.blockSignals(True); sp.setValue(v); sp.blockSignals(False)

    def _on_asym_changed(self):
        r = self._sel_off_row
        if r < 0 or r >= len(self._design.offset_steps) or self._block:
            return
        s = self._design.offset_steps[r]
        s.step_top    = self._sp_top.value()
        s.step_right  = self._sp_right.value()
        s.step_bottom = self._sp_bottom.value()
        s.step_left   = self._sp_left.value()
        # sync step_mm to average for display
        s.step_mm = (s.step_top + s.step_right + s.step_bottom + s.step_left) / 4
        self._refresh_all()

    # ── Pattern param panel ───────────────────────────────────────────────────

    def _on_pat_row_sel(self, row):
        self._sel_pat_row = row
        self._rebuild_pat_params(row)

    def _rebuild_pat_params(self, row):
        # clear old widgets
        for w in self._pat_param_widgets.values():
            w.setParent(None)
        self._pat_param_widgets.clear()
        lay = self._pat_params_lay
        while lay.count():
            item = lay.takeAt(0)
            if item.widget(): item.widget().setParent(None)

        if row < 0 or row >= len(self._design.patterns):
            self._pat_params_box.setVisible(False)
            return

        p = self._design.patterns[row]
        params = PATTERN_PARAMS.get(p.pattern_type, [])
        if not params:
            self._pat_params_box.setVisible(False)
            return

        self._pat_params_box.setTitle(f"Pattern Parameters – {p.pattern_type}")
        self._pat_params_box.setVisible(True)

        for col, (key, label, unit, lo, hi, default) in enumerate(params):
            lbl = QLabel(f"{label} ({unit})" if unit else label)
            if isinstance(default, int) and isinstance(lo, int):
                sp = QSpinBox()
                sp.setRange(int(lo), int(hi)); sp.setValue(int(getattr(p, key, default)))
            else:
                sp = QDoubleSpinBox()
                sp.setRange(float(lo), float(hi)); sp.setDecimals(1)
                sp.setValue(float(getattr(p, key, default)))
            lay.addWidget(lbl, 0, col)
            lay.addWidget(sp, 1, col)
            self._pat_param_widgets[key] = sp
            sp.valueChanged.connect(lambda _, k=key: self._on_pat_param_changed(k))

    def _on_pat_param_changed(self, key):
        r = self._sel_pat_row
        if r < 0 or r >= len(self._design.patterns) or self._block:
            return
        p = self._design.patterns[r]
        sp = self._pat_param_widgets.get(key)
        if sp:
            setattr(p, key, sp.value())
        W, H = self._sp_w.value(), self._sp_h.value()
        totals = cumulative_totals(self._design.offset_steps)
        self._canvas.set_design(self._design, W, H)
        self._mini_canvas.set_design(self._design, W, H)
        self._big_canvas.set_design(self._design, W, H)

    # ── Table signal handlers ─────────────────────────────────────────────────

    def _off_item_changed(self, item):
        if self._block:
            return
        r = item.row(); c = item.column()
        d = self._design
        if r >= len(d.offset_steps):
            return
        s = d.offset_steps[r]
        if c == 0:   # enabled checkbox
            s.enabled = (item.checkState() == Qt.Checked)
        elif c == 1: # step mm
            try:
                v = float(item.text()); s.step_mm = v
                if s.link:
                    s.step_top = s.step_right = s.step_bottom = s.step_left = v
            except ValueError: pass
        elif c == 3: s.operation = item.text().strip()
        elif c == 4: s.tool_id   = item.text().strip()
        elif c == 5:
            try: s.depth_mm = float(item.text())
            except ValueError: pass
        elif c == 6: s.note = item.text()
        elif c == 7: # link toggle
            s.link = (item.checkState() == Qt.Checked)
            self._on_off_row_sel(r)
        self._refresh_all()

    def _pat_item_changed(self, item):
        if self._block:
            return
        r = item.row(); c = item.column()
        d = self._design
        if r >= len(d.patterns):
            return
        p = d.patterns[r]
        if c == 0:   p.enabled = (item.checkState() == Qt.Checked)
        elif c == 1: p.name = item.text().strip()
        elif c == 2:
            pt = item.text().strip()
            if pt in ALL_PATTERN_TYPES:
                p.pattern_type = pt
                self._rebuild_pat_params(r)
        elif c == 3:
            try: p.outer_idx = max(0, int(float(item.text())) - 1)
            except ValueError: pass
        elif c == 4:
            try: p.inner_idx = max(0, int(float(item.text())) - 1)
            except ValueError: pass
        elif c == 5: p.tool_id = item.text().strip()
        elif c == 6:
            try: p.depth_mm = float(item.text())
            except ValueError: pass
        self._refresh_all()

    # ── Offset row actions ────────────────────────────────────────────────────

    def _off_add(self):
        self._design.offset_steps.append(
            OffsetStep(enabled=True, step_mm=10.0, tool_id="T1",
                       operation="groove", depth_mm=2.0, note="",
                       link=True, step_top=10, step_right=10,
                       step_bottom=10, step_left=10))
        self._refresh_all()

    def _off_dup(self):
        r = self._off_tbl.currentRow()
        steps = self._design.offset_steps
        if 0 <= r < len(steps):
            import copy
            steps.insert(r+1, copy.deepcopy(steps[r]))
            self._refresh_all()

    def _off_del(self):
        r = self._off_tbl.currentRow()
        steps = self._design.offset_steps
        if 0 <= r < len(steps):
            steps.pop(r)
            self._refresh_all()

    def _off_up(self):
        r = self._off_tbl.currentRow()
        steps = self._design.offset_steps
        if r > 0:
            steps[r-1], steps[r] = steps[r], steps[r-1]
            self._refresh_all()
            self._off_tbl.selectRow(r-1)

    def _off_dn(self):
        r = self._off_tbl.currentRow()
        steps = self._design.offset_steps
        if 0 <= r < len(steps)-1:
            steps[r], steps[r+1] = steps[r+1], steps[r]
            self._refresh_all()
            self._off_tbl.selectRow(r+1)

    # ── Pattern row actions ───────────────────────────────────────────────────

    def _pat_add(self):
        self._design.patterns.append(
            PatternRule(enabled=True, name="NewPattern",
                        pattern_type="horizontal",
                        outer_idx=0, inner_idx=1,
                        tool_id="T1", depth_mm=1.5,
                        spacing_mm=30, margin_mm=0))
        self._refresh_all()

    def _pat_dup(self):
        r = self._pat_tbl.currentRow()
        pats = self._design.patterns
        if 0 <= r < len(pats):
            import copy
            pats.insert(r+1, copy.deepcopy(pats[r]))
            self._refresh_all()

    def _pat_del(self):
        r = self._pat_tbl.currentRow()
        pats = self._design.patterns
        if 0 <= r < len(pats):
            pats.pop(r)
            self._refresh_all()

    def _pat_up(self):
        r = self._pat_tbl.currentRow()
        pats = self._design.patterns
        if r > 0:
            pats[r-1], pats[r] = pats[r], pats[r-1]
            self._refresh_all(); self._pat_tbl.selectRow(r-1)

    def _pat_dn(self):
        r = self._pat_tbl.currentRow()
        pats = self._design.patterns
        if 0 <= r < len(pats)-1:
            pats[r], pats[r+1] = pats[r+1], pats[r]
            self._refresh_all(); self._pat_tbl.selectRow(r+1)

    # ── Size change ───────────────────────────────────────────────────────────

    def _on_size_changed(self):
        if not self._block:
            self._refresh_all()

    # ── File operations ───────────────────────────────────────────────────────

    def _collect_from_ui(self):
        d = self._design
        d.code = self._ed_code.text().strip() or "F000"
        d.name = self._ed_name.text().strip() or "Door"
        d.default_width  = self._sp_w.value()
        d.default_height = self._sp_h.value()

    def _save(self):
        self._collect_from_ui()
        path = Path(f"{self._design.code}.fdr.json")
        path.write_text(json.dumps(design_to_dict(self._design), indent=2))
        self._status_lbl.setText(f"Saved: {path.resolve()}")

    def _save_as(self):
        self._collect_from_ui()
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Design", f"{self._design.code}.fdr.json",
            "FIROO Design (*.fdr.json);;JSON (*.json)")
        if path:
            Path(path).write_text(json.dumps(design_to_dict(self._design), indent=2))
            self._status_lbl.setText(f"Saved: {path}")

    def _open_design(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open Design", "", "FIROO Design (*.fdr.json *.json)")
        if path:
            try:
                data = json.loads(Path(path).read_text())
                self._design = design_from_dict(data)
                self._refresh_all()
            except Exception as e:
                QMessageBox.critical(self, "Open Error", str(e))

    def _new_design(self):
        self._design = _make_default_design()
        self._refresh_all()

    # ── Style ─────────────────────────────────────────────────────────────────

    def _apply_style(self):
        self.setStyleSheet(f"""
QMainWindow, QWidget {{
    background: {C_BG}; color: {C_TEXT};
    font-family: "Segoe UI", "Vazirmatn", sans-serif; font-size: 12px;
}}
QFrame {{
    background: {C_PANEL}; border: 1px solid {C_BORDER}; border-radius: 2px;
}}
QLabel {{ color: {C_TEXT}; border: none; background: transparent; }}
QLineEdit, QTextEdit, QDoubleSpinBox, QSpinBox, QComboBox {{
    background: #111820; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 3px; padding: 3px; min-height: 22px;
}}
QPushButton {{
    background: {C_PANEL2}; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 4px; padding: 4px 10px; min-height: 24px;
}}
QPushButton:hover {{ border-color: {C_BLUE}; background: #26313a; }}
QPushButton:pressed {{ background: #1f6feb; }}
QTabWidget::pane {{ border: 1px solid {C_BORDER}; background: {C_PANEL}; }}
QTabBar::tab {{
    background: {C_PANEL2}; color: {C_TEXT}; padding: 7px 14px;
    border: 1px solid {C_BORDER}; border-bottom: none;
}}
QTabBar::tab:selected {{ background: #1f6feb; color: white; }}
QTableWidget {{
    background: #111820; color: {C_TEXT}; gridline-color: {C_BORDER};
    selection-background-color: #1f6feb; alternate-background-color: #151d25;
    border: 1px solid {C_BORDER};
}}
QHeaderView::section {{
    background: #26313a; color: {C_TEXT}; padding: 5px;
    border: 1px solid {C_BORDER};
}}
QCheckBox {{ background: transparent; border: none; }}
QGroupBox {{
    color: {C_ORANGE}; border: 1px solid {C_BORDER}; border-radius: 4px;
    margin-top: 6px; padding-top: 4px; font-weight: 600;
}}
QGroupBox::title {{ subcontrol-origin: margin; left: 8px; padding: 0 4px; }}
QScrollBar:vertical {{
    background: {C_PANEL}; width: 10px; border-radius: 5px;
}}
QScrollBar::handle:vertical {{
    background: {C_BORDER}; border-radius: 5px; min-height: 20px;
}}
""")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sep():
    s = QFrame(); s.setFrameShape(QFrame.VLine)
    s.setFixedWidth(2); s.setStyleSheet(f"background:{C_BORDER};border:none;")
    return s

def _hdr(text):
    lbl = QLabel(text)
    lbl.setStyleSheet(f"color:{C_ORANGE};font-weight:700;font-size:11px;")
    return lbl

def _dspin(lo, hi, val, suffix=""):
    sp = QDoubleSpinBox()
    sp.setRange(lo, hi); sp.setDecimals(1); sp.setValue(val)
    if suffix: sp.setSuffix(suffix)
    return sp

def _cell(text, editable=True):
    item = QTableWidgetItem(str(text))
    if not editable:
        item.setFlags(item.flags() & ~Qt.ItemIsEditable)
    return item


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    app = QApplication(sys.argv)
    w = DoorDesignerWindow()
    w.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
