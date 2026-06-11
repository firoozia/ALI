"""
FIROO CAM - Parts Tab  (v4)

New features:
  Switch To Detailed Grid / Switch To Standard Grid toggle
  Standard Grid: Name | Dim X | Dim Y | Quantity | Preview
  Detailed Grid: Name | Dim X | Dim Y | Quantity | Allowed Rotation | Tilt | Mirror | Priority | Preview
  Dim X = larger dimension (length), Dim Y = smaller (width) — matches Solid Edge
"""
from __future__ import annotations
import uuid, csv
from pathlib import Path
from typing import List

from PySide6.QtCore  import Qt, Signal, QSize
from PySide6.QtGui   import (QColor, QPainter, QBrush, QPen, QPixmap)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QSplitter,
    QLabel, QPushButton, QTableWidget, QTableWidgetItem,
    QHeaderView, QAbstractItemView, QFrame, QFileDialog,
    QMessageBox, QDialog, QFormLayout, QDialogButtonBox,
    QDoubleSpinBox, QSpinBox, QLineEdit, QComboBox,
    QSizePolicy, QApplication, QCheckBox, QListWidget,
    QListWidgetItem, QStyledItemDelegate
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
C_SEL    = QColor("#264f78")

PREVIEW_COLORS = [
    "#c0392b","#e67e22","#27ae60","#2980b9","#8e44ad",
    "#16a085","#d35400","#f39c12","#7f8c8d","#1abc9c",
]

ROTATION_OPTIONS = ["None","90","180","Any"]
PRIORITY_OPTIONS = ["Highest","High","Normal","Low","Lowest"]


def make_preview_pixmap(w: float, h: float, color: str,
                        pw=32, ph=20) -> QPixmap:
    pix = QPixmap(pw, ph)
    pix.fill(QColor("#1a1a1a"))
    p = QPainter(pix)
    p.setRenderHint(QPainter.Antialiasing)
    aspect = w / h if h > 0 else 1.0
    if aspect >= pw / ph:
        rw = pw - 4; rh = max(4, int(rw / aspect))
    else:
        rh = ph - 4; rw = max(4, int(rh * aspect))
    rx = (pw - rw) // 2; ry = (ph - rh) // 2
    col = QColor(color)
    p.setBrush(QBrush(col)); p.setPen(QPen(col.lighter(130), 1))
    p.drawRect(rx, ry, rw, rh); p.end()
    return pix


def _load_design_codes() -> list:
    """Return sorted list of available design codes from the designs folder."""
    try:
        from design_resolver import get_resolver
        codes = get_resolver().all_codes()
        result = [c for c in codes if c != "cd0"]
        result.sort()
        return ["cd0"] + result
    except Exception:
        return ["cd0"]


class DesignCodeDelegate(QStyledItemDelegate):
    """Combobox delegate for the Design Code column in the parts grid."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._codes = _load_design_codes()

    def createEditor(self, parent, option, index):
        cmb = QComboBox(parent)
        cmb.setEditable(True)
        for c in self._codes:
            cmb.addItem(c)
        cmb.setStyleSheet(
            "QComboBox{background:#1a1a1a;color:#cccccc;border:1px solid #3e3e42;}"
            "QComboBox QAbstractItemView{background:#252526;color:#cccccc;"
            "selection-background-color:#264f78;}"
        )
        return cmb

    def setEditorData(self, editor, index):
        val = index.data(Qt.EditRole) or "cd0"
        idx = editor.findText(val)
        if idx >= 0:
            editor.setCurrentIndex(idx)
        else:
            editor.setEditText(val)

    def setModelData(self, editor, model, index):
        model.setData(index, editor.currentText(), Qt.EditRole)


class StandardPartsDialog(QDialog):
    SHAPE_TYPES = ["Rectangle", "Circle", "Ring"]

    STANDARD_COLS = ["Name", "X Dim", "Y Dim", "Quantity", "Design Code"]
    DETAILED_COLS = [
        "Name", "X Dim", "Y Dim", "Quantity",
        "Allowed Rotation", "Tilt", "Mirror", "Priority", "Design Code"
    ]

    def __init__(self, parent=None, detailed_mode: bool = False):
        super().__init__(parent)
        self._detailed_mode = bool(detailed_mode)
        self.setWindowTitle("Detailed Parts" if self._detailed_mode else "Standard Parts")
        self.setModal(True)
        self.resize(980 if self._detailed_mode else 780, 480)
        self._shape_type = "Rectangle"
        self._result_rows: List[dict] = []
        self._build()
        self._apply_style()
        self._on_type(0)

    def _active_cols(self) -> list:
        return self.DETAILED_COLS if self._detailed_mode else self.STANDARD_COLS

    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0); root.setSpacing(0)
        body = QHBoxLayout(); body.setContentsMargins(0,0,0,0); body.setSpacing(0)
        left = QFrame(); left.setFixedWidth(150)
        left.setStyleSheet(f"background:{C_PANEL.name()}; border-right:1px solid {C_BORDER.name()};")
        ll = QVBoxLayout(left); ll.setContentsMargins(0,0,0,0)
        hdr = QLabel("  Choose Type"); hdr.setFixedHeight(26)
        hdr.setStyleSheet(f"background:{C_BG.name()}; color:{C_DIM.name()}; font-size:11px; font-weight:600;")
        ll.addWidget(hdr)
        self._type_list = QListWidget()
        self._type_list.setStyleSheet(
            f"QListWidget{{background:{C_PANEL.name()};border:none;color:{C_TEXT.name()};font-size:12px;}}"
            f"QListWidget::item{{padding:8px 12px;}}"
            f"QListWidget::item:selected{{background:{C_SEL.name()};color:white;}}")
        for t in self.SHAPE_TYPES:
            self._type_list.addItem(QListWidgetItem(t))
        self._type_list.setCurrentRow(0)
        self._type_list.currentRowChanged.connect(self._on_type)
        ll.addWidget(self._type_list, 1); body.addWidget(left)

        right = QFrame()
        rl = QVBoxLayout(right); rl.setContentsMargins(0,0,0,0)
        hdr2 = QLabel("  Enter Detailed Data" if self._detailed_mode else "  Enter Data")
        hdr2.setFixedHeight(26)
        hdr2.setStyleSheet(f"background:{C_BG.name()}; color:{C_DIM.name()}; font-size:11px; font-weight:600;")
        rl.addWidget(hdr2)

        cols = self._active_cols()
        self._grid = QTableWidget(20, len(cols))
        self._grid.setHorizontalHeaderLabels(cols)
        self._grid.verticalHeader().hide()
        self._grid.setAlternatingRowColors(True)
        self._grid.setEditTriggers(QAbstractItemView.DoubleClicked | QAbstractItemView.EditKeyPressed | QAbstractItemView.AnyKeyPressed)
        hdr3 = self._grid.horizontalHeader()
        hdr3.setSectionResizeMode(0, QHeaderView.Stretch)
        for i in range(1, len(cols)):
            hdr3.setSectionResizeMode(i, QHeaderView.ResizeToContents)
            self._grid.setColumnWidth(i, 100)
        dc_col = 8 if self._detailed_mode else 4
        self._grid.setColumnWidth(dc_col, 110)
        if self._detailed_mode:
            for r in range(20):
                self._grid.setItem(r, 4, QTableWidgetItem("90"))
                self._grid.setItem(r, 5, QTableWidgetItem("0"))
                self._grid.setItem(r, 6, QTableWidgetItem(""))
                self._grid.setItem(r, 7, QTableWidgetItem("Normal"))
        _codes = _load_design_codes()
        for r in range(20):
            self._grid.setRowHeight(r, 26)
            cmb = QComboBox()
            cmb.setEditable(True)
            for c in _codes:
                cmb.addItem(c)
            cmb.setCurrentText("cd0")
            cmb.setStyleSheet(
                "QComboBox{background:#1a1a1a;color:#4ec9b0;"
                "border:1px solid #3e3e42;font-size:11px;}"
                "QComboBox QAbstractItemView{background:#252526;color:#cccccc;"
                "selection-background-color:#264f78;}"
            )
            self._grid.setCellWidget(r, dc_col, cmb)
        rl.addWidget(self._grid, 1); body.addWidget(right, 1)
        root.addLayout(body, 1)

        btn_bar = QFrame(); btn_bar.setFixedHeight(42)
        btn_bar.setStyleSheet(f"background:{C_PANEL.name()}; border-top:1px solid {C_BORDER.name()};")
        bl = QHBoxLayout(btn_bar); bl.setContentsMargins(12,6,12,6); bl.addStretch()
        self._btn_save   = QPushButton("Save Parts"); self._btn_save.setFixedSize(90,28)
        self._btn_cancel = QPushButton("Cancel");     self._btn_cancel.setFixedSize(70,28)
        self._btn_save.clicked.connect(self._save); self._btn_cancel.clicked.connect(self.reject)
        bl.addWidget(self._btn_save); bl.addWidget(self._btn_cancel)
        root.addWidget(btn_bar)

    def _on_type(self, row):
        types = self.SHAPE_TYPES
        if not (0 <= row < len(types)):
            return
        self._shape_type = types[row]
        headers = list(self._active_cols())
        if self._shape_type == "Circle":
            headers[1] = "Diameter"
            headers[2] = ""
            self._grid.setColumnHidden(2, True)
        elif self._shape_type == "Ring":
            headers[1] = "Outer Dia"
            headers[2] = "Inner Dia"
            self._grid.setColumnHidden(2, False)
        else:
            headers[1] = "X Dim"
            headers[2] = "Y Dim"
            self._grid.setColumnHidden(2, False)
        self._grid.setHorizontalHeaderLabels(headers)

    def _cell_text(self, row: int, col: int, default: str = "") -> str:
        item = self._grid.item(row, col)
        return item.text().strip() if item and item.text().strip() else default

    def _save(self):
        self._result_rows = []
        for r in range(self._grid.rowCount()):
            x_text = self._cell_text(r, 1)
            if not x_text:
                continue
            try:
                x = float(x_text)
            except ValueError:
                continue

            if self._shape_type == "Rectangle":
                try:
                    y = float(self._cell_text(r, 2, x_text))
                except ValueError:
                    y = x
            else:
                y = x

            try:
                qty = int(float(self._cell_text(r, 3, "1")))
            except ValueError:
                qty = 1

            name = self._cell_text(r, 0) or f"{self._shape_type} ({x:.0f}x{y:.0f})"

            dc_col = 8 if self._detailed_mode else 4
            _dc_widget = self._grid.cellWidget(r, dc_col)
            _dc_val = (_dc_widget.currentText().strip()
                       if _dc_widget else self._cell_text(r, dc_col, "cd0")) or "cd0"

            if self._detailed_mode:
                rotation = self._cell_text(r, 4, "90")
                try:
                    tilt = float(self._cell_text(r, 5, "0"))
                except ValueError:
                    tilt = 0.0
                mirror_txt = self._cell_text(r, 6, "").lower()
                mirror = mirror_txt in ("1", "true", "yes", "y", "✓", "check", "checked")
                priority = self._cell_text(r, 7, "Normal") or "Normal"
                design_code = _dc_val
            else:
                rotation = "90"
                tilt = 0.0
                mirror = False
                priority = "Normal"
                design_code = _dc_val

            self._result_rows.append({
                "part_code": name,
                "label": "",
                "width": max(x, y),
                "height": min(x, y),
                "qty": max(1, qty),
                "thickness": 18.0,
                "design_code": design_code,
                "material": "MDF",
                "customer": "",
                "rotation": rotation if rotation in ROTATION_OPTIONS else "90",
                "tilt": tilt,
                "mirror": mirror,
                "priority": priority if priority in PRIORITY_OPTIONS else "Normal",
            })
        if not self._result_rows:
            QMessageBox.warning(self,"No Data","Enter at least one part dimension.")
            return
        self.accept()

    def result_parts(self) -> List[dict]:
        return self._result_rows

    def _apply_style(self):
        self.setStyleSheet(f"""
        QDialog {{ background:{C_BG.name()}; }}
        QTableWidget {{ background:#1a1a1a; gridline-color:{C_BORDER.name()}; border:none;
            alternate-background-color:#202020; selection-background-color:{C_SEL.name()};
            color:{C_TEXT.name()}; font-size:12px; }}
        QTableWidget::item {{ padding:1px 6px; }}
        QHeaderView::section {{ background:{C_PANEL.name()}; border:none;
            border-right:1px solid {C_BORDER.name()}; border-bottom:1px solid {C_BORDER.name()};
            padding:3px 6px; font-weight:600; color:{C_DIM.name()}; font-size:11px; }}
        QPushButton {{ background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:3px 8px; color:{C_TEXT.name()}; font-size:12px; }}
        QPushButton:hover {{ background:#3e3e42; border-color:{C_ACCENT.name()}; }}
        """)

class PartEditDialog(QDialog):
    def __init__(self, part_data: dict = None, parent=None):
        super().__init__(parent)
        self._d = part_data or {}
        self.setWindowTitle("Edit Part" if part_data else "Add Part")
        self.setModal(True); self.setFixedWidth(400)
        self._build()

    def _build(self):
        lay = QVBoxLayout(self); form = QFormLayout()
        form.setLabelAlignment(Qt.AlignRight); form.setSpacing(6)
        self._name     = QLineEdit(self._d.get("part_code",""))
        self._dimx     = QDoubleSpinBox(); self._dimy = QDoubleSpinBox()
        self._qty      = QSpinBox();       self._thick = QDoubleSpinBox()
        self._design   = QComboBox()
        self._design.setEditable(True)
        _codes = _load_design_codes()
        for c in _codes:
            self._design.addItem(c)
        _cur = self._d.get("design_code", "cd0") or "cd0"
        _idx = self._design.findText(_cur)
        if _idx >= 0:
            self._design.setCurrentIndex(_idx)
        else:
            self._design.setEditText(_cur)
        self._material = QLineEdit(self._d.get("material","MDF"))
        self._customer = QLineEdit(self._d.get("customer",""))
        self._label    = QLineEdit(self._d.get("label",""))
        self._rotation = QComboBox(); [self._rotation.addItem(v) for v in ROTATION_OPTIONS]
        self._tilt     = QDoubleSpinBox(); self._tilt.setRange(0,45); self._tilt.setDecimals(1)
        self._mirror   = QCheckBox("Mirror Allowed")
        self._priority = QComboBox(); [self._priority.addItem(v) for v in PRIORITY_OPTIONS]
        for sp in [self._dimx, self._dimy, self._thick]: sp.setRange(1,9999); sp.setDecimals(2)
        self._dimx.setValue(self._d.get("width",600)); self._dimy.setValue(self._d.get("height",400))
        self._thick.setValue(self._d.get("thickness",18)); self._qty.setRange(1,9999)
        self._qty.setValue(self._d.get("qty",1))
        self._tilt.setValue(self._d.get("tilt",0.0))
        self._mirror.setChecked(self._d.get("mirror",False))
        rot_idx = ROTATION_OPTIONS.index(str(self._d.get("rotation","90"))) if str(self._d.get("rotation","90")) in ROTATION_OPTIONS else 1
        self._rotation.setCurrentIndex(rot_idx)
        pri_idx = PRIORITY_OPTIONS.index(self._d.get("priority","Normal")) if self._d.get("priority","Normal") in PRIORITY_OPTIONS else 2
        self._priority.setCurrentIndex(pri_idx)
        form.addRow("Part Code:", self._name); form.addRow("Dim X (mm):", self._dimx)
        form.addRow("Dim Y (mm):", self._dimy); form.addRow("Quantity:", self._qty)
        form.addRow("Thickness:", self._thick); form.addRow("Design Code:", self._design)
        form.addRow("Material:", self._material); form.addRow("Customer:", self._customer)
        form.addRow("Label:", self._label); form.addRow("Rotation:", self._rotation)
        form.addRow("Tilt (+/-)°:", self._tilt); form.addRow("", self._mirror)
        form.addRow("Priority:", self._priority)
        lay.addLayout(form)
        btns = QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        btns.accepted.connect(self.accept); btns.rejected.connect(self.reject)
        lay.addWidget(btns)

    def result_data(self) -> dict:
        return {
            "part_code": self._name.text().strip() or "Part",
            "width": self._dimx.value(), "height": self._dimy.value(),
            "qty": self._qty.value(), "thickness": self._thick.value(),
            "design_code": self._design.currentText().strip() or "cd0",
            "material": self._material.text().strip() or "MDF",
            "customer": self._customer.text().strip(),
            "label": self._label.text().strip(),
            "rotation": self._rotation.currentText(),
            "tilt": self._tilt.value(),
            "mirror": self._mirror.isChecked(),
            "priority": self._priority.currentText(),
        }


class PartsTab(QWidget):
    parts_changed = Signal(list)

    # Column indices for both grid modes
    # Standard:  Name(0) DimX(1) DimY(2) Qty(3) Preview(4)
    # Detailed:  Name(0) DimX(1) DimY(2) Qty(3) Rotation(4) Tilt(5) Mirror(6) Priority(7) Preview(8)
    STANDARD_COLS = ["Name","Dim X","Dim Y","Quantity","Design Code","Preview"]
    DETAILED_COLS = ["Name","Dim X","Dim Y","Quantity","Allowed Rotation","Tilt","Mirror","Priority","Design Code","Preview"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self._rows: List[dict] = []
        self._detailed_mode = False
        lang.on_change(lambda c, d: self._retranslate())
        self._build_ui(); self._apply_style(); self._retranslate()

    def _build_ui(self):
        root = QVBoxLayout(self); root.setContentsMargins(0,0,0,0); root.setSpacing(0)
        root.addWidget(self._build_toolbar())
        sep = QFrame(); sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet(f"background:{C_BORDER.name()};"); sep.setFixedHeight(1)
        root.addWidget(sep)
        splitter = QSplitter(Qt.Horizontal); splitter.setHandleWidth(1)
        self._table = self._build_table(); splitter.addWidget(self._table)
        self._stats_panel = self._build_stats_panel(); splitter.addWidget(self._stats_panel)
        splitter.setStretchFactor(0,1); splitter.setStretchFactor(1,0); splitter.setSizes([980,300])
        root.addWidget(splitter, 1)
        self._bottom_bar = QFrame(); self._bottom_bar.setFixedHeight(24)
        self._bottom_bar.setStyleSheet(f"background:{C_PANEL.name()}; border-top:1px solid {C_BORDER.name()};")
        bl = QHBoxLayout(self._bottom_bar); bl.setContentsMargins(12,0,12,0)
        self._lbl_unique = QLabel("Unique Parts = 0"); self._lbl_total = QLabel("Total for Nesting = 0")
        for lbl in [self._lbl_unique, self._lbl_total]:
            lbl.setStyleSheet(f"color:{C_DIM.name()}; font-size:11px;"); bl.addWidget(lbl)
        bl.addStretch(); root.addWidget(self._bottom_bar)

    def _build_toolbar(self) -> QFrame:
        tb = QFrame(); tb.setFixedHeight(56)
        tb.setStyleSheet(f"background:{C_PANEL.name()}; border-bottom:1px solid {C_BORDER.name()};")
        tl = QHBoxLayout(tb); tl.setContentsMargins(6,4,6,4); tl.setSpacing(2)

        def btn(text, tooltip, icon="", w=80):
            b = QPushButton(); b.setToolTip(tooltip); b.setFixedSize(w,44)
            b.setText(f"{icon}\n{text}" if icon else text); b.setStyleSheet(self._tb_btn_style())
            return b

        # Switch grid button — special style, left side
        self._btn_switch = QPushButton()
        self._btn_switch.setFixedSize(90, 44)
        self._btn_switch.setToolTip("Switch to Detailed Grid")
        self._btn_switch.setStyleSheet(self._tb_btn_style())
        self._update_switch_btn()
        tl.addWidget(self._btn_switch)
        tl.addWidget(self._vdiv())

        # Import group
        self._btn_dxf_dwg  = btn("DXF/DWG",  "Import DXF/DWG file",  "📄", 70)
        self._btn_csv      = btn("CSV",       "Import CSV order",     "📊", 60)
        self._btn_shapes   = btn("Shapes",    "Add standard shapes",  "⬛", 60)
        div1 = self._vdiv()

        # Edit group (standard)
        self._btn_edit_qty  = btn("Edit\nQuantity","Edit quantity",   "✎",  60)
        self._btn_remove    = btn("Remove",   "Remove selected",     "✕",  60)
        self._btn_clone     = btn("Clone",    "Clone selected",      "⧉",  60)
        self._btn_rotate    = btn("Rotate/\nMirror","Rotate 90°",    "↻",  70)
        self._btn_multiply  = btn("Multiply\nQty","Multiply qty",    "×",  70)
        div2 = self._vdiv()

        # Export group
        self._btn_csv_data  = btn("CSV Part\nData","Export CSV",     "📤", 70)
        self._btn_part_dxfs = btn("Part DXFs","Export part DXFs",   "📁", 70)

        # Detailed-only buttons (hidden in standard mode)
        self._btn_edit_rot  = btn("Edit\nRotation","Edit rotation",  "↺",  70)
        self._btn_edit_tilt = btn("Edit\nTilt",    "Edit tilt",      "◸",  60)
        self._btn_edit_rot.hide(); self._btn_edit_tilt.hide()

        for w in [self._btn_dxf_dwg, self._btn_csv, self._btn_shapes]: tl.addWidget(w)
        tl.addWidget(self._group_label("Import Parts"))
        tl.addWidget(div1)
        self._std_btns = [self._btn_edit_qty, self._btn_remove,
                          self._btn_clone, self._btn_rotate, self._btn_multiply]
        for w in self._std_btns: tl.addWidget(w)
        tl.addWidget(self._btn_edit_rot); tl.addWidget(self._btn_edit_tilt)
        tl.addWidget(self._group_label("Edit Selected Parts"))
        tl.addWidget(div2)
        for w in [self._btn_csv_data, self._btn_part_dxfs]: tl.addWidget(w)
        tl.addWidget(self._group_label("Export"))
        tl.addStretch()

        # Connect
        self._btn_switch.clicked.connect(self._toggle_grid_mode)
        self._btn_dxf_dwg.clicked.connect(self._import_dxf)
        self._btn_csv.clicked.connect(self._import_csv)
        self._btn_shapes.clicked.connect(self._open_shapes)
        self._btn_edit_qty.clicked.connect(self._edit_quantity)
        self._btn_remove.clicked.connect(self._remove_selected)
        self._btn_clone.clicked.connect(self._clone_selected)
        self._btn_rotate.clicked.connect(self._rotate_selected)
        self._btn_multiply.clicked.connect(self._multiply_quantity)
        self._btn_csv_data.clicked.connect(self._export_csv)
        self._btn_part_dxfs.clicked.connect(self._export_part_dxfs)
        self._btn_edit_rot.clicked.connect(self._edit_rotation)
        self._btn_edit_tilt.clicked.connect(self._edit_tilt)
        return tb

    def _update_switch_btn(self):
        if self._detailed_mode:
            self._btn_switch.setText("📋\nSwitch To\nStandard Grid")
            self._btn_switch.setToolTip("Switch to Standard Grid")
        else:
            self._btn_switch.setText("🔲\nSwitch To\nDetailed Grid")
            self._btn_switch.setToolTip("Switch to Detailed Grid")

    def _toggle_grid_mode(self):
        self._detailed_mode = not self._detailed_mode
        self._update_switch_btn()
        # Show/hide detailed-only buttons
        self._btn_edit_rot.setVisible(self._detailed_mode)
        self._btn_edit_tilt.setVisible(self._detailed_mode)
        # Rebuild table columns
        self._rebuild_table()
        self._refresh_table()

    def _rebuild_table(self):
        cols = self.DETAILED_COLS if self._detailed_mode else self.STANDARD_COLS
        self._table.setColumnCount(len(cols))
        self._table.setHorizontalHeaderLabels(cols)
        hdr = self._table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.Stretch)
        # Design Code column: resizable
        dc_col   = len(cols) - 2
        prev_col = len(cols) - 1
        for i in range(1, dc_col):
            hdr.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(dc_col,   QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(prev_col, QHeaderView.Fixed)
        self._table.setColumnWidth(dc_col,   90)
        self._table.setColumnWidth(prev_col, 60)

    def _build_table(self) -> QTableWidget:
        t = QTableWidget(0, len(self.STANDARD_COLS))
        t.setHorizontalHeaderLabels(self.STANDARD_COLS)
        t.verticalHeader().hide()
        t.setSelectionBehavior(QAbstractItemView.SelectRows)
        t.setSelectionMode(QAbstractItemView.ExtendedSelection)
        t.setEditTriggers(QAbstractItemView.DoubleClicked | QAbstractItemView.EditKeyPressed)
        t.setAlternatingRowColors(True); t.setShowGrid(True)
        t.doubleClicked.connect(self._on_double_click)
        t.itemSelectionChanged.connect(self._on_selection_changed)
        t.itemChanged.connect(self._on_item_changed)
        hdr = t.horizontalHeader(); hdr.setSectionResizeMode(0, QHeaderView.Stretch)
        for i in range(1,5): hdr.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(5, QHeaderView.Fixed); t.setColumnWidth(5, 60)
        t.setIconSize(QSize(32,20)); return t

    def _build_stats_panel(self) -> QWidget:
        w = QWidget(); w.setFixedWidth(300)
        lay = QVBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)
        self._stats_table = QTableWidget(5, 3)
        self._stats_table.setHorizontalHeaderLabels(["Statistic","Unique","Total"])
        self._stats_table.verticalHeader().hide()
        self._stats_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self._stats_table.setSelectionMode(QAbstractItemView.NoSelection)
        self._stats_table.setAlternatingRowColors(True)
        hdr = self._stats_table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.Stretch)
        for i in range(1,3): hdr.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        lay.addWidget(self._stats_table)
        self._preview_canvas = QLabel()
        self._preview_canvas.setMinimumHeight(120); self._preview_canvas.setAlignment(Qt.AlignCenter)
        self._preview_canvas.setStyleSheet(f"background:#1a1a1a; border:1px solid {C_BORDER.name()};")
        self._preview_canvas.setText("No selection")
        lay.addWidget(self._preview_canvas, 1); self._reset_stats(); return w

    # ── Public API ────────────────────────────────────────────
    def set_rows(self, rows: List[dict]):
        self._rows = rows; self._refresh_table(); self._emit()
    def get_rows(self) -> List[dict]: return self._rows

    def get_expanded_parts(self):
        from data_models import Part
        parts = []
        for row in self._rows:
            qty = row.get("qty",1)
            for i in range(1, qty+1):
                code = row.get("part_code","P")
                pid  = f"{code}_{i}" if qty>1 else code
                parts.append(Part(
                    part_id=str(uuid.uuid4())[:8], part_code=pid,
                    width=row.get("width",600), height=row.get("height",400),
                    thickness=row.get("thickness",18),
                    design_code=str(row.get("design_code","cd0")),
                    customer=row.get("customer",""), material=row.get("material","MDF"),
                    label=row.get("label",""), status="pending",
                ))
        return parts

    def get_unique_count(self) -> int: return len(self._rows)
    def get_total_count(self) -> int:  return sum(r.get("qty",1) for r in self._rows)

    # ── Table refresh ─────────────────────────────────────────
    def _refresh_table(self):
        t = self._table; t.setRowCount(len(self._rows))
        for row, part in enumerate(self._rows):
            color = PREVIEW_COLORS[row%len(PREVIEW_COLORS)]
            # Solid Edge convention: Dim X = larger, Dim Y = smaller
            raw_w = part.get("width",0); raw_h = part.get("height",0)
            dim_x = max(raw_w, raw_h); dim_y = min(raw_w, raw_h)
            qty   = part.get("qty",1); name = part.get("part_code","")

            name_item = QTableWidgetItem(name); name_item.setData(Qt.UserRole, row)
            t.setItem(row, 0, name_item)
            for col, val in [(1,f"{dim_x:.0f}"),(2,f"{dim_y:.0f}"),(3,str(qty))]:
                item=QTableWidgetItem(val); item.setTextAlignment(Qt.AlignCenter); t.setItem(row,col,item)

            if self._detailed_mode:
                # Rotation | Tilt | Mirror | Priority
                rot   = str(part.get("rotation","90"))
                tilt  = f"{part.get('tilt',0.0):.1f}"
                mirror= "✓" if part.get("mirror",False) else ""
                pri   = part.get("priority","Normal")
                for col, val in [(4,rot),(5,tilt),(6,mirror),(7,pri)]:
                    item=QTableWidgetItem(val); item.setTextAlignment(Qt.AlignCenter)
                    item.setFlags(item.flags() & ~Qt.ItemIsEditable)
                    t.setItem(row,col,item)
                dc_col   = 8
                prev_col = 9
            else:
                dc_col   = 4
                prev_col = 5

            # Design Code column — editable
            dc = part.get("design_code","") or ""
            dc_item = QTableWidgetItem(dc)
            dc_item.setTextAlignment(Qt.AlignCenter)
            dc_item.setForeground(QColor("#4ec9b0") if dc and dc not in ("cd0","0","") else QColor("#858585"))
            t.setItem(row, dc_col, dc_item)

            pix=make_preview_pixmap(raw_w, raw_h, color); prev=QTableWidgetItem()
            prev.setData(Qt.DecorationRole, pix)
            prev.setFlags(prev.flags() & ~Qt.ItemIsEditable)
            t.setItem(row, prev_col, prev)
            t.setRowHeight(row, 26)
        self._update_bottom_bar()

    def _update_bottom_bar(self):
        self._lbl_unique.setText(f"Unique Parts = {self.get_unique_count()}")
        self._lbl_total.setText(f"Total for Nesting = {self.get_total_count()}")

    # ── Stats ─────────────────────────────────────────────────
    def _on_selection_changed(self):
        sel = list(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: self._reset_stats(); self._preview_canvas.clear(); self._preview_canvas.setText("No selection"); return
        parts = [self._rows[r] for r in sel if r<len(self._rows)]
        unique=len(parts); total=sum(p.get("qty",1) for p in parts)
        au=sum(p.get("width",0)*p.get("height",0)/1e6 for p in parts)
        at=sum(p.get("width",0)*p.get("height",0)/1e6*p.get("qty",1) for p in parts)
        cu=sum(2*(p.get("width",0)+p.get("height",0)) for p in parts)
        ct=sum(2*(p.get("width",0)+p.get("height",0))*p.get("qty",1) for p in parts)
        rows=[("Parts Selected",unique,total),("Area",f"{au:.5f} m²",f"{at:.5f} m²"),
              ("Cut Distance",f"{cu:.0f} mm",f"{ct:.0f} mm"),("No of Pierces",unique,total),
              ("Cut Distance by Layer",f"{cu:.0f} mm",f"{ct:.0f} mm")]
        self._set_stats(rows)
        if parts:
            p=parts[0]; color=PREVIEW_COLORS[sel[0]%len(PREVIEW_COLORS)]
            pix=make_preview_pixmap(p.get("width",1),p.get("height",1),color,
                                     max(60,self._preview_canvas.width()-4),
                                     max(60,self._preview_canvas.height()-4))
            self._preview_canvas.setPixmap(pix)

    def _reset_stats(self):
        self._set_stats([("Parts Selected","—","—"),("Area","—","—"),("Cut Distance","—","—"),
                         ("No of Pierces","—","—"),("Cut Distance by Layer","—","—")])

    def _set_stats(self, rows):
        t=self._stats_table; t.setRowCount(len(rows))
        for r,(stat,uniq,total) in enumerate(rows):
            for c,val in enumerate([stat,uniq,total]):
                item=QTableWidgetItem(str(val))
                item.setTextAlignment(Qt.AlignLeft|Qt.AlignVCenter if c==0 else Qt.AlignCenter)
                t.setItem(r,c,item)
            t.setRowHeight(r,24)

    # ── Import CSV ────────────────────────────────────────────
    def _import_csv(self):
        path,_=QFileDialog.getOpenFileName(self,"Import CSV Order",str(Path.home()),"CSV Files (*.csv);;All Files (*)")
        if not path: return
        try:
            from csv_handler import parse_csv, get_unique_rows
            order,errors=parse_csv(path)
            if errors: QMessageBox.warning(self,"Import Warnings","\n".join(errors[:10]))
            if not order.parts: QMessageBox.warning(self,"Import","No parts found."); return
            self._rows=get_unique_rows(order.parts)
            # Ensure dim_x >= dim_y (Solid Edge convention)
            for r in self._rows:
                w=r.get("width",0); h=r.get("height",0)
                r["width"]=max(w,h); r["height"]=min(w,h)
                if not r.get("rotation"): r["rotation"]="90"
                if not r.get("priority"): r["priority"]="Normal"
                r.setdefault("tilt",0.0); r.setdefault("mirror",False)
            self._refresh_table(); self._emit()
            QMessageBox.information(self,"Import OK",
                f"Imported {len(self._rows)} unique parts\n({order.total_parts()} total)")
        except Exception as e: QMessageBox.critical(self,"Import Error",str(e))

    # ── Import DXF ────────────────────────────────────────────
    def _import_dxf(self):
        path,_=QFileDialog.getOpenFileName(self,"Import DXF/DWG",str(Path.home()),
                                            "DXF/DWG Files (*.dxf *.dwg);;All Files (*)")
        if not path: return
        p=Path(path)
        if p.suffix.lower()==".dwg":
            QMessageBox.warning(self,"DWG Not Supported","Convert to DXF first."); return
        try:
            import ezdxf
        except ImportError:
            QMessageBox.critical(self,"Missing","ezdxf required.\nRun: pip install ezdxf"); return
        try:
            doc=ezdxf.readfile(str(p)); msp=doc.modelspace(); new_parts=[]
            for entity in msp:
                if entity.dxftype()=="LWPOLYLINE":
                    try:
                        pts=list(entity.get_points())
                        if len(pts)<3: continue
                        xs=[pt[0] for pt in pts]; ys=[pt[1] for pt in pts]
                        w=max(xs)-min(xs); h=max(ys)-min(ys)
                        if w>10 and h>10:
                            name=entity.dxf.layer or f"Part_{len(new_parts)+1}"
                            dim_x=max(w,h); dim_y=min(w,h)
                            new_parts.append({"part_code":name,"width":round(dim_x,2),"height":round(dim_y,2),
                                "qty":1,"thickness":18.0,"design_code":"cd0","material":"MDF","customer":"","label":"",
                                "rotation":"90","tilt":0.0,"mirror":False,"priority":"Normal"})
                    except Exception: pass
            if not new_parts: QMessageBox.warning(self,"DXF","No rectangular parts found."); return
            self._rows.extend(new_parts); self._refresh_table(); self._emit()
            QMessageBox.information(self,"DXF OK",f"Imported {len(new_parts)} parts")
        except Exception as e: QMessageBox.critical(self,"DXF Error",str(e))

    def _open_shapes(self):
        dlg=StandardPartsDialog(parent=self, detailed_mode=self._detailed_mode)
        if dlg.exec()==QDialog.Accepted:
            self._rows.extend(dlg.result_parts()); self._refresh_table(); self._emit()

    # ── Edit operations ───────────────────────────────────────
    def _remove_selected(self):
        sel=sorted(set(i.row() for i in self._table.selectedIndexes()),reverse=True)
        if not sel: return
        ans=QMessageBox.question(self,"Remove",f"Remove {len(sel)} part(s)?",QMessageBox.Yes|QMessageBox.No)
        if ans==QMessageBox.Yes:
            for r in sel:
                if r<len(self._rows): self._rows.pop(r)
            self._refresh_table(); self._emit()

    def _clone_selected(self):
        import copy
        sel=sorted(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: return
        clones=[copy.deepcopy(self._rows[r]) for r in sel if r<len(self._rows)]
        for c in clones: c["part_code"]=c["part_code"]+"_copy"
        self._rows.extend(clones); self._refresh_table(); self._emit()

    def _edit_quantity(self):
        sel=list(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: return
        dlg=QDialog(self); dlg.setWindowTitle("Edit Quantity"); dlg.setFixedWidth(260)
        lay=QVBoxLayout(dlg); form=QFormLayout()
        spin=QSpinBox(); spin.setRange(1,9999); spin.setValue(self._rows[sel[0]].get("qty",1))
        form.addRow("New Quantity:",spin); lay.addLayout(form)
        btns=QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject); lay.addWidget(btns)
        if dlg.exec()==QDialog.Accepted:
            for r in sel:
                if r<len(self._rows): self._rows[r]["qty"]=spin.value()
            self._refresh_table(); self._emit()

    def _multiply_quantity(self):
        sel=list(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: return
        dlg=QDialog(self); dlg.setWindowTitle("Multiply Quantity"); dlg.setFixedWidth(260)
        lay=QVBoxLayout(dlg); form=QFormLayout()
        spin=QDoubleSpinBox(); spin.setRange(0.1,100); spin.setValue(2.0); spin.setDecimals(1)
        form.addRow("Multiplier:",spin); lay.addLayout(form)
        btns=QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject); lay.addWidget(btns)
        if dlg.exec()==QDialog.Accepted:
            for r in sel:
                if r<len(self._rows): self._rows[r]["qty"]=max(1,int(self._rows[r]["qty"]*spin.value()))
            self._refresh_table(); self._emit()

    def _rotate_selected(self):
        sel=list(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: return
        for r in sel:
            if r<len(self._rows):
                p=self._rows[r]; p["width"],p["height"]=p["height"],p["width"]
        self._refresh_table(); self._emit()

    def _edit_rotation(self):
        """Detailed mode: edit Allowed Rotation for selected parts."""
        sel=list(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: return
        dlg=QDialog(self); dlg.setWindowTitle("Edit Rotation"); dlg.setFixedWidth(260)
        lay=QVBoxLayout(dlg); form=QFormLayout()
        cmb=QComboBox(); [cmb.addItem(v) for v in ROTATION_OPTIONS]
        cur=str(self._rows[sel[0]].get("rotation","90"))
        if cur in ROTATION_OPTIONS: cmb.setCurrentIndex(ROTATION_OPTIONS.index(cur))
        form.addRow("Allowed Rotation:",cmb); lay.addLayout(form)
        btns=QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject); lay.addWidget(btns)
        if dlg.exec()==QDialog.Accepted:
            for r in sel:
                if r<len(self._rows): self._rows[r]["rotation"]=cmb.currentText()
            self._refresh_table()

    def _edit_tilt(self):
        """Detailed mode: edit Tilt for selected parts."""
        sel=list(set(i.row() for i in self._table.selectedIndexes()))
        if not sel: return
        dlg=QDialog(self); dlg.setWindowTitle("Edit Tilt"); dlg.setFixedWidth(260)
        lay=QVBoxLayout(dlg); form=QFormLayout()
        spin=QDoubleSpinBox(); spin.setRange(0,45); spin.setDecimals(1)
        spin.setValue(self._rows[sel[0]].get("tilt",0.0)); spin.setSuffix("°")
        form.addRow("Tilt (+/-):",spin); lay.addLayout(form)
        btns=QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject); lay.addWidget(btns)
        if dlg.exec()==QDialog.Accepted:
            for r in sel:
                if r<len(self._rows): self._rows[r]["tilt"]=spin.value()
            self._refresh_table()

    def _on_double_click(self, idx):
        row=idx.row()
        if row>=len(self._rows): return
        dlg=PartEditDialog(self._rows[row],parent=self)
        if dlg.exec()==QDialog.Accepted:
            self._rows[row].update(dlg.result_data()); self._refresh_table(); self._emit()

    # ── Export CSV ────────────────────────────────────────────
    def _on_item_changed(self, item):
        """Sync Design Code edits in table back to _rows data."""
        row = item.row()
        if row < 0 or row >= len(self._rows):
            return
        # Determine which column is Design Code
        dc_col = 8 if self._detailed_mode else 4
        if item.column() != dc_col:
            return
        new_code = item.text().strip()
        if not new_code:
            new_code = "cd0"
        self._rows[row]["design_code"] = new_code
        # Update color feedback
        from PySide6.QtGui import QColor
        item.setForeground(
            QColor("#4ec9b0") if new_code not in ("cd0","0","")
            else QColor("#858585"))
        self._emit()

    def _export_csv(self):
        path,_=QFileDialog.getSaveFileName(self,"Export Part Data CSV",
                                            str(Path.home()/"parts_export.csv"),"CSV Files (*.csv)")
        if not path: return
        if not path.lower().endswith(".csv"): path+=".csv"
        try:
            with open(path,"w",newline="",encoding="utf-8-sig") as f:
                w=csv.writer(f)
                w.writerow(["PartCode","Width","Height","Qty","DesignCode","Material","Thickness",
                            "Customer","Label","Rotation","Tilt","Mirror","Priority"])
                for p in self._rows:
                    w.writerow([p.get("part_code",""),p.get("width",""),p.get("height",""),
                                p.get("qty",1),p.get("design_code",""),p.get("material",""),
                                p.get("thickness",""),p.get("customer",""),p.get("label",""),
                                p.get("rotation","90"),p.get("tilt",0.0),p.get("mirror",False),
                                p.get("priority","Normal")])
            QMessageBox.information(self,"Export OK",f"Saved to:\n{path}")
        except Exception as e: QMessageBox.critical(self,"Export Error",str(e))

    # ── Export Part DXFs ──────────────────────────────────────
    def _export_part_dxfs(self):
        if not self._rows: QMessageBox.warning(self,"No Parts","No parts to export."); return
        folder=QFileDialog.getExistingDirectory(self,"Select Output Folder",str(Path(config.output_folder)))
        if not folder: return
        try: import ezdxf
        except ImportError: QMessageBox.critical(self,"Missing","ezdxf required.\nRun: pip install ezdxf"); return
        out_dir=Path(folder); out_dir.mkdir(parents=True,exist_ok=True); saved=0
        sel=list(set(i.row() for i in self._table.selectedIndexes()))
        rows_to_export=([self._rows[r] for r in sel if r<len(self._rows)] if sel else self._rows)
        for part in rows_to_export:
            try:
                doc=ezdxf.new("R2000"); msp=doc.modelspace()
                w=part.get("width",600); h=part.get("height",400)
                code=part.get("part_code","Part").replace("/","_").replace("\\","_")
                msp.add_lwpolyline([(0,0),(w,0),(w,h),(0,h),(0,0)],dxfattribs={"layer":"0","closed":True})
                msp.add_text(f"{code}  {w:.0f}x{h:.0f}",
                             dxfattribs={"layer":"labels","height":min(w,h)*0.06,"insert":(w/2,h/2)})
                doc.saveas(str(out_dir/f"{code}.dxf")); saved+=1
            except Exception as e: print(f"[PartDXF] {part.get('part_code')}: {e}")
        QMessageBox.information(self,"Export OK",f"Saved {saved} DXF files to:\n{folder}")

    # ── Helpers ───────────────────────────────────────────────
    def _emit(self): self.parts_changed.emit(self.get_expanded_parts())
    def _retranslate(self):
        self.setLayoutDirection(Qt.RightToLeft if lang.is_rtl else Qt.LeftToRight)

    def _apply_style(self):
        self.setStyleSheet(f"""
        * {{ font-family:"Segoe UI",Tahoma,sans-serif; font-size:12px; }}
        QWidget {{ background:{C_BG.name()}; color:{C_TEXT.name()}; }}
        QTableWidget {{ background:#1a1a1a; gridline-color:{C_BORDER.name()}; border:none;
            alternate-background-color:#202020; selection-background-color:{C_SEL.name()}; }}
        QTableWidget::item {{ padding:1px 6px; }}
        QHeaderView::section {{ background:{C_PANEL.name()}; border:none;
            border-right:1px solid {C_BORDER.name()}; border-bottom:1px solid {C_BORDER.name()};
            padding:3px 6px; font-weight:600; color:{C_DIM.name()}; font-size:11px; }}
        QSplitter::handle {{ background:{C_BORDER.name()}; width:1px; }}
        QScrollBar:vertical {{ background:{C_PANEL.name()}; width:8px; border:none; }}
        QScrollBar::handle:vertical {{ background:{C_BORDER.name()}; border-radius:4px; min-height:20px; }}
        """)

    @staticmethod
    def _tb_btn_style() -> str:
        return (f"background:{C_PANEL.name()}; border:none; color:{C_TEXT.name()}; font-size:10px; "
                f"border-right:1px solid {C_BORDER.name()}; padding:2px 4px; text-align:center;")

    @staticmethod
    def _vdiv() -> QFrame:
        d=QFrame(); d.setFrameShape(QFrame.VLine); d.setFixedWidth(1)
        d.setStyleSheet(f"background:{C_BORDER.name()}; margin:4px 4px;"); return d

    @staticmethod
    def _group_label(text: str) -> QLabel:
        lbl=QLabel(text)
        lbl.setStyleSheet(f"color:{C_DIM.name()}; font-size:10px; border-left:1px solid {C_BORDER.name()}; padding-left:4px;")
        lbl.setFixedHeight(44); return lbl
