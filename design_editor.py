"""
FIROO CAM - Design Editor
Visual editor for door designs (.fdr files).
Real-time preview, offset layers, pattern, tool assignment.
"""
from __future__ import annotations
import json
import math
import copy
from pathlib import Path
from typing import List, Dict, Optional

from PySide6.QtCore  import Qt, Signal, QRectF, QPointF, QTimer
from PySide6.QtGui   import (
    QPainter, QColor, QPen, QBrush, QFont,
    QLinearGradient, QPainterPath, QPolygonF
)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QSplitter,
    QLabel, QPushButton, QDoubleSpinBox, QSpinBox,
    QComboBox, QCheckBox, QGroupBox, QScrollArea,
    QFrame, QFileDialog, QMessageBox, QDialog,
    QDialogButtonBox, QFormLayout, QLineEdit,
    QTableWidget, QTableWidgetItem, QHeaderView,
    QAbstractItemView, QApplication, QSizePolicy,
    QTabWidget, QTextEdit, QColorDialog
)

from config import config
try:
    from language_manager import lang as _lang
except Exception:
    class _FallbackLang:
        is_rtl = False
        current_language = "en"
        def t(self, key): return key.split('.')[-1]
        def on_change(self, fn): pass
    _lang = _FallbackLang()

# ── Palette ───────────────────────────────────────────────────
C_BG      = QColor("#1e1e1e")
C_PANEL   = QColor("#252526")
C_BORDER  = QColor("#3e3e42")
C_ACCENT  = QColor("#0078d4")
C_TEXT    = QColor("#cccccc")
C_DIM     = QColor("#858585")
C_GOOD    = QColor("#4ec9b0")
C_WARN    = QColor("#ce9178")

# Layer colors matching real CNC visualization
LAYER_COLORS = [
    QColor("#e74c3c"),  # 0 profile
    QColor("#e67e22"),  # 1 layer 1
    QColor("#f1c40f"),  # 2 layer 2
    QColor("#2ecc71"),  # 3 layer 3
    QColor("#3498db"),  # 4 layer 4
    QColor("#9b59b6"),  # 5 layer 5
    QColor("#1abc9c"),  # 6 layer 6
    QColor("#e91e63"),  # 7 layer 7
    QColor("#ff9800"),  # 8 layer 8
    QColor("#00bcd4"),  # 9 layer 9
]

LAYER_TYPES = [
    "profile", "shallow_groove", "groove",
    "deep_groove", "bevel", "inner_cut", "rabbet"
]

FDR_EXTENSION = ".fdr"


# ═══════════════════════════════════════════════════════════════
# Design Data Model
# ═══════════════════════════════════════════════════════════════
class DesignData:
    """In-memory design object. Serializes to/from .fdr (JSON)."""

    def __init__(self):
        self.design_code = "NEW"
        self.name        = "New Design"
        self.name_fa     = "طرح جدید"
        self.category    = "designs"
        self.tags: List[str] = []
        self.width       = 900.0
        self.height      = 500.0
        self.t1_diameter = 6.0
        self.t2_diameter = 16.0
        self.pass_depth  = 2.0
        self.tools: Dict[str, Dict] = {
            "T1": {"name":"Vbit 140", "type":"vbit", "diameter":0, "angle":140, "rpm":20000, "feed":200, "plunge":100, "pass_depth":0, "tool_number":1},
            "T2": {"name":"Ball 20", "type":"ballnose", "diameter":20, "angle":0, "rpm":20000, "feed":200, "plunge":100, "pass_depth":0, "tool_number":2},
            "T3": {"name":"Form Tool 50", "type":"form", "diameter":50, "angle":0, "rpm":20000, "feed":200, "plunge":100, "pass_depth":0, "tool_number":3},
            "T4": {"name":"Ball 8", "type":"ballnose", "diameter":8, "angle":0, "rpm":20000, "feed":200, "plunge":100, "pass_depth":0, "tool_number":4},
        }
        self.layers: List[Dict] = [
            self._default_layer(0)
        ]
        self.pattern = {
            "enabled": False, "type": "none",
            "spacing_mm": 60.0, "angle_deg": 45.0
        }

    @staticmethod
    def _default_layer(idx: int) -> Dict:
        if idx == 0:
            return {
                "id": 0, "name": "Profile Cut", "name_fa": "برش پروفایل",
                "type": "profile", "tool": "T1",
                "depth_mm": 0.0, "offset_mm": 0.0,
                "pass_count": 1, "enabled": True,
            }
        return {
            "id": idx, "name": f"Layer {idx}", "name_fa": f"لایه {idx}",
            "type": "groove", "tool": "T2",
            "depth_mm": 2.0, "offset_mm": float(idx * 20),
            "pass_count": 1, "enabled": True,
        }

    def add_layer(self):
        idx = len(self.layers)
        self.layers.append(self._default_layer(idx))

    def remove_layer(self, idx: int):
        if 0 < idx < len(self.layers):
            self.layers.pop(idx)
            for i, l in enumerate(self.layers):
                l["id"] = i

    def move_layer(self, idx: int, direction: int):
        """direction: -1=up, +1=down. Never move profile (idx=0)."""
        if idx <= 0:
            return
        new_idx = idx + direction
        if 1 <= new_idx < len(self.layers):
            self.layers[idx], self.layers[new_idx] = \
                self.layers[new_idx], self.layers[idx]
            self.layers[idx]["id"]     = idx
            self.layers[new_idx]["id"] = new_idx

    def to_dict(self) -> Dict:
        return {
            "firoo_format":  "fdr",
            "format_version":"1.0",
            "design_code":   self.design_code,
            "name":          self.name,
            "name_fa":       self.name_fa,
            "category":      self.category,
            "tags":          self.tags,
            "default_size":  {"width": self.width, "height": self.height},
            "tools": self.tools,
            "pass_depth_mm": self.pass_depth,
            "layers":        self.layers,
            "pattern":       self.pattern,
            "offsets": [
                {"layer_no": l["id"],
                 "distance_mm": l["offset_mm"],
                 "name": l["name"], "name_fa": l["name_fa"]}
                for l in self.layers if l["offset_mm"] > 0
            ],
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "DesignData":
        obj = cls()
        obj.design_code = d.get("design_code", "")
        obj.name        = d.get("name", "")
        obj.name_fa     = d.get("name_fa", "")
        obj.category    = d.get("category", "designs")
        obj.tags        = d.get("tags", [])
        sz = d.get("default_size", {})
        obj.width       = float(sz.get("width",  900))
        obj.height      = float(sz.get("height", 500))
        tools = d.get("tools", {})
        if isinstance(tools, dict) and tools:
            obj.tools.update(tools)
        obj.t1_diameter = float(tools.get("T1",{}).get("diameter", 6))
        obj.t2_diameter = float(tools.get("T2",{}).get("diameter", 16))
        obj.pass_depth  = float(d.get("pass_depth_mm", 2))
        obj.layers      = d.get("layers", [obj._default_layer(0)])
        obj.pattern     = d.get("pattern", {"enabled": False})
        return obj

    def save(self, path: str) -> bool:
        try:
            Path(path).write_text(
                json.dumps(self.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8")
            return True
        except Exception:
            return False

    @classmethod
    def load(cls, path: str) -> Optional["DesignData"]:
        try:
            with open(path, encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        except Exception:
            return None


# ═══════════════════════════════════════════════════════════════
# Door Preview Canvas
# ═══════════════════════════════════════════════════════════════
class DoorPreviewCanvas(QWidget):
    """
    Real-time visual preview of the door design.
    Shows all offset layers with correct colors and depths.
    Supports zoom and pan.
    """
    layer_clicked = Signal(int)   # layer index

    def __init__(self, parent=None):
        super().__init__(parent)
        self._design: Optional[DesignData] = None
        self._zoom          = 1.0
        self._offset_x      = 0.0
        self._offset_y      = 0.0
        self._selected_layer= 0
        self._show_dims     = True
        self._show_labels   = True
        self._show_grid     = False
        self._last_mouse    = QPointF()
        self._dragging      = False

        self.setMinimumSize(300, 200)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMouseTracking(True)

    def set_design(self, design: DesignData):
        self._design = design
        self.fit_to_window()
        self.update()

    def set_selected_layer(self, idx: int):
        self._selected_layer = idx
        self.update()

    def fit_to_window(self):
        if not self._design:
            return
        pad  = 40
        aw   = self.width()  - 2 * pad
        ah   = self.height() - 2 * pad
        if aw <= 0 or ah <= 0:
            return
        dw, dh = self._design.width, self._design.height
        self._zoom     = min(aw / dw, ah / dh)
        self._offset_x = pad + (aw - dw * self._zoom) / 2
        self._offset_y = pad + (ah - dh * self._zoom) / 2
        self.update()

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        self.fit_to_window()

    def wheelEvent(self, ev):
        factor = 1.15 if ev.angleDelta().y() > 0 else 0.87
        self._zoom = max(0.1, min(20.0, self._zoom * factor))
        self.update()

    def mousePressEvent(self, ev):
        self._last_mouse = ev.position()
        self._dragging   = True

    def mouseMoveEvent(self, ev):
        if self._dragging:
            dx = ev.position().x() - self._last_mouse.x()
            dy = ev.position().y() - self._last_mouse.y()
            self._offset_x += dx
            self._offset_y += dy
            self._last_mouse = ev.position()
            self.update()

    def mouseReleaseEvent(self, ev):
        self._dragging = False

    def mouseDoubleClickEvent(self, ev):
        self.fit_to_window()

    # ── Coordinate helpers ────────────────────────────────────
    def _sx(self, x: float) -> float:
        return self._offset_x + x * self._zoom

    def _sy(self, y: float) -> float:
        dh = self._design.height if self._design else 500
        return self._offset_y + (dh - y) * self._zoom

    def _srect(self, x, y, w, h) -> QRectF:
        return QRectF(self._sx(x), self._sy(y + h),
                      w * self._zoom, h * self._zoom)

    # ── Paint ─────────────────────────────────────────────────
    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), C_BG)

        if not self._design:
            p.setPen(QPen(C_DIM))
            p.drawText(self.rect(), Qt.AlignCenter,
                       "No design loaded")
            return

        d  = self._design
        dw = d.width
        dh = d.height

        # ── Grid ──────────────────────────────────────────────
        if self._show_grid:
            step = 50.0
            p.setPen(QPen(QColor("#2a2a2a"), 0.5))
            x = 0
            while x <= dw:
                p.drawLine(
                    int(self._sx(x)), int(self._sy(0)),
                    int(self._sx(x)), int(self._sy(dh)))
                x += step
            y = 0
            while y <= dh:
                p.drawLine(
                    int(self._sx(0)), int(self._sy(y)),
                    int(self._sx(dw)), int(self._sy(y)))
                y += step

        # ── Door background ───────────────────────────────────
        door_rect = self._srect(0, 0, dw, dh)
        grad = QLinearGradient(door_rect.topLeft(),
                                door_rect.bottomRight())
        grad.setColorAt(0, QColor("#4a3728"))
        grad.setColorAt(1, QColor("#3a2a1e"))
        p.fillRect(door_rect, grad)
        p.setPen(QPen(QColor("#6b4c3b"), 2))
        p.drawRect(door_rect)

        # ── Layers (draw innermost first = reversed) ──────────
        font_lbl = QFont("Segoe UI"); font_lbl.setPixelSize(10)
        p.setFont(font_lbl)

        for layer in reversed(d.layers):
            if not layer.get("enabled", True):
                continue
            idx     = layer["id"]
            ltype   = layer["type"]
            off_mm  = layer["offset_mm"]
            dep_mm  = layer["depth_mm"]
            is_sel  = (idx == self._selected_layer)

            if ltype == "profile":
                continue   # profile is the door border itself

            color = LAYER_COLORS[idx % len(LAYER_COLORS)]

            # Shrink rect by offset
            ox  = off_mm
            oy  = off_mm
            lw  = dw - 2 * off_mm
            lh  = dh - 2 * off_mm

            if lw <= 0 or lh <= 0:
                continue

            lrect = self._srect(ox, oy, lw, lh)

            # Fill with depth-based alpha
            fill = QColor(color)
            fill.setAlpha(max(40, min(180, int(dep_mm / 20 * 255 + 60))))
            p.setBrush(QBrush(fill))

            pen_w = 3 if is_sel else 1.5
            pen_c = QColor("#ffffff") if is_sel else color.lighter(130)
            p.setPen(QPen(pen_c, pen_w))
            p.drawRect(lrect)

            # Selection highlight
            if is_sel:
                hl = QColor(C_ACCENT); hl.setAlpha(40)
                p.fillRect(lrect, QBrush(hl))

            # Label
            if self._show_labels and lrect.width() > 40:
                p.setPen(QPen(color.lighter(160)))
                short = f"L{idx}  {off_mm:.0f}mm"
                p.drawText(lrect, Qt.AlignCenter, short)

        # ── Profile border (on top) ───────────────────────────
        is_prof_sel = (self._selected_layer == 0)
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(
            QColor("#ffffff") if is_prof_sel else QColor("#e74c3c"),
            3 if is_prof_sel else 2))
        p.drawRect(door_rect)

        # ── Dimension lines ───────────────────────────────────
        if self._show_dims:
            self._draw_dims(p, dw, dh)

    def _draw_dims(self, p: QPainter, dw: float, dh: float):
        p.setPen(QPen(C_DIM, 1))
        f = QFont("Segoe UI"); f.setPixelSize(10); p.setFont(f)

        # Width dimension (bottom)
        y_dim = self._sy(0) + 18
        x0    = self._sx(0);  x1 = self._sx(dw)
        p.drawLine(int(x0), int(y_dim), int(x1), int(y_dim))
        p.drawLine(int(x0), int(y_dim-5), int(x0), int(y_dim+5))
        p.drawLine(int(x1), int(y_dim-5), int(x1), int(y_dim+5))
        p.drawText(
            QRectF(x0, y_dim+3, x1-x0, 14),
            Qt.AlignCenter, f"{dw:.0f} mm")

        # Height dimension (right)
        x_dim = self._sx(dw) + 18
        yb    = self._sy(0);  yt = self._sy(dh)
        p.drawLine(int(x_dim), int(yt), int(x_dim), int(yb))
        p.drawLine(int(x_dim-5), int(yt), int(x_dim+5), int(yt))
        p.drawLine(int(x_dim-5), int(yb), int(x_dim+5), int(yb))
        # Rotated text
        p.save()
        p.translate(x_dim + 14, (yt + yb) / 2)
        p.rotate(-90)
        p.drawText(
            QRectF(-30, -7, 60, 14),
            Qt.AlignCenter, f"{dh:.0f} mm")
        p.restore()


# ═══════════════════════════════════════════════════════════════
# Layer Editor Row
# ═══════════════════════════════════════════════════════════════
class LayerRow(QFrame):
    """One row in the layers panel — editable inline."""
    changed  = Signal()
    selected = Signal(int)
    delete   = Signal(int)
    move_up  = Signal(int)
    move_dn  = Signal(int)

    def __init__(self, layer: Dict, idx: int, parent=None):
        super().__init__(parent)
        self._idx   = idx
        self._layer = layer
        self._loading = False
        self._build()
        self._load()
        self.setObjectName("layer_row")

    def _build(self):
        lay = QHBoxLayout(self)
        lay.setContentsMargins(4, 2, 4, 2)
        lay.setSpacing(4)

        # Color swatch
        self._swatch = QLabel()
        self._swatch.setFixedSize(14, 14)
        col = LAYER_COLORS[self._idx % len(LAYER_COLORS)]
        self._swatch.setStyleSheet(
            f"background:{col.name()}; border-radius:2px;")
        lay.addWidget(self._swatch)

        # Enable toggle
        self._chk = QCheckBox()
        self._chk.setFixedWidth(18)
        lay.addWidget(self._chk)

        # Layer type
        self._cmb_type = QComboBox()
        self._cmb_type.setFixedWidth(110)
        for t in LAYER_TYPES:
            self._cmb_type.addItem(t)
        lay.addWidget(self._cmb_type)

        # Offset
        lay.addWidget(QLabel("Off:"))
        self._spin_off = QDoubleSpinBox()
        self._spin_off.setRange(0, 500)
        self._spin_off.setDecimals(1)
        self._spin_off.setFixedWidth(70)
        self._spin_off.setSuffix(" mm")
        lay.addWidget(self._spin_off)

        # Depth
        lay.addWidget(QLabel("Dep:"))
        self._spin_dep = QDoubleSpinBox()
        self._spin_dep.setRange(0, 50)
        self._spin_dep.setDecimals(1)
        self._spin_dep.setFixedWidth(65)
        self._spin_dep.setSuffix(" mm")
        lay.addWidget(self._spin_dep)

        # Tool
        self._cmb_tool = QComboBox()
        self._cmb_tool.setFixedWidth(65)
        self._cmb_tool.addItems(["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"])
        lay.addWidget(self._cmb_tool)

        # Passes
        lay.addWidget(QLabel("Pass:"))
        self._spin_pass = QSpinBox()
        self._spin_pass.setRange(1, 20)
        self._spin_pass.setFixedWidth(45)
        lay.addWidget(self._spin_pass)

        # Buttons
        self._btn_up  = QPushButton("↑")
        self._btn_dn  = QPushButton("↓")
        self._btn_del = QPushButton("✕")
        for b in [self._btn_up, self._btn_dn, self._btn_del]:
            b.setFixedSize(22, 22)
            b.setStyleSheet(
                f"background:{C_PANEL.name()};border:none;"
                f"color:{C_DIM.name()};font-size:12px;")
        self._btn_del.setStyleSheet(
            f"background:{C_PANEL.name()};border:none;"
            f"color:#e74c3c;font-size:12px;")
        lay.addWidget(self._btn_up)
        lay.addWidget(self._btn_dn)
        lay.addWidget(self._btn_del)

        # Profile row — offset and delete disabled
        if self._idx == 0:
            self._spin_off.setEnabled(False)
            self._btn_del.setEnabled(False)
            self._btn_up.setEnabled(False)

        # Signals
        for w in [self._cmb_type, self._cmb_tool]:
            w.currentIndexChanged.connect(self._on_change)
        for w in [self._spin_off, self._spin_dep, self._spin_pass]:
            w.valueChanged.connect(self._on_change)
        self._chk.toggled.connect(self._on_change)
        self._btn_del.clicked.connect(lambda: self.delete.emit(self._idx))
        self._btn_up.clicked.connect(lambda: self.move_up.emit(self._idx))
        self._btn_dn.clicked.connect(lambda: self.move_dn.emit(self._idx))
        self.mousePressEvent = lambda ev: self.selected.emit(self._idx)

    def _load(self):
        # Important: setting widget values emits Qt signals.
        # Without blocking, a real .fdr layer can be overwritten by default UI values.
        self._loading = True
        widgets = [self._chk, self._cmb_type, self._spin_off, self._spin_dep,
                   self._cmb_tool, self._spin_pass]
        for w in widgets:
            w.blockSignals(True)
        try:
            self._chk.setChecked(self._layer.get("enabled", True))
            t = self._layer.get("type","groove")
            if t in LAYER_TYPES:
                self._cmb_type.setCurrentIndex(LAYER_TYPES.index(t))
            self._spin_off.setValue(float(self._layer.get("offset_mm", 0) or 0))
            self._spin_dep.setValue(float(self._layer.get("depth_mm",  0) or 0))
            tl = self._layer.get("tool","T1")
            tool_list = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"]
            self._cmb_tool.clear(); self._cmb_tool.addItems(tool_list)
            self._cmb_tool.setCurrentIndex(tool_list.index(tl) if tl in tool_list else 0)
            self._spin_pass.setValue(int(self._layer.get("pass_count", 1) or 1))
        finally:
            for w in widgets:
                w.blockSignals(False)
            self._loading = False

    def _on_change(self):
        if getattr(self, "_loading", False):
            return
        self._layer["enabled"]   = self._chk.isChecked()
        self._layer["type"]      = self._cmb_type.currentText()
        self._layer["offset_mm"] = self._spin_off.value()
        self._layer["depth_mm"]  = self._spin_dep.value()
        self._layer["tool"]      = self._cmb_tool.currentText()
        self._layer["pass_count"]= self._spin_pass.value()
        self.changed.emit()

    def set_selected(self, v: bool):
        bg = "#1a3a5c" if v else "transparent"
        self.setStyleSheet(
            f"#layer_row{{background:{bg};"
            f"border-radius:3px;}}")


# ═══════════════════════════════════════════════════════════════
# Design Editor Widget
# ═══════════════════════════════════════════════════════════════
class DesignEditorWidget(QWidget):
    """
    Full design editor with:
    - Real-time door preview (left)
    - Layer list editor (right top)
    - Properties panel (right bottom)
    - File toolbar (top)
    """
    design_saved = Signal(str)    # emits path

    def __init__(self, parent=None, designs_dir=None):
        super().__init__(parent)
        self._designs_dir = Path(designs_dir) if designs_dir else Path(config.output_folder).parent / "designs"
        self._designs_dir.mkdir(parents=True, exist_ok=True)
        self._design: DesignData = DesignData()
        self._filepath = ""
        self._modified = False
        self._layer_rows: List[LayerRow] = []

        self._build_ui()
        self._apply_style()
        self._refresh_all()

    # ══════════════════════════════════════════════════════════
    # BUILD
    # ══════════════════════════════════════════════════════════
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0,0,0,0)
        root.setSpacing(0)

        # Toolbar
        root.addWidget(self._build_toolbar())
        root.addWidget(self._hsep())

        # Main area
        splitter = QSplitter(Qt.Horizontal)

        # Left: preview
        left = QWidget()
        ll   = QVBoxLayout(left)
        ll.setContentsMargins(0,0,0,0)

        view_hdr = QHBoxLayout()
        lbl_prev = QLabel("  Preview")
        lbl_prev.setStyleSheet(
            f"color:{C_DIM.name()};font-size:11px;"
            f"font-weight:600;")
        view_hdr.addWidget(lbl_prev)
        view_hdr.addStretch()

        self._chk_grid   = QCheckBox("Grid")
        self._chk_labels = QCheckBox("Labels")
        self._chk_dims   = QCheckBox("Dims")
        self._chk_labels.setChecked(True)
        self._chk_dims.setChecked(True)
        for c in [self._chk_grid, self._chk_labels, self._chk_dims]:
            c.setStyleSheet(f"color:{C_DIM.name()};font-size:11px;")
            c.toggled.connect(self._on_view_toggle)
            view_hdr.addWidget(c)
        view_hdr.setContentsMargins(4,4,8,4)
        ll.addLayout(view_hdr)

        self._canvas = DoorPreviewCanvas()
        self._canvas.layer_clicked.connect(self._select_layer)
        # _btn_fit is created before _canvas, so connect it here.
        self._btn_fit.clicked.connect(self._canvas.fit_to_window)
        ll.addWidget(self._canvas, 1)

        # Size indicator
        self._lbl_size = QLabel("900 × 500 mm")
        self._lbl_size.setStyleSheet(
            f"color:{C_DIM.name()};font-size:11px;"
            f"padding:3px 8px;"
            f"border-top:1px solid {C_BORDER.name()};")
        ll.addWidget(self._lbl_size)
        splitter.addWidget(left)

        # Right: layers + properties (resizable via splitter)
        right = QWidget(); right.setMinimumWidth(380)
        rl    = QVBoxLayout(right)
        rl.setContentsMargins(0,0,0,0)
        rl.setSpacing(0)

        tabs = QTabWidget()
        tabs.setStyleSheet(self._tab_style())

        # Cwood-style order: settings, middle patterns, border patterns, offsets, tools
        self._tabs = tabs

        def _tlabel(en, fa, ar=None):
            try:
                from language_manager import lang as _lm
                code = _lm.current_language
                if code == "fa": return fa
                if code == "ar": return (ar or fa)
            except Exception:
                pass
            return en

        tabs.addTab(self._build_props_tab(),           _tlabel("Design Settings", "تنظیمات طرح"))
        tabs.addTab(self._build_middle_patterns_tab(), _tlabel("Middle Patterns",  "طرح های وسط"))
        tabs.addTab(self._build_around_patterns_tab(), _tlabel("Border Patterns",  "طرح های دور"))
        tabs.addTab(self._build_layers_tab(),          _tlabel("Offsets",          "آفست ها"))
        tabs.addTab(self._build_tools_tab(),           _tlabel("Tools",            "ابزارها"))

        try:
            from language_manager import lang as _lm
            _lm.on_change(self._on_lang_change)
        except Exception:
            pass
        tabs.addTab(self._build_pattern_tab(), "Pattern")

        rl.addWidget(tabs, 1)
        splitter.addWidget(right)
        splitter.setSizes([600, 400])
        splitter.setStretchFactor(0, 6)
        splitter.setStretchFactor(1, 4)
        splitter.setChildrenCollapsible(False)
        self._main_splitter = splitter

        root.addWidget(splitter, 1)

        # Status bar
        self._lbl_status = QLabel("  Ready")
        self._lbl_status.setFixedHeight(22)
        self._lbl_status.setStyleSheet(
            f"background:{C_PANEL.name()};color:{C_DIM.name()};"
            f"padding:0 8px;font-size:11px;"
            f"border-top:1px solid {C_BORDER.name()};")
        root.addWidget(self._lbl_status)

    def _build_toolbar(self) -> QFrame:
        tb = QFrame(); tb.setFixedHeight(44)
        tb.setStyleSheet(f"background:{C_PANEL.name()};")
        tl = QHBoxLayout(tb)
        tl.setContentsMargins(6,4,6,4); tl.setSpacing(4)

        def btn(icon, label, tip):
            b = QPushButton(f"{icon}  {label}")
            b.setToolTip(tip); b.setFixedHeight(32)
            b.setStyleSheet(
                f"background:{C_PANEL.name()};"
                f"border:1px solid {C_BORDER.name()};"
                f"border-radius:3px;color:{C_TEXT.name()};"
                f"padding:0 10px;")
            return b

        self._btn_new    = btn("⊕","New",    "New design")
        self._btn_open   = btn("📂","Open",   "Open .fdr file")
        self._btn_save   = btn("💾","Save",   "Save design")
        self._btn_saveas = btn("💾","Save As","Save as new file")
        self._btn_import = btn("📥","Import", "Import from raw design file")
        self._btn_fit    = btn("⊡","Fit",    "Fit to window")

        for b in [self._btn_new, self._btn_open, self._btn_save,
                  self._btn_saveas, self._btn_import, self._btn_fit]:
            tl.addWidget(b)
        tl.addStretch()

        # Modified indicator
        self._lbl_mod = QLabel("")
        self._lbl_mod.setStyleSheet(f"color:{C_WARN.name()};font-size:11px;")
        tl.addWidget(self._lbl_mod)

        self._btn_new.clicked.connect(self._new_design)
        self._btn_open.clicked.connect(self._open_design)
        self._btn_save.clicked.connect(self._save_design)
        self._btn_saveas.clicked.connect(self._save_as)
        self._btn_import.clicked.connect(self._import_design)
        # Connected after _canvas is created in _build_ui().
        return tb

    def _build_tools_tab(self) -> QWidget:
        """Cwood-style tool/setup panel for door correction.
        This tab is intentionally visual and simple: it exposes T1..T12
        and quick toolpath buttons so the operator can think in machine tools.
        """
        w = QWidget()
        root = QVBoxLayout(w)
        root.setContentsMargins(8, 8, 8, 8)
        root.setSpacing(8)

        title = QLabel("Tool Setup")
        title.setStyleSheet(
            f"color:{C_TEXT.name()};font-size:13px;font-weight:700;")
        root.addWidget(title)

        self._tools_table = QTableWidget(12, 8)
        self._tools_table.setHorizontalHeaderLabels([
            "Use", "No", "Tool Name", "Ø mm", "Angle°", "RPM", "Feed", "Plunge"
        ])
        self._tools_table.verticalHeader().hide()
        self._tools_table.setAlternatingRowColors(True)
        self._tools_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._tools_table.setEditTriggers(QAbstractItemView.DoubleClicked | QAbstractItemView.SelectedClicked)
        self._tools_table.setStyleSheet(
            f"QTableWidget{{background:#1a1a1a;border:1px solid {C_BORDER.name()};"
            f"gridline-color:{C_BORDER.name()};color:{C_TEXT.name()};"
            f"selection-background-color:#264f78;}}"
            f"QHeaderView::section{{background:{C_PANEL.name()};color:{C_DIM.name()};"
            f"border:0;border-right:1px solid {C_BORDER.name()};"
            f"border-bottom:1px solid {C_BORDER.name()};padding:4px;}}"
        )
        hdr = self._tools_table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(2, QHeaderView.Stretch)
        for c in range(3, 8):
            hdr.setSectionResizeMode(c, QHeaderView.ResizeToContents)

        self._populate_tools_table()
        root.addWidget(self._tools_table, 1)
        self._tools_table.cellClicked.connect(self._on_tool_cell_click)

        # Cwood-like toolpath buttons
        btn_grid = QHBoxLayout(); btn_grid.setSpacing(4)
        self._toolpath_buttons = []
        for i in range(1, 13):
            b = QPushButton(f"Toolpath {i}")
            b.setFixedHeight(30)
            b.setEnabled(i <= 4)
            b.setStyleSheet(
                f"background:{'#333333' if i <= 4 else '#242424'};"
                f"border:1px solid {C_BORDER.name()};border-radius:3px;"
                f"color:{C_TEXT.name() if i <= 4 else C_DIM.name()};font-size:11px;")
            btn_grid.addWidget(b)
            self._toolpath_buttons.append(b)
        root.addLayout(btn_grid)

        action_row = QHBoxLayout(); action_row.setSpacing(8)
        for text in ["Change Tool", "Create Contour", "Update Design"]:
            b = QPushButton(text)
            b.setFixedHeight(34)
            b.setStyleSheet(
                f"background:{C_ACCENT.name() if text == 'Update Design' else C_PANEL.name()};"
                f"border:1px solid {C_ACCENT.name() if text == 'Update Design' else C_BORDER.name()};"
                f"border-radius:4px;color:white;padding:0 12px;font-weight:600;"
            )
            action_row.addWidget(b)
        root.addLayout(action_row)
        return w


    def _build_middle_patterns_tab(self) -> QWidget:
        """Cwood-like middle pattern settings."""
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(10, 10, 10, 10)
        lay.setSpacing(8)
        title = QLabel("Middle Patterns")
        title.setStyleSheet(f"color:{C_TEXT.name()};font-weight:700;")
        lay.addWidget(title)
        table = QTableWidget(6, 8)
        table.setHorizontalHeaderLabels([
            "Use", "Pattern", "Boundary", "Tool", "Depth", "V Gap", "H Gap", "Diameter"
        ])
        table.verticalHeader().hide()
        icons = ["||||", "====", "XXXX", "OOOO", "ooo", "shape"]
        for r in range(6):
            use = QTableWidgetItem("✓" if r == 2 else "")
            use.setFlags(use.flags() | Qt.ItemIsUserCheckable)
            use.setCheckState(Qt.Checked if r == 2 else Qt.Unchecked)
            use.setTextAlignment(Qt.AlignCenter)
            table.setItem(r, 0, use)
            values = [icons[r], "Offset 5" if r == 2 else "-", "T4" if r == 2 else "-", "2" if r == 2 else "0", "100" if r == 2 else "0", "100" if r == 2 else "0", "0"]
            for c, val in enumerate(values, start=1):
                item = QTableWidgetItem(val)
                item.setTextAlignment(Qt.AlignCenter)
                table.setItem(r, c, item)
        table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        table.setStyleSheet(self._table_style())
        lay.addWidget(table, 1)
        hint = QLabel("Changes here will later connect to vector and G-code generation.")
        hint.setStyleSheet(f"color:{C_DIM.name()};font-size:11px;")
        lay.addWidget(hint)
        return w

    def _build_around_patterns_tab(self) -> QWidget:
        """Cwood-like around/border pattern settings."""
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(10, 10, 10, 10)
        lay.setSpacing(8)
        title = QLabel("Border Patterns")
        title.setStyleSheet(f"color:{C_TEXT.name()};font-weight:700;")
        lay.addWidget(title)
        table = QTableWidget(6, 7)
        table.setHorizontalHeaderLabels([
            "Use", "Pattern", "Outer", "Inner", "Spacing", "Depth", "Tool"
        ])
        table.verticalHeader().hide()
        patterns = ["ladder", "slant", "bead", "round", "dots", "custom"]
        for r in range(6):
            use = QTableWidgetItem("")
            use.setFlags(use.flags() | Qt.ItemIsUserCheckable)
            use.setCheckState(Qt.Unchecked)
            use.setTextAlignment(Qt.AlignCenter)
            table.setItem(r, 0, use)
            vals = [patterns[r], "-", "-", "0", "0", "-"]
            for c, val in enumerate(vals, start=1):
                item = QTableWidgetItem(val)
                item.setTextAlignment(Qt.AlignCenter)
                table.setItem(r, c, item)
        table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        table.setStyleSheet(self._table_style())
        lay.addWidget(table, 1)
        return w

    def _update_design_from_panels(self):
        self._on_props_changed()
        self._on_pattern_changed()
        self._refresh_all()
        self._status("Design updated")

    @staticmethod
    def _table_style() -> str:
        return f"""
        QTableWidget{{background:#1a1a1a;border:1px solid {C_BORDER.name()};
        gridline-color:{C_BORDER.name()};color:{C_TEXT.name()};selection-background-color:#264f78;}}
        QHeaderView::section{{background:{C_PANEL.name()};color:{C_DIM.name()};
        border:0;border-right:1px solid {C_BORDER.name()};border-bottom:1px solid {C_BORDER.name()};padding:4px;}}
        """

    def _build_layers_tab(self) -> QWidget:
        w   = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(4,4,4,4)
        lay.setSpacing(4)

        # Toolbar
        tb_row = QHBoxLayout(); tb_row.setSpacing(4)
        self._btn_add_layer = QPushButton("＋ Add Layer")
        self._btn_delete_layer = QPushButton("✕ Delete")
        self._btn_layer_up = QPushButton("↑ Up")
        self._btn_layer_down = QPushButton("↓ Down")
        for b in [self._btn_add_layer, self._btn_delete_layer,
                  self._btn_layer_up, self._btn_layer_down]:
            b.setFixedHeight(28)
            b.setStyleSheet(
                f"background:{C_PANEL.name()};"
                f"border:1px solid {C_BORDER.name()};"
                f"border-radius:3px;color:{C_TEXT.name()};"
                f"padding:0 8px;")
        self._btn_add_layer.setStyleSheet(
            f"background:{C_ACCENT.name()};"
            f"border:1px solid {C_ACCENT.name()};"
            f"border-radius:3px;color:white;font-weight:600;"
            f"padding:0 8px;")
        self._btn_delete_layer.setStyleSheet(
            f"background:#5a1f1f;"
            f"border:1px solid #b94a48;"
            f"border-radius:3px;color:white;"
            f"padding:0 8px;")
        self._btn_add_layer.clicked.connect(self._add_layer)
        self._btn_delete_layer.clicked.connect(self._delete_selected_layer)
        self._btn_layer_up.clicked.connect(lambda: self._move_selected_layer(-1))
        self._btn_layer_down.clicked.connect(lambda: self._move_selected_layer(+1))
        tb_row.addWidget(self._btn_add_layer)
        tb_row.addWidget(self._btn_delete_layer)
        tb_row.addWidget(self._btn_layer_up)
        tb_row.addWidget(self._btn_layer_down)
        tb_row.addStretch()

        # Layer count
        self._lbl_layer_count = QLabel("1 layer")
        self._lbl_layer_count.setStyleSheet(
            f"color:{C_DIM.name()};font-size:11px;")
        tb_row.addWidget(self._lbl_layer_count)
        lay.addLayout(tb_row)

        # Column headers
        hdr = QFrame()
        hl  = QHBoxLayout(hdr)
        hl.setContentsMargins(4,0,4,0)
        for txt, col_w in [("","14"), (" ","18"),
                       ("Type","110"), ("Offset","74"),
                       ("Depth","69"), ("Tool","55"),
                       ("Pass","54"), ("","70")]:
            lbl = QLabel(txt)
            lbl.setStyleSheet(
                f"color:{C_DIM.name()};font-size:10px;")
            lbl.setFixedWidth(int(col_w))
            hl.addWidget(lbl)
        lay.addWidget(hdr)

        sep = QFrame(); sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet(f"color:{C_BORDER.name()};")
        lay.addWidget(sep)

        # Scroll area for layer rows
        self._layers_scroll = QScrollArea()
        self._layers_scroll.setWidgetResizable(True)
        self._layers_scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarAlwaysOff)
        self._layers_scroll.setStyleSheet("border:none;")

        self._layers_container = QWidget()
        self._layers_vlay = QVBoxLayout(self._layers_container)
        self._layers_vlay.setContentsMargins(0,0,0,0)
        self._layers_vlay.setSpacing(2)
        self._layers_vlay.addStretch()

        self._layers_scroll.setWidget(self._layers_container)
        lay.addWidget(self._layers_scroll, 1)
        return w

    def _build_props_tab(self) -> QWidget:
        w    = QScrollArea(); w.setWidgetResizable(True)
        w.setStyleSheet("border:none;")
        inner = QWidget()
        form  = QFormLayout(inner)
        form.setSpacing(8); form.setContentsMargins(12,12,12,12)
        form.setLabelAlignment(Qt.AlignRight)

        self._prop_code    = QLineEdit()
        self._prop_name    = QLineEdit()
        self._prop_name_fa = QLineEdit()
        self._prop_w       = QDoubleSpinBox()
        self._prop_h       = QDoubleSpinBox()
        self._prop_t1      = QDoubleSpinBox()
        self._prop_t2      = QDoubleSpinBox()
        self._prop_pass    = QDoubleSpinBox()
        self._prop_cat     = QComboBox()

        for sp in [self._prop_w, self._prop_h]:
            sp.setRange(50, 9999); sp.setDecimals(1)
            sp.setSuffix(" mm")
        self._prop_w.setValue(900); self._prop_h.setValue(500)

        for sp in [self._prop_t1, self._prop_t2]:
            sp.setRange(0.5, 100); sp.setDecimals(1)
            sp.setSuffix(" mm")
        self._prop_t1.setValue(6); self._prop_t2.setValue(16)

        self._prop_pass.setRange(0.5,10); self._prop_pass.setDecimals(1)
        self._prop_pass.setValue(2); self._prop_pass.setSuffix(" mm")

        for cat in ["designs","vitrines","hoods","columns","decorative","others"]:
            self._prop_cat.addItem(cat)

        form.addRow("Design Code:", self._prop_code)
        form.addRow("Name (EN):",   self._prop_name)
        form.addRow("نام (FA):",    self._prop_name_fa)
        form.addRow("Width:",       self._prop_w)
        form.addRow("Height:",      self._prop_h)
        form.addRow("T1 Ø (mm):",  self._prop_t1)
        form.addRow("T2 Ø (mm):",  self._prop_t2)
        form.addRow("Pass Depth:", self._prop_pass)
        form.addRow("Category:",   self._prop_cat)

        # Connect
        for w2 in [self._prop_code, self._prop_name, self._prop_name_fa]:
            w2.textChanged.connect(self._on_props_changed)
        for w2 in [self._prop_w, self._prop_h,
                   self._prop_t1, self._prop_t2, self._prop_pass]:
            w2.valueChanged.connect(self._on_props_changed)
        self._prop_cat.currentIndexChanged.connect(self._on_props_changed)

        w.setWidget(inner)
        return w

    def _build_pattern_tab(self) -> QWidget:
        w    = QWidget()
        form = QFormLayout(w)
        form.setSpacing(8); form.setContentsMargins(12,12,12,12)
        form.setLabelAlignment(Qt.AlignRight)

        self._pat_enabled = QCheckBox("Enable Pattern")
        self._pat_type    = QComboBox()
        for t in ["none","cross_grid","diagonal","horizontal",
                  "vertical","diamond","wave","multi_frame"]:
            self._pat_type.addItem(t)
        self._pat_spacing = QDoubleSpinBox()
        self._pat_spacing.setRange(10,500); self._pat_spacing.setValue(60)
        self._pat_spacing.setSuffix(" mm")
        self._pat_angle   = QDoubleSpinBox()
        self._pat_angle.setRange(0,90); self._pat_angle.setValue(45)
        self._pat_angle.setSuffix(" °")
        self._pat_depth   = QDoubleSpinBox()
        self._pat_depth.setRange(0.1,10); self._pat_depth.setValue(2)
        self._pat_depth.setSuffix(" mm")

        form.addRow("",            self._pat_enabled)
        form.addRow("Type:",       self._pat_type)
        form.addRow("Spacing:",    self._pat_spacing)
        form.addRow("Angle:",      self._pat_angle)
        form.addRow("Depth:",      self._pat_depth)

        for w2 in [self._pat_type, self._pat_spacing,
                   self._pat_angle, self._pat_depth]:
            if hasattr(w2, "valueChanged"):
                w2.valueChanged.connect(self._on_pattern_changed)
            else:
                w2.currentIndexChanged.connect(self._on_pattern_changed)
        self._pat_enabled.toggled.connect(self._on_pattern_changed)
        return w

    # ══════════════════════════════════════════════════════════
    # REFRESH
    # ══════════════════════════════════════════════════════════
    def _refresh_all(self):
        self._refresh_layers_panel()
        self._refresh_props_panel()
        self._refresh_pattern_panel()
        self._populate_tools_table()
        self._canvas.set_design(self._design)
        self._lbl_size.setText(
            f"{self._design.width:.0f} × "
            f"{self._design.height:.0f} mm")

    def _refresh_layers_panel(self):
        # Defensive fix: if Qt deleted the scroll container/layout, recreate it.
        try:
            _ = self._layers_vlay.count()
        except RuntimeError:
            self._layers_container = QWidget()
            self._layers_vlay = QVBoxLayout(self._layers_container)
            self._layers_vlay.setContentsMargins(0,0,0,0)
            self._layers_vlay.setSpacing(2)
            self._layers_scroll.setWidget(self._layers_container)

        # Clear
        for row in self._layer_rows:
            row.setParent(None)
        self._layer_rows.clear()

        # Remove stretch
        while self._layers_vlay.count():
            item = self._layers_vlay.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        # Rebuild
        for i, layer in enumerate(self._design.layers):
            row = LayerRow(layer, i)
            row.changed.connect(self._on_layer_changed)
            row.selected.connect(self._select_layer)
            row.delete.connect(self._del_layer)
            row.move_up.connect(lambda idx: self._move_layer(idx, -1))
            row.move_dn.connect(lambda idx: self._move_layer(idx, +1))
            self._layers_vlay.addWidget(row)
            self._layer_rows.append(row)

        self._layers_vlay.addStretch()
        n = len(self._design.layers)
        self._lbl_layer_count.setText(
            f"{n} layer{'s' if n!=1 else ''}")

        # Highlight selected
        for i, row in enumerate(self._layer_rows):
            row.set_selected(
                i == self._canvas._selected_layer)

    def _refresh_props_panel(self):
        d = self._design
        widgets = [self._prop_code, self._prop_name, self._prop_name_fa,
                   self._prop_w, self._prop_h, self._prop_t1, self._prop_t2,
                   self._prop_pass, self._prop_cat]
        for w in widgets: w.blockSignals(True)
        try:
            self._prop_code.setText(d.design_code)
            self._prop_name.setText(d.name)
            self._prop_name_fa.setText(d.name_fa)
            self._prop_w.setValue(d.width)
            self._prop_h.setValue(d.height)
            self._prop_t1.setValue(d.t1_diameter)
            self._prop_t2.setValue(d.t2_diameter)
            self._prop_pass.setValue(d.pass_depth)
            cats = ["designs","vitrines","hoods","columns","decorative","others"]
            idx = cats.index(d.category) if d.category in cats else 0
            self._prop_cat.setCurrentIndex(idx)
        finally:
            for w in widgets: w.blockSignals(False)

    def _refresh_pattern_panel(self):
        pat = self._design.pattern
        widgets = [self._pat_enabled, self._pat_type, self._pat_spacing, self._pat_angle, self._pat_depth]
        for w in widgets: w.blockSignals(True)
        try:
            self._pat_enabled.setChecked(pat.get("enabled", False))
            t = pat.get("type","none")
            types = ["none","cross_grid","diagonal","horizontal",
                     "vertical","diamond","wave","multi_frame"]
            if t in types:
                self._pat_type.setCurrentIndex(types.index(t))
            self._pat_spacing.setValue(float(pat.get("spacing_mm", 60)))
            self._pat_angle.setValue(float(pat.get("angle_deg", 45)))
            self._pat_depth.setValue(float(pat.get("depth_mm", 2)))
        finally:
            for w in widgets: w.blockSignals(False)

    # ══════════════════════════════════════════════════════════
    # EVENTS
    # ══════════════════════════════════════════════════════════
    def _on_layer_changed(self):
        self._mark_modified()
        self._canvas.update()
        self._lbl_size.setText(
            f"{self._design.width:.0f} × "
            f"{self._design.height:.0f} mm")

    def _on_props_changed(self):
        d = self._design
        d.design_code = self._prop_code.text().strip()
        d.name        = self._prop_name.text().strip()
        d.name_fa     = self._prop_name_fa.text().strip()
        d.width       = self._prop_w.value()
        d.height      = self._prop_h.value()
        d.t1_diameter = self._prop_t1.value()
        d.t2_diameter = self._prop_t2.value()
        d.pass_depth  = self._prop_pass.value()
        d.category    = self._prop_cat.currentText()
        self._canvas.set_design(d)
        self._lbl_size.setText(
            f"{d.width:.0f} × {d.height:.0f} mm")
        self._mark_modified()

    def _on_pattern_changed(self):
        self._design.pattern = {
            "enabled":    self._pat_enabled.isChecked(),
            "type":       self._pat_type.currentText(),
            "spacing_mm": self._pat_spacing.value(),
            "angle_deg":  self._pat_angle.value(),
            "depth_mm":   self._pat_depth.value(),
        }
        self._mark_modified()

    def _on_view_toggle(self):
        self._canvas._show_grid   = self._chk_grid.isChecked()
        self._canvas._show_labels = self._chk_labels.isChecked()
        self._canvas._show_dims   = self._chk_dims.isChecked()
        self._canvas.update()

    def _select_layer(self, idx: int):
        self._canvas.set_selected_layer(idx)
        for i, row in enumerate(self._layer_rows):
            row.set_selected(i == idx)

    def _add_layer(self):
        self._design.add_layer()
        new_idx = len(self._design.layers) - 1
        self._canvas.set_selected_layer(new_idx)
        self._refresh_layers_panel()
        self._canvas.update()
        self._mark_modified()

    def _delete_selected_layer(self):
        idx = getattr(self._canvas, "_selected_layer", 0)
        self._del_layer(idx)

    def _move_selected_layer(self, direction: int):
        idx = getattr(self._canvas, "_selected_layer", 0)
        self._move_layer(idx, direction)

    def _del_layer(self, idx: int):
        if idx <= 0:
            QMessageBox.information(self, "Delete Layer", "Profile layer cannot be deleted.")
            return
        if idx >= len(self._design.layers):
            return
        self._design.remove_layer(idx)
        self._canvas.set_selected_layer(max(0, min(idx - 1, len(self._design.layers) - 1)))
        self._refresh_layers_panel()
        self._canvas.update()
        self._mark_modified()

    def _move_layer(self, idx: int, direction: int):
        if idx <= 0:
            return
        self._design.move_layer(idx, direction)
        new_idx = max(1, min(idx + direction, len(self._design.layers) - 1))
        self._canvas.set_selected_layer(new_idx)
        self._refresh_layers_panel()
        self._canvas.update()
        self._mark_modified()

    # ══════════════════════════════════════════════════════════
    # FILE OPERATIONS
    # ══════════════════════════════════════════════════════════
    def _new_design(self):
        if self._modified:
            if not self._confirm_discard():
                return
        self._design   = DesignData()
        self._filepath = ""
        self._modified = False
        self._refresh_all()
        self._lbl_mod.setText("")
        self._status("New design")

    def load_design(self, code_or_path: str) -> bool:
        """Public loader used by DesignLibraryWidget / main window.
        Accepts a design code like 'cd1' or a direct .fdr/.json path.
        """
        if not code_or_path:
            return False
        p = Path(str(code_or_path))
        if not p.exists():
            for ext in (FDR_EXTENSION, ".json"):
                candidate = self._designs_dir / f"{code_or_path}{ext}"
                if candidate.exists():
                    p = candidate
                    break
        if not p.exists():
            QMessageBox.critical(self, "Open Error", f"Cannot find design: {code_or_path}")
            return False
        d = DesignData.load(str(p))
        if not d:
            QMessageBox.critical(self, "Open Error", f"Cannot read: {p}")
            return False
        self._design = d
        self._filepath = str(p)
        self._modified = False
        self._refresh_all()
        self._lbl_mod.setText("")
        self._status(f"Opened: {p.name}")
        return True

    def _open_design(self):
        if self._modified and not self._confirm_discard():
            return
        path, _ = QFileDialog.getOpenFileName(
            self, "Open Design",
            str(self._designs_dir),
            f"FIROO Design (*{FDR_EXTENSION});;JSON (*.json);;All Files (*)")
        if not path:
            return
        d = DesignData.load(path)
        if d:
            self._design   = d
            self._filepath = path
            self._modified = False
            self._refresh_all()
            self._lbl_mod.setText("")
            self._status(f"Opened: {Path(path).name}")
        else:
            QMessageBox.critical(self,"Open Error",
                                 f"Cannot read: {path}")

    def _save_design(self):
        if not self._filepath:
            self._save_as(); return
        self._do_save(self._filepath)

    def _save_as(self):
        designs_dir = str(
            Path(config.output_folder).parent / "designs")
        default = str(
            Path(designs_dir) /
            f"{self._design.design_code or 'design'}{FDR_EXTENSION}")
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Design", default,
            f"FIROO Design (*{FDR_EXTENSION});;All Files (*)")
        if path:
            if not path.endswith(FDR_EXTENSION):
                path += FDR_EXTENSION
            self._filepath = path
            self._do_save(path)

    def _do_save(self, path: str):
        self._sync_tools_from_table()
        if self._design.save(path):
            self._modified = False
            self._lbl_mod.setText("")
            self._status(f"Saved: {Path(path).name}")
            self.design_saved.emit(path)
        else:
            QMessageBox.critical(self,"Save Error",
                                 f"Cannot save: {path}")

    def _import_design(self):
        """Import a raw design file and open for editing."""
        path, _ = QFileDialog.getOpenFileName(
            self, "Import Raw Design File", str(Path.home()),
            "Design Files (*.cd *.dsgn *.design);;All Files (*)")
        if not path:
            return
        try:
            import sys, os
            sys.path.insert(0, os.path.dirname(__file__))
            from design_importer import DesignImporter, DesignFileParser, DesignBuilder
            parser = DesignFileParser(path)
            parser.load()
            parsed = parser.parse()
            if not parsed:
                QMessageBox.critical(
                    self,"Import Error","Cannot parse design file.")
                return
            builder = DesignBuilder()
            d_dict  = builder.build(parsed, path)
            self._design   = DesignData.from_dict(d_dict)
            self._filepath = ""
            self._modified = True
            self._refresh_all()
            self._lbl_mod.setText("● Modified")
            self._status(
                f"Imported: {Path(path).name} "
                f"— {len(self._design.layers)} layers")
        except Exception as e:
            QMessageBox.critical(self,"Import Error",str(e))

    # ── Helpers ───────────────────────────────────────────────
    def _mark_modified(self):
        self._modified = True
        self._lbl_mod.setText("● Modified")
        self._lbl_mod.setStyleSheet(
            f"color:{C_WARN.name()};font-size:11px;")

    def _confirm_discard(self) -> bool:
        ans = QMessageBox.question(
            self,"Unsaved Changes",
            "Discard unsaved changes?",
            QMessageBox.Yes | QMessageBox.No)
        return ans == QMessageBox.Yes

    def _status(self, msg: str):
        self._lbl_status.setText(f"  {msg}")

    # ── Style ─────────────────────────────────────────────────
    def _populate_tools_table(self):
        """Fill T1..T12 table from the current design tool data."""
        if not hasattr(self, "_tools_table"):
            return
        tools = getattr(self._design, "tools", {}) or {}
        for row in range(12):
            key = f"T{row+1}"
            td = tools.get(key, {})
            use = bool(td) and str(td.get("name", "-")).strip() not in ("", "-")
            no = key
            name = td.get("name", "-") if use else "-"
            dia = td.get("diameter", 0)
            ang = td.get("angle", 0)
            rpm = td.get("rpm", td.get("spindle_rpm", 0))
            feed = td.get("feed", td.get("feed_rate", 0))
            plunge = td.get("plunge", td.get("plunge_rate", 0))
            chk = QTableWidgetItem("✓" if use else "")
            chk.setTextAlignment(Qt.AlignCenter)
            chk.setFlags(chk.flags() | Qt.ItemIsUserCheckable)
            chk.setCheckState(Qt.Checked if use else Qt.Unchecked)
            self._tools_table.setItem(row, 0, chk)
            for col, val in enumerate([no, name, dia, ang, rpm, feed, plunge], start=1):
                item = QTableWidgetItem(str(val))
                item.setTextAlignment(Qt.AlignCenter if col != 2 else Qt.AlignLeft | Qt.AlignVCenter)
                if not use:
                    item.setForeground(C_DIM)
                self._tools_table.setItem(row, col, item)
        self._tools_table.resizeRowsToContents()

    def _sync_tools_from_table(self):
        """Store final editable tool table values into DesignData.tools before saving."""
        if not hasattr(self, "_tools_table"):
            return
        tools = {}
        for row in range(12):
            key_item = self._tools_table.item(row, 1)
            key = key_item.text().strip() if key_item else f"T{row+1}"
            if not key:
                key = f"T{row+1}"
            name = self._tools_table.item(row, 2).text().strip() if self._tools_table.item(row, 2) else ""
            if name in ("", "-"):
                continue
            def val(c, default="0"):
                it = self._tools_table.item(row, c)
                return it.text().strip() if it else default
            def f(c):
                try: return float(val(c, "0"))
                except Exception: return 0.0
            chk = self._tools_table.item(row, 0)
            enabled = True if not chk else chk.checkState() == Qt.Checked
            tools[key] = {
                "name": name,
                "type": val(2, ""),
                "diameter": f(3),
                "angle": f(4),
                "rpm": int(f(5)),
                "feed": f(6),
                "plunge": f(7),
                "enabled": enabled,
            }
        self._design.tools = tools

    def _on_tool_cell_click(self, row: int, col: int):
        """Click on Tool Name (col 2) opens Aspire-style tool database."""
        if col != 2:
            return
        try:
            from aspire_tool_dialog import AspireToolDatabaseDialog, ensure_default_database
            ensure_default_database()
            dlg = AspireToolDatabaseDialog(self)
            if dlg.exec() != QDialog.Accepted or not dlg.selected_tool:
                return
            t = dlg.selected_tool
            values = t.as_design_values()
            # Keep current T row number, but fill all Aspire parameters.
            mapping = {
                2: values.get("name", t.name),
                3: values.get("diameter", "0"),
                4: values.get("angle", "0"),
                5: values.get("rpm", "0"),
                6: values.get("feed", "0"),
                7: values.get("plunge", "0"),
            }
            for c, val in mapping.items():
                item = self._tools_table.item(row, c)
                if item:
                    item.setText(str(val))
                else:
                    item = QTableWidgetItem(str(val))
                    item.setTextAlignment(Qt.AlignCenter if c != 2 else Qt.AlignLeft | Qt.AlignVCenter)
                    self._tools_table.setItem(row, c, item)
            no_item = self._tools_table.item(row, 1)
            if no_item and values.get("tool_number") and values.get("tool_number") != "0":
                no_item.setText(f"T{values.get('tool_number')}")
            chk = self._tools_table.item(row, 0)
            if chk:
                chk.setCheckState(Qt.Checked)
            self._sync_tools_from_table()
            self._mark_modified()
        except Exception as e:
            QMessageBox.warning(self, "Tool Database", f"Cannot open Aspire-style tool database:\n{e}")

    def _on_lang_change(self, code: str, direction: str = "ltr"):
        from PySide6.QtCore import Qt
        self.setLayoutDirection(
            Qt.RightToLeft if direction == "rtl" else Qt.LeftToRight)
        if not hasattr(self, "_tabs"):
            return
        tab_labels = {
            "en": ["Design Settings","Middle Patterns","Border Patterns","Offsets","Tools"],
            "fa": ["تنظیمات طرح","طرح های وسط","طرح های دور","آفست ها","ابزارها"],
            "ar": ["إعدادات التصميم","الأنماط الوسطى","الأنماط الحدودية","الإزاحات","الأدوات"],
        }
        labels = tab_labels.get(code, tab_labels["en"])
        for i, lbl in enumerate(labels):
            if i < self._tabs.count():
                self._tabs.setTabText(i, lbl)

    def _apply_style(self):
        self.setStyleSheet(f"""
        * {{ font-family:"Segoe UI",Tahoma,sans-serif;
             font-size:12px; }}
        QWidget {{ background:{C_BG.name()};
                  color:{C_TEXT.name()}; }}
        QGroupBox {{
            background:transparent;
            border:1px solid {C_BORDER.name()};
            border-radius:3px; margin-top:6px;
            padding-top:6px;
            color:{C_DIM.name()}; font-size:11px;
            font-weight:600;
        }}
        QGroupBox::title {{
            subcontrol-origin:margin; left:6px;
            padding:0 3px;
        }}
        QPushButton {{
            background:{C_PANEL.name()};
            border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:3px 10px;
            color:{C_TEXT.name()};
        }}
        QPushButton:hover {{
            background:#3e3e42;
            border-color:{C_ACCENT.name()};
        }}
        QDoubleSpinBox, QSpinBox, QLineEdit, QComboBox {{
            background:#1a1a1a;
            border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:2px 5px;
            color:{C_TEXT.name()};
        }}
        QDoubleSpinBox:focus, QSpinBox:focus,
        QLineEdit:focus, QComboBox:focus {{
            border-color:{C_ACCENT.name()};
        }}
        QCheckBox::indicator {{
            width:13px; height:13px;
            border:1px solid {C_BORDER.name()};
            border-radius:2px; background:#1a1a1a;
        }}
        QCheckBox::indicator:checked {{
            background:{C_ACCENT.name()};
            border-color:{C_ACCENT.name()};
        }}
        QScrollArea {{ border:none; }}
        QScrollBar:vertical {{
            background:{C_PANEL.name()};
            width:8px; border:none;
        }}
        QScrollBar::handle:vertical {{
            background:{C_BORDER.name()};
            border-radius:4px; min-height:20px;
        }}
        QSplitter::handle {{
            background:{C_BORDER.name()}; width:1px;
        }}
        """)

    @staticmethod
    def _hsep() -> QFrame:
        s = QFrame(); s.setFrameShape(QFrame.HLine)
        s.setFixedHeight(1)
        s.setStyleSheet(f"background:{C_BORDER.name()};")
        return s

    @staticmethod
    def _tab_style() -> str:
        return f"""
        QTabWidget::pane {{
            border:none;
            border-top:1px solid {C_BORDER.name()};
        }}
        QTabBar::tab {{
            background:{C_PANEL.name()};
            color:{C_DIM.name()};
            border:none;
            border-right:1px solid {C_BORDER.name()};
            padding:5px 16px; font-size:12px;
        }}
        QTabBar::tab:selected {{
            background:{C_BG.name()};
            color:{C_TEXT.name()};
            border-bottom:2px solid {C_ACCENT.name()};
            font-weight:600;
        }}
        """


# ═══════════════════════════════════════════════════════════════
# Test
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    w = DesignEditorWidget()
    w.setWindowTitle("FIROO CAM — Design Editor")
    w.resize(1280, 760)

    # Load cd1 for demo
    from design_importer import DesignFileParser, DesignBuilder
    path = "/mnt/user-data/uploads/cd1.cwd"
    if os.path.exists(path):
        p = DesignFileParser(path)
        p.load()
        parsed = p.parse()
        if parsed:
            b = DesignBuilder()
            d_dict = b.build(parsed, path)
            w._design = DesignData.from_dict(d_dict)
            w._refresh_all()

    w.show()
    sys.exit(app.exec())