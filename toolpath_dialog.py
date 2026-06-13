from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from PySide6.QtCore import Qt, QRectF, QPointF
from PySide6.QtGui import QColor, QPainter, QPen, QBrush, QPainterPath, QPolygonF
from PySide6.QtWidgets import (
    QDialog, QWidget, QHBoxLayout, QVBoxLayout, QFormLayout,
    QListWidget, QListWidgetItem, QStackedWidget, QGroupBox,
    QDoubleSpinBox, QSpinBox, QComboBox, QCheckBox, QLabel,
    QPushButton, QDialogButtonBox, QSizePolicy, QFrame,
)

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
C_BG     = QColor("#0d1117")
C_PANEL  = QColor("#161b22")
C_BORDER = QColor("#30363d")
C_ACCENT = QColor("#58a6ff")
C_TEXT   = QColor("#e6edf3")
C_DIM    = QColor("#8b949e")
C_GOOD   = QColor("#4ec9b0")
C_WARN   = QColor("#ce9178")

# ---------------------------------------------------------------------------
# Operation types
# ---------------------------------------------------------------------------
OPERATION_TYPES = [
    ("profile",     "Profile",      "Outer/inner contour cutting"),
    ("pocket",      "Pocket",       "Area pocket clearing"),
    ("vcarve",      "V-Carve",      "V-bit depth-variable carving"),
    ("engrave",     "Engraving",    "Fixed-depth scribing"),
    ("drill",       "Drilling",     "Drill cycles at positions"),
    ("thread_mill", "Thread Mill",  "Helical thread interpolation"),
]

# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------
@dataclass
class ToolpathConfig:
    # Common
    op_type:     str   = "profile"
    tool_id:     str   = "T1"
    depth_mm:    float = 10.0
    pass_count:  int   = 2

    # Profile
    side:        str   = "outside"
    allowance:   float = 0.0
    tab_count:   int   = 0
    tab_width:   float = 8.0
    tab_height:  float = 5.0

    # Pocket
    stepover_pct:  float = 40.0
    finish_depth:  float = 0.5
    pocket_ramp:   bool  = False

    # V-Carve
    vcarve_start:  float = 0.0
    vcarve_flat:   float = 0.0

    # Engraving
    engrave_depth: float = 1.5

    # Drilling
    peck_depth:    float = 5.0
    drill_mode:    str   = "peck"
    dwell_ms:      int   = 300

    # Thread Mill
    thread_pitch:  float = 1.25
    thread_dia:    float = 6.0
    thread_depth:  float = 12.0
    thread_dir:    str   = "cw"
    lead_in_z:     float = 2.0

    # -----------------------------------------------------------------------
    def label(self) -> str:
        for key, name, _ in OPERATION_TYPES:
            if key == self.op_type:
                return name
        return self.op_type.title()

    def summary(self) -> str:
        base = f"{self.label()} | {self.tool_id} | depth={self.depth_mm:.2f}mm"
        if self.op_type == "profile":
            return f"{base} | {self.side} | passes={self.pass_count}"
        if self.op_type == "pocket":
            return f"{base} | stepover={self.stepover_pct:.0f}% | passes={self.pass_count}"
        if self.op_type == "vcarve":
            return f"{base} | start={self.vcarve_start:.2f}mm"
        if self.op_type == "engrave":
            return f"{base} | engrave={self.engrave_depth:.2f}mm"
        if self.op_type == "drill":
            return f"{base} | mode={self.drill_mode}"
        if self.op_type == "thread_mill":
            return f"{base} | pitch={self.thread_pitch:.2f}mm | {self.thread_dir.upper()}"
        return base


# ---------------------------------------------------------------------------
# Preview widget
# ---------------------------------------------------------------------------
class ToolpathPreview(QWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._op_type: str = "profile"
        self.setFixedSize(200, 120)
        self.setToolTip("Toolpath preview")

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        # Background
        painter.fillRect(self.rect(), QColor("#111820"))

        # Thin border
        border_pen = QPen(C_BORDER, 1)
        painter.setPen(border_pen)
        painter.drawRect(self.rect().adjusted(0, 0, -1, -1))

        w, h = self.width(), self.height()
        cx, cy = w / 2, h / 2

        op = self._op_type
        if op == "profile":
            self._draw_profile(painter, cx, cy, w, h)
        elif op == "pocket":
            self._draw_pocket(painter, cx, cy, w, h)
        elif op == "vcarve":
            self._draw_vcarve(painter, cx, cy, w, h)
        elif op == "engrave":
            self._draw_engrave(painter, cx, cy, w, h)
        elif op == "drill":
            self._draw_drill(painter, cx, cy, w, h)
        elif op == "thread_mill":
            self._draw_thread_mill(painter, cx, cy, w, h)

        painter.end()

    # -- individual draw helpers --------------------------------------------

    def _draw_profile(self, p: QPainter, cx, cy, w, h) -> None:
        rect = QRectF(cx - 60, cy - 35, 120, 70)
        # Workpiece
        p.setPen(QPen(C_DIM, 1, Qt.DashLine))
        p.setBrush(Qt.NoBrush)
        p.drawRect(rect)
        # Tool path (slightly inset)
        path_rect = rect.adjusted(8, 8, -8, -8)
        p.setPen(QPen(C_ACCENT, 2))
        p.drawRect(path_rect)
        # Arrows on path
        arrow_pen = QPen(C_ACCENT, 2)
        p.setPen(arrow_pen)
        for ax, ay, dx, dy in [
            (path_rect.left() + 30, path_rect.top(), 1, 0),
            (path_rect.right(), path_rect.top() + 20, 0, 1),
            (path_rect.right() - 30, path_rect.bottom(), -1, 0),
            (path_rect.left(), path_rect.bottom() - 20, 0, -1),
        ]:
            self._draw_arrow(p, ax, ay, dx, dy, 7)

    def _draw_pocket(self, p: QPainter, cx, cy, w, h) -> None:
        rect = QRectF(cx - 60, cy - 35, 120, 70)
        p.setPen(QPen(C_DIM, 1, Qt.DashLine))
        p.setBrush(Qt.NoBrush)
        p.drawRect(rect)
        # Raster lines
        p.setPen(QPen(C_ACCENT, 1))
        y = rect.top() + 10
        while y < rect.bottom() - 4:
            p.drawLine(QPointF(rect.left() + 6, y), QPointF(rect.right() - 6, y))
            y += 9

    def _draw_vcarve(self, p: QPainter, cx, cy, w, h) -> None:
        # V cross-section triangle
        pts = [
            QPointF(cx - 55, cy - 30),
            QPointF(cx,       cy + 35),
            QPointF(cx + 55,  cy - 30),
        ]
        poly = QPolygonF(pts)
        p.setPen(QPen(C_DIM, 1, Qt.DashLine))
        p.setBrush(QBrush(QColor("#161b22")))
        p.drawPolygon(poly)
        # V-cut line
        p.setPen(QPen(C_ACCENT, 2))
        p.drawLine(pts[0], pts[1])
        p.drawLine(pts[1], pts[2])
        # Small label
        p.setPen(QPen(C_DIM, 1))
        p.drawText(QRectF(cx - 40, cy - 50, 80, 16), Qt.AlignCenter, "V-bit cross-section")

    def _draw_engrave(self, p: QPainter, cx, cy, w, h) -> None:
        rect = QRectF(cx - 60, cy - 35, 120, 70)
        p.setPen(QPen(C_DIM, 1, Qt.DashLine))
        p.setBrush(Qt.NoBrush)
        p.drawRect(rect)
        # Thin scribing path
        p.setPen(QPen(C_ACCENT, 1))
        path = QPainterPath()
        path.moveTo(rect.left() + 12, rect.top() + 15)
        path.lineTo(rect.right() - 12, rect.top() + 15)
        path.moveTo(rect.right() - 12, rect.top() + 30)
        path.lineTo(rect.left() + 12, rect.top() + 30)
        path.moveTo(rect.left() + 12, rect.top() + 45)
        path.lineTo(rect.right() - 12, rect.top() + 45)
        p.drawPath(path)

    def _draw_drill(self, p: QPainter, cx, cy, w, h) -> None:
        # Circle target
        r = 28
        p.setPen(QPen(C_DIM, 1, Qt.DashLine))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(QPointF(cx, cy - 10), r, r)
        # Cross hairs
        p.setPen(QPen(C_DIM, 1))
        p.drawLine(QPointF(cx - r - 4, cy - 10), QPointF(cx + r + 4, cy - 10))
        p.drawLine(QPointF(cx, cy - r - 14), QPointF(cx, cy + r + 4))
        # Drill bit triangle pointing down
        tip_pts = [
            QPointF(cx - 8, cy - 10 - r + 4),
            QPointF(cx + 8, cy - 10 - r + 4),
            QPointF(cx,     cy - 10 - r + 18),
        ]
        p.setPen(QPen(C_ACCENT, 1))
        p.setBrush(QBrush(C_ACCENT))
        p.drawPolygon(QPolygonF(tip_pts))
        # Shaft
        p.setPen(QPen(C_ACCENT, 3))
        p.drawLine(QPointF(cx, cy - h // 2 + 4), QPointF(cx, cy - 10 - r + 4))

    def _draw_thread_mill(self, p: QPainter, cx, cy, w, h) -> None:
        # Outer circle
        r = 32
        p.setPen(QPen(C_DIM, 1, Qt.DashLine))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(QPointF(cx, cy), r, r)
        # Helix approximation: smaller spiral arcs
        p.setPen(QPen(C_ACCENT, 2))
        path = QPainterPath()
        import math
        steps = 60
        for i in range(steps + 1):
            angle = math.radians(i * 360 / steps * 1.5)
            radius = r * (0.3 + 0.7 * i / steps)
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)
            if i == 0:
                path.moveTo(x, y)
            else:
                path.lineTo(x, y)
        p.drawPath(path)

    @staticmethod
    def _draw_arrow(p: QPainter, x, y, dx, dy, size) -> None:
        import math
        angle = math.atan2(dy, dx)
        a1 = angle + math.radians(150)
        a2 = angle - math.radians(150)
        pts = [
            QPointF(x, y),
            QPointF(x + size * math.cos(a1), y + size * math.sin(a1)),
            QPointF(x + size * math.cos(a2), y + size * math.sin(a2)),
        ]
        p.setBrush(QBrush(C_ACCENT))
        p.drawPolygon(QPolygonF(pts))


# ---------------------------------------------------------------------------
# Dialog
# ---------------------------------------------------------------------------
class ToolpathDialog(QDialog):
    def __init__(
        self,
        config: Optional[ToolpathConfig] = None,
        tool_ids: list = None,
        parent: Optional[QWidget] = None,
    ) -> None:
        super().__init__(parent)
        self._cfg = config if config is not None else ToolpathConfig()
        self._tool_ids: list[str] = tool_ids if tool_ids else ["T1", "T2", "T3", "T4", "T5"]
        self._result_cfg: Optional[ToolpathConfig] = None

        self.setWindowTitle("Configure Toolpath")
        self.setFixedSize(460, 600)
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)

        self._apply_style()
        self._build()
        self._load_config()

    # -----------------------------------------------------------------------
    # Style
    # -----------------------------------------------------------------------
    def _apply_style(self) -> None:
        self.setStyleSheet(f"""
            QDialog,QWidget{{background:{C_BG.name()};color:{C_TEXT.name()};font-family:"Segoe UI",sans-serif;font-size:12px;}}
            QListWidget{{background:{C_PANEL.name()};border:1px solid {C_BORDER.name()};border-radius:3px;outline:none;}}
            QListWidget::item{{padding:8px 12px;border-radius:3px;}}
            QListWidget::item:selected{{background:{C_ACCENT.name()};color:white;}}
            QListWidget::item:hover:!selected{{background:#21262d;}}
            QGroupBox{{border:1px solid {C_BORDER.name()};border-radius:4px;margin-top:8px;padding:8px;}}
            QGroupBox::title{{color:{C_DIM.name()};subcontrol-origin:margin;left:8px;padding:0 4px;}}
            QDoubleSpinBox,QSpinBox,QLineEdit,QComboBox{{background:#111820;border:1px solid {C_BORDER.name()};border-radius:3px;padding:3px 6px;color:{C_TEXT.name()};min-width:80px;}}
            QCheckBox{{color:{C_TEXT.name()};spacing:6px;}}
            QCheckBox::indicator{{width:13px;height:13px;border:1px solid {C_BORDER.name()};background:#111820;border-radius:2px;}}
            QCheckBox::indicator:checked{{background:{C_ACCENT.name()};border-color:{C_ACCENT.name()};}}
            QPushButton{{background:{C_PANEL.name()};border:1px solid {C_BORDER.name()};border-radius:3px;padding:4px 16px;color:{C_TEXT.name()};}}
            QPushButton:hover{{background:#30363d;border-color:{C_ACCENT.name()};}}
            QLabel{{color:{C_TEXT.name()};background:transparent;}}
        """)

    # -----------------------------------------------------------------------
    # Build layout
    # -----------------------------------------------------------------------
    def _build(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        # --- Top: list + stacked ---
        top = QHBoxLayout()
        top.setSpacing(8)

        # Left: operation type list
        self._type_list = QListWidget()
        self._type_list.setFixedWidth(140)
        self._type_list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        for key, name, desc in OPERATION_TYPES:
            item = QListWidgetItem(name)
            item.setToolTip(desc)
            self._type_list.addItem(item)
        self._type_list.currentRowChanged.connect(self._on_type_changed)
        top.addWidget(self._type_list)

        # Right: stacked pages
        self._stack = QStackedWidget()
        self._stack.addWidget(self._build_profile_page())
        self._stack.addWidget(self._build_pocket_page())
        self._stack.addWidget(self._build_vcarve_page())
        self._stack.addWidget(self._build_engrave_page())
        self._stack.addWidget(self._build_drill_page())
        self._stack.addWidget(self._build_thread_mill_page())
        top.addWidget(self._stack, 1)

        root.addLayout(top, 1)

        # --- Separator ---
        sep1 = QFrame()
        sep1.setFrameShape(QFrame.HLine)
        sep1.setStyleSheet(f"color:{C_BORDER.name()};")
        root.addWidget(sep1)

        # --- Preview ---
        self._preview = ToolpathPreview()
        preview_row = QHBoxLayout()
        preview_row.addStretch()
        preview_row.addWidget(self._preview)
        preview_row.addStretch()
        root.addLayout(preview_row)

        # --- Separator ---
        sep2 = QFrame()
        sep2.setFrameShape(QFrame.HLine)
        sep2.setStyleSheet(f"color:{C_BORDER.name()};")
        root.addWidget(sep2)

        # --- Buttons ---
        btn_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btn_box.accepted.connect(self._on_accept)
        btn_box.rejected.connect(self.reject)
        root.addWidget(btn_box)

    # -----------------------------------------------------------------------
    # Page builders
    # -----------------------------------------------------------------------
    def _make_dspin(self, min_v=0.0, max_v=200.0, step=0.5, decimals=2, value=0.0) -> QDoubleSpinBox:
        sb = QDoubleSpinBox()
        sb.setRange(min_v, max_v)
        sb.setSingleStep(step)
        sb.setDecimals(decimals)
        sb.setValue(value)
        return sb

    def _make_spin(self, min_v=0, max_v=100, value=1) -> QSpinBox:
        sb = QSpinBox()
        sb.setRange(min_v, max_v)
        sb.setValue(value)
        return sb

    def _make_tool_combo(self) -> QComboBox:
        cb = QComboBox()
        for tid in self._tool_ids:
            cb.addItem(tid)
        return cb

    # -- Profile ------------------------------------------------------------
    def _build_profile_page(self) -> QWidget:
        page = QWidget()
        form = QFormLayout(page)
        form.setContentsMargins(4, 4, 4, 4)
        form.setSpacing(8)

        self._pro_side = QComboBox()
        for label, data in [("Outside", "outside"), ("Inside", "inside"), ("On Line", "on")]:
            self._pro_side.addItem(label, data)
        form.addRow("Cut Side:", self._pro_side)

        self._pro_depth = self._make_dspin(0.0, 200.0, 0.5, 2, 10.0)
        form.addRow("Total Depth (mm):", self._pro_depth)

        self._pro_passes = self._make_spin(1, 20, 2)
        form.addRow("Passes:", self._pro_passes)

        self._pro_allowance = self._make_dspin(0.0, 10.0, 0.1, 3, 0.0)
        form.addRow("Allowance (mm):", self._pro_allowance)

        # Tabs group
        tabs_group = QGroupBox("Tabs")
        tabs_layout = QFormLayout(tabs_group)
        tabs_layout.setSpacing(6)

        self._pro_tab_count = self._make_spin(0, 20, 0)
        tabs_layout.addRow("Count:", self._pro_tab_count)

        self._pro_tab_width = self._make_dspin(0.5, 50.0, 0.5, 2, 8.0)
        tabs_layout.addRow("Width (mm):", self._pro_tab_width)

        self._pro_tab_height = self._make_dspin(0.5, 50.0, 0.5, 2, 5.0)
        tabs_layout.addRow("Height (mm):", self._pro_tab_height)

        form.addRow(tabs_group)

        self._pro_tool = self._make_tool_combo()
        form.addRow("Tool:", self._pro_tool)

        return page

    # -- Pocket -------------------------------------------------------------
    def _build_pocket_page(self) -> QWidget:
        page = QWidget()
        form = QFormLayout(page)
        form.setContentsMargins(4, 4, 4, 4)
        form.setSpacing(8)

        self._pkt_depth = self._make_dspin(0.0, 200.0, 0.5, 2, 10.0)
        form.addRow("Total Depth (mm):", self._pkt_depth)

        self._pkt_passes = self._make_spin(1, 20, 2)
        form.addRow("Passes:", self._pkt_passes)

        self._pkt_stepover = self._make_dspin(1.0, 99.0, 1.0, 1, 40.0)
        form.addRow("Stepover (%):", self._pkt_stepover)

        self._pkt_finish = self._make_dspin(0.0, 10.0, 0.1, 2, 0.5)
        form.addRow("Finish Pass Depth (mm):", self._pkt_finish)

        self._pkt_ramp = QCheckBox("Enable ramp entry")
        form.addRow("Ramp Entry:", self._pkt_ramp)

        self._pkt_tool = self._make_tool_combo()
        form.addRow("Tool:", self._pkt_tool)

        return page

    # -- V-Carve ------------------------------------------------------------
    def _build_vcarve_page(self) -> QWidget:
        page = QWidget()
        form = QFormLayout(page)
        form.setContentsMargins(4, 4, 4, 4)
        form.setSpacing(8)

        self._vc_start = self._make_dspin(0.0, 50.0, 0.1, 2, 0.0)
        form.addRow("Start Depth (mm):", self._vc_start)

        self._vc_flat = self._make_dspin(0.0, 50.0, 0.1, 2, 0.0)
        form.addRow("Flat Depth (mm):", self._vc_flat)

        self._vc_tool = self._make_tool_combo()
        form.addRow("V-Bit Tool:", self._vc_tool)

        note = QLabel("Note: V-bit angle is configured in tool library")
        note.setStyleSheet(f"color:{C_DIM.name()};font-style:italic;")
        note.setWordWrap(True)
        form.addRow(note)

        return page

    # -- Engraving ----------------------------------------------------------
    def _build_engrave_page(self) -> QWidget:
        page = QWidget()
        form = QFormLayout(page)
        form.setContentsMargins(4, 4, 4, 4)
        form.setSpacing(8)

        self._eng_depth = self._make_dspin(0.1, 20.0, 0.1, 2, 1.5)
        form.addRow("Engraving Depth (mm):", self._eng_depth)

        self._eng_tool = self._make_tool_combo()
        form.addRow("Tool:", self._eng_tool)

        return page

    # -- Drilling -----------------------------------------------------------
    def _build_drill_page(self) -> QWidget:
        page = QWidget()
        form = QFormLayout(page)
        form.setContentsMargins(4, 4, 4, 4)
        form.setSpacing(8)

        self._drl_depth = self._make_dspin(0.0, 200.0, 0.5, 2, 10.0)
        form.addRow("Drill Depth (mm):", self._drl_depth)

        self._drl_mode = QComboBox()
        self._drl_mode.addItem("Simple Drill (G81)", "simple")
        self._drl_mode.addItem("Peck Drilling (G83)", "peck")
        self._drl_mode.addItem("Dwell Drill (G82)", "dwell")
        form.addRow("Drill Mode:", self._drl_mode)

        self._drl_peck = self._make_dspin(0.1, 200.0, 0.5, 2, 5.0)
        form.addRow("Peck Depth (mm):", self._drl_peck)

        self._drl_dwell = self._make_spin(0, 9999, 300)
        form.addRow("Dwell (ms):", self._drl_dwell)

        self._drl_tool = self._make_tool_combo()
        form.addRow("Tool:", self._drl_tool)

        # Enable/disable peck and dwell based on mode
        def _update_drill_fields(index: int) -> None:
            mode = self._drl_mode.itemData(index)
            self._drl_peck.setEnabled(mode == "peck")
            self._drl_dwell.setEnabled(mode == "dwell")

        self._drl_mode.currentIndexChanged.connect(_update_drill_fields)
        _update_drill_fields(self._drl_mode.currentIndex())

        return page

    # -- Thread Mill --------------------------------------------------------
    def _build_thread_mill_page(self) -> QWidget:
        page = QWidget()
        form = QFormLayout(page)
        form.setContentsMargins(4, 4, 4, 4)
        form.setSpacing(8)

        self._tm_dia = self._make_dspin(1.0, 100.0, 0.5, 2, 6.0)
        form.addRow("Thread Diameter (mm):", self._tm_dia)

        self._tm_pitch = self._make_dspin(0.2, 10.0, 0.25, 2, 1.25)
        form.addRow("Thread Pitch (mm):", self._tm_pitch)

        self._tm_depth = self._make_dspin(0.0, 200.0, 0.5, 2, 12.0)
        form.addRow("Thread Depth (mm):", self._tm_depth)

        self._tm_dir = QComboBox()
        self._tm_dir.addItem("Right-Hand (CW)", "cw")
        self._tm_dir.addItem("Left-Hand (CCW)", "ccw")
        form.addRow("Direction:", self._tm_dir)

        self._tm_lead_in = self._make_dspin(0.0, 20.0, 0.5, 2, 2.0)
        form.addRow("Lead-In Z (mm):", self._tm_lead_in)

        self._tm_tool = self._make_tool_combo()
        form.addRow("Tool:", self._tm_tool)

        note = QLabel("Note: Tool diameter must be < thread diameter")
        note.setStyleSheet(f"color:{C_DIM.name()};font-style:italic;")
        note.setWordWrap(True)
        form.addRow(note)

        return page

    # -----------------------------------------------------------------------
    # Config I/O
    # -----------------------------------------------------------------------
    def _load_config(self) -> None:
        cfg = self._cfg

        # Select operation type row
        op_keys = [k for k, _, _ in OPERATION_TYPES]
        row = op_keys.index(cfg.op_type) if cfg.op_type in op_keys else 0
        self._type_list.setCurrentRow(row)

        # Profile
        side_map = {"outside": 0, "inside": 1, "on": 2}
        self._pro_side.setCurrentIndex(side_map.get(cfg.side, 0))
        self._pro_depth.setValue(cfg.depth_mm)
        self._pro_passes.setValue(cfg.pass_count)
        self._pro_allowance.setValue(cfg.allowance)
        self._pro_tab_count.setValue(cfg.tab_count)
        self._pro_tab_width.setValue(cfg.tab_width)
        self._pro_tab_height.setValue(cfg.tab_height)
        self._set_combo_by_value(self._pro_tool, cfg.tool_id)

        # Pocket
        self._pkt_depth.setValue(cfg.depth_mm)
        self._pkt_passes.setValue(cfg.pass_count)
        self._pkt_stepover.setValue(cfg.stepover_pct)
        self._pkt_finish.setValue(cfg.finish_depth)
        self._pkt_ramp.setChecked(cfg.pocket_ramp)
        self._set_combo_by_value(self._pkt_tool, cfg.tool_id)

        # V-Carve
        self._vc_start.setValue(cfg.vcarve_start)
        self._vc_flat.setValue(cfg.vcarve_flat)
        self._set_combo_by_value(self._vc_tool, cfg.tool_id)

        # Engraving
        self._eng_depth.setValue(cfg.engrave_depth)
        self._set_combo_by_value(self._eng_tool, cfg.tool_id)

        # Drilling
        self._drl_depth.setValue(cfg.depth_mm)
        drill_map = {"simple": 0, "peck": 1, "dwell": 2}
        self._drl_mode.setCurrentIndex(drill_map.get(cfg.drill_mode, 1))
        self._drl_peck.setValue(cfg.peck_depth)
        self._drl_dwell.setValue(cfg.dwell_ms)
        self._set_combo_by_value(self._drl_tool, cfg.tool_id)

        # Thread Mill
        self._tm_dia.setValue(cfg.thread_dia)
        self._tm_pitch.setValue(cfg.thread_pitch)
        self._tm_depth.setValue(cfg.thread_depth)
        dir_map = {"cw": 0, "ccw": 1}
        self._tm_dir.setCurrentIndex(dir_map.get(cfg.thread_dir, 0))
        self._tm_lead_in.setValue(cfg.lead_in_z)
        self._set_combo_by_value(self._tm_tool, cfg.tool_id)

    @staticmethod
    def _set_combo_by_value(combo: QComboBox, value: str) -> None:
        for i in range(combo.count()):
            if combo.itemData(i) == value or combo.itemText(i) == value:
                combo.setCurrentIndex(i)
                return

    def _collect_config(self) -> ToolpathConfig:
        row = self._type_list.currentRow()
        op_keys = [k for k, _, _ in OPERATION_TYPES]
        op_type = op_keys[row] if 0 <= row < len(op_keys) else "profile"

        cfg = ToolpathConfig(op_type=op_type)

        if op_type == "profile":
            cfg.side       = self._pro_side.currentData()
            cfg.depth_mm   = self._pro_depth.value()
            cfg.pass_count = self._pro_passes.value()
            cfg.allowance  = self._pro_allowance.value()
            cfg.tab_count  = self._pro_tab_count.value()
            cfg.tab_width  = self._pro_tab_width.value()
            cfg.tab_height = self._pro_tab_height.value()
            cfg.tool_id    = self._pro_tool.currentText()

        elif op_type == "pocket":
            cfg.depth_mm     = self._pkt_depth.value()
            cfg.pass_count   = self._pkt_passes.value()
            cfg.stepover_pct = self._pkt_stepover.value()
            cfg.finish_depth = self._pkt_finish.value()
            cfg.pocket_ramp  = self._pkt_ramp.isChecked()
            cfg.tool_id      = self._pkt_tool.currentText()

        elif op_type == "vcarve":
            cfg.vcarve_start = self._vc_start.value()
            cfg.vcarve_flat  = self._vc_flat.value()
            cfg.tool_id      = self._vc_tool.currentText()

        elif op_type == "engrave":
            cfg.engrave_depth = self._eng_depth.value()
            cfg.tool_id       = self._eng_tool.currentText()

        elif op_type == "drill":
            cfg.depth_mm   = self._drl_depth.value()
            cfg.drill_mode = self._drl_mode.currentData()
            cfg.peck_depth = self._drl_peck.value()
            cfg.dwell_ms   = self._drl_dwell.value()
            cfg.tool_id    = self._drl_tool.currentText()

        elif op_type == "thread_mill":
            cfg.thread_dia   = self._tm_dia.value()
            cfg.thread_pitch = self._tm_pitch.value()
            cfg.thread_depth = self._tm_depth.value()
            cfg.thread_dir   = self._tm_dir.currentData()
            cfg.lead_in_z    = self._tm_lead_in.value()
            cfg.tool_id      = self._tm_tool.currentText()

        return cfg

    # -----------------------------------------------------------------------
    # Slots
    # -----------------------------------------------------------------------
    def _on_type_changed(self, row: int) -> None:
        self._stack.setCurrentIndex(row)
        op_keys = [k for k, _, _ in OPERATION_TYPES]
        if 0 <= row < len(op_keys):
            self._preview._op_type = op_keys[row]
        self._preview.update()

    def _on_accept(self) -> None:
        self._result_cfg = self._collect_config()
        self.accept()

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------
    def get_config(self) -> ToolpathConfig:
        if self._result_cfg is None:
            return self._collect_config()
        return self._result_cfg

    def exec_and_get(self) -> Optional[ToolpathConfig]:
        if self.exec() == QDialog.Accepted:
            return self._result_cfg
        return None
