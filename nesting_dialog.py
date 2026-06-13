from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from PySide6.QtCore import Qt, QTimer, QRectF
from PySide6.QtGui import QColor, QPainter, QPen, QBrush, QFont
from PySide6.QtWidgets import (
    QApplication, QDialog, QWidget, QVBoxLayout, QHBoxLayout,
    QTabWidget, QTableWidget, QTableWidgetItem, QHeaderView,
    QAbstractItemView, QLabel, QPushButton, QCheckBox, QDoubleSpinBox,
    QSpinBox, QComboBox, QFrame, QSplitter, QTreeWidget, QTreeWidgetItem,
    QTextEdit, QSizePolicy, QButtonGroup, QRadioButton, QFormLayout,
    QDialogButtonBox, QLineEdit, QMessageBox, QFileDialog, QListWidget,
    QListWidgetItem,
)

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
    ("2440 × 1220 mm", 2440.0, 1220.0),
    ("2440 × 610 mm",  2440.0,  610.0),
    ("1220 × 610 mm",  1220.0,  610.0),
    ("1830 × 915 mm",  1830.0,  915.0),
]


class _NoScrollSpin(QDoubleSpinBox):
    def wheelEvent(self, e):
        e.ignore()


class _NoScrollISpin(QSpinBox):
    def wheelEvent(self, e):
        e.ignore()


class _NoScrollCombo(QComboBox):
    def wheelEvent(self, e):
        e.ignore()


@dataclass
class NestPart:
    id: str = ""
    name: str = "Part"
    width: float = 100.0
    height: float = 100.0
    quantity: int = 1
    rotation: str = "90"
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


def _icon_btn(text: str, tooltip: str = "", min_w: int = 32) -> QPushButton:
    btn = QPushButton(text)
    btn.setMinimumWidth(min_w)
    btn.setMaximumWidth(min_w + 20)
    btn.setToolTip(tooltip)
    return btn


def _sep() -> QFrame:
    f = QFrame()
    f.setFrameShape(QFrame.Shape.VLine)
    f.setFixedWidth(1)
    f.setStyleSheet(f"background:{C_BORDER}; border:none; max-height:9999px;")
    return f


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

                free: List[Tuple[float, float, float, float]] = [(el, eb, uw, uh)]
                placed: List[PlacedRect] = []
                still_remaining: List[NestPart] = []

                for part in remaining:
                    pw = part.width  + part_spacing
                    ph = part.height + part_spacing
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
                        w=actual_w - part_spacing,
                        h=actual_h - part_spacing,
                        rotated=rotated,
                        sheet_idx=len(layouts),
                    ))
                    new_free = self._guillotine_split(fx, fy, fw, fh, actual_w, actual_h)
                    free.pop(rect_idx)
                    free.extend(new_free)

                if placed:
                    placed_area = sum(r.w * r.h for r in placed)
                    sheet_area  = sheet.width * sheet.height
                    util = (placed_area / sheet_area * 100.0) if sheet_area else 0.0
                    layouts.append(NestLayout(sheet=sheet, placed=placed, utilization=util))
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
        uw: float, uh: float,
    ) -> List[Tuple[float, float, float, float]]:
        result = []
        right_w = fw - uw
        top_h   = fh - uh
        if right_w > 1 and fh > 1:
            result.append((fx + uw, fy, right_w, fh))
        if top_h > 1 and uw > 1:
            result.append((fx, fy + uh, uw, top_h))
        return result


class NestCanvas(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.layout_data: Optional[NestLayout] = None
        self.setMinimumSize(300, 200)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

    def set_layout(self, layout: Optional[NestLayout]):
        self.layout_data = layout
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        w = self.width()
        h = self.height()

        painter.fillRect(0, 0, w, h, QColor(C_PANEL))

        if self.layout_data is None:
            painter.setPen(QColor(C_DIM))
            painter.setFont(QFont("Segoe UI", 11))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "No nesting result selected")
            return

        sheet = self.layout_data.sheet
        placed = self.layout_data.placed
        margin = 24
        sw = sheet.width
        sh = sheet.height

        scale = min((w - margin * 2) / sw, (h - margin * 2) / sh)
        ox = (w - sw * scale) / 2
        oy = (h - sh * scale) / 2

        painter.setPen(QPen(QColor(C_ACCENT), 2))
        painter.setBrush(QColor(C_BG))
        painter.drawRect(QRectF(ox, oy, sw * scale, sh * scale))

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

        info = f"{sheet.name}  {sheet.width:.0f}×{sheet.height:.0f}  {self.layout_data.utilization:.1f}%"
        painter.setPen(QColor(C_DIM))
        painter.setFont(QFont("Segoe UI", 9))
        painter.drawText(
            QRectF(ox, oy + sh * scale + 4, sw * scale, 18),
            Qt.AlignmentFlag.AlignCenter,
            info,
        )


class _PartDialog(QDialog):
    def __init__(self, parent=None, part: Optional[NestPart] = None):
        super().__init__(parent)
        self.setWindowTitle("Edit Part" if part else "Add Part")
        self.setMinimumWidth(320)
        self.setStyleSheet(DIALOG_STYLE)

        layout = QVBoxLayout(self)
        form   = QFormLayout()
        form.setSpacing(8)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._name = QLineEdit(part.name if part else "Part")
        self._w    = _NoScrollSpin(); self._w.setRange(1, 99999); self._w.setDecimals(2); self._w.setSuffix(" mm")
        self._h    = _NoScrollSpin(); self._h.setRange(1, 99999); self._h.setDecimals(2); self._h.setSuffix(" mm")
        self._qty  = _NoScrollISpin(); self._qty.setRange(1, 9999)
        self._rot  = _NoScrollCombo(); self._rot.addItems(["0", "90", "180", "Any"])
        self._mir  = QCheckBox("Allow Mirror")
        self._pri  = _NoScrollCombo(); self._pri.addItems(["Highest", "High", "Normal", "Low", "Lowest"])

        if part:
            self._w.setValue(part.width)
            self._h.setValue(part.height)
            self._qty.setValue(part.quantity)
            idx = self._rot.findText(part.rotation)
            if idx >= 0: self._rot.setCurrentIndex(idx)
            self._mir.setChecked(part.mirror)
            idx2 = self._pri.findText(part.priority)
            if idx2 >= 0: self._pri.setCurrentIndex(idx2)
        else:
            self._w.setValue(100.0)
            self._h.setValue(100.0)
            self._qty.setValue(1)
            self._rot.setCurrentIndex(1)
            self._pri.setCurrentIndex(2)

        form.addRow("Name:", self._name)
        form.addRow("Width:", self._w)
        form.addRow("Height:", self._h)
        form.addRow("Quantity:", self._qty)
        form.addRow("Rotation:", self._rot)
        form.addRow("", self._mir)
        form.addRow("Priority:", self._pri)

        layout.addLayout(form)
        btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
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
            tilt=0.0,
            mirror=self._mir.isChecked(),
            priority=self._pri.currentText(),
        )


class _SheetDialog(QDialog):
    def __init__(self, parent=None, sheet: Optional[NestSheet] = None):
        super().__init__(parent)
        self.setWindowTitle("Edit Sheet" if sheet else "Create Sheet")
        self.setMinimumWidth(380)
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

        sep = QFrame(); sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"background:{C_BORDER}; max-height:1px; border:none;")
        layout.addWidget(sep)

        cust_lbl = QLabel("Custom Sheet Size:")
        cust_lbl.setStyleSheet(f"color:{C_DIM}; font-size:11px;")
        layout.addWidget(cust_lbl)

        form = QFormLayout()
        form.setSpacing(8)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._name = QLineEdit(sheet.name if sheet else "Sheet")
        self._sw   = _NoScrollSpin(); self._sw.setRange(1, 99999); self._sw.setDecimals(2); self._sw.setSuffix(" mm")
        self._sh   = _NoScrollSpin(); self._sh.setRange(1, 99999); self._sh.setDecimals(2); self._sh.setSuffix(" mm")
        self._qty  = _NoScrollISpin(); self._qty.setRange(1, 9999)
        self._pri  = _NoScrollCombo(); self._pri.addItems(["Highest", "High", "Normal", "Low", "Lowest"])

        if sheet:
            self._sw.setValue(sheet.width)
            self._sh.setValue(sheet.height)
            self._qty.setValue(sheet.quantity)
            idx = self._pri.findText(sheet.priority)
            if idx >= 0: self._pri.setCurrentIndex(idx)
        else:
            self._sw.setValue(2440.0)
            self._sh.setValue(1220.0)
            self._qty.setValue(1)
            self._pri.setCurrentIndex(2)

        form.addRow("Name:", self._name)
        form.addRow("Length (X):", self._sw)
        form.addRow("Width (Y):", self._sh)
        form.addRow("Quantity:", self._qty)
        form.addRow("Priority:", self._pri)
        layout.addLayout(form)

        btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
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


def _make_sheet_preview_label(w: float, h: float) -> QLabel:
    from PySide6.QtGui import QPixmap
    pw, ph = 48, 28
    pix = QPixmap(pw, ph)
    pix.fill(QColor(C_PANEL2))
    p = QPainter(pix)
    aspect = w / h if h > 0 else 1.0
    if aspect >= pw / ph:
        rw = pw - 4; rh = max(4, int(rw / aspect))
    else:
        rh = ph - 4; rw = max(4, int(rh * aspect))
    rx = (pw - rw) // 2; ry = (ph - rh) // 2
    col = QColor(C_BLUE)
    p.setBrush(QBrush(col))
    p.setPen(QPen(QColor(C_ACCENT), 1))
    p.drawRect(rx, ry, rw, rh)
    p.end()
    lbl = QLabel()
    lbl.setPixmap(pix)
    lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    return lbl


class _PartsTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._parts: List[NestPart] = []
        self._build()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(8, 8, 8, 8)
        vlay.setSpacing(6)

        toolbar = QHBoxLayout()
        toolbar.setSpacing(4)

        self._btn_add  = _icon_btn("＋", "Add Part", 34)
        self._btn_edit = _icon_btn("✎", "Edit Selected", 34)
        self._btn_clone= _icon_btn("⧉", "Clone Selected", 34)
        self._btn_del  = _icon_btn("✕", "Remove Selected", 34)
        self._btn_rot  = _icon_btn("↔", "Rotate/Mirror Toggle", 34)
        self._btn_mul  = _icon_btn("×N", "Multiply Quantity", 36)

        self._btn_add.setProperty("primary", "true")
        self._btn_del.setProperty("danger", "true")

        for b in (self._btn_add, self._btn_edit, self._btn_clone,
                  _sep(), self._btn_del, _sep(),
                  self._btn_rot, self._btn_mul):
            if isinstance(b, QPushButton):
                toolbar.addWidget(b)
            else:
                toolbar.addWidget(b)
        toolbar.addStretch()
        vlay.addLayout(toolbar)

        self._table = QTableWidget(0, 7)
        self._table.setHorizontalHeaderLabels(
            ["Name", "Dim X", "Dim Y", "Quantity", "Rotation", "Mirror", "Priority"]
        )
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for c in range(1, 7):
            self._table.horizontalHeader().setSectionResizeMode(c, QHeaderView.ResizeMode.ResizeToContents)
        self._table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self._table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self._table.setAlternatingRowColors(False)
        self._table.verticalHeader().setVisible(False)
        self._table.doubleClicked.connect(self._on_edit)
        vlay.addWidget(self._table)

        self._stats = QLabel("Unique Parts = 0  |  Total for Nesting = 0")
        self._stats.setStyleSheet(f"color:{C_DIM}; font-size:11px; padding:2px;")
        vlay.addWidget(self._stats)

        self._btn_add.clicked.connect(self._on_add)
        self._btn_edit.clicked.connect(self._on_edit)
        self._btn_clone.clicked.connect(self._on_clone)
        self._btn_del.clicked.connect(self._on_remove)
        self._btn_rot.clicked.connect(self._on_rot_toggle)
        self._btn_mul.clicked.connect(self._on_multiply)

    def _refresh_table(self):
        self._table.setRowCount(0)
        for part in self._parts:
            r = self._table.rowCount()
            self._table.insertRow(r)
            self._table.setItem(r, 0, QTableWidgetItem(part.name))
            self._table.setItem(r, 1, QTableWidgetItem(f"{part.width:.2f}"))
            self._table.setItem(r, 2, QTableWidgetItem(f"{part.height:.2f}"))
            self._table.setItem(r, 3, QTableWidgetItem(str(part.quantity)))
            self._table.setItem(r, 4, QTableWidgetItem(part.rotation))
            self._table.setItem(r, 5, QTableWidgetItem("Yes" if part.mirror else "No"))
            self._table.setItem(r, 6, QTableWidgetItem(part.priority))
            for c in range(7):
                item = self._table.item(r, c)
                if item:
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self._update_stats()

    def _update_stats(self):
        total = sum(p.quantity for p in self._parts)
        self._stats.setText(
            f"Unique Parts = {len(self._parts)}  |  Total for Nesting = {total}"
        )

    def _on_add(self):
        dlg = _PartDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._parts.append(dlg.get_part())
            self._refresh_table()

    def _on_edit(self):
        rows = self._table.selectedItems()
        if not rows:
            return
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
            import copy
            p = copy.deepcopy(self._parts[row])
            p.id = str(uuid.uuid4())
            p.name = p.name + " (copy)"
            self._parts.insert(row + 1, p)
            self._refresh_table()

    def _on_remove(self):
        rows = sorted(
            set(i.row() for i in self._table.selectedItems()), reverse=True
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
            btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
            btns.accepted.connect(dlg.accept)
            btns.rejected.connect(dlg.reject)
            vl.addWidget(btns)
            if dlg.exec() == QDialog.DialogCode.Accepted:
                self._parts[row].quantity *= spin.value()
                self._refresh_table()

    def get_parts(self) -> List[NestPart]:
        return list(self._parts)

    def set_parts(self, parts: List[NestPart]):
        self._parts = list(parts)
        self._refresh_table()


class _SheetsTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._sheets: List[NestSheet] = []
        self._build()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(8, 8, 8, 8)
        vlay.setSpacing(6)

        toolbar = QHBoxLayout()
        toolbar.setSpacing(4)

        self._btn_add  = QPushButton("＋ Create Sheet")
        self._btn_edit = _icon_btn("✎", "Edit Sheet", 34)
        self._btn_del  = _icon_btn("✕", "Remove Selected Sheets", 34)

        self._btn_add.setProperty("primary", "true")
        self._btn_del.setProperty("danger", "true")

        toolbar.addWidget(self._btn_add)
        toolbar.addWidget(_sep())
        toolbar.addWidget(self._btn_edit)
        toolbar.addWidget(self._btn_del)
        toolbar.addStretch()
        vlay.addLayout(toolbar)

        self._table = QTableWidget(0, 6)
        self._table.setHorizontalHeaderLabels(
            ["Name", "X Dim", "Y Dim", "Quantity", "Priority", "Preview"]
        )
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for c in range(1, 6):
            self._table.horizontalHeader().setSectionResizeMode(c, QHeaderView.ResizeMode.ResizeToContents)
        self._table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self._table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self._table.setAlternatingRowColors(False)
        self._table.verticalHeader().setVisible(False)
        self._table.setRowHeight(0, 36)
        self._table.doubleClicked.connect(self._on_edit)
        vlay.addWidget(self._table)

        self._btn_add.clicked.connect(self._on_add)
        self._btn_edit.clicked.connect(self._on_edit)
        self._btn_del.clicked.connect(self._on_remove)

    def _refresh_table(self):
        self._table.setRowCount(0)
        for sheet in self._sheets:
            r = self._table.rowCount()
            self._table.insertRow(r)
            self._table.setRowHeight(r, 36)
            self._table.setItem(r, 0, QTableWidgetItem(sheet.name))
            self._table.setItem(r, 1, QTableWidgetItem(f"{sheet.width:.2f}"))
            self._table.setItem(r, 2, QTableWidgetItem(f"{sheet.height:.2f}"))
            self._table.setItem(r, 3, QTableWidgetItem(str(sheet.quantity)))
            self._table.setItem(r, 4, QTableWidgetItem(sheet.priority))
            for c in range(5):
                item = self._table.item(r, c)
                if item:
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl = _make_sheet_preview_label(sheet.width, sheet.height)
            self._table.setCellWidget(r, 5, lbl)

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
            set(i.row() for i in self._table.selectedItems()), reverse=True
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


class _NestingTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._running    = False
        self._elapsed    = 0
        self._timer      = QTimer(self)
        self._timer.setInterval(1000)
        self._timer.timeout.connect(self._tick)
        self._layouts: List[NestLayout] = []
        self._dir_fwd    = True
        self._build()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(8, 8, 8, 8)
        vlay.setSpacing(6)

        top = QHBoxLayout()
        top.setSpacing(6)

        self._btn_start = QPushButton("▶  Start")
        self._btn_start.setMinimumWidth(80)
        self._btn_start.setStyleSheet(
            f"background:{C_GREEN}; color:#000; font-weight:bold; border-radius:4px;"
        )

        self._btn_stop = QPushButton("■  Stop")
        self._btn_stop.setMinimumWidth(80)
        self._btn_stop.setEnabled(False)
        self._btn_stop.setStyleSheet(
            f"background:#c62828; color:white; font-weight:bold; border-radius:4px;"
        )

        self._chk_fixed = QCheckBox("Fixed Run")

        self._lbl_time = QLabel("00:00:00")
        self._lbl_time.setStyleSheet(
            f"color:{C_ACCENT}; font-family:monospace; font-size:14px; font-weight:bold;"
        )
        self._lbl_time.setMinimumWidth(75)

        top.addWidget(self._btn_start)
        top.addWidget(self._btn_stop)
        top.addWidget(self._chk_fixed)
        top.addWidget(_sep())
        top.addWidget(self._lbl_time)
        top.addWidget(_sep())

        top.addWidget(QLabel("Rotation:"))
        self._cmb_rot = _NoScrollCombo()
        self._cmb_rot.addItems(["0", "90", "180", "Any"])
        self._cmb_rot.setCurrentIndex(1)
        self._cmb_rot.setMaximumWidth(70)
        top.addWidget(self._cmb_rot)

        top.addWidget(QLabel("Tilt (+/-):"))
        self._spn_tilt = _NoScrollSpin()
        self._spn_tilt.setRange(0.0, 45.0)
        self._spn_tilt.setDecimals(1)
        self._spn_tilt.setMaximumWidth(70)
        top.addWidget(self._spn_tilt)

        self._chk_mirror = QCheckBox("Mirror Allowed")
        top.addWidget(self._chk_mirror)

        top.addWidget(_sep())

        top.addWidget(QLabel("Part Spacing:"))
        self._spn_gap = _NoScrollSpin()
        self._spn_gap.setRange(0.0, 999.0)
        self._spn_gap.setDecimals(1)
        self._spn_gap.setValue(5.0)
        self._spn_gap.setSuffix(" mm")
        self._spn_gap.setMaximumWidth(90)
        top.addWidget(self._spn_gap)

        self._chk_uniform = QCheckBox("Uniform")
        self._chk_uniform.setChecked(True)
        top.addWidget(self._chk_uniform)

        top.addWidget(_sep())

        for lbl_txt, attr in (
            ("Top:",   "_spn_et"),
            ("Left:",  "_spn_el"),
            ("Right:", "_spn_er"),
            ("Bot:",   "_spn_eb"),
        ):
            top.addWidget(QLabel(lbl_txt))
            spn = _NoScrollSpin()
            spn.setRange(0.0, 999.0)
            spn.setDecimals(1)
            spn.setValue(5.0)
            spn.setSuffix(" mm")
            spn.setMaximumWidth(82)
            setattr(self, attr, spn)
            top.addWidget(spn)

        self._chk_uniform.stateChanged.connect(self._uniform_changed)
        self._spn_et.valueChanged.connect(self._sync_uniform)

        top.addWidget(_sep())

        self._btn_dir = QPushButton("→")
        self._btn_dir.setMaximumWidth(36)
        self._btn_dir.setToolTip("Nesting Direction")
        self._btn_dir.clicked.connect(self._toggle_dir)
        top.addWidget(self._btn_dir)

        top.addWidget(_sep())

        self._radio_best   = QRadioButton("Best Efficiency")
        self._radio_bal    = QRadioButton("Balanced Repeats")
        self._radio_rep    = QRadioButton("Prefer Repeats")
        self._radio_best.setChecked(True)
        self._prio_group   = QButtonGroup(self)
        for rb in (self._radio_best, self._radio_bal, self._radio_rep):
            self._prio_group.addButton(rb)
            top.addWidget(rb)

        top.addStretch()
        vlay.addLayout(top)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"background:{C_BORDER}; max-height:1px; border:none;")
        vlay.addWidget(sep)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setHandleWidth(4)

        left = QWidget()
        llay = QVBoxLayout(left)
        llay.setContentsMargins(0, 0, 0, 0)
        llay.setSpacing(4)

        res_lbl = QLabel("Results")
        res_lbl.setStyleSheet(f"color:{C_DIM}; font-size:11px;")
        llay.addWidget(res_lbl)

        self._tree = QTreeWidget()
        self._tree.setColumnCount(8)
        self._tree.setHeaderLabels(
            ["Rank", "Length", "Util(%)", "Parts Nested", "Extras", "Sheets", "Nests", "Time"]
        )
        self._tree.header().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self._tree.header().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self._tree.header().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self._tree.header().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        for c in range(4, 8):
            self._tree.header().setSectionResizeMode(c, QHeaderView.ResizeMode.ResizeToContents)
        self._tree.currentItemChanged.connect(self._on_result_selected)
        llay.addWidget(self._tree)

        chk_row = QHBoxLayout()
        self._chk_auto   = QCheckBox("Auto-Select Best Result")
        self._chk_unique = QCheckBox("Show Unique Nests Only")
        self._chk_auto.setChecked(True)
        chk_row.addWidget(self._chk_auto)
        chk_row.addWidget(self._chk_unique)
        chk_row.addStretch()
        llay.addLayout(chk_row)

        splitter.addWidget(left)

        self._canvas = NestCanvas()
        splitter.addWidget(self._canvas)
        splitter.setStretchFactor(0, 40)
        splitter.setStretchFactor(1, 60)

        vlay.addWidget(splitter, 1)

        self._stats = QLabel("Unique Parts = 0  |  Total for Nesting = 0")
        self._stats.setStyleSheet(f"color:{C_DIM}; font-size:11px; padding:2px;")
        vlay.addWidget(self._stats)

        self._btn_start.clicked.connect(self._on_start)
        self._btn_stop.clicked.connect(self._on_stop)

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
        self._running  = True
        self._elapsed  = 0
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
            return
        idx = self._tree.indexOfTopLevelItem(current)
        if 0 <= idx < len(self._layouts):
            self._canvas.set_layout(self._layouts[idx])

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
        self._update_stats(parts)

    def _populate_results(self, elapsed_ms: float):
        self._tree.clear()
        total_placed = 0
        for idx, layout in enumerate(self._layouts):
            placed_count = len(layout.placed)
            total_placed += placed_count
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

    def _update_stats(self, parts: List[NestPart]):
        total = sum(p.quantity for p in parts)
        self._stats.setText(
            f"Unique Parts = {len(parts)}  |  Total for Nesting = {total}"
        )

    def get_layouts(self) -> List[NestLayout]:
        return list(self._layouts)

    def get_settings(self) -> dict:
        return {
            "rotation": self._cmb_rot.currentText(),
            "tilt":     self._spn_tilt.value(),
            "mirror":   self._chk_mirror.isChecked(),
            "gap":      self._spn_gap.value(),
            "edge":     (
                self._spn_et.value(),
                self._spn_el.value(),
                self._spn_er.value(),
                self._spn_eb.value(),
            ),
        }


class _ExportTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._parts:   List[NestPart]   = []
        self._sheets:  List[NestSheet]  = []
        self._layouts: List[NestLayout] = []
        self._build()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(8, 8, 8, 8)
        vlay.setSpacing(8)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        self._btn_summary  = QPushButton("📄  Summary Report")
        self._btn_detailed = QPushButton("📊  Detailed Report")
        self._btn_dxf      = QPushButton("💾  Export DXF")

        for btn in (self._btn_summary, self._btn_detailed, self._btn_dxf):
            btn.setMinimumHeight(40)
            btn.setMinimumWidth(160)

        self._btn_summary.setProperty("primary", "true")
        btn_row.addWidget(self._btn_summary)
        btn_row.addWidget(self._btn_detailed)
        btn_row.addWidget(self._btn_dxf)
        btn_row.addStretch()
        vlay.addLayout(btn_row)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"background:{C_BORDER}; max-height:1px; border:none;")
        vlay.addWidget(sep)

        self._report = QTextEdit()
        self._report.setReadOnly(True)
        self._report.setFont(QFont("Courier New", 10))
        self._report.setStyleSheet(
            f"background:{C_PANEL}; color:{C_TEXT}; border:1px solid {C_BORDER};"
        )
        vlay.addWidget(self._report, 1)

        self._btn_summary.clicked.connect(self._on_summary)
        self._btn_detailed.clicked.connect(self._on_detailed)
        self._btn_dxf.clicked.connect(self._on_dxf)

    def set_data(
        self,
        parts: List[NestPart],
        sheets: List[NestSheet],
        layouts: List[NestLayout],
    ):
        self._parts   = parts
        self._sheets  = sheets
        self._layouts = layouts

    def _on_summary(self):
        self._report.setPlainText(self._build_summary())

    def _on_detailed(self):
        self._report.setPlainText(self._build_detailed())

    def _build_summary(self) -> str:
        layouts   = self._layouts
        parts     = self._parts
        n_nests   = len(layouts)
        n_sheets  = sum(1 for _ in layouts)
        nested    = sum(len(l.placed) for l in layouts)
        total_req = sum(p.quantity for p in parts)

        sheet_area  = sum(l.sheet.width * l.sheet.height for l in layouts) / 1e6
        parts_area  = sum(
            r.w * r.h for l in layouts for r in l.placed
        ) / 1e6

        avg_util = (
            sum(l.utilization for l in layouts) / len(layouts)
            if layouts else 0.0
        )

        lines = [
            "Job Summary",
            f"  No. of Nests:       {n_nests}",
            f"  No. of Sheets:      {n_sheets}",
            f"  Nesting Efficiency: {avg_util:.2f}%",
            f"  Sheet Utilization:  {avg_util:.2f}%",
            f"  Parts Nested:       {nested} / {total_req}",
            f"  Area (Sheets):      {sheet_area:.2f} m²",
            f"  Area (Parts):       {parts_area:.2f} m²",
            "",
            "Sheet Requirements",
            f"  {'Name':<20} {'Qty':<6} {'X Dim':<8} {'Y Dim':<8} {'Area':<12}",
        ]

        from collections import defaultdict
        sheet_counts: dict = defaultdict(lambda: {"qty": 0, "w": 0.0, "h": 0.0})
        for l in layouts:
            key = f"{l.sheet.width:.0f}x{l.sheet.height:.0f}"
            sheet_counts[key]["qty"] += 1
            sheet_counts[key]["w"]    = l.sheet.width
            sheet_counts[key]["h"]    = l.sheet.height

        for name, info in sheet_counts.items():
            area = info["w"] * info["h"] * info["qty"] / 1e6
            lines.append(
                f"  {name:<20} {info['qty']:<6} {info['w']:<8.0f} {info['h']:<8.0f} {area:.3f} m²"
            )

        lines += [
            "",
            "Parts List",
            f"  {'Part Name':<20} {'Nested Qty':<12} {'Req Qty':<10} {'X Dim':<8} {'Y Dim':<8}",
        ]

        nested_counts: dict = defaultdict(int)
        for l in layouts:
            for r in l.placed:
                nested_counts[r.part.name] += 1

        for part in parts:
            nc = nested_counts.get(part.name, 0)
            lines.append(
                f"  {part.name:<20} {nc:<12} {part.quantity:<10} {part.width:<8.0f} {part.height:<8.0f}"
            )

        return "\n".join(lines)

    def _build_detailed(self) -> str:
        lines = ["Detailed Report", "=" * 60, ""]
        for idx, layout in enumerate(self._layouts):
            sheet = layout.sheet
            lines.append(
                f"Sheet {idx+1}: {sheet.name}  {sheet.width:.0f} x {sheet.height:.0f} mm"
            )
            lines.append(f"  Utilization: {layout.utilization:.2f}%")
            lines.append(f"  Parts placed: {len(layout.placed)}")
            lines.append(
                f"  {'Part':<20} {'X':>8} {'Y':>8} {'W':>8} {'H':>8} {'Rotated'}"
            )
            for r in layout.placed:
                lines.append(
                    f"  {r.part.name:<20} {r.x:>8.1f} {r.y:>8.1f} "
                    f"{r.w:>8.1f} {r.h:>8.1f} {'Yes' if r.rotated else 'No'}"
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
            lines = self._build_dxf()
            with open(path, "w", encoding="ascii") as f:
                f.write(lines)
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
                line_entity(rx,      ry,      rx + rw, ry,      layer="PARTS")
                line_entity(rx + rw, ry,      rx + rw, ry + rh, layer="PARTS")
                line_entity(rx + rw, ry + rh, rx,      ry + rh, layer="PARTS")
                line_entity(rx,      ry + rh, rx,      ry,      layer="PARTS")

        emit(0, "ENDSEC")
        emit(0, "EOF")

        return "\n".join(out) + "\n"


class NestingDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("FIROO CAM — Nesting")
        self.resize(1280, 780)
        self.setStyleSheet(DIALOG_STYLE)
        self._build()
        self._load_defaults()

    def _build(self):
        vlay = QVBoxLayout(self)
        vlay.setContentsMargins(0, 0, 0, 0)
        vlay.setSpacing(0)

        self._tabs = QTabWidget()
        self._tabs.setDocumentMode(False)

        self._tab_parts   = _PartsTab(self)
        self._tab_sheets  = _SheetsTab(self)
        self._tab_nesting = _NestingTab(self)
        self._tab_export  = _ExportTab(self)

        self._tabs.addTab(self._tab_parts,   "  Parts  ")
        self._tabs.addTab(self._tab_sheets,  "  Sheets  ")
        self._tabs.addTab(self._tab_nesting, "  Nesting  ")
        self._tabs.addTab(self._tab_export,  "  Export  ")

        self._tabs.currentChanged.connect(self._on_tab_changed)

        vlay.addWidget(self._tabs)

        btn_row = QHBoxLayout()
        btn_row.setContentsMargins(8, 6, 8, 8)
        btn_row.setSpacing(8)

        self._btn_nest = QPushButton("▶  Run Nesting")
        self._btn_nest.setProperty("primary", "true")
        self._btn_nest.setMinimumHeight(32)
        self._btn_nest.setMinimumWidth(130)
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
                      width=2440.0, height=1220.0, quantity=5, priority="Normal"),
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
            QMessageBox.warning(self, "No Parts", "Add at least one part before nesting.")
            return
        if not sheets:
            QMessageBox.warning(self, "No Sheets", "Add at least one sheet before nesting.")
            return

        self._tabs.setCurrentIndex(2)
        self._tab_nesting.run_nesting(parts, sheets)

        self._tab_export.set_data(
            parts, sheets, self._tab_nesting.get_layouts()
        )


if __name__ == "__main__":
    import sys
    from PySide6.QtWidgets import QApplication
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    dlg = NestingDialog()
    dlg.show()
    sys.exit(app.exec())
