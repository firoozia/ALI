from __future__ import annotations

import copy
import time
import uuid
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from PySide6.QtCore import Qt, QTimer, QRectF, QSize
from PySide6.QtGui import QColor, QPainter, QPen, QBrush, QFont, QPixmap
from PySide6.QtWidgets import (
    QApplication, QDialog, QWidget, QVBoxLayout, QHBoxLayout,
    QTabWidget, QTableWidget, QTableWidgetItem, QHeaderView,
    QAbstractItemView, QLabel, QPushButton, QCheckBox, QDoubleSpinBox,
    QSpinBox, QComboBox, QFrame, QSplitter, QTreeWidget, QTreeWidgetItem,
    QTextEdit, QSizePolicy, QButtonGroup, QRadioButton, QFormLayout,
    QDialogButtonBox, QLineEdit, QMessageBox, QFileDialog, QListWidget,
    QListWidgetItem, QScrollArea,
)

# ---------------------------------------------------------------------------
# Theme constants
# ---------------------------------------------------------------------------
C_BG     = "#0d1117"
C_PANEL  = "#161b22"
C_PANEL2 = "#21262d"
C_BORDER = "#30363d"
C_TEXT   = "#e6edf3"
C_DIM    = "#8b949e"
C_ACCENT = "#58a6ff"
C_BLUE   = "#1f6feb"
C_GREEN  = "#3fb950"
C_YELLOW = "#e3b341"

DIALOG_STYLE = f"""
QDialog, QWidget {{
    background: {C_BG}; color: {C_TEXT};
    font-family: "Segoe UI", "Vazirmatn", sans-serif; font-size: 12px;
}}
QLabel {{ color: {C_TEXT}; border: none; background: transparent; }}
QLineEdit, QTextEdit, QDoubleSpinBox, QSpinBox, QComboBox {{
    background: #111820; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 3px; padding: 3px 5px; min-height: 22px;
}}
QDoubleSpinBox:focus, QSpinBox:focus, QComboBox:focus, QLineEdit:focus {{
    border-color: {C_ACCENT};
}}
QDoubleSpinBox::up-button, QSpinBox::up-button {{
    subcontrol-origin: border; subcontrol-position: top right;
    width: 16px; border-left: 1px solid {C_BORDER};
    border-bottom: 1px solid {C_BORDER};
    background: {C_PANEL2}; border-top-right-radius: 3px;
}}
QDoubleSpinBox::down-button, QSpinBox::down-button {{
    subcontrol-origin: border; subcontrol-position: bottom right;
    width: 16px; border-left: 1px solid {C_BORDER};
    background: {C_PANEL2}; border-bottom-right-radius: 3px;
}}
QDoubleSpinBox::up-button:hover, QSpinBox::up-button:hover,
QDoubleSpinBox::down-button:hover, QSpinBox::down-button:hover {{
    background: {C_BLUE};
}}
QDoubleSpinBox::up-button:pressed, QSpinBox::up-button:pressed,
QDoubleSpinBox::down-button:pressed, QSpinBox::down-button:pressed {{
    background: #388bfd;
}}
QPushButton {{
    background: {C_PANEL2}; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 4px; padding: 4px 10px; min-height: 26px;
}}
QPushButton:hover {{ border-color: {C_ACCENT}; background: #26313a; }}
QPushButton:pressed {{ background: {C_BLUE}; }}
QPushButton[primary="true"] {{
    background: {C_BLUE}; color: white; border-color: {C_BLUE};
}}
QPushButton[primary="true"]:hover {{ background: #388bfd; }}
QPushButton[danger="true"] {{
    background: #6e2a2a; color: white; border-color: #a03030;
}}
QPushButton[danger="true"]:hover {{ background: #8a3535; }}
QPushButton[active="true"] {{
    background: {C_BLUE}; color: white; border-color: {C_ACCENT};
}}
QTableWidget {{
    background: {C_PANEL}; color: {C_TEXT};
    border: 1px solid {C_BORDER}; gridline-color: {C_BORDER};
    outline: none;
}}
QTableWidget::item {{ padding: 3px 6px; }}
QTableWidget::item:selected {{ background: {C_BLUE}; color: white; }}
QTableWidget::item:hover {{ background: #1c2128; }}
QHeaderView::section {{
    background: {C_PANEL2}; color: {C_TEXT}; font-weight: bold;
    border: none; border-right: 1px solid {C_BORDER};
    border-bottom: 1px solid {C_BORDER}; padding: 4px 6px;
}}
QTreeWidget {{
    background: {C_PANEL}; color: {C_TEXT};
    border: 1px solid {C_BORDER}; outline: none;
}}
QTreeWidget::item {{ padding: 3px 4px; }}
QTreeWidget::item:selected {{ background: {C_BLUE}; color: white; border-radius: 2px; }}
QTreeWidget::item:hover {{ background: #1c2128; }}
QTreeWidget QHeaderView::section {{
    background: {C_PANEL2}; color: {C_TEXT}; font-weight: bold;
    border: none; border-right: 1px solid {C_BORDER};
    border-bottom: 1px solid {C_BORDER}; padding: 4px 6px;
}}
QScrollBar:vertical {{
    background: {C_PANEL}; width: 6px; border-radius: 3px;
}}
QScrollBar::handle:vertical {{
    background: {C_BORDER}; border-radius: 3px; min-height: 20px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0px; }}
QScrollBar:horizontal {{
    background: {C_PANEL}; height: 6px; border-radius: 3px;
}}
QScrollBar::handle:horizontal {{
    background: {C_BORDER}; border-radius: 3px; min-width: 20px;
}}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0px; }}
QTabWidget::pane {{
    border: 1px solid {C_BORDER}; background: {C_BG};
}}
QTabBar::tab {{
    background: {C_PANEL2}; color: {C_DIM};
    border: 1px solid {C_BORDER}; border-bottom: none;
    padding: 6px 16px; margin-right: 2px;
}}
QTabBar::tab:selected {{ background: {C_BG}; color: {C_TEXT}; }}
QTabBar::tab:hover {{ color: {C_TEXT}; }}
QSplitter::handle {{ background: {C_BORDER}; width: 1px; }}
QCheckBox {{ color: {C_TEXT}; spacing: 5px; }}
QCheckBox::indicator {{
    width: 14px; height: 14px; border: 1px solid {C_BORDER};
    border-radius: 2px; background: #111820;
}}
QCheckBox::indicator:checked {{
    background: {C_BLUE}; border-color: {C_BLUE};
}}
QRadioButton {{ color: {C_TEXT}; spacing: 5px; }}
QRadioButton::indicator {{
    width: 14px; height: 14px; border: 1px solid {C_BORDER};
    border-radius: 7px; background: #111820;
}}
QRadioButton::indicator:checked {{
    background: {C_BLUE}; border-color: {C_BLUE};
}}
QFrame[frameShape="4"] {{ background: {C_BORDER}; max-height: 1px; border: none; }}
QListWidget {{
    background: {C_PANEL}; color: {C_TEXT}; border: 1px solid {C_BORDER};
    outline: none;
}}
QListWidget::item {{ padding: 4px 8px; }}
QListWidget::item:selected {{ background: {C_BLUE}; color: white; }}
QListWidget::item:hover {{ background: #1c2128; }}
"""

PART_COLORS = [
    "#2d6a4f", "#1d3557", "#6d3b47", "#5c4033", "#4a4e69",
    "#2b6cb0", "#276749", "#744210", "#553c9a", "#1a535c",
]

STANDARD_SHEET_SIZES = [
    ("2440 x 1220 mm", 2440.0, 1220.0),
    ("2440 x 610 mm",  2440.0,  610.0),
    ("1220 x 610 mm",  1220.0,  610.0),
    ("1830 x 915 mm",  1830.0,  915.0),
]

RIBBON_BTN_STYLE = f"""
QPushButton {{
    background: {C_PANEL2}; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 3px; padding: 2px 6px;
    font-size: 11px;
}}
QPushButton:hover {{ border-color: {C_ACCENT}; background: #26313a; }}
QPushButton:pressed {{ background: {C_BLUE}; }}
QPushButton[primary="true"] {{
    background: {C_BLUE}; color: white; border-color: {C_BLUE};
}}
QPushButton[primary="true"]:hover {{ background: #388bfd; }}
QPushButton[danger="true"] {{
    background: #6e2a2a; color: white; border-color: #a03030;
}}
QPushButton[danger="true"]:hover {{ background: #8a3535; }}
QPushButton[active="true"] {{
    background: {C_BLUE}; color: white; border-color: {C_ACCENT};
}}
"""

# ---------------------------------------------------------------------------
# No-scroll input widgets
# ---------------------------------------------------------------------------

class _NoScrollSpin(QDoubleSpinBox):
    def wheelEvent(self, e):
        e.ignore()


class _NoScrollISpin(QSpinBox):
    def wheelEvent(self, e):
        e.ignore()


class _NoScrollCombo(QComboBox):
    def wheelEvent(self, e):
        e.ignore()


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class NestPart:
    id: str = ""
    name: str = "Part"
    width: float = 100.0
    height: float = 100.0
    quantity: int = 1
    rotation: str = "90"   # "0","90","180","Any"
    tilt: float = 0.0
    mirror: bool = False
    priority: str = "Normal"


@dataclass
class NestSheet:
    id: str = ""
    name: str = "Sheet"
    width: float = 2440.0
    height: float = 1220.0
    quantity: int = 1
    priority: str = "Normal"


@dataclass
class PlacedRect:
    part: NestPart
    x: float
    y: float
    w: float
    h: float
    rotated: bool
    sheet_idx: int


@dataclass
class NestLayout:
    sheet: NestSheet
    placed: List[PlacedRect]
    utilization: float
    repeat_count: int = 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sep_v() -> QFrame:
    """Vertical separator line for toolbars."""
    f = QFrame()
    f.setFrameShape(QFrame.Shape.VLine)
    f.setFixedWidth(1)
    f.setStyleSheet(f"background:{C_BORDER}; border:none;")
    f.setFixedHeight(48)
    return f


def _sep_h() -> QFrame:
    """Horizontal separator line."""
    f = QFrame()
    f.setFrameShape(QFrame.Shape.HLine)
    f.setStyleSheet(f"background:{C_BORDER}; max-height:1px; border:none;")
    return f


def _dim_fmt(v: float) -> str:
    """Format dimension: integer if whole number, else 1 decimal."""
    return str(int(v)) if v == int(v) else f"{v:.1f}"


# ---------------------------------------------------------------------------
# Ribbon toolbar builder helpers
# ---------------------------------------------------------------------------

def _tb_btn(text: str, tip: str = "", wide: bool = False) -> QPushButton:
    """Create a ribbon-style toolbar button (tall, icon+label style)."""
    b = QPushButton(text)
    b.setToolTip(tip)
    b.setFixedHeight(52)
    b.setMinimumWidth(80 if wide else 52)
    b.setStyleSheet(RIBBON_BTN_STYLE)
    return b


def _tb_group(label: str, buttons: list) -> QWidget:
    """Create a labelled group of buttons separated by a vertical line."""
    container = QWidget()
    container.setStyleSheet("background: transparent;")
    vl = QVBoxLayout(container)
    vl.setContentsMargins(4, 0, 4, 0)
    vl.setSpacing(0)

    btn_row = QHBoxLayout()
    btn_row.setSpacing(2)
    btn_row.setContentsMargins(0, 0, 0, 0)
    for w in buttons:
        btn_row.addWidget(w)
    vl.addLayout(btn_row)

    lbl = QLabel(label)
    lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lbl.setStyleSheet(f"color:{C_DIM}; font-size:9px; padding:1px 0 0 0;")
    vl.addWidget(lbl)

    return container


class _RibbonBar(QWidget):
    """Ribbon-style toolbar container that holds groups."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(68)
        self.setStyleSheet(
            f"background:{C_PANEL2}; border-bottom:1px solid {C_BORDER};"
        )
        self._layout = QHBoxLayout(self)
        self._layout.setContentsMargins(4, 4, 4, 4)
        self._layout.setSpacing(0)

    def add_group(self, label: str, buttons: list):
        if self._layout.count() > 0:
            sep = QFrame()
            sep.setFrameShape(QFrame.Shape.VLine)
            sep.setFixedWidth(1)
            sep.setFixedHeight(56)
            sep.setStyleSheet(f"background:{C_BORDER}; border:none;")
            self._layout.addWidget(sep)
        grp = _tb_group(label, buttons)
        self._layout.addWidget(grp)

    def add_stretch(self):
        self._layout.addStretch()


# ---------------------------------------------------------------------------
# Guillotine Nester algorithm
# ---------------------------------------------------------------------------

class GuillotineNester:
    def nest(
        self,
        parts: List[NestPart],
        sheets: List[NestSheet],
        part_spacing: float = 5.0,
        edge_spacing: Tuple = (5, 5, 5, 5),
        rotation: str = "90",
        mirror: bool = False,
    ) -> List[NestLayout]:
        expanded: List[NestPart] = []
        for p in parts:
            for _ in range(max(1, p.quantity)):
                expanded.append(p)
        expanded.sort(key=lambda p: p.width * p.height, reverse=True)

        layouts: List[NestLayout] = []
        remaining = list(expanded)
        et, el, er, eb = edge_spacing

        for sheet in sheets:
            for _sq in range(max(1, sheet.quantity)):
                if not remaining:
                    break
                uw = sheet.width  - el - er
                uh = sheet.height - et - eb
                if uw <= 0 or uh <= 0:
                    continue

                free: List[Tuple[float, float, float, float]] = [
                    (el, eb, uw, uh)
                ]
                placed: List[PlacedRect] = []
                still_remaining: List[NestPart] = []

                for part in remaining:
                    sp = part_spacing
                    pw = part.width  + sp
                    ph = part.height + sp
                    result = self._best_fit(pw, ph, free, rotation)
                    if result is None:
                        still_remaining.append(part)
                        continue
                    rect_idx, rotated, _ = result
                    fx, fy, fw, fh = free[rect_idx]
                    actual_w = ph if rotated else pw
                    actual_h = pw if rotated else ph
                    placed.append(PlacedRect(
                        part=part,
                        x=fx, y=fy,
                        w=actual_w - sp,
                        h=actual_h - sp,
                        rotated=rotated,
                        sheet_idx=len(layouts),
                    ))
                    new_free = self._guillotine_split(
                        fx, fy, fw, fh, actual_w, actual_h, sp
                    )
                    free.pop(rect_idx)
                    free.extend(new_free)

                if placed:
                    placed_area = sum(r.w * r.h for r in placed)
                    sheet_area  = sheet.width * sheet.height
                    util = (placed_area / sheet_area * 100.0) if sheet_area else 0.0
                    layouts.append(
                        NestLayout(sheet=sheet, placed=placed, utilization=util)
                    )
                remaining = still_remaining
                if not remaining:
                    break

        return layouts

    def _best_fit(
        self,
        pw: float,
        ph: float,
        free: List[Tuple[float, float, float, float]],
        rotation: str,
    ) -> Optional[Tuple[int, bool, float]]:
        best_score = float("inf")
        best_idx   = -1
        best_rot   = False

        orientations = [(pw, ph, False)]
        if rotation in ("90", "Any") and abs(pw - ph) > 0.001:
            orientations.append((ph, pw, True))

        for fw_try, fh_try, rot_flag in orientations:
            for i, (_, _, rw, rh) in enumerate(free):
                if fw_try <= rw and fh_try <= rh:
                    short_leftover = min(rw - fw_try, rh - fh_try)
                    score = short_leftover
                    if score < best_score:
                        best_score = score
                        best_idx   = i
                        best_rot   = rot_flag

        if best_idx == -1:
            return None
        return best_idx, best_rot, best_score

    @staticmethod
    def _guillotine_split(
        fx: float, fy: float, fw: float, fh: float,
        uw: float, uh: float, spacing: float = 0.0,
    ) -> List[Tuple[float, float, float, float]]:
        result = []
        right_w = fw - uw
        top_h   = fh - uh
        if right_w > 1 and fh > 1:
            result.append((fx + uw, fy, right_w, fh))
        if top_h > 1 and uw > 1:
            result.append((fx, fy + uh, uw, top_h))
        return result


# ---------------------------------------------------------------------------
# NestCanvas — drawing widget
# ---------------------------------------------------------------------------

class NestCanvas(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.layout_data: Optional[NestLayout] = None
        self.setMinimumSize(300, 200)
        self.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding
        )

    def set_layout(self, layout: Optional[NestLayout]):
        self.layout_data = layout
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        w = self.width()
        h = self.height()

        painter.fillRect(0, 0, w, h, QColor(C_PANEL2))

        if self.layout_data is None:
            painter.setPen(QColor(C_DIM))
            painter.setFont(QFont("Segoe UI", 11))
            painter.drawText(
                self.rect(),
                Qt.AlignmentFlag.AlignCenter,
                "No nesting result selected",
            )
            return

        sheet  = self.layout_data.sheet
        placed = self.layout_data.placed
        margin = 28
        sw = sheet.width
        sh = sheet.height

        scale = min((w - margin * 2) / sw, (h - margin * 2 - 20) / sh)
        ox = (w - sw * scale) / 2
        oy = margin

        # Grid lines (100mm spacing)
        painter.setPen(QPen(QColor(40, 50, 60), 1))
        grid_step = 100.0
        gx = 0.0
        while gx <= sw:
            x = ox + gx * scale
            painter.drawLine(int(x), int(oy), int(x), int(oy + sh * scale))
            gx += grid_step
        gy = 0.0
        while gy <= sh:
            y = oy + gy * scale
            painter.drawLine(int(ox), int(y), int(ox + sw * scale), int(y))
            gy += grid_step

        # Sheet background
        painter.setBrush(QColor(C_BG))
        painter.setPen(QPen(QColor(C_ACCENT), 2))
        painter.drawRect(QRectF(ox, oy, sw * scale, sh * scale))

        # Placed parts
        for idx, rect in enumerate(placed):
            color = QColor(PART_COLORS[idx % len(PART_COLORS)])
            rx = ox + rect.x * scale
            ry = oy + (sh - rect.y - rect.h) * scale
            rw = rect.w * scale
            rh = rect.h * scale
            painter.setBrush(QBrush(color))
            painter.setPen(QPen(QColor("#000000"), 1))
            painter.drawRect(QRectF(rx, ry, rw, rh))
            if rw > 30 and rh > 14:
                painter.setPen(QColor(C_TEXT))
                f = QFont("Segoe UI", 7)
                painter.setFont(f)
                painter.drawText(
                    QRectF(rx + 2, ry + 2, rw - 4, rh - 4),
                    Qt.AlignmentFlag.AlignCenter,
                    rect.part.name,
                )

        # Repeat watermark
        if self.layout_data.repeat_count > 1:
            painter.setPen(QColor(C_DIM))
            big = QFont("Segoe UI", 36)
            big.setBold(True)
            painter.setFont(big)
            painter.setOpacity(0.18)
            painter.drawText(
                self.rect(),
                Qt.AlignmentFlag.AlignCenter,
                f"x{self.layout_data.repeat_count}",
            )
            painter.setOpacity(1.0)

        # Sheet info below
        info = (
            f"{sheet.name}  "
            f"{sheet.width:.0f} x {sheet.height:.0f} mm  "
            f"Util: {self.layout_data.utilization:.1f}%"
        )
        painter.setPen(QColor(C_DIM))
        painter.setFont(QFont("Segoe UI", 9))
        painter.drawText(
            QRectF(ox, oy + sh * scale + 4, sw * scale, 18),
            Qt.AlignmentFlag.AlignCenter,
            info,
        )


# ---------------------------------------------------------------------------
# PartThumb — small inline preview widget for table cells
# ---------------------------------------------------------------------------

class PartThumb(QWidget):
    """Draws a proportional scaled rectangle for a part's preview."""

    def __init__(self, width: float, height: float, parent=None):
        super().__init__(parent)
        self._pw = width
        self._ph = height
        self.setFixedSize(80, 24)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        W = self.width()
        H = self.height()
        painter.fillRect(0, 0, W, H, QColor(C_PANEL))

        margin = 3
        pw, ph = self._pw, self._ph
        if pw <= 0 or ph <= 0:
            return

        aspect = pw / ph
        avail_w = W - margin * 2
        avail_h = H - margin * 2

        if aspect >= avail_w / avail_h:
            rw = avail_w
            rh = max(4, int(rw / aspect))
        else:
            rh = avail_h
            rw = max(4, int(rh * aspect))

        rx = (W - rw) // 2
        ry = (H - rh) // 2

        painter.setBrush(QBrush(QColor("#2b4a72")))
        painter.setPen(QPen(QColor(C_ACCENT), 1))
        painter.drawRect(rx, ry, rw, rh)


# ---------------------------------------------------------------------------
# _PartDialog — edit/add part dialog
# ---------------------------------------------------------------------------

class _PartDialog(QDialog):
    def __init__(self, parent=None, part: Optional[NestPart] = None):
        super().__init__(parent)
        self.setWindowTitle("Edit Part" if part else "Add Part")
        self.setMinimumWidth(340)
        self.setStyleSheet(DIALOG_STYLE)

        layout = QVBoxLayout(self)
        form   = QFormLayout()
        form.setSpacing(8)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._name = QLineEdit(part.name if part else "Part")
        self._w    = _NoScrollSpin()
        self._w.setRange(1, 99999)
        self._w.setDecimals(2)
        self._w.setSuffix(" mm")

        self._h    = _NoScrollSpin()
        self._h.setRange(1, 99999)
        self._h.setDecimals(2)
        self._h.setSuffix(" mm")

        self._qty  = _NoScrollISpin()
        self._qty.setRange(1, 9999)

        self._rot  = _NoScrollCombo()
        self._rot.addItems(["0", "90", "180", "Any"])

        self._tilt = _NoScrollSpin()
        self._tilt.setRange(0.0, 45.0)
        self._tilt.setDecimals(1)
        self._tilt.setSuffix(" °")

        self._mir  = QCheckBox("Allow Mirror")

        self._pri  = _NoScrollCombo()
        self._pri.addItems(["Highest", "High", "Normal", "Low", "Lowest"])

        if part:
            self._w.setValue(part.width)
            self._h.setValue(part.height)
            self._qty.setValue(part.quantity)
            self._tilt.setValue(part.tilt)
            idx = self._rot.findText(part.rotation)
            if idx >= 0:
                self._rot.setCurrentIndex(idx)
            self._mir.setChecked(part.mirror)
            idx2 = self._pri.findText(part.priority)
            if idx2 >= 0:
                self._pri.setCurrentIndex(idx2)
        else:
            self._w.setValue(100.0)
            self._h.setValue(100.0)
            self._qty.setValue(1)
            self._rot.setCurrentIndex(1)
            self._pri.setCurrentIndex(2)

        form.addRow("Name:", self._name)
        form.addRow("Width (Dim X):", self._w)
        form.addRow("Height (Dim Y):", self._h)
        form.addRow("Quantity:", self._qty)
        form.addRow("Allowed Rotation:", self._rot)
        form.addRow("Tilt (+/-):", self._tilt)
        form.addRow("", self._mir)
        form.addRow("Priority:", self._pri)

        layout.addLayout(form)
        btns = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel
        )
        btns.accepted.connect(self.accept)
        btns.rejected.connect(self.reject)
        layout.addWidget(btns)

    def get_part(self) -> NestPart:
        return NestPart(
            id=str(uuid.uuid4()),
            name=self._name.text().strip() or "Part",
            width=self._w.value(),
            height=self._h.value(),
            quantity=self._qty.value(),
            rotation=self._rot.currentText(),
            tilt=self._tilt.value(),
            mirror=self._mir.isChecked(),
            priority=self._pri.currentText(),
        )


# ---------------------------------------------------------------------------
# _SheetDialog — create/edit sheet dialog
# ---------------------------------------------------------------------------

class _SheetDialog(QDialog):
    def __init__(self, parent=None, sheet: Optional[NestSheet] = None):
        super().__init__(parent)
        self.setWindowTitle("Edit Sheet" if sheet else "Create Sheet")
        self.setMinimumWidth(400)
        self.setStyleSheet(DIALOG_STYLE)

        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        std_lbl = QLabel("Choose Standard Sheet Size:")
        std_lbl.setStyleSheet(f"color:{C_DIM}; font-size:11px;")
        layout.addWidget(std_lbl)

        self._std_list = QListWidget()
        self._std_list.setMaximumHeight(110)
        for label, _, _ in STANDARD_SHEET_SIZES:
            self._std_list.addItem(label)
        self._std_list.itemClicked.connect(self._apply_standard)
        layout.addWidget(self._std_list)

        sep = _sep_h()
        layout.addWidget(sep)

        cust_lbl = QLabel("Custom Sheet Size:")
        cust_lbl.setStyleSheet(f"color:{C_DIM}; font-size:11px;")
        layout.addWidget(cust_lbl)

        form = QFormLayout()
        form.setSpacing(8)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._name = QLineEdit(sheet.name if sheet else "Sheet")

        self._sw   = _NoScrollSpin()
        self._sw.setRange(1, 99999)
        self._sw.setDecimals(2)
        self._sw.setSuffix(" mm")

        self._sh   = _NoScrollSpin()
        self._sh.setRange(1, 99999)
        self._sh.setDecimals(2)
        self._sh.setSuffix(" mm")

        self._qty  = _NoScrollISpin()
        self._qty.setRange(1, 9999)

        self._pri  = _NoScrollCombo()
        self._pri.addItems(["Highest", "High", "Normal", "Low", "Lowest"])

        if sheet:
            self._sw.setValue(sheet.width)
            self._sh.setValue(sheet.height)
            self._qty.setValue(sheet.quantity)
            idx = self._pri.findText(sheet.priority)
            if idx >= 0:
                self._pri.setCurrentIndex(idx)
        else:
            self._sw.setValue(2440.0)
            self._sh.setValue(1220.0)
            self._qty.setValue(1)
            self._pri.setCurrentIndex(2)

        form.addRow("Name:", self._name)
        form.addRow("X Dim (Length):", self._sw)
        form.addRow("Y Dim (Width):", self._sh)
        form.addRow("Quantity:", self._qty)
        form.addRow("Priority:", self._pri)
        layout.addLayout(form)

        btns = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel
        )
        btns.accepted.connect(self.accept)
        btns.rejected.connect(self.reject)
        layout.addWidget(btns)

    def _apply_standard(self, item: QListWidgetItem):
        row = self._std_list.row(item)
        if 0 <= row < len(STANDARD_SHEET_SIZES):
            label, sw, sh = STANDARD_SHEET_SIZES[row]
            self._sw.setValue(sw)
            self._sh.setValue(sh)
            self._name.setText(f"{int(sw)}x{int(sh)}")

    def get_sheet(self) -> NestSheet:
        return NestSheet(
            id=str(uuid.uuid4()),
            name=self._name.text().strip() or "Sheet",
            width=self._sw.value(),
            height=self._sh.value(),
            quantity=self._qty.value(),
            priority=self._pri.currentText(),
        )


# ---------------------------------------------------------------------------
# _PartsStatPanel — statistics panel shown to the right of the parts table
# ---------------------------------------------------------------------------

class _PartsStatPanel(QWidget):
    """Right-side statistics panel for the Parts tab."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedWidth(220)
        self.setStyleSheet(f"background:{C_PANEL2}; border-left:1px solid {C_BORDER};")

        vl = QVBoxLayout(self)
        vl.setContentsMargins(0, 0, 0, 0)
        vl.setSpacing(0)

        # Empty preview placeholder
        self._preview = QWidget()
        self._preview.setFixedHeight(300)
        self._preview.setStyleSheet(f"background:{C_PANEL2};")
        preview_lbl = QLabel("Preview")
        preview_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        preview_lbl.setStyleSheet(f"color:{C_DIM}; font-size:11px;")
        pl = QVBoxLayout(self._preview)
        pl.addStretch()
        pl.addWidget(preview_lbl)
        pl.addStretch()
        vl.addWidget(self._preview)

        # Divider
        div = QFrame()
        div.setFrameShape(QFrame.Shape.HLine)
        div.setStyleSheet(f"background:{C_BORDER}; max-height:1px; border:none;")
        vl.addWidget(div)

        # Stats table
        self._tbl = QTableWidget(3, 3)
        self._tbl.setHorizontalHeaderLabels(["Statistic", "Unique", "Total"])
        self._tbl.verticalHeader().setVisible(False)
        self._tbl.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self._tbl.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self._tbl.setAlternatingRowColors(False)
        self._tbl.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Stretch
        )
        self._tbl.setStyleSheet(
            f"background:{C_PANEL2}; border:none; gridline-color:{C_BORDER};"
        )
        self._tbl.setShowGrid(True)

        stats_data = [("Parts", "0", "0"), ("Instances", "0", "0"), ("Area (m²)", "0.00", "0.00")]
        for row, (stat, uniq, total) in enumerate(stats_data):
            for col, val in enumerate((stat, uniq, total)):
                item = QTableWidgetItem(val)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self._tbl.setItem(row, col, item)

        vl.addWidget(self._tbl)
        vl.addStretch()

    def update_stats(self, parts: List[NestPart]):
        unique_count = len(parts)
        total_count  = sum(p.quantity for p in parts)
        area_unique  = sum(p.width * p.height for p in parts) / 1e6
        area_total   = sum(p.width * p.height * p.quantity for p in parts) / 1e6

        rows_data = [
            ("Parts",      str(unique_count), str(total_count)),
            ("Instances",  str(unique_count), str(total_count)),
            ("Area (m²)",  f"{area_unique:.3f}", f"{area_total:.3f}"),
        ]
        for row, (stat, uniq, total) in enumerate(rows_data):
            for col, val in enumerate((stat, uniq, total)):
                item = self._tbl.item(row, col)
                if item:
                    item.setText(val)


# ---------------------------------------------------------------------------
# _PartsTab
# ---------------------------------------------------------------------------

class _PartsTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._parts: List[NestPart] = []
        self._detailed_mode = False
        self._build()

    # ------------------------------------------------------------------
    # Build UI
    # ------------------------------------------------------------------

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(0, 0, 0, 0)
        vlay.setSpacing(0)

        # Ribbon toolbar
        ribbon = _RibbonBar(self)

        self._btn_toggle = _tb_btn("Switch To\nDetailed Grid", "Toggle standard/detailed columns", wide=True)
        self._btn_toggle.setProperty("active", "false")
        self._btn_toggle.clicked.connect(self._toggle_mode)

        self._btn_se   = _tb_btn("Solid\nEdge",   "Import from Solid Edge")
        self._btn_dxf  = _tb_btn("DXF/DWG",       "Import DXF/DWG files")
        self._btn_csv  = _tb_btn("CSV",            "Import from CSV")
        self._btn_shp  = _tb_btn("Shapes",         "Add basic shapes")

        self._btn_edit  = _tb_btn("Edit\nQty",   "Edit selected part quantity")
        self._btn_del   = _tb_btn("Remove",       "Remove selected parts")
        self._btn_del.setProperty("danger", "true")
        self._btn_clone = _tb_btn("Clone",        "Clone selected part")
        self._btn_rot   = _tb_btn("Rotate/\nMirror", "Toggle rotation/mirror")
        self._btn_mul   = _tb_btn("Multiply\nQty",   "Multiply quantity")

        self._btn_csvd  = _tb_btn("CSV Part\nData", "Export CSV part data")
        self._btn_pdxf  = _tb_btn("Part\nDXFs",     "Export Part DXFs")

        ribbon.add_group("View", [self._btn_toggle])
        ribbon.add_group("Import Parts", [self._btn_se, self._btn_dxf, self._btn_csv, self._btn_shp])
        ribbon.add_group("Edit Selected Parts", [
            self._btn_edit, self._btn_del, self._btn_clone,
            self._btn_rot, self._btn_mul,
        ])
        ribbon.add_group("Export", [self._btn_csvd, self._btn_pdxf])
        ribbon.add_stretch()

        # "Add Part" quick button in the ribbon area (not a group, floats right)
        self._btn_add = QPushButton("＋  Add Part")
        self._btn_add.setProperty("primary", "true")
        self._btn_add.setFixedHeight(52)
        self._btn_add.setMinimumWidth(90)
        self._btn_add.setStyleSheet(RIBBON_BTN_STYLE)
        ribbon._layout.addWidget(self._btn_add)
        ribbon._layout.addSpacing(8)

        vlay.addWidget(ribbon)

        # Main content: table + stats panel
        content = QHBoxLayout()
        content.setContentsMargins(0, 0, 0, 0)
        content.setSpacing(0)

        # Table
        self._table = QTableWidget(0, 5)
        self._std_headers   = ["Name", "Dim X", "Dim Y", "Quantity", "Preview"]
        self._det_headers   = [
            "Name", "Dim X", "Dim Y", "Quantity",
            "Allowed Rotation", "Tilt", "Mirror", "Priority", "Preview",
        ]
        self._table.setHorizontalHeaderLabels(self._std_headers)
        self._table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Stretch
        )
        for c in range(1, 5):
            self._table.horizontalHeader().setSectionResizeMode(
                c, QHeaderView.ResizeMode.ResizeToContents
            )
        self._table.verticalHeader().setVisible(False)
        self._table.verticalHeader().setDefaultSectionSize(26)
        self._table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self._table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self._table.setAlternatingRowColors(False)
        self._table.doubleClicked.connect(self._on_edit)
        content.addWidget(self._table, 1)

        # Stats panel
        self._stat_panel = _PartsStatPanel(self)
        content.addWidget(self._stat_panel)

        vlay.addLayout(content, 1)

        # Bottom status bar
        self._lbl_status = QLabel(
            "Unique Parts = 0    Total for Nesting = 0"
        )
        self._lbl_status.setStyleSheet(
            f"color:{C_DIM}; font-size:11px; padding:4px 8px;"
            f"background:{C_PANEL2}; border-top:1px solid {C_BORDER};"
        )
        vlay.addWidget(self._lbl_status)

        # Connections
        self._btn_add.clicked.connect(self._on_add)
        self._btn_edit.clicked.connect(self._on_edit)
        self._btn_clone.clicked.connect(self._on_clone)
        self._btn_del.clicked.connect(self._on_remove)
        self._btn_rot.clicked.connect(self._on_rot_toggle)
        self._btn_mul.clicked.connect(self._on_multiply)

    # ------------------------------------------------------------------
    # Toggle standard / detailed mode
    # ------------------------------------------------------------------

    def _toggle_mode(self):
        self._detailed_mode = not self._detailed_mode
        if self._detailed_mode:
            self._btn_toggle.setText("Switch To\nStandard Grid")
            self._btn_toggle.setProperty("active", "true")
            cols = len(self._det_headers)
            self._table.setColumnCount(cols)
            self._table.setHorizontalHeaderLabels(self._det_headers)
            self._table.horizontalHeader().setSectionResizeMode(
                0, QHeaderView.ResizeMode.Stretch
            )
            for c in range(1, cols):
                self._table.horizontalHeader().setSectionResizeMode(
                    c, QHeaderView.ResizeMode.ResizeToContents
                )
        else:
            self._btn_toggle.setText("Switch To\nDetailed Grid")
            self._btn_toggle.setProperty("active", "false")
            cols = len(self._std_headers)
            self._table.setColumnCount(cols)
            self._table.setHorizontalHeaderLabels(self._std_headers)
            self._table.horizontalHeader().setSectionResizeMode(
                0, QHeaderView.ResizeMode.Stretch
            )
            for c in range(1, cols):
                self._table.horizontalHeader().setSectionResizeMode(
                    c, QHeaderView.ResizeMode.ResizeToContents
                )
        # Re-style the button (force property refresh)
        self._btn_toggle.style().unpolish(self._btn_toggle)
        self._btn_toggle.style().polish(self._btn_toggle)
        self._refresh_table()

    # ------------------------------------------------------------------
    # Table population
    # ------------------------------------------------------------------

    def _refresh_table(self):
        self._table.setRowCount(0)
        if self._detailed_mode:
            self._fill_detailed()
        else:
            self._fill_standard()
        self._update_stats()

    def _fill_standard(self):
        """Columns: Name | Dim X | Dim Y | Quantity | Preview"""
        for part in self._parts:
            r = self._table.rowCount()
            self._table.insertRow(r)
            self._table.setRowHeight(r, 26)
            self._table.setItem(r, 0, _tc(part.name, Qt.AlignmentFlag.AlignLeft))
            self._table.setItem(r, 1, _tc(_dim_fmt(part.width)))
            self._table.setItem(r, 2, _tc(_dim_fmt(part.height)))
            self._table.setItem(r, 3, _tc(str(part.quantity)))
            thumb = PartThumb(part.width, part.height)
            self._table.setCellWidget(r, 4, thumb)

    def _fill_detailed(self):
        """Columns: Name | Dim X | Dim Y | Quantity | Allowed Rotation | Tilt | Mirror | Priority | Preview"""
        for part in self._parts:
            r = self._table.rowCount()
            self._table.insertRow(r)
            self._table.setRowHeight(r, 26)
            self._table.setItem(r, 0, _tc(part.name, Qt.AlignmentFlag.AlignLeft))
            self._table.setItem(r, 1, _tc(_dim_fmt(part.width)))
            self._table.setItem(r, 2, _tc(_dim_fmt(part.height)))
            self._table.setItem(r, 3, _tc(str(part.quantity)))
            self._table.setItem(r, 4, _tc(part.rotation))
            self._table.setItem(r, 5, _tc(f"{part.tilt:.1f}"))
            self._table.setItem(r, 6, _tc("Yes" if part.mirror else "No"))
            self._table.setItem(r, 7, _tc(part.priority))
            thumb = PartThumb(part.width, part.height)
            self._table.setCellWidget(r, 8, thumb)

    def _update_stats(self):
        unique = len(self._parts)
        total  = sum(p.quantity for p in self._parts)
        self._lbl_status.setText(
            f"Unique Parts = {unique}    Total for Nesting = {total}"
        )
        self._stat_panel.update_stats(self._parts)

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def _on_add(self):
        dlg = _PartDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._parts.append(dlg.get_part())
            self._refresh_table()

    def _on_edit(self):
        row = self._table.currentRow()
        if 0 <= row < len(self._parts):
            dlg = _PartDialog(self, self._parts[row])
            if dlg.exec() == QDialog.DialogCode.Accepted:
                updated = dlg.get_part()
                updated.id = self._parts[row].id
                self._parts[row] = updated
                self._refresh_table()

    def _on_clone(self):
        row = self._table.currentRow()
        if 0 <= row < len(self._parts):
            p = copy.deepcopy(self._parts[row])
            p.id   = str(uuid.uuid4())
            p.name = p.name + " (copy)"
            self._parts.insert(row + 1, p)
            self._refresh_table()

    def _on_remove(self):
        rows = sorted(
            {i.row() for i in self._table.selectedItems()}, reverse=True
        )
        for r in rows:
            if 0 <= r < len(self._parts):
                self._parts.pop(r)
        self._refresh_table()

    def _on_rot_toggle(self):
        row = self._table.currentRow()
        if 0 <= row < len(self._parts):
            opts = ["0", "90", "180", "Any"]
            cur  = self._parts[row].rotation
            idx  = opts.index(cur) if cur in opts else 1
            self._parts[row].rotation = opts[(idx + 1) % len(opts)]
            self._refresh_table()

    def _on_multiply(self):
        row = self._table.currentRow()
        if 0 <= row < len(self._parts):
            dlg = QDialog(self)
            dlg.setWindowTitle("Multiply Quantity")
            dlg.setStyleSheet(DIALOG_STYLE)
            vl = QVBoxLayout(dlg)
            fl = QFormLayout()
            spin = _NoScrollISpin()
            spin.setRange(1, 100)
            spin.setValue(2)
            fl.addRow("Multiply by:", spin)
            vl.addLayout(fl)
            btns = QDialogButtonBox(
                QDialogButtonBox.StandardButton.Ok
                | QDialogButtonBox.StandardButton.Cancel
            )
            btns.accepted.connect(dlg.accept)
            btns.rejected.connect(dlg.reject)
            vl.addWidget(btns)
            if dlg.exec() == QDialog.DialogCode.Accepted:
                self._parts[row].quantity *= spin.value()
                self._refresh_table()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_parts(self) -> List[NestPart]:
        return list(self._parts)

    def set_parts(self, parts: List[NestPart]):
        self._parts = list(parts)
        self._refresh_table()


# ---------------------------------------------------------------------------
# _SheetsTab
# ---------------------------------------------------------------------------

class _SheetsTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._sheets: List[NestSheet] = []
        self._build()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(0, 0, 0, 0)
        vlay.setSpacing(0)

        # Ribbon toolbar
        ribbon = _RibbonBar(self)

        self._btn_add  = _tb_btn("Create\nSheet", "Create a new sheet", wide=True)
        self._btn_add.setProperty("primary", "true")
        self._btn_dxf  = _tb_btn("DXF/DWG", "Import sheet from DXF/DWG")
        self._btn_edit = _tb_btn("Edit\nSheet", "Edit selected sheet")
        self._btn_del  = _tb_btn("Remove\nSelected", "Remove selected sheets")
        self._btn_del.setProperty("danger", "true")

        ribbon.add_group("Create", [self._btn_add, self._btn_dxf])
        ribbon.add_group("Edit Selected Sheets", [self._btn_edit, self._btn_del])
        ribbon.add_stretch()

        vlay.addWidget(ribbon)

        # Table: Name | X Dim | Y Dim | Quantity | Priority | Preview
        self._table = QTableWidget(0, 6)
        self._table.setHorizontalHeaderLabels(
            ["Name", "X Dim", "Y Dim", "Quantity", "Priority", "Preview"]
        )
        self._table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Stretch
        )
        for c in range(1, 6):
            self._table.horizontalHeader().setSectionResizeMode(
                c, QHeaderView.ResizeMode.ResizeToContents
            )
        self._table.verticalHeader().setVisible(False)
        self._table.verticalHeader().setDefaultSectionSize(36)
        self._table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self._table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self._table.setAlternatingRowColors(False)
        self._table.doubleClicked.connect(self._on_edit)
        vlay.addWidget(self._table, 1)

        # Connections
        self._btn_add.clicked.connect(self._on_add)
        self._btn_edit.clicked.connect(self._on_edit)
        self._btn_del.clicked.connect(self._on_remove)

    def _refresh_table(self):
        self._table.setRowCount(0)
        for sheet in self._sheets:
            r = self._table.rowCount()
            self._table.insertRow(r)
            self._table.setRowHeight(r, 36)
            self._table.setItem(r, 0, _tc(sheet.name, Qt.AlignmentFlag.AlignLeft))
            self._table.setItem(r, 1, _tc(_dim_fmt(sheet.width)))
            self._table.setItem(r, 2, _tc(_dim_fmt(sheet.height)))
            self._table.setItem(r, 3, _tc(str(sheet.quantity)))

            # Priority column: inline combo
            cmb = _NoScrollCombo()
            cmb.addItems(["Highest", "High", "Normal", "Low", "Lowest"])
            idx = cmb.findText(sheet.priority)
            if idx >= 0:
                cmb.setCurrentIndex(idx)
            cmb.setStyleSheet(
                f"background:#111820; color:{C_TEXT}; border:none; padding:2px 4px;"
            )
            _r = r  # capture for lambda
            def _make_pri_handler(row):
                def _h(text):
                    if 0 <= row < len(self._sheets):
                        self._sheets[row].priority = text
                return _h
            cmb.currentTextChanged.connect(_make_pri_handler(r))
            self._table.setCellWidget(r, 4, cmb)

            # Preview cell
            thumb = _SheetThumb(sheet.width, sheet.height)
            self._table.setCellWidget(r, 5, thumb)

    def _on_add(self):
        dlg = _SheetDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._sheets.append(dlg.get_sheet())
            self._refresh_table()

    def _on_edit(self):
        row = self._table.currentRow()
        if 0 <= row < len(self._sheets):
            dlg = _SheetDialog(self, self._sheets[row])
            if dlg.exec() == QDialog.DialogCode.Accepted:
                updated = dlg.get_sheet()
                updated.id = self._sheets[row].id
                self._sheets[row] = updated
                self._refresh_table()

    def _on_remove(self):
        rows = sorted(
            {i.row() for i in self._table.selectedItems()}, reverse=True
        )
        for r in rows:
            if 0 <= r < len(self._sheets):
                self._sheets.pop(r)
        self._refresh_table()

    def get_sheets(self) -> List[NestSheet]:
        return list(self._sheets)

    def set_sheets(self, sheets: List[NestSheet]):
        self._sheets = list(sheets)
        self._refresh_table()


class _SheetThumb(QWidget):
    """Small proportional rectangle preview for sheets table."""

    def __init__(self, width: float, height: float, parent=None):
        super().__init__(parent)
        self._pw = width
        self._ph = height
        self.setFixedSize(80, 32)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        W = self.width()
        H = self.height()
        painter.fillRect(0, 0, W, H, QColor(C_PANEL))

        margin = 4
        pw, ph = self._pw, self._ph
        if pw <= 0 or ph <= 0:
            return

        aspect = pw / ph
        avail_w = W - margin * 2
        avail_h = H - margin * 2
        if aspect >= avail_w / avail_h:
            rw = avail_w
            rh = max(4, int(rw / aspect))
        else:
            rh = avail_h
            rw = max(4, int(rh * aspect))
        rx = (W - rw) // 2
        ry = (H - rh) // 2

        painter.setBrush(QBrush(QColor(C_BLUE)))
        painter.setPen(QPen(QColor(C_ACCENT), 1))
        painter.drawRect(rx, ry, rw, rh)


# ---------------------------------------------------------------------------
# _NestingTab
# ---------------------------------------------------------------------------

class _NestingTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._running  = False
        self._elapsed  = 0
        self._timer    = QTimer(self)
        self._timer.setInterval(1000)
        self._timer.timeout.connect(self._tick)
        self._layouts: List[NestLayout] = []
        self._dir_fwd  = True
        self._build()

    # ------------------------------------------------------------------
    # Build UI
    # ------------------------------------------------------------------

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(0, 0, 0, 0)
        vlay.setSpacing(0)

        # ---- Toolbar row ----
        toolbar_widget = QWidget()
        toolbar_widget.setStyleSheet(
            f"background:{C_PANEL2}; border-bottom:1px solid {C_BORDER};"
        )
        toolbar_widget.setFixedHeight(44)
        top = QHBoxLayout(toolbar_widget)
        top.setContentsMargins(8, 4, 8, 4)
        top.setSpacing(6)

        # Start / Stop
        self._btn_start = QPushButton("▶  Start")
        self._btn_start.setFixedHeight(34)
        self._btn_start.setMinimumWidth(80)
        self._btn_start.setStyleSheet(
            f"background:{C_GREEN}; color:#000; font-weight:bold; "
            f"border-radius:4px; border:none;"
        )

        self._btn_stop = QPushButton("■  Stop")
        self._btn_stop.setFixedHeight(34)
        self._btn_stop.setMinimumWidth(80)
        self._btn_stop.setEnabled(False)
        self._btn_stop.setStyleSheet(
            f"background:#c62828; color:white; font-weight:bold; "
            f"border-radius:4px; border:none;"
        )

        self._chk_fixed = QCheckBox("Fixed Run")

        self._lbl_time = QLabel("00:00:00")
        self._lbl_time.setStyleSheet(
            f"color:{C_ACCENT}; font-family:monospace; "
            f"font-size:14px; font-weight:bold;"
        )
        self._lbl_time.setMinimumWidth(80)

        top.addWidget(self._btn_start)
        top.addWidget(self._btn_stop)
        top.addWidget(self._chk_fixed)
        top.addWidget(_vsep_sm())
        top.addWidget(self._lbl_time)
        top.addWidget(_vsep_sm())

        top.addWidget(QLabel("Rotation:"))
        self._cmb_rot = _NoScrollCombo()
        self._cmb_rot.addItems(["0", "90", "180", "Any"])
        self._cmb_rot.setCurrentIndex(1)
        self._cmb_rot.setFixedWidth(70)
        top.addWidget(self._cmb_rot)

        top.addWidget(QLabel("Tilt (+/-):"))
        self._spn_tilt = _NoScrollSpin()
        self._spn_tilt.setRange(0.0, 45.0)
        self._spn_tilt.setDecimals(1)
        self._spn_tilt.setFixedWidth(72)
        top.addWidget(self._spn_tilt)

        self._chk_mirror = QCheckBox("Mirror")
        top.addWidget(self._chk_mirror)
        top.addWidget(_vsep_sm())

        top.addWidget(QLabel("Part Spacing:"))
        self._spn_gap = _NoScrollSpin()
        self._spn_gap.setRange(0.0, 999.0)
        self._spn_gap.setDecimals(3)
        self._spn_gap.setValue(5.0)
        self._spn_gap.setSuffix(" mm")
        self._spn_gap.setFixedWidth(96)
        top.addWidget(self._spn_gap)

        self._chk_uniform = QCheckBox("Uniform")
        self._chk_uniform.setChecked(True)
        top.addWidget(self._chk_uniform)
        top.addWidget(_vsep_sm())

        for lbl_txt, attr, default_val in (
            ("Top:",    "_spn_et", 5.0),
            ("Left:",   "_spn_el", 5.0),
            ("Right:",  "_spn_er", 5.0),
            ("Bottom:", "_spn_eb", 5.0),
        ):
            top.addWidget(QLabel(lbl_txt))
            spn = _NoScrollSpin()
            spn.setRange(0.0, 999.0)
            spn.setDecimals(1)
            spn.setValue(default_val)
            spn.setFixedWidth(68)
            setattr(self, attr, spn)
            top.addWidget(spn)

        top.addWidget(_vsep_sm())

        self._btn_dir = QPushButton("→")
        self._btn_dir.setFixedSize(32, 28)
        self._btn_dir.setToolTip("Nesting Direction")
        self._btn_dir.clicked.connect(self._toggle_dir)
        top.addWidget(self._btn_dir)

        top.addWidget(_vsep_sm())

        self._radio_best = QRadioButton("Best Efficiency")
        self._radio_bal  = QRadioButton("Balanced Repeats")
        self._radio_rep  = QRadioButton("Prefer Repeats")
        self._radio_best.setChecked(True)
        self._prio_group = QButtonGroup(self)
        for rb in (self._radio_best, self._radio_bal, self._radio_rep):
            self._prio_group.addButton(rb)
            top.addWidget(rb)

        top.addWidget(_vsep_sm())

        self._btn_cost = QPushButton("Estimate Material Cost")
        self._btn_cost.setFixedHeight(28)
        top.addWidget(self._btn_cost)

        top.addStretch()

        vlay.addWidget(toolbar_widget)

        # ---- Splitter: results (left) + canvas (right) ----
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setHandleWidth(4)
        splitter.setStyleSheet(f"QSplitter::handle {{ background:{C_BORDER}; }}")

        # Left: results panel
        left_w = QWidget()
        left_w.setStyleSheet(f"background:{C_BG};")
        llay = QVBoxLayout(left_w)
        llay.setContentsMargins(8, 8, 8, 4)
        llay.setSpacing(4)

        res_lbl = QLabel("Results")
        res_lbl.setStyleSheet(
            f"color:{C_DIM}; font-size:11px; font-weight:bold; "
            f"border-bottom:1px solid {C_BORDER}; padding-bottom:4px;"
        )
        llay.addWidget(res_lbl)

        self._tree = QTreeWidget()
        self._tree.setColumnCount(8)
        self._tree.setHeaderLabels([
            "Rank", "Length", "Util(%)", "Parts Nested",
            "Extras", "Sheets", "Nests", "Time",
        ])
        self._tree.header().setSectionResizeMode(
            0, QHeaderView.ResizeMode.ResizeToContents
        )
        self._tree.header().setSectionResizeMode(
            1, QHeaderView.ResizeMode.ResizeToContents
        )
        self._tree.header().setSectionResizeMode(
            2, QHeaderView.ResizeMode.ResizeToContents
        )
        self._tree.header().setSectionResizeMode(
            3, QHeaderView.ResizeMode.Stretch
        )
        for c in range(4, 8):
            self._tree.header().setSectionResizeMode(
                c, QHeaderView.ResizeMode.ResizeToContents
            )
        self._tree.setRootIsDecorated(False)
        self._tree.setUniformRowHeights(True)
        self._tree.currentItemChanged.connect(self._on_result_selected)
        llay.addWidget(self._tree, 1)

        chk_row = QHBoxLayout()
        self._chk_auto   = QCheckBox("Auto-Select Best Result")
        self._chk_unique = QCheckBox("Show Unique Nests Only")
        self._chk_auto.setChecked(True)
        chk_row.addWidget(self._chk_auto)
        chk_row.addWidget(self._chk_unique)
        chk_row.addStretch()
        llay.addLayout(chk_row)

        self._lbl_layout = QLabel("Current Layout: ")
        self._lbl_layout.setStyleSheet(
            f"color:{C_DIM}; font-size:11px; padding:2px 0;"
        )
        llay.addWidget(self._lbl_layout)

        splitter.addWidget(left_w)

        # Right: canvas
        self._canvas = NestCanvas()
        splitter.addWidget(self._canvas)
        splitter.setStretchFactor(0, 40)
        splitter.setStretchFactor(1, 60)

        vlay.addWidget(splitter, 1)

        # Connections
        self._btn_start.clicked.connect(self._on_start)
        self._btn_stop.clicked.connect(self._on_stop)
        self._chk_uniform.stateChanged.connect(self._uniform_changed)
        self._spn_et.valueChanged.connect(self._sync_uniform)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _uniform_changed(self, state):
        enabled = not self._chk_uniform.isChecked()
        for spn in (self._spn_el, self._spn_er, self._spn_eb):
            spn.setEnabled(enabled)

    def _sync_uniform(self, val):
        if self._chk_uniform.isChecked():
            self._spn_el.setValue(val)
            self._spn_er.setValue(val)
            self._spn_eb.setValue(val)

    def _toggle_dir(self):
        self._dir_fwd = not self._dir_fwd
        self._btn_dir.setText("→" if self._dir_fwd else "←")

    def _tick(self):
        self._elapsed += 1
        h = self._elapsed // 3600
        m = (self._elapsed % 3600) // 60
        s = self._elapsed % 60
        self._lbl_time.setText(f"{h:02d}:{m:02d}:{s:02d}")

    def _on_start(self):
        self._running = True
        self._elapsed = 0
        self._lbl_time.setText("00:00:00")
        self._timer.start()
        self._btn_start.setEnabled(False)
        self._btn_stop.setEnabled(True)

    def _on_stop(self):
        self._timer.stop()
        self._running = False
        self._btn_start.setEnabled(True)
        self._btn_stop.setEnabled(False)

    def _on_result_selected(self, current, previous):
        if current is None:
            self._canvas.set_layout(None)
            self._lbl_layout.setText("Current Layout: ")
            return
        idx = self._tree.indexOfTopLevelItem(current)
        if 0 <= idx < len(self._layouts):
            ly = self._layouts[idx]
            self._canvas.set_layout(ly)
            self._lbl_layout.setText(
                f"Current Layout: Sheet {idx+1} — "
                f"{ly.sheet.name}  "
                f"{ly.sheet.width:.0f}x{ly.sheet.height:.0f}  "
                f"{ly.utilization:.1f}%"
            )

    # ------------------------------------------------------------------
    # Public: run nesting
    # ------------------------------------------------------------------

    def run_nesting(self, parts: List[NestPart], sheets: List[NestSheet]):
        self._on_start()
        t0 = time.perf_counter()

        nester = GuillotineNester()
        edge = (
            self._spn_et.value(),
            self._spn_el.value(),
            self._spn_er.value(),
            self._spn_eb.value(),
        )
        self._layouts = nester.nest(
            parts=parts,
            sheets=sheets,
            part_spacing=self._spn_gap.value(),
            edge_spacing=edge,
            rotation=self._cmb_rot.currentText(),
            mirror=self._chk_mirror.isChecked(),
        )

        elapsed_ms = (time.perf_counter() - t0) * 1000
        self._on_stop()
        self._populate_results(elapsed_ms)

    def _populate_results(self, elapsed_ms: float):
        self._tree.clear()
        for idx, layout in enumerate(self._layouts):
            placed_count = len(layout.placed)
            item = QTreeWidgetItem([
                str(idx + 1),
                f"{layout.sheet.width:.0f}x{layout.sheet.height:.0f}",
                f"{layout.utilization:.2f}",
                str(placed_count),
                "0",
                "1",
                str(layout.repeat_count),
                f"{elapsed_ms:.0f}ms",
            ])
            for c in range(8):
                item.setTextAlignment(c, Qt.AlignmentFlag.AlignCenter)
            self._tree.addTopLevelItem(item)

        if self._chk_auto.isChecked() and self._tree.topLevelItemCount() > 0:
            best = None
            best_util = -1.0
            for i in range(self._tree.topLevelItemCount()):
                it = self._tree.topLevelItem(i)
                try:
                    util = float(it.text(2))
                except ValueError:
                    util = 0.0
                if util > best_util:
                    best_util = util
                    best      = it
            if best:
                self._tree.setCurrentItem(best)
                self._on_result_selected(best, None)

    def get_layouts(self) -> List[NestLayout]:
        return list(self._layouts)

    def get_settings(self) -> dict:
        return {
            "rotation": self._cmb_rot.currentText(),
            "tilt":     self._spn_tilt.value(),
            "mirror":   self._chk_mirror.isChecked(),
            "gap":      self._spn_gap.value(),
            "edge": (
                self._spn_et.value(),
                self._spn_el.value(),
                self._spn_er.value(),
                self._spn_eb.value(),
            ),
        }


# ---------------------------------------------------------------------------
# _ExportTab
# ---------------------------------------------------------------------------

class _ExportTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._parts:   List[NestPart]   = []
        self._sheets:  List[NestSheet]  = []
        self._layouts: List[NestLayout] = []
        self._build()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(0, 0, 0, 0)
        vlay.setSpacing(0)

        # Ribbon toolbar
        ribbon = _RibbonBar(self)

        self._btn_se      = _tb_btn("Solid\nEdge",        "Export to Solid Edge")
        self._btn_dxf     = _tb_btn("DXF/DWG",            "Export DXF/DWG")
        self._btn_summary = _tb_btn("Summary\nReport",     "Generate summary report", wide=True)
        self._btn_detail  = _tb_btn("Detailed\nReport",    "Generate detailed report", wide=True)

        self._btn_summary.setProperty("primary", "true")

        ribbon.add_group("Export", [self._btn_se, self._btn_dxf])
        ribbon.add_group("Reports", [self._btn_summary, self._btn_detail])
        ribbon.add_stretch()

        vlay.addWidget(ribbon)

        # Results tree + canvas (same layout as Nesting tab)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setHandleWidth(4)

        left_w = QWidget()
        left_w.setStyleSheet(f"background:{C_BG};")
        llay = QVBoxLayout(left_w)
        llay.setContentsMargins(8, 8, 8, 8)
        llay.setSpacing(4)

        self._tree = QTreeWidget()
        self._tree.setColumnCount(8)
        self._tree.setHeaderLabels([
            "Rank", "Length", "Util(%)", "Parts Nested",
            "Extras", "Sheets", "Nests", "Time",
        ])
        self._tree.header().setSectionResizeMode(
            0, QHeaderView.ResizeMode.ResizeToContents
        )
        self._tree.header().setSectionResizeMode(
            3, QHeaderView.ResizeMode.Stretch
        )
        for c in [1, 2, 4, 5, 6, 7]:
            self._tree.header().setSectionResizeMode(
                c, QHeaderView.ResizeMode.ResizeToContents
            )
        self._tree.setRootIsDecorated(False)
        self._tree.setUniformRowHeights(True)
        self._tree.currentItemChanged.connect(self._on_result_selected)
        llay.addWidget(self._tree, 1)

        self._report = QTextEdit()
        self._report.setReadOnly(True)
        self._report.setFont(QFont("Courier New", 10))
        self._report.setStyleSheet(
            f"background:{C_PANEL}; color:{C_TEXT}; "
            f"border:1px solid {C_BORDER}; font-size:11px;"
        )
        self._report.setMaximumHeight(180)
        llay.addWidget(self._report)

        splitter.addWidget(left_w)

        self._canvas = NestCanvas()
        splitter.addWidget(self._canvas)
        splitter.setStretchFactor(0, 40)
        splitter.setStretchFactor(1, 60)

        vlay.addWidget(splitter, 1)

        # Connections
        self._btn_summary.clicked.connect(self._on_summary)
        self._btn_detail.clicked.connect(self._on_detailed)
        self._btn_dxf.clicked.connect(self._on_dxf)

    def _on_result_selected(self, current, previous):
        if current is None:
            self._canvas.set_layout(None)
            return
        idx = self._tree.indexOfTopLevelItem(current)
        if 0 <= idx < len(self._layouts):
            self._canvas.set_layout(self._layouts[idx])

    def set_data(
        self,
        parts: List[NestPart],
        sheets: List[NestSheet],
        layouts: List[NestLayout],
    ):
        self._parts   = parts
        self._sheets  = sheets
        self._layouts = layouts
        self._refresh_tree()

    def _refresh_tree(self):
        self._tree.clear()
        for idx, layout in enumerate(self._layouts):
            placed_count = len(layout.placed)
            item = QTreeWidgetItem([
                str(idx + 1),
                f"{layout.sheet.width:.0f}x{layout.sheet.height:.0f}",
                f"{layout.utilization:.2f}",
                str(placed_count),
                "0",
                "1",
                str(layout.repeat_count),
                "",
            ])
            for c in range(8):
                item.setTextAlignment(c, Qt.AlignmentFlag.AlignCenter)
            self._tree.addTopLevelItem(item)
        if self._tree.topLevelItemCount() > 0:
            first = self._tree.topLevelItem(0)
            self._tree.setCurrentItem(first)
            self._on_result_selected(first, None)

    # ------------------------------------------------------------------

    def _on_summary(self):
        self._report.setPlainText(self._build_summary())

    def _on_detailed(self):
        self._report.setPlainText(self._build_detailed())

    def _build_summary(self) -> str:
        layouts   = self._layouts
        parts     = self._parts
        n_nests   = len(layouts)
        nested    = sum(len(lyt.placed) for lyt in layouts)
        total_req = sum(p.quantity for p in parts)
        sheet_area = sum(
            lyt.sheet.width * lyt.sheet.height for lyt in layouts
        ) / 1e6
        parts_area = sum(
            r.w * r.h for lyt in layouts for r in lyt.placed
        ) / 1e6
        avg_util = (
            sum(lyt.utilization for lyt in layouts) / len(layouts)
            if layouts else 0.0
        )

        lines = [
            "Job Summary",
            "=" * 50,
            f"  No. of Nests:        {n_nests}",
            f"  Nesting Efficiency:  {avg_util:.2f}%",
            f"  Parts Nested:        {nested} / {total_req}",
            f"  Area (Sheets):       {sheet_area:.3f} m²",
            f"  Area (Parts):        {parts_area:.3f} m²",
            "",
            "Parts List",
            f"  {'Part Name':<22} {'Req Qty':<10} {'X Dim':<8} {'Y Dim':<8}",
        ]
        from collections import defaultdict
        nested_counts: dict = defaultdict(int)
        for lyt in layouts:
            for r in lyt.placed:
                nested_counts[r.part.name] += 1
        for part in parts:
            nc = nested_counts.get(part.name, 0)
            lines.append(
                f"  {part.name:<22} {part.quantity:<10} "
                f"{part.width:<8.0f} {part.height:<8.0f}  (nested: {nc})"
            )
        return "\n".join(lines)

    def _build_detailed(self) -> str:
        lines = ["Detailed Report", "=" * 60, ""]
        for idx, layout in enumerate(self._layouts):
            sheet = layout.sheet
            lines.append(
                f"Sheet {idx+1}: {sheet.name}  "
                f"{sheet.width:.0f} x {sheet.height:.0f} mm"
            )
            lines.append(f"  Utilization: {layout.utilization:.2f}%")
            lines.append(f"  Parts placed: {len(layout.placed)}")
            lines.append(
                f"  {'Part':<22} {'X':>8} {'Y':>8} {'W':>8} {'H':>8} Rotated"
            )
            for r in layout.placed:
                lines.append(
                    f"  {r.part.name:<22} {r.x:>8.1f} {r.y:>8.1f} "
                    f"{r.w:>8.1f} {r.h:>8.1f} "
                    f"{'Yes' if r.rotated else 'No'}"
                )
            lines.append("")
        return "\n".join(lines)

    def _on_dxf(self):
        if not self._layouts:
            QMessageBox.warning(self, "No Data", "Run nesting first.")
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Save DXF", "nesting.dxf", "DXF Files (*.dxf)"
        )
        if not path:
            return
        try:
            content = self._build_dxf()
            with open(path, "w", encoding="ascii") as f:
                f.write(content)
            QMessageBox.information(self, "Export DXF", f"Saved to:\n{path}")
        except Exception as ex:
            QMessageBox.critical(self, "Export Error", str(ex))

    def _build_dxf(self) -> str:
        out = []

        def emit(code, value):
            out.append(f"{code}\n{value}")

        emit(0, "SECTION")
        emit(2, "HEADER")
        emit(9, "$ACADVER")
        emit(1, "AC1009")
        emit(0, "ENDSEC")
        emit(0, "SECTION")
        emit(2, "ENTITIES")

        for layout_idx, layout in enumerate(self._layouts):
            sheet = layout.sheet
            sy = layout_idx * (sheet.height + 100)

            def line_entity(x1, y1, x2, y2, layer="SHEET"):
                emit(0,  "LINE")
                emit(8,  layer)
                emit(10, f"{x1:.4f}")
                emit(20, f"{y1:.4f}")
                emit(30, "0.0")
                emit(11, f"{x2:.4f}")
                emit(21, f"{y2:.4f}")
                emit(31, "0.0")

            sw, sh = sheet.width, sheet.height
            line_entity(0,  sy,      sw, sy)
            line_entity(sw, sy,      sw, sy + sh)
            line_entity(sw, sy + sh, 0,  sy + sh)
            line_entity(0,  sy + sh, 0,  sy)

            for rect in layout.placed:
                rx, ry = rect.x, sy + rect.y
                rw, rh = rect.w, rect.h
                line_entity(rx,      ry,      rx + rw, ry,       "PARTS")
                line_entity(rx + rw, ry,      rx + rw, ry + rh,  "PARTS")
                line_entity(rx + rw, ry + rh, rx,      ry + rh,  "PARTS")
                line_entity(rx,      ry + rh, rx,      ry,       "PARTS")

        emit(0, "ENDSEC")
        emit(0, "EOF")
        return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# NestingDialog — main dialog
# ---------------------------------------------------------------------------

class NestingDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("2D Nesting")
        self.resize(1380, 820)
        self.setMinimumSize(1000, 600)
        self.setStyleSheet(DIALOG_STYLE)
        self._build()
        self._load_defaults()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(0, 0, 0, 0)
        vlay.setSpacing(0)

        self._tabs = QTabWidget()
        self._tabs.setDocumentMode(False)
        self._tabs.setTabPosition(QTabWidget.TabPosition.North)

        self._tab_parts   = _PartsTab(self)
        self._tab_sheets  = _SheetsTab(self)
        self._tab_nesting = _NestingTab(self)
        self._tab_export  = _ExportTab(self)

        self._tabs.addTab(self._tab_parts,   "  Parts  ")
        self._tabs.addTab(self._tab_sheets,  "  Sheets  ")
        self._tabs.addTab(self._tab_nesting, "  Nesting  ")
        self._tabs.addTab(self._tab_export,  "  Export  ")

        self._tabs.currentChanged.connect(self._on_tab_changed)
        vlay.addWidget(self._tabs, 1)

        # Bottom button row
        btn_row = QHBoxLayout()
        btn_row.setContentsMargins(8, 6, 8, 8)
        btn_row.setSpacing(8)

        self._btn_nest = QPushButton("▶  Run Nesting")
        self._btn_nest.setProperty("primary", "true")
        self._btn_nest.setMinimumHeight(32)
        self._btn_nest.setMinimumWidth(140)
        self._btn_nest.clicked.connect(self._run_nesting)

        btn_close = QPushButton("Close")
        btn_close.setMinimumHeight(32)
        btn_close.clicked.connect(self.reject)

        btn_row.addStretch()
        btn_row.addWidget(self._btn_nest)
        btn_row.addWidget(btn_close)
        vlay.addLayout(btn_row)

    def _load_defaults(self):
        default_parts = [
            NestPart(id=str(uuid.uuid4()), name="Panel A",
                     width=400.0, height=200.0, quantity=5, rotation="90"),
            NestPart(id=str(uuid.uuid4()), name="Panel B",
                     width=300.0, height=150.0, quantity=8, rotation="90"),
            NestPart(id=str(uuid.uuid4()), name="Panel C",
                     width=250.0, height=100.0, quantity=6, rotation="Any"),
        ]
        default_sheets = [
            NestSheet(id=str(uuid.uuid4()), name="2440x1220",
                      width=2440.0, height=1220.0, quantity=5,
                      priority="Normal"),
        ]
        self._tab_parts.set_parts(default_parts)
        self._tab_sheets.set_sheets(default_sheets)

    def _on_tab_changed(self, idx: int):
        if idx == 3:
            self._tab_export.set_data(
                self._tab_parts.get_parts(),
                self._tab_sheets.get_sheets(),
                self._tab_nesting.get_layouts(),
            )

    def _run_nesting(self):
        parts  = self._tab_parts.get_parts()
        sheets = self._tab_sheets.get_sheets()

        if not parts:
            QMessageBox.warning(
                self, "No Parts",
                "Add at least one part before nesting."
            )
            return
        if not sheets:
            QMessageBox.warning(
                self, "No Sheets",
                "Add at least one sheet before nesting."
            )
            return

        self._tabs.setCurrentIndex(2)
        self._tab_nesting.run_nesting(parts, sheets)
        self._tab_export.set_data(
            parts, sheets, self._tab_nesting.get_layouts()
        )


# ---------------------------------------------------------------------------
# Utility: table cell item helper
# ---------------------------------------------------------------------------

def _tc(
    text: str,
    align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignCenter,
) -> QTableWidgetItem:
    item = QTableWidgetItem(text)
    item.setTextAlignment(align | Qt.AlignmentFlag.AlignVCenter)
    return item


def _vsep_sm() -> QFrame:
    """Small vertical separator for narrow toolbars."""
    f = QFrame()
    f.setFrameShape(QFrame.Shape.VLine)
    f.setFixedWidth(1)
    f.setFixedHeight(28)
    f.setStyleSheet(f"background:{C_BORDER}; border:none;")
    return f


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    dlg = NestingDialog()
    dlg.show()
    sys.exit(app.exec())
