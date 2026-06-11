"""
FIROO CAM - Nesting Tab  (v2 — Solid Edge exact replica)

Changes from v1:
  • Spacing group: Uniform checkbox + Top/Left/Bottom/Right fields
    (Sheet Edge Spacing) + single Part Spacing — matches s11/s12
  • Results table: added "Extras" column between Parts Nested and Sheets
  • Thumbnails: label shows actual repeat count (x5, x10, x1) not always x1
  • Right panel: Nest tree format "Nest 1 (x5): '2440x1220' (91.19%, 2405mm)"
  • Added "Estimate Material Cost" button in toolbar
  • Spacing group layout matches Solid Edge EXACTLY
"""
from __future__ import annotations
import math, time
from typing import List, Optional

from PySide6.QtCore  import Qt, QThread, Signal, QRectF, QTimer, QSize
from PySide6.QtGui   import (QPainter, QColor, QPen, QBrush, QFont,
                              QFontMetrics, QLinearGradient, QPainterPath)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QSplitter, QGroupBox,
    QLabel, QPushButton, QComboBox, QSpinBox, QDoubleSpinBox,
    QCheckBox, QTableWidget, QTableWidgetItem, QHeaderView,
    QAbstractItemView, QProgressBar, QFrame, QScrollArea,
    QTreeWidget, QTreeWidgetItem, QDialog, QDialogButtonBox,
    QFormLayout, QLineEdit, QApplication, QSizePolicy,
    QRadioButton, QButtonGroup, QStatusBar,
    QMessageBox, QGridLayout
)

from language_manager import lang
from config import config

# ── Palette ──────────────────────────────────────────────────
C_BG         = QColor("#1e1e1e")
C_PANEL      = QColor("#252526")
C_BORDER     = QColor("#3e3e42")
C_ACCENT     = QColor("#0078d4")
C_ACCENT2    = QColor("#106ebe")
C_TEXT       = QColor("#cccccc")
C_DIM        = QColor("#858585")
C_GOOD       = QColor("#4ec9b0")
C_WARN       = QColor("#ce9178")
C_BEST_ROW   = QColor("#1a3a1a")
C_SEL_ROW    = QColor("#264f78")
C_SHEET_BG   = QColor("#2a2a2a")
C_SHEET_BDR  = QColor("#555555")
C_MARGIN_LINE= QColor("#444444")

PART_COLORS = [
    QColor("#c0392b"), QColor("#e67e22"), QColor("#27ae60"),
    QColor("#2980b9"), QColor("#8e44ad"), QColor("#16a085"),
    QColor("#d35400"), QColor("#2c3e50"), QColor("#7f8c8d"),
    QColor("#1abc9c"), QColor("#e74c3c"), QColor("#3498db"),
]

PRIORITY_LABELS = {1:"Highest", 2:"High", 3:"Normal", 4:"Low", 5:"Lowest"}


# ═══════════════════════════════════════════════════════════════
# Worker Thread
# ═══════════════════════════════════════════════════════════════
class NestingWorker(QThread):
    sig_progress = Signal(int, int, float)
    sig_finished = Signal(list, list)
    sig_error    = Signal(str)
    sig_status   = Signal(str)

    def __init__(self, parts, sheet_defs, opts):
        super().__init__()
        self._parts      = parts
        self._sheet_defs = sheet_defs
        self._opts       = opts
        self._stop       = False

    def stop(self): self._stop = True

    def run(self):
        try:
            from nesting_engine import NestingEngine, SheetDef
            engine = NestingEngine()
            engine.gap           = self._opts["part_spacing"]
            engine.margin        = self._opts["sheet_margin"]  # max margin fallback
            engine.margin_top    = self._opts.get("margin_top",    self._opts["sheet_margin"])
            engine.margin_left   = self._opts.get("margin_left",   self._opts["sheet_margin"])
            engine.margin_right  = self._opts.get("margin_right",  self._opts["sheet_margin"])
            engine.margin_bottom = self._opts.get("margin_bottom", self._opts["sheet_margin"])
            engine.auto_rotate   = self._opts["rotation"] > 0

            sds = []
            for sd in self._sheet_defs:
                sds.append(SheetDef(
                    name=sd["name"], width=sd["width"], height=sd["height"],
                    thickness=sd.get("thickness",18), material=sd.get("material","MDF"),
                    quantity=sd["quantity"], priority=sd["priority"],
                    is_remnant=sd.get("is_remnant",False)
                ))
            engine.set_sheets(sds)

            orig = engine._evaluate
            gen_seen = [0]; best_u = [0.0]

            def patched(parts, algo, gen):
                if self._stop: return orig([], algo, gen)
                r = orig(parts, algo, gen)
                if r.utilization > best_u[0]: best_u[0] = r.utilization
                if gen != gen_seen[0]:
                    gen_seen[0] = gen
                    self.sig_progress.emit(gen, self._opts["generations"], best_u[0])
                    self.sig_status.emit(
                        f"Looking for improvements...  Gen {gen}  Best {best_u[0]:.1f}%")
                return r
            engine._evaluate = patched

            sheets = engine.run(
                self._parts,
                generations=self._opts["generations"],
                population=self._opts["population"],
                time_limit=self._opts["duration"],
            )
            self.sig_finished.emit(sheets, engine.all_results)
        except Exception as e:
            import traceback
            self.sig_error.emit(str(e) + "\n" + traceback.format_exc())


# ═══════════════════════════════════════════════════════════════
# Sheet Canvas
# ═══════════════════════════════════════════════════════════════
class SheetCanvas(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._sheet   = None
        self._labels  = True
        self._selected= False
        self.setMinimumSize(80, 60)

    def set_sheet(self, sheet, labels=True):
        self._sheet  = sheet
        self._labels = labels
        self.update()

    def set_selected(self, v):
        self._selected = v
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        try:
            p.setRenderHint(QPainter.Antialiasing)
            p.fillRect(self.rect(), C_BG)
            if not self._sheet:
                p.setPen(QPen(C_DIM))
                p.drawText(self.rect(), Qt.AlignCenter, "No data")
                return

            s   = self._sheet
            sw, sh = s.width, s.height
            pad = 6
            aw  = self.width()  - 2*pad
            ah  = self.height() - 2*pad
            if aw <= 0 or ah <= 0: return
            sc  = min(aw/sw, ah/sh)
            ox  = pad + (aw - sw*sc)/2
            oy  = pad + (ah - sh*sc)/2

            def rx(x): return ox + x*sc
            def ry(y): return oy + (sh-y)*sc

            # Sheet background
            pen_c = C_ACCENT if self._selected else C_SHEET_BDR
            p.setBrush(QBrush(C_SHEET_BG))
            p.setPen(QPen(pen_c, 2 if self._selected else 1))
            p.drawRect(QRectF(rx(0), ry(sh), sw*sc, sh*sc))

            # Parts + optional door design overlay
            for i, part in enumerate(s.parts):
                col  = PART_COLORS[i % len(PART_COLORS)]
                pw, ph = part.actual_width(), part.actual_height()
                prx = rx(part.x); pry = ry(part.y+ph)
                prw = pw*sc;       prh = ph*sc

                # Draw part background
                fill = QColor(col); fill.setAlpha(180)
                p.setBrush(QBrush(fill))
                p.setPen(QPen(col.lighter(130), 0.8))
                p.drawRect(QRectF(prx, pry, prw, prh))

                # Draw door design layers if available
                if self._labels:
                    self._draw_design_layers(
                        p, part, prx, pry, prw, prh, sc)

        finally:
            p.end()

    def _draw_design_layers(self, p, part, prx, pry, prw, prh, sc):
        """Draw door design layer rectangles inside the part."""
        try:
            design_code = getattr(part, "design_code", None)
            if not design_code or design_code in ("cd0", "0", ""):
                return
            from design_resolver import get_resolver
            resolver = get_resolver()
            design = resolver.load(design_code,
                                   width=part.actual_width(),
                                   height=part.actual_height())
            if not design:
                return
            layer_colors = [
                QColor("#ffffff"),  # L0 profile
                QColor("#f1c40f"),  # L1
                QColor("#e67e22"),  # L2
                QColor("#2ecc71"),  # L3
                QColor("#3498db"),  # L4
                QColor("#9b59b6"),  # L5
            ]
            MIN_PX = 3  # minimum pixel inset so lines are visible in thumbnails
            for layer in design.layers:
                if not layer.get("enabled", True):
                    continue
                offset = float(layer.get("offset_mm", 0) or 0)
                depth  = float(layer.get("depth_mm",  0) or 0)
                ltype  = layer.get("type", "groove")
                # Skip only if zero offset AND zero depth AND not a profile cut
                if offset <= 0 and depth <= 0 and ltype != "profile":
                    continue
                lid  = layer.get("id", 0)
                lc   = layer_colors[lid % len(layer_colors)]
                # Enforce minimum pixel visibility for thumbnail scale
                ox_ = max(MIN_PX, offset * sc) if offset > 0 else 0
                oy_ = max(MIN_PX, offset * sc) if offset > 0 else 0
                lx  = prx + ox_
                ly  = pry + oy_
                lw  = prw - 2 * ox_
                lh  = prh - 2 * oy_
                if lw < 2 or lh < 2:
                    continue
                lc_pen = QColor(lc)
                lc_pen.setAlpha(230)
                p.setBrush(Qt.NoBrush)
                p.setPen(QPen(lc_pen, 1.0))
                p.drawRect(QRectF(lx, ly, lw, lh))
        except Exception:
            pass  # Never crash the UI


# ═══════════════════════════════════════════════════════════════
# Util Chart
# ═══════════════════════════════════════════════════════════════
class UtilChart(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._data: List[float] = []
        self._selected = -1
        self.setFixedWidth(110)
        self.setMinimumHeight(120)

    def set_data(self, utils: List[float], selected=0):
        self._data     = utils
        self._selected = selected
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), C_BG)
        if not self._data: return

        n   = len(self._data)
        pad = 28   # left margin for Y labels
        rpad = 4
        w   = self.width()  - pad - rpad
        h   = self.height() - 16
        mn  = max(0, min(self._data) - 2)
        mx  = min(100, max(self._data) + 2)
        rng = mx - mn if mx != mn else 1

        bar_h = max(4, (h - (n-1)*2) // n)

        font = QFont("Segoe UI"); font.setPixelSize(9)
        p.setFont(font)

        # Y axis labels (top and bottom)
        p.setPen(QPen(C_DIM))
        p.drawText(QRectF(0, 8, pad-2, 12), Qt.AlignRight, f"{mx:.2f}%")
        p.drawText(QRectF(0, h-4, pad-2, 12), Qt.AlignRight, f"{mn:.2f}%")

        for i, u in enumerate(self._data):
            bw   = max(2, int((u - mn) / rng * w))
            by   = 8 + i * (bar_h + 2)
            col  = C_ACCENT if i == self._selected else C_DIM
            p.setBrush(QBrush(col)); p.setPen(Qt.NoPen)
            p.drawRect(QRectF(pad, by, bw, bar_h))
            p.setPen(QPen(C_TEXT))
            p.drawText(QRectF(pad + bw + 2, by, 50, bar_h),
                       Qt.AlignVCenter, f"{u:.1f}%")


# ═══════════════════════════════════════════════════════════════
# Sheet Def Dialog  (used inside nesting tab sheets panel)
# ═══════════════════════════════════════════════════════════════
class SheetDefDialog(QDialog):
    STANDARD = [("1220x2440", 1220, 2440), ("2440x1220", 2440, 1220),
                ("3660x1830", 3660, 1830), ("1830x3660", 1830, 3660),
                ("2800x1220", 2800, 1220), ("1220x2800", 1220, 2800)]

    def __init__(self, data=None, parent=None):
        super().__init__(parent)
        self._d = data or {}
        self.setWindowTitle("Add Sheet" if not data else "Edit Sheet")
        self.setModal(True); self.setFixedWidth(380)
        self._build()

    def _build(self):
        lay = QVBoxLayout(self)

        grp1 = QGroupBox("Choose Standard Sheet Sizes")
        g1l  = QVBoxLayout(grp1)
        self._std_combo = QComboBox()
        self._std_combo.addItem("Custom...")
        for lbl, w, h in self.STANDARD:
            self._std_combo.addItem(lbl, (w, h))
        self._std_combo.currentIndexChanged.connect(self._on_std)
        g1l.addWidget(self._std_combo)
        lay.addWidget(grp1)

        grp2 = QGroupBox("Sheet Properties")
        form = QFormLayout(grp2)
        self._name  = QLineEdit(self._d.get("name","Sheet"))
        self._w     = QDoubleSpinBox(); self._w.setRange(100,9999); self._w.setValue(self._d.get("width",2440))
        self._h     = QDoubleSpinBox(); self._h.setRange(100,9999); self._h.setValue(self._d.get("height",1220))
        self._thick = QDoubleSpinBox(); self._thick.setRange(1,100); self._thick.setValue(self._d.get("thickness",18))
        self._mat   = QLineEdit(self._d.get("material","MDF"))
        self._qty   = QSpinBox(); self._qty.setRange(1,9999); self._qty.setValue(self._d.get("quantity",100))
        self._pri   = QComboBox()
        for k,v in PRIORITY_LABELS.items(): self._pri.addItem(v, k)
        self._pri.setCurrentIndex(self._d.get("priority",3)-1)
        self._remn  = QCheckBox("Remnant Sheet")
        self._remn.setChecked(self._d.get("is_remnant",False))
        form.addRow("Name:",       self._name)
        form.addRow("X Dim (mm):", self._w)
        form.addRow("Y Dim (mm):", self._h)
        form.addRow("Thickness:", self._thick)
        form.addRow("Material:",  self._mat)
        form.addRow("Quantity:",  self._qty)
        form.addRow("Priority:",  self._pri)
        form.addRow("",           self._remn)
        lay.addWidget(grp2)

        btns = QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        btns.accepted.connect(self.accept); btns.rejected.connect(self.reject)
        lay.addWidget(btns)

    def _on_std(self, idx):
        data = self._std_combo.itemData(idx)
        if data:
            w, h = data
            self._w.setValue(w); self._h.setValue(h)
            self._name.setText(self._std_combo.currentText())

    def result_data(self):
        return {"name": self._name.text(), "width": self._w.value(),
                "height": self._h.value(), "thickness": self._thick.value(),
                "material": self._mat.text(), "quantity": self._qty.value(),
                "priority": self._pri.currentData(),
                "is_remnant": self._remn.isChecked()}


# ═══════════════════════════════════════════════════════════════
# NESTING TAB  — main widget
# ═══════════════════════════════════════════════════════════════
class NestingTab(QWidget):
    layout_applied = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._parts:       list  = []
        self._sheet_defs:  list  = [
            {"name":"2440x1220","width":2440,"height":1220,
             "thickness":18,"material":"MDF","quantity":100,
             "priority":3,"is_remnant":False}
        ]
        self._all_results: list  = []
        self._sheets:      list  = []
        self._worker            = None
        self._running           = False
        self._elapsed           = 0
        self._run_start         = 0.0

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

        self._build_ui()
        self._apply_style()
        self._load_settings_from_config()

    # ══════════════════════════════════════════════════════════
    # BUILD UI
    # ══════════════════════════════════════════════════════════
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Compact top bar (Start/Stop + key settings only, no ribbon)
        root.addWidget(self._build_compact_bar())

        sep = QFrame(); sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet(f"background:{C_BORDER.name()};")
        sep.setFixedHeight(1)
        root.addWidget(sep)

        # Main body: splitter (sheets panel | center | right panel)
        body = QSplitter(Qt.Horizontal)
        body.setHandleWidth(1)

        # Left: sheets panel
        sheets_panel = self._build_sheets_panel()
        body.addWidget(sheets_panel)

        # Center: layout preview (main area — now large)
        center = self._build_center()
        body.addWidget(center)

        # Right: Results (top) + Nest Details (bottom)
        right = self._build_right_panel()
        body.addWidget(right)

        body.setStretchFactor(0, 0)
        body.setStretchFactor(1, 1)
        body.setStretchFactor(2, 0)
        body.setSizes([220, 900, 300])

        root.addWidget(body, 1)

        # Status bar
        self._status_bar = QLabel("  Ready")
        self._status_bar.setFixedHeight(22)
        self._status_bar.setStyleSheet(
            f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
            f"font-size:11px; border-top:1px solid {C_BORDER.name()};")
        root.addWidget(self._status_bar)

    # ── RIBBON ────────────────────────────────────────────────
    def _build_compact_bar(self) -> QFrame:
        """Compact single-row bar replaces 90px ribbon. Saves vertical space."""
        bar = QFrame()
        bar.setFixedHeight(40)
        bar.setStyleSheet(
            f"background:{C_PANEL.name()};"
            f"border-bottom:1px solid {C_BORDER.name()};")
        bl = QHBoxLayout(bar)
        bl.setContentsMargins(8, 4, 8, 4)
        bl.setSpacing(8)

        # Start / Stop
        self._btn_start = QPushButton("▶  Start")
        self._btn_stop  = QPushButton("■  Stop")
        self._btn_start.setFixedSize(90, 28)
        self._btn_stop.setFixedSize(80, 28)
        self._btn_stop.setEnabled(False)
        self._btn_start.setObjectName("btn_start")
        self._btn_stop.setObjectName("btn_stop")
        bl.addWidget(self._btn_start)
        bl.addWidget(self._btn_stop)

        # Elapsed timer
        self._lbl_elapsed = QLabel("00:00:00")
        self._lbl_elapsed.setStyleSheet(
            f"color:{C_DIM.name()}; font-size:11px; min-width:60px;")
        bl.addWidget(self._lbl_elapsed)
        self._lbl_duration = QLabel("00h:10m")
        self._lbl_duration.setStyleSheet(
            f"color:{C_GOOD.name()}; font-size:11px; font-weight:600;")
        bl.addWidget(self._lbl_duration)

        bl.addWidget(self._vsep())

        # Rotation
        bl.addWidget(QLabel("Rot:"))
        self._cmb_rotation = QComboBox()
        for v in ["None","90","180","Any"]: self._cmb_rotation.addItem(v)
        self._cmb_rotation.setCurrentIndex(1)
        self._cmb_rotation.setFixedWidth(60)
        bl.addWidget(self._cmb_rotation)

        bl.addWidget(self._vsep())

        # Part Spacing
        bl.addWidget(QLabel("Gap:"))
        self._spin_part_spacing = QDoubleSpinBox()
        self._spin_part_spacing.setRange(0,100); self._spin_part_spacing.setDecimals(1)
        self._spin_part_spacing.setFixedWidth(60); self._spin_part_spacing.setValue(5.0)
        self._spin_part_spacing.setSuffix(" mm")
        bl.addWidget(self._spin_part_spacing)

        bl.addWidget(self._vsep())

        # Margins — compact: single Uniform value
        self._chk_uniform = QCheckBox("Uniform")
        self._chk_uniform.setChecked(True)
        self._chk_uniform.setStyleSheet(f"color:{C_TEXT.name()}; font-size:11px;")
        self._chk_uniform.toggled.connect(self._on_uniform_toggled)
        bl.addWidget(self._chk_uniform)

        bl.addWidget(QLabel("Margin:"))
        self._spin_top = QDoubleSpinBox()
        self._spin_top.setRange(0,200); self._spin_top.setDecimals(1)
        self._spin_top.setFixedWidth(60); self._spin_top.setValue(5.0)
        self._spin_top.setSuffix(" mm")
        self._spin_top.valueChanged.connect(self._on_top_changed)
        bl.addWidget(self._spin_top)

        # Hidden spinboxes (still needed for 4-side logic)
        self._spin_left   = QDoubleSpinBox(); self._spin_left.setValue(5.0);   self._spin_left.hide()
        self._spin_right  = QDoubleSpinBox(); self._spin_right.setValue(5.0);  self._spin_right.hide()
        self._spin_bottom = QDoubleSpinBox(); self._spin_bottom.setValue(5.0); self._spin_bottom.hide()
        self._spin_tilt   = QDoubleSpinBox(); self._spin_tilt.setValue(0.0);   self._spin_tilt.hide()
        self._chk_mirror  = QCheckBox();      self._chk_mirror.hide()
        self._spin_speed  = QSpinBox();       self._spin_speed.hide()
        self._chk_fixed   = QCheckBox();      self._chk_fixed.hide()
        self._btn_dir     = QPushButton("→"); self._btn_dir.hide()
        self._rb_best     = QRadioButton("Best Efficiency"); self._rb_best.setChecked(True); self._rb_best.hide()
        self._rb_bal      = QRadioButton("Balanced Repeats"); self._rb_bal.hide()
        self._rb_prefer   = QRadioButton("Prefer Repeats");  self._rb_prefer.hide()
        from PySide6.QtWidgets import QButtonGroup
        self._bg_repeats  = QButtonGroup(self)
        for i, rb in enumerate([self._rb_best, self._rb_bal, self._rb_prefer]):
            self._bg_repeats.addButton(rb, i)
        self._btn_costing = QPushButton("Cost"); self._btn_costing.hide()

        bl.addStretch()

        # Settings button (opens settings dialog)
        self._btn_nest_settings = QPushButton("⚙ Settings")
        self._btn_nest_settings.setFixedSize(90, 28)
        self._btn_nest_settings.setStyleSheet(
            f"background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};"
            f"border-radius:3px; color:{C_TEXT.name()}; font-size:11px;")
        self._btn_nest_settings.clicked.connect(self._show_nest_settings)
        bl.addWidget(self._btn_nest_settings)

        # Connect
        self._btn_start.clicked.connect(self.run_nesting)
        self._btn_stop.clicked.connect(self.stop_nesting)

        return bar

    def _show_nest_settings(self):
        """Show a popup dialog with all nesting settings."""
        from PySide6.QtWidgets import QDialog, QVBoxLayout, QFormLayout, QDialogButtonBox
        dlg = QDialog(self); dlg.setWindowTitle("Nesting Settings")
        dlg.setFixedSize(360, 340)
        dlg.setStyleSheet(f"background:#1e1e1e; color:#cccccc; font-size:12px;")
        lay = QVBoxLayout(dlg); form = QFormLayout(); form.setSpacing(8)

        from PySide6.QtWidgets import QDoubleSpinBox as DSB, QSpinBox as SB
        from PySide6.QtWidgets import QCheckBox as CHK

        # Margins per side
        s_top = QDoubleSpinBox(); s_top.setRange(0,200); s_top.setValue(self._spin_top.value()); s_top.setSuffix(" mm")
        s_left = QDoubleSpinBox(); s_left.setRange(0,200); s_left.setValue(self._spin_left.value()); s_left.setSuffix(" mm")
        s_right = QDoubleSpinBox(); s_right.setRange(0,200); s_right.setValue(self._spin_right.value()); s_right.setSuffix(" mm")
        s_bot = QDoubleSpinBox(); s_bot.setRange(0,200); s_bot.setValue(self._spin_bottom.value()); s_bot.setSuffix(" mm")

        form.addRow("Top Margin:",    s_top)
        form.addRow("Left Margin:",   s_left)
        form.addRow("Right Margin:",  s_right)
        form.addRow("Bottom Margin:", s_bot)
        form.addRow("Part Spacing:",  self._spin_part_spacing)
        form.addRow("Rotation:",      self._cmb_rotation)
        lay.addLayout(form)

        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject)
        lay.addWidget(btns)

        if dlg.exec() == QDialog.Accepted:
            self._spin_top.setValue(s_top.value())
            self._spin_left.setValue(s_left.value())
            self._spin_right.setValue(s_right.value())
            self._spin_bottom.setValue(s_bot.value())

    @staticmethod
    def _vsep() -> QFrame:
        d = QFrame(); d.setFrameShape(QFrame.VLine); d.setFixedWidth(1)
        d.setStyleSheet(f"color:#3e3e42; margin:4px 0;"); return d

    def _build_ribbon(self) -> QFrame:
        ribbon = QFrame()
        ribbon.setFixedHeight(90)
        ribbon.setStyleSheet(
            f"background:{C_PANEL.name()};"
            f"border-bottom:1px solid {C_BORDER.name()};")
        rl = QHBoxLayout(ribbon)
        rl.setContentsMargins(6, 4, 6, 0)
        rl.setSpacing(0)

        # ── Group: Nesting ─────────────────────────────────────
        g_nest = self._ribbon_group("Nesting")
        gn_lay = QHBoxLayout(g_nest)
        gn_lay.setSpacing(4)

        btn_col = QVBoxLayout(); btn_col.setSpacing(2)
        row1 = QHBoxLayout(); row1.setSpacing(4)
        self._btn_start = QPushButton("▶  Start")
        self._btn_stop  = QPushButton("■  Stop")
        self._btn_start.setFixedSize(72, 28)
        self._btn_stop.setFixedSize(72, 28)
        self._btn_stop.setEnabled(False)
        self._btn_start.setObjectName("btn_start")
        self._btn_stop.setObjectName("btn_stop")
        row1.addWidget(self._btn_start); row1.addWidget(self._btn_stop)
        btn_col.addLayout(row1)

        timer_row = QHBoxLayout(); timer_row.setSpacing(4)
        self._chk_fixed = QCheckBox("Fixed Run")
        self._chk_fixed.setStyleSheet(f"color:{C_TEXT.name()}; font-size:11px;")
        self._lbl_duration = QLabel("00h:10m")
        self._lbl_duration.setStyleSheet(
            f"color:{C_GOOD.name()}; font-size:11px; font-weight:600;")
        self._lbl_elapsed = QLabel("00:00:00")
        self._lbl_elapsed.setStyleSheet(f"color:{C_DIM.name()}; font-size:11px;")
        timer_row.addWidget(self._chk_fixed)
        timer_row.addWidget(self._lbl_duration)
        timer_row.addWidget(self._lbl_elapsed)
        btn_col.addLayout(timer_row)
        gn_lay.addLayout(btn_col)

        rl.addWidget(g_nest)
        rl.addWidget(self._vdiv())

        # ── Group: Part Rotation ───────────────────────────────
        g_rot = self._ribbon_group("Part Rotation")
        gr_lay = QFormLayout(g_rot)
        gr_lay.setSpacing(3); gr_lay.setContentsMargins(4,2,4,2)
        gr_lay.setLabelAlignment(Qt.AlignRight)

        self._cmb_rotation = QComboBox()
        for v in ["None","90","180","Any"]: self._cmb_rotation.addItem(v)
        self._cmb_rotation.setCurrentIndex(1)
        self._cmb_rotation.setFixedWidth(70)

        self._spin_tilt = QDoubleSpinBox()
        self._spin_tilt.setRange(0,45); self._spin_tilt.setValue(0.0)
        self._spin_tilt.setFixedWidth(70)

        self._chk_mirror = QCheckBox("Mirror Allowed")
        self._chk_mirror.setStyleSheet(f"color:{C_TEXT.name()}; font-size:11px;")

        gr_lay.addRow("Rotation:", self._cmb_rotation)
        gr_lay.addRow("Tilt (+/-)°:", self._spin_tilt)
        gr_lay.addRow("", self._chk_mirror)
        rl.addWidget(g_rot)
        rl.addWidget(self._vdiv())

        # ── Group: Spacing  (EXACT Solid Edge layout) ──────────
        # Layout: checkbox Uniform + spin | Top/Left/Bottom/Right for Sheet Edge Spacing
        # and Part Spacing
        g_spc = self._ribbon_group("Spacing")
        gs_lay = QVBoxLayout(g_spc)
        gs_lay.setSpacing(2); gs_lay.setContentsMargins(4,2,4,2)

        # Part Spacing row
        part_row = QHBoxLayout(); part_row.setSpacing(4)
        part_row.addWidget(QLabel("Part Spacing:"))
        self._spin_part_spacing = QDoubleSpinBox()
        self._spin_part_spacing.setRange(0,100); self._spin_part_spacing.setDecimals(3)
        self._spin_part_spacing.setFixedWidth(72); self._spin_part_spacing.setValue(5.0)
        part_row.addWidget(self._spin_part_spacing)
        gs_lay.addLayout(part_row)

        # Uniform checkbox
        self._chk_uniform = QCheckBox("Uniform")
        self._chk_uniform.setChecked(True)
        self._chk_uniform.setStyleSheet(f"color:{C_TEXT.name()}; font-size:11px;")
        self._chk_uniform.toggled.connect(self._on_uniform_toggled)
        gs_lay.addWidget(self._chk_uniform)

        # Sheet Edge Spacing — Top row
        top_row = QHBoxLayout(); top_row.setSpacing(3)
        top_row.addWidget(QLabel("Top:"))
        self._spin_top = QDoubleSpinBox()
        self._spin_top.setRange(0,200); self._spin_top.setDecimals(3)
        self._spin_top.setFixedWidth(65); self._spin_top.setValue(5.0)
        self._spin_top.valueChanged.connect(self._on_top_changed)
        top_row.addWidget(self._spin_top)
        # Right side of top row (just a spacer to align)
        top_row.addStretch()
        gs_lay.addLayout(top_row)

        # Left / Right row
        lr_row = QHBoxLayout(); lr_row.setSpacing(3)
        lr_row.addWidget(QLabel("Left:"))
        self._spin_left = QDoubleSpinBox()
        self._spin_left.setRange(0,200); self._spin_left.setDecimals(3)
        self._spin_left.setFixedWidth(65); self._spin_left.setValue(5.0)
        lr_row.addWidget(self._spin_left)
        lr_row.addSpacing(4)
        lr_row.addWidget(QLabel("Right:"))
        self._spin_right = QDoubleSpinBox()
        self._spin_right.setRange(0,200); self._spin_right.setDecimals(3)
        self._spin_right.setFixedWidth(65); self._spin_right.setValue(5.0)
        lr_row.addWidget(self._spin_right)
        gs_lay.addLayout(lr_row)

        # Bottom row
        bot_row = QHBoxLayout(); bot_row.setSpacing(3)
        bot_row.addWidget(QLabel("Bottom:"))
        self._spin_bottom = QDoubleSpinBox()
        self._spin_bottom.setRange(0,200); self._spin_bottom.setDecimals(3)
        self._spin_bottom.setFixedWidth(65); self._spin_bottom.setValue(5.0)
        bot_row.addWidget(self._spin_bottom)
        bot_row.addStretch()
        gs_lay.addLayout(bot_row)

        # Label below
        spc_lbl = QLabel("Sheet Edge Spacing")
        spc_lbl.setStyleSheet(f"color:{C_DIM.name()}; font-size:10px;")
        gs_lay.addWidget(spc_lbl)

        rl.addWidget(g_spc)
        rl.addWidget(self._vdiv())

        # ── Group: Nesting Direction ───────────────────────────
        g_dir = self._ribbon_group("Nesting Direction")
        gd_lay = QVBoxLayout(g_dir)
        gd_lay.setAlignment(Qt.AlignCenter)

        # Speed input (number field above arrow, like Solid Edge)
        self._spin_speed = QSpinBox()
        self._spin_speed.setRange(0, 9999); self._spin_speed.setValue(0)
        self._spin_speed.setFixedWidth(50)
        gd_lay.addWidget(self._spin_speed, 0, Qt.AlignCenter)

        self._btn_dir = QPushButton("→")
        self._btn_dir.setFixedSize(40, 40)
        self._btn_dir.setStyleSheet(
            f"background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};"
            f"border-radius:4px; color:{C_TEXT.name()}; font-size:18px;")
        self._btn_dir.clicked.connect(self._toggle_direction)
        gd_lay.addWidget(self._btn_dir)
        rl.addWidget(g_dir)
        rl.addWidget(self._vdiv())

        # ── Group: Nest Repeats ────────────────────────────────
        g_rep = self._ribbon_group("Nesting Repeats")
        gr2_lay = QVBoxLayout(g_rep)
        gr2_lay.setSpacing(2); gr2_lay.setContentsMargins(4,2,4,2)
        self._bg_repeats = QButtonGroup(self)
        self._rb_best    = QRadioButton("Best Efficiency")
        self._rb_bal     = QRadioButton("Balanced Repeats")
        self._rb_prefer  = QRadioButton("Prefer Repeats")
        self._rb_best.setChecked(True)
        for i, rb in enumerate([self._rb_best, self._rb_bal, self._rb_prefer]):
            rb.setStyleSheet(f"color:{C_TEXT.name()}; font-size:11px;")
            self._bg_repeats.addButton(rb, i)
            gr2_lay.addWidget(rb)
        rl.addWidget(g_rep)
        rl.addWidget(self._vdiv())

        # ── Group: Costing ────────────────────────────────────
        g_cost = self._ribbon_group("Costing")
        gc_lay = QVBoxLayout(g_cost)
        gc_lay.setAlignment(Qt.AlignCenter)
        self._btn_costing = QPushButton("💰\nEstimate\nMaterial Cost")
        self._btn_costing.setFixedSize(80, 60)
        self._btn_costing.setStyleSheet(
            f"background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};"
            f"border-radius:3px; color:{C_TEXT.name()}; font-size:10px;"
            f"text-align:center;")
        gc_lay.addWidget(self._btn_costing)
        rl.addWidget(g_cost)

        rl.addStretch()

        # Connect
        self._btn_start.clicked.connect(self.run_nesting)
        self._btn_stop.clicked.connect(self.stop_nesting)

        return ribbon

    def _on_uniform_toggled(self, checked: bool):
        """When Uniform is checked, sync all four spacing fields."""
        if checked:
            v = self._spin_top.value()
            for sp in [self._spin_left, self._spin_right, self._spin_bottom]:
                sp.blockSignals(True)
                sp.setValue(v)
                sp.blockSignals(False)
        enabled = not checked
        for sp in [self._spin_left, self._spin_right, self._spin_bottom]:
            sp.setEnabled(enabled)

    def _on_top_changed(self, v: float):
        if self._chk_uniform.isChecked():
            for sp in [self._spin_left, self._spin_right, self._spin_bottom]:
                sp.blockSignals(True)
                sp.setValue(v)
                sp.blockSignals(False)

    @staticmethod
    def _ribbon_group(title: str) -> QWidget:
        w  = QWidget()
        vl = QVBoxLayout(w)
        vl.setContentsMargins(0,0,0,0); vl.setSpacing(0)
        inner = QFrame()
        inner.setObjectName("ribbon_group")
        vl.addWidget(inner, 1)
        lbl = QLabel(title)
        lbl.setAlignment(Qt.AlignCenter)
        lbl.setStyleSheet(f"color:{C_DIM.name()}; font-size:10px; "
                          f"border-top:1px solid {C_BORDER.name()}; padding:1px 0;")
        vl.addWidget(lbl)
        return w

    @staticmethod
    def _vdiv():
        d = QFrame(); d.setFrameShape(QFrame.VLine)
        d.setFixedWidth(1)
        d.setStyleSheet(f"background:{C_BORDER.name()}; margin:4px 6px;")
        return d

    # ── SHEETS PANEL (left) ───────────────────────────────────
    def _build_sheets_panel(self):
        w = QWidget(); w.setFixedWidth(220)
        lay = QVBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

        hdr = QLabel("  Sheets")
        hdr.setFixedHeight(26)
        hdr.setStyleSheet(f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
                          f"font-size:11px; font-weight:600;"
                          f"border-bottom:1px solid {C_BORDER.name()};")
        lay.addWidget(hdr)

        tb = QHBoxLayout(); tb.setContentsMargins(4,3,4,3); tb.setSpacing(3)
        self._btn_create_sheet = QPushButton("+ Sheet")
        self._btn_add_remnant  = QPushButton("+ Remnant")
        self._btn_edit_sheet   = QPushButton("✎")
        self._btn_remove_sheet = QPushButton("✕")
        for b in [self._btn_create_sheet, self._btn_add_remnant]:
            b.setFixedHeight(22); b.setStyleSheet(self._small_btn_style())
            tb.addWidget(b)
        for b in [self._btn_edit_sheet, self._btn_remove_sheet]:
            b.setFixedSize(24,22); b.setStyleSheet(self._small_btn_style())
            tb.addWidget(b)
        tb.addStretch()
        lay.addLayout(tb)

        self._sheet_table = QTableWidget(0, 5)
        self._sheet_table.setHorizontalHeaderLabels(
            ["Name","X Dim","Y Dim","Qty","Priority"])
        self._sheet_table.verticalHeader().hide()
        self._sheet_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._sheet_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        hdr2 = self._sheet_table.horizontalHeader()
        hdr2.setSectionResizeMode(0, QHeaderView.Stretch)
        for i in range(1,5): hdr2.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        lay.addWidget(self._sheet_table, 1)

        self._btn_create_sheet.clicked.connect(self._add_sheet)
        self._btn_add_remnant.clicked.connect(self._add_remnant)
        self._btn_edit_sheet.clicked.connect(self._edit_sheet)
        self._btn_remove_sheet.clicked.connect(self._del_sheet)

        self._refresh_sheet_table()
        return w

    # ── CENTER PANEL ──────────────────────────────────────────
    def _build_center(self):
        """Center panel: Current Layout fills entire area (max space)."""
        w   = QWidget()
        lay = QVBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

        # Current Layout header
        layout_hdr = QLabel("  Current Layout")
        layout_hdr.setFixedHeight(26)
        layout_hdr.setStyleSheet(
            f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
            f"font-size:11px; font-weight:600; "
            f"border-bottom:1px solid {C_BORDER.name()};")
        lay.addWidget(layout_hdr)

        # Sheet thumbnails scroll area — now fills full height
        scroll = QScrollArea()
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet(f"background:{C_BG.name()}; border:none;")

        self._thumbs_container = QWidget()
        self._thumbs_layout    = QHBoxLayout(self._thumbs_container)
        self._thumbs_layout.setContentsMargins(12,12,12,12)
        self._thumbs_layout.setSpacing(16)
        self._thumbs_layout.setAlignment(Qt.AlignLeft | Qt.AlignTop)
        scroll.setWidget(self._thumbs_container)
        lay.addWidget(scroll, 1)

        # Checkboxes row at bottom
        chk_row = QHBoxLayout(); chk_row.setContentsMargins(8,3,8,3); chk_row.setSpacing(16)
        self._chk_auto_select  = QCheckBox("Auto-Select Best Result")
        self._chk_unique_nests = QCheckBox("Show Unique Nests Only")
        self._chk_auto_select.setChecked(True)
        self._chk_unique_nests.setChecked(True)
        for c in [self._chk_auto_select, self._chk_unique_nests]:
            c.setStyleSheet(f"color:{C_TEXT.name()}; font-size:11px;")
            chk_row.addWidget(c)
        chk_row.addStretch()
        lay.addLayout(chk_row)

        # Progress bar
        self._progress = QProgressBar()
        self._progress.setFixedHeight(3)
        self._progress.setRange(0,100)
        self._progress.setTextVisible(False)
        self._progress.hide()
        self._progress.setStyleSheet(
            f"QProgressBar{{background:{C_PANEL.name()};border:none;}}"
            f"QProgressBar::chunk{{background:{C_ACCENT.name()};}}")
        lay.addWidget(self._progress)

        return w

    # ── RIGHT PANEL ───────────────────────────────────────────
    def _build_right_panel(self):
        """Right panel: Results table (top) + Nest Details (bottom)."""
        w   = QWidget(); w.setMinimumWidth(280); w.setMaximumWidth(400)
        lay = QVBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

        spl = QSplitter(Qt.Vertical)
        spl.setHandleWidth(3)

        # ── TOP: Results table ─────────────────────────────────
        results_w = QWidget()
        rl = QVBoxLayout(results_w); rl.setContentsMargins(0,0,0,0); rl.setSpacing(0)

        res_hdr = QLabel("  Results")
        res_hdr.setFixedHeight(26)
        res_hdr.setStyleSheet(
            f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
            f"font-size:11px; font-weight:600;"
            f"border-bottom:1px solid {C_BORDER.name()};")
        rl.addWidget(res_hdr)

        self._results_table = QTableWidget(0, 8)
        self._results_table.setHorizontalHeaderLabels(
            ["Rank","Length","Util (%)","Parts Nested","Extras","Sheets","Nests","Time"])
        self._results_table.verticalHeader().hide()
        self._results_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._results_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self._results_table.setAlternatingRowColors(True)
        self._results_table.itemSelectionChanged.connect(self._on_result_select)
        hdr = self._results_table.horizontalHeader()
        for i in range(8): hdr.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(3, QHeaderView.Stretch)
        rl.addWidget(self._results_table, 1)
        spl.addWidget(results_w)

        # ── BOTTOM: Nest Details ───────────────────────────────
        details_w = QWidget()
        dl = QVBoxLayout(details_w); dl.setContentsMargins(0,0,0,0); dl.setSpacing(0)

        det_hdr = QLabel("  Nest Details")
        det_hdr.setFixedHeight(26)
        det_hdr.setStyleSheet(
            f"background:{C_PANEL.name()}; color:{C_DIM.name()};"
            f"font-size:11px; font-weight:600;"
            f"border-top:1px solid {C_BORDER.name()};"
            f"border-bottom:1px solid {C_BORDER.name()};")
        dl.addWidget(det_hdr)

        self._nest_tree = QTreeWidget()
        self._nest_tree.setHeaderHidden(True)
        self._nest_tree.setStyleSheet(
            f"QTreeWidget{{background:{C_BG.name()}; border:none;"
            f"color:{C_TEXT.name()};}}"
            f"QTreeWidget::item:selected{{background:{C_SEL_ROW.name()};}}")
        self._nest_tree.itemClicked.connect(self._on_tree_click)
        dl.addWidget(self._nest_tree, 1)

        self._util_chart = UtilChart()
        dl.addWidget(self._util_chart)
        spl.addWidget(details_w)

        spl.setSizes([220, 280])
        lay.addWidget(spl, 1)
        return w

    # ══════════════════════════════════════════════════════════
    # PUBLIC API
    # ══════════════════════════════════════════════════════════
    def set_parts(self, parts: list):
        self._parts = parts
        n = len(parts)
        self._status_bar.setText(f"  {n} parts loaded — ready to nest")

    # ══════════════════════════════════════════════════════════
    # NESTING CONTROL
    def _load_settings_from_config(self):
        """Load spacing/margin values from config into UI spinboxes on startup."""
        try:
            ps = float(config.part_gap)
            self._spin_part_spacing.setValue(ps)
        except Exception:
            pass
        try:
            em = float(config.edge_margin)
            for sp in [self._spin_top, self._spin_left,
                       self._spin_right, self._spin_bottom]:
                sp.setValue(em)
        except Exception:
            pass

    def _save_settings_to_config(self):
        """Save current UI spacing/margin values back to config."""
        try:
            config.set(self._spin_part_spacing.value(), "nesting", "part_gap")
            config.set(self._spin_top.value(),    "nesting", "edge_margin")
            config.set(self._spin_left.value(),   "nesting", "edge_margin_left")
            config.set(self._spin_right.value(),  "nesting", "edge_margin_right")
            config.set(self._spin_bottom.value(), "nesting", "edge_margin_bottom")
        except Exception:
            pass

    # ══════════════════════════════════════════════════════════
    def run_nesting(self):
        if not self._parts:
            self._status_bar.setText("  No parts loaded. Import a CSV order first.")
            return

        # Save current UI values to config for persistence
        self._save_settings_to_config()

        opts = {
            "part_spacing":   self._spin_part_spacing.value(),
            "margin_top":     self._spin_top.value(),
            "margin_left":    self._spin_left.value(),
            "margin_right":   self._spin_right.value(),
            "margin_bottom":  self._spin_bottom.value(),
            # Keep sheet_margin as max of 4 for engine compatibility
            "sheet_margin":   max(self._spin_top.value(), self._spin_left.value(),
                                  self._spin_right.value(), self._spin_bottom.value()),
            "rotation":       self._cmb_rotation.currentIndex(),
            "generations":    30,
            "population":     20,
            "duration":       600.0,
        }

        self._btn_start.setEnabled(False)
        self._btn_stop.setEnabled(True)
        self._progress.show(); self._progress.setValue(0)
        self._running = True
        self._elapsed = 0
        self._timer.start(1000)
        self._run_start = time.time()

        self._worker = NestingWorker(self._parts, self._sheet_defs, opts)
        self._worker.sig_progress.connect(self._on_progress)
        self._worker.sig_finished.connect(self._on_finished)
        self._worker.sig_error.connect(self._on_error)
        self._worker.sig_status.connect(lambda s: self._status_bar.setText(f"  {s}"))
        self._worker.start()

    def stop_nesting(self):
        if self._worker:
            self._worker.stop()
            self._worker.wait(2000)
        self._running = False
        self._timer.stop()
        self._btn_start.setEnabled(True)
        self._btn_stop.setEnabled(False)
        self._progress.hide()
        self._status_bar.setText("  Nesting stopped by user.")

    def clear_layout(self):
        self._all_results = []; self._sheets = []
        self._results_table.setRowCount(0)
        self._nest_tree.clear()
        self._util_chart.set_data([])
        self._clear_thumbs()
        self._status_bar.setText("  Ready")

    # ── Timer ─────────────────────────────────────────────────
    def _tick(self):
        self._elapsed += 1
        h = self._elapsed // 3600
        m = (self._elapsed % 3600) // 60
        s = self._elapsed % 60
        self._lbl_elapsed.setText(f"{h:02d}:{m:02d}:{s:02d}")

    # ── Progress ──────────────────────────────────────────────
    def _on_progress(self, gen, total, best_util):
        pct = int(gen / max(1, total) * 100)
        self._progress.setValue(pct)

    # ── Finished ──────────────────────────────────────────────
    def _on_finished(self, sheets, all_results):
        self._sheets      = sheets
        self._all_results = all_results
        self._worker      = None
        self._running     = False
        self._timer.stop()
        self._btn_start.setEnabled(True)
        self._btn_stop.setEnabled(False)
        self._progress.hide()

        if not all_results:
            self._status_bar.setText("  No results.")
            return

        self._refresh_results_table()
        self._refresh_nest_tree()

        if self._chk_auto_select.isChecked():
            self._results_table.selectRow(0)
            self._select_result(0)

        elapsed = time.time() - self._run_start
        best    = all_results[0]
        self._status_bar.setText(
            f"  Nesting complete — Best: Rank 1  {best.utilization:.2f}%  "
            f"{best.sheet_count} sheets  {best.total_parts} parts  "
            f"({elapsed:.0f}s)")

    def _on_error(self, msg):
        self._worker  = None
        self._running = False
        self._timer.stop()
        self._btn_start.setEnabled(True)
        self._btn_stop.setEnabled(False)
        self._progress.hide()
        self._status_bar.setText(f"  Error: {msg[:100]}")
        QMessageBox.critical(self, "Nesting Error", msg[:600])

    # ══════════════════════════════════════════════════════════
    # RESULTS TABLE
    # ══════════════════════════════════════════════════════════
    def _refresh_results_table(self):
        t = self._results_table
        t.setRowCount(0)
        if not self._all_results: return

        results = self._all_results
        if self._chk_unique_nests.isChecked():
            seen = set(); unique = []
            for r in results:
                key = (r.sheet_count, round(r.utilization, 2))
                if key not in seen:
                    seen.add(key); unique.append(r)
            results = unique

        t.setRowCount(len(results))

        for row, r in enumerate(results):
            is_best = (row == 0)
            total_len = sum(s.width for s in r.sheets) if r.sheets else 0
            extras = 0  # parts not nested (overflow)
            total_parts = len(self._parts)
            nested = r.total_parts
            not_nested = max(0, total_parts - nested)

            cells = [
                str(r.rank),
                f"{total_len:.0f}",
                f"{r.utilization:.2f}",
                f"{nested} of {total_parts}",
                str(not_nested),           # Extras column
                str(r.sheet_count),
                str(r.sheet_count),
                (f"{r.time_ms/1000:.0f}s" if r.time_ms < 60000
                 else f"{r.time_ms/60000:.0f}m{(r.time_ms%60000)/1000:.0f}s"),
            ]
            for col, text in enumerate(cells):
                item = QTableWidgetItem(text)
                item.setTextAlignment(Qt.AlignCenter)
                if is_best:
                    item.setBackground(QBrush(C_BEST_ROW))
                    item.setForeground(QBrush(C_GOOD))
                    f = item.font(); f.setBold(True); item.setFont(f)
                t.setItem(row, col, item)

        t.resizeRowsToContents()

    # ══════════════════════════════════════════════════════════
    # NEST TREE (right panel)
    # ══════════════════════════════════════════════════════════
    def _refresh_nest_tree(self):
        self._nest_tree.clear()
        if not self._sheets: return

        # Group identical sheets (same dimensions + utilization)
        # to show x5, x10 labels like Solid Edge
        groups = []  # list of (sheets_list, label)
        seen_sig = {}
        for i, sheet in enumerate(self._sheets):
            util = sheet.utilization()
            nest_len = max((p.x + p.actual_width() for p in sheet.parts), default=0)
            dc = getattr(sheet, "design_code", "")
            sig = (sheet.width, sheet.height, round(util, 2), dc)
            if sig not in seen_sig:
                seen_sig[sig] = len(groups)
                groups.append({
                    "sheets": [sheet],
                    "util": util,
                    "nest_len": nest_len,
                    "width": sheet.width,
                    "height": sheet.height,
                    "design_code": dc,
                })
            else:
                groups[seen_sig[sig]]["sheets"].append(sheet)

        for idx, grp in enumerate(groups):
            count    = len(grp["sheets"])
            util     = grp["util"]
            nest_len = grp["nest_len"]
            dc_tag   = f"  [{grp['design_code']}]" if grp["design_code"] else ""
            lbl = (f"Nest {idx+1} (x{count}): "
                   f"'{grp['width']:.0f}x{grp['height']:.0f}'"
                   f" ({util:.2f}%, {nest_len:.0f}mm){dc_tag}")
            item = QTreeWidgetItem([lbl])
            item.setData(0, Qt.UserRole, idx)
            item.setForeground(0, QColor(C_GOOD if util >= 90 else C_WARN))
            self._nest_tree.addTopLevelItem(item)

        # Placed Parts summary
        placed_item = QTreeWidgetItem([f"Placed Parts  ({len(self._parts)})"])
        placed_item.setForeground(0, QColor(C_DIM))
        self._nest_tree.addTopLevelItem(placed_item)

        utils = [s.utilization() for s in self._sheets]
        self._util_chart.set_data(utils, 0)

    def _on_tree_click(self, item, col):
        idx = item.data(0, Qt.UserRole)
        if idx is not None:
            self._show_thumb_at(idx)

    # ══════════════════════════════════════════════════════════
    # THUMBNAILS  — with x5/x10/x1 labels
    # ══════════════════════════════════════════════════════════
    def _clear_thumbs(self):
        while self._thumbs_layout.count():
            item = self._thumbs_layout.takeAt(0)
            if item.widget(): item.widget().deleteLater()

    def _refresh_thumbs(self):
        self._clear_thumbs()
        if not self._sheets:
            self._thumbs_layout.addStretch()
            return

        # Group sheets to determine counts (xN labels)
        seen_sig = {}
        groups_ordered = []
        for sheet in self._sheets:
            util = sheet.utilization()
            dc = getattr(sheet, "design_code", "")
            sig = (sheet.width, sheet.height, round(util, 2), dc)
            if sig not in seen_sig:
                seen_sig[sig] = len(groups_ordered)
                groups_ordered.append({"sheet": sheet, "count": 1, "design_code": dc})
            else:
                groups_ordered[seen_sig[sig]]["count"] += 1

        for i, grp in enumerate(groups_ordered):
            sheet = grp["sheet"]
            count = grp["count"]
            dc    = grp["design_code"]

            col_w = QWidget()
            col_l = QVBoxLayout(col_w)
            col_l.setContentsMargins(0,0,0,0); col_l.setSpacing(3)

            canvas = SheetCanvas()
            canvas.setFixedSize(220, 160)
            canvas.set_sheet(sheet, labels=True)
            canvas.set_selected(i == 0)
            canvas.mousePressEvent = lambda ev, idx=i: self._on_thumb_click(idx)
            col_l.addWidget(canvas)

            # x5 / x10 / x1 label + design code
            count_lbl = f"x{count}" + (f"  {dc}" if dc else "")
            lbl = QLabel(count_lbl)
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet(
                f"color:{C_TEXT.name()}; font-size:14px; font-weight:600;")
            col_l.addWidget(lbl)

            self._thumbs_layout.addWidget(col_w)

        self._thumbs_layout.addStretch()

    def _on_thumb_click(self, idx):
        self._show_thumb_at(idx)

    def _show_thumb_at(self, idx):
        for i in range(self._thumbs_layout.count()):
            item = self._thumbs_layout.itemAt(i)
            if item and item.widget():
                col_w = item.widget()
                if col_w.layout():
                    for j in range(col_w.layout().count()):
                        wi = col_w.layout().itemAt(j)
                        if wi and isinstance(wi.widget(), SheetCanvas):
                            wi.widget().set_selected(i == idx)
        self._util_chart.set_data(
            [s.utilization() for s in self._sheets], idx)

    # ══════════════════════════════════════════════════════════
    # RESULT SELECTION
    # ══════════════════════════════════════════════════════════
    def _on_result_select(self):
        rows = self._results_table.selectedIndexes()
        if not rows or not self._all_results: return
        self._select_result(rows[0].row())

    def _select_result(self, row):
        results = self._all_results
        if self._chk_unique_nests.isChecked():
            seen = set(); unique = []
            for r in results:
                key = (r.sheet_count, round(r.utilization,2))
                if key not in seen: seen.add(key); unique.append(r)
            results = unique
        if row < len(results):
            self._sheets = results[row].sheets
            self._refresh_nest_tree()
            self._refresh_thumbs()
            self.layout_applied.emit(self._sheets)

    # ══════════════════════════════════════════════════════════
    # SHEET MANAGEMENT
    # ══════════════════════════════════════════════════════════
    def _refresh_sheet_table(self):
        t = self._sheet_table; t.setRowCount(len(self._sheet_defs))
        for row, sd in enumerate(self._sheet_defs):
            name = ("◈ " if sd["is_remnant"] else "") + sd["name"]
            cells = [name, f"{sd['width']:.0f}", f"{sd['height']:.0f}",
                     str(sd["quantity"]), PRIORITY_LABELS.get(sd["priority"],"Normal")]
            for col, txt in enumerate(cells):
                item = QTableWidgetItem(txt)
                item.setTextAlignment(Qt.AlignCenter)
                if sd["is_remnant"]:
                    item.setForeground(QBrush(QColor("#e67e22")))
                t.setItem(row, col, item)

    def _add_sheet(self):
        dlg = SheetDefDialog(parent=self)
        if dlg.exec() == QDialog.Accepted:
            self._sheet_defs.append(dlg.result_data())
            self._refresh_sheet_table()

    def _add_remnant(self):
        dlg = SheetDefDialog(
            {"name":"Remnant","width":1500,"height":800,
             "thickness":18,"material":"MDF","quantity":1,
             "priority":1,"is_remnant":True}, parent=self)
        if dlg.exec() == QDialog.Accepted:
            d = dlg.result_data(); d["is_remnant"] = True
            self._sheet_defs.insert(0, d)
            self._refresh_sheet_table()

    def _edit_sheet(self):
        row = self._sheet_table.currentRow()
        if row < 0: return
        dlg = SheetDefDialog(self._sheet_defs[row], parent=self)
        if dlg.exec() == QDialog.Accepted:
            self._sheet_defs[row] = dlg.result_data()
            self._refresh_sheet_table()

    def _del_sheet(self):
        row = self._sheet_table.currentRow()
        if row < 0 or len(self._sheet_defs) <= 1: return
        self._sheet_defs.pop(row)
        self._refresh_sheet_table()

    def _toggle_direction(self):
        cur = self._btn_dir.text()
        self._btn_dir.setText("↓" if cur == "→" else "→")

    def get_current_sheets(self):
        return self._sheets

    # ══════════════════════════════════════════════════════════
    # STYLE
    # ══════════════════════════════════════════════════════════
    def _apply_style(self):
        self.setStyleSheet(f"""
        * {{ font-family: "Segoe UI", Tahoma, sans-serif; font-size: 12px; }}
        QWidget {{ background: {C_BG.name()}; color: {C_TEXT.name()}; }}

        QPushButton#btn_start {{
            background: #1a5c2a; border: 1px solid #27ae60;
            border-radius: 3px; color: white; font-weight: 600;
        }}
        QPushButton#btn_start:hover {{ background: #27ae60; }}
        QPushButton#btn_start:disabled {{
            background: #2a2a2a; color: {C_DIM.name()}; border-color:#333;
        }}
        QPushButton#btn_stop {{
            background: #5c1a1a; border: 1px solid #c0392b;
            border-radius: 3px; color: white; font-weight: 600;
        }}
        QPushButton#btn_stop:hover {{ background: #c0392b; }}
        QPushButton#btn_stop:disabled {{
            background: #2a2a2a; color: {C_DIM.name()}; border-color:#333;
        }}
        QPushButton {{
            background: {C_PANEL.name()}; border: 1px solid {C_BORDER.name()};
            border-radius: 3px; padding: 3px 8px; color: {C_TEXT.name()};
        }}
        QPushButton:hover {{ background: #3e3e42; border-color: {C_ACCENT.name()}; }}

        QTableWidget {{
            background: #1a1a1a; gridline-color: {C_BORDER.name()};
            border: none; selection-background-color: {C_SEL_ROW.name()};
            alternate-background-color: #202020;
        }}
        QTableWidget::item {{ padding: 2px 6px; }}
        QHeaderView::section {{
            background: {C_PANEL.name()}; border: none;
            border-right: 1px solid {C_BORDER.name()};
            border-bottom: 1px solid {C_BORDER.name()};
            padding: 3px 6px; font-weight: 600;
            color: {C_DIM.name()}; font-size: 11px;
        }}
        QScrollArea {{ border: none; }}
        QScrollBar:horizontal {{
            background: {C_PANEL.name()}; height: 8px; border: none;
        }}
        QScrollBar::handle:horizontal {{
            background: {C_BORDER.name()}; border-radius: 4px; min-width: 20px;
        }}
        QScrollBar:vertical {{
            background: {C_PANEL.name()}; width: 8px; border: none;
        }}
        QScrollBar::handle:vertical {{
            background: {C_BORDER.name()}; border-radius: 4px; min-height: 20px;
        }}
        QCheckBox {{ color: {C_TEXT.name()}; }}
        QCheckBox::indicator {{
            width: 13px; height: 13px;
            border: 1px solid {C_BORDER.name()}; border-radius: 2px;
            background: #1a1a1a;
        }}
        QCheckBox::indicator:checked {{
            background: {C_ACCENT.name()}; border-color: {C_ACCENT.name()};
        }}
        QRadioButton {{ color: {C_TEXT.name()}; font-size: 11px; }}
        QDoubleSpinBox, QSpinBox, QComboBox {{
            background: #1a1a1a; border: 1px solid {C_BORDER.name()};
            border-radius: 3px; padding: 2px 4px; color: {C_TEXT.name()};
        }}
        QDoubleSpinBox:focus, QSpinBox:focus {{
            border-color: {C_ACCENT.name()};
        }}
        QLabel {{ background: transparent; color: {C_TEXT.name()}; }}
        QSplitter::handle {{ background: {C_BORDER.name()}; }}
        """)

    @staticmethod
    def _small_btn_style() -> str:
        return (f"background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};"
                f"border-radius:2px; color:{C_TEXT.name()}; font-size:11px;"
                f"padding:1px 4px;")


# ═══════════════════════════════════════════════════════════════
# Test
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    w = QWidget()
    w.setWindowTitle("FIROO CAM — Nesting Tab v2")
    w.resize(1400, 800)
    from PySide6.QtWidgets import QVBoxLayout
    vl = QVBoxLayout(w); vl.setContentsMargins(0,0,0,0)
    tab = NestingTab()
    vl.addWidget(tab)
    w.show()
    sys.exit(app.exec())