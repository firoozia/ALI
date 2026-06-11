"""
FIROO CAM - Sheets Tab  (v3 — fully fixed)

Fixes:
  Create Sheet dialog now works
  Edit Sheet dialog now works
  DXF import for sheets works
  Priority column added
  Exact Solid Edge layout
"""
from __future__ import annotations
from pathlib import Path
from typing import List, Optional
import json

from PySide6.QtCore  import Qt, Signal
from PySide6.QtGui   import (QColor, QPainter, QBrush, QPen, QPixmap)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFrame, QLabel,
    QPushButton, QTableWidget, QTableWidgetItem, QHeaderView,
    QAbstractItemView, QDialog, QFormLayout, QDialogButtonBox,
    QDoubleSpinBox, QSpinBox, QLineEdit, QComboBox,
    QGroupBox, QListWidget, QListWidgetItem, QScrollArea,
    QApplication, QFileDialog, QMessageBox, QCheckBox,
    QGridLayout
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

PRIORITY_LABELS = {1:"Highest",2:"High",3:"Normal",4:"Low",5:"Lowest"}

STANDARD_SHEET_SIZES = [
    ("2440 x 1220",   2440, 1220),
    ("1220 x 2440",   1220, 2440),
    ("3660 x 1830",   3660, 1830),
    ("1830 x 3660",   1830, 3660),
    ("2800 x 1220",   2800, 1220),
    ("1220 x 2800",   1220, 2800),
    ("2100 x 1220",   2100, 1220),
    ("2400 x 1200",   2400, 1200),
    ("3000 x 1500",   3000, 1500),
]

SHEET_LIBRARY_FILE = Path(__file__).parent / "sheet_library.json"

def load_standard_sheet_sizes():
    """Load editable standard sheet sizes from sheet_library.json."""
    global STANDARD_SHEET_SIZES
    if not SHEET_LIBRARY_FILE.exists():
        save_standard_sheet_sizes(STANDARD_SHEET_SIZES)
        return STANDARD_SHEET_SIZES
    try:
        with open(SHEET_LIBRARY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        rows = []
        for item in data.get("sheets", []):
            name = str(item.get("name") or f"{item.get('width')} x {item.get('height')}")
            width = float(item.get("width", 2440))
            height = float(item.get("height", 1220))
            rows.append((name, width, height))
        if rows:
            STANDARD_SHEET_SIZES = rows
    except Exception as e:
        print(f"[Sheets] Could not load sheet library: {e}")
    return STANDARD_SHEET_SIZES

def save_standard_sheet_sizes(rows):
    """Save editable standard sheet sizes to sheet_library.json."""
    try:
        payload = {
            "_meta": {"version": "1.0.0", "units": "mm"},
            "sheets": [
                {"name": name, "width": float(w), "height": float(h),
                 "thickness": 18.0, "material": "MDF"}
                for name, w, h in rows
            ]
        }
        with open(SHEET_LIBRARY_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[Sheets] Could not save sheet library: {e}")
        return False

load_standard_sheet_sizes()



class SheetLibraryDialog(QDialog):
    """Editable standard sheet-size library."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Edit Standard Sheet Sizes")
        self.setModal(True)
        self.resize(560, 420)
        self._rows = list(load_standard_sheet_sizes())
        self._build()
        self._apply_style()
        self._refresh()

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 10, 10, 10)
        lay.setSpacing(8)

        self._table = QTableWidget(0, 3)
        self._table.setHorizontalHeaderLabels(["Name", "Length (mm)", "Width (mm)"])
        self._table.verticalHeader().hide()
        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setAlternatingRowColors(True)
        hdr = self._table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.Stretch)
        hdr.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        lay.addWidget(self._table, 1)

        btnrow = QHBoxLayout()
        self._btn_add = QPushButton("＋ Add")
        self._btn_del = QPushButton("✕ Delete")
        self._btn_reset = QPushButton("Reset Default")
        btnrow.addWidget(self._btn_add)
        btnrow.addWidget(self._btn_del)
        btnrow.addStretch()
        btnrow.addWidget(self._btn_reset)
        lay.addLayout(btnrow)

        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.accepted.connect(self._on_ok)
        btns.rejected.connect(self.reject)
        lay.addWidget(btns)

        self._btn_add.clicked.connect(self._add_row)
        self._btn_del.clicked.connect(self._delete_rows)
        self._btn_reset.clicked.connect(self._reset_defaults)

    def _refresh(self):
        self._table.setRowCount(len(self._rows))
        for r, (name, w, h) in enumerate(self._rows):
            for c, val in enumerate([name, f"{w:.0f}", f"{h:.0f}"]):
                item = QTableWidgetItem(str(val))
                item.setTextAlignment(Qt.AlignCenter if c else Qt.AlignVCenter | Qt.AlignLeft)
                self._table.setItem(r, c, item)

    def _collect(self):
        rows = []
        for r in range(self._table.rowCount()):
            try:
                name = self._table.item(r, 0).text().strip()
                w = float(self._table.item(r, 1).text().strip())
                h = float(self._table.item(r, 2).text().strip())
                if not name:
                    name = f"{w:.0f} x {h:.0f}"
                if w >= 100 and h >= 100:
                    rows.append((name, w, h))
            except Exception:
                pass
        return rows

    def _add_row(self):
        self._rows = self._collect()
        self._rows.append(("New Sheet", 2440, 1220))
        self._refresh()
        self._table.selectRow(len(self._rows) - 1)

    def _delete_rows(self):
        rows = sorted(set(i.row() for i in self._table.selectedIndexes()), reverse=True)
        if not rows:
            return
        self._rows = self._collect()
        for r in rows:
            if 0 <= r < len(self._rows):
                self._rows.pop(r)
        if not self._rows:
            self._rows.append(("2440 x 1220", 2440, 1220))
        self._refresh()

    def _reset_defaults(self):
        self._rows = [
            ("2440 x 1220", 2440, 1220), ("1220 x 2440", 1220, 2440),
            ("3660 x 1830", 3660, 1830), ("1830 x 3660", 1830, 3660),
            ("2800 x 1220", 2800, 1220), ("1220 x 2800", 1220, 2800),
            ("2100 x 1220", 2100, 1220), ("2400 x 1200", 2400, 1200),
            ("3000 x 1500", 3000, 1500),
        ]
        self._refresh()

    def _on_ok(self):
        rows = self._collect()
        if not rows:
            QMessageBox.warning(self, "Sheet Library", "At least one sheet size is required.")
            return
        save_standard_sheet_sizes(rows)
        load_standard_sheet_sizes()
        self.accept()

    def _apply_style(self):
        self.setStyleSheet(f"""
        QDialog, QWidget {{ background:{C_BG.name()}; color:{C_TEXT.name()};
            font-family:"Segoe UI",Tahoma,sans-serif; font-size:12px; }}
        QTableWidget {{ background:#1a1a1a; gridline-color:{C_BORDER.name()};
            border:1px solid {C_BORDER.name()}; alternate-background-color:#222; }}
        QHeaderView::section {{ background:{C_PANEL.name()}; color:{C_DIM.name()};
            border:none; border-right:1px solid {C_BORDER.name()}; padding:4px 6px; }}
        QPushButton {{ background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:4px 10px; color:{C_TEXT.name()}; }}
        QPushButton:hover {{ background:#3e3e42; border-color:{C_ACCENT.name()}; }}
        """)

class AddSheetsDialog(QDialog):
    """
    Solid Edge exact 'Add Sheets' dialog.
    Choose Standard Sheet Sizes + Add a Custom Sheet Size
    """

    def __init__(self, existing_data: dict = None, parent=None):
        super().__init__(parent)
        self._data = existing_data
        title = "Edit Sheet" if existing_data else "Add Sheets"
        self.setWindowTitle(title)
        self.setModal(True)
        self.setMinimumWidth(480)
        self._build()
        self._apply_style()
        if existing_data:
            self._populate(existing_data)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(10)

        # ── Standard sizes group ──────────────────────────────
        grp1 = QGroupBox("Choose Standard Sheet Sizes")
        g1   = QVBoxLayout(grp1)

        self._std_list = QListWidget()
        self._std_list.setFixedHeight(180)
        self._std_list.setSelectionMode(QAbstractItemView.SingleSelection)
        self._reload_std_list()
        self._std_list.itemClicked.connect(self._on_std_select)

        lbl_edit = QLabel('<a href="#">Edit Standard Sheet Sizes</a>')
        lbl_edit.setStyleSheet(f"color:{C_ACCENT.name()}; font-size:11px;")
        lbl_edit.setOpenExternalLinks(False)
        lbl_edit.linkActivated.connect(self._edit_standard_sizes)

        g1.addWidget(self._std_list)
        g1.addWidget(lbl_edit)
        lay.addWidget(grp1)

        # ── Custom size group ─────────────────────────────────
        grp2 = QGroupBox("Add a Custom Sheet Size")
        g2   = QHBoxLayout(grp2)

        # Preview rectangle
        self._preview = QLabel()
        self._preview.setFixedSize(80, 60)
        self._preview.setStyleSheet(
            f"background:#3a3a3a; border:1px solid {C_BORDER.name()};")
        self._preview.setAlignment(Qt.AlignCenter)
        self._preview.setText("Length")
        g2.addWidget(self._preview)

        form = QFormLayout()
        form.setSpacing(6)
        form.setLabelAlignment(Qt.AlignRight)

        self._name     = QLineEdit("Sheet")
        self._length   = QDoubleSpinBox()
        self._length.setRange(100, 9999); self._length.setDecimals(1)
        self._length.setValue(2440); self._length.setSuffix(" mm")

        self._width    = QDoubleSpinBox()
        self._width.setRange(100, 9999); self._width.setDecimals(1)
        self._width.setValue(1220); self._width.setSuffix(" mm")

        self._thick    = QDoubleSpinBox()
        self._thick.setRange(1, 100); self._thick.setDecimals(1)
        self._thick.setValue(18); self._thick.setSuffix(" mm")

        self._material = QLineEdit("MDF")

        self._qty      = QSpinBox()
        self._qty.setRange(1, 9999); self._qty.setValue(100)

        self._priority = QComboBox()
        for k, v in PRIORITY_LABELS.items():
            self._priority.addItem(v, k)
        self._priority.setCurrentIndex(2)  # Normal

        self._remnant  = QCheckBox("Remnant Sheet")

        form.addRow("Name:",          self._name)
        form.addRow("Length (mm):",   self._length)
        form.addRow("Width (mm):",    self._width)
        form.addRow("Thickness:",     self._thick)
        form.addRow("Material:",      self._material)
        form.addRow("Quantity:",      self._qty)
        form.addRow("Priority:",      self._priority)
        form.addRow("",               self._remnant)

        g2.addLayout(form)
        lay.addWidget(grp2)

        # Connect preview update
        self._length.valueChanged.connect(self._update_preview)
        self._width.valueChanged.connect(self._update_preview)
        self._update_preview()

        # Buttons
        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.accepted.connect(self.accept)
        btns.rejected.connect(self.reject)
        lay.addWidget(btns)

    def _reload_std_list(self):
        self._std_list.clear()
        for label, w, h in load_standard_sheet_sizes():
            item = QListWidgetItem(f"  {label}")
            item.setData(Qt.UserRole, (w, h, label))
            self._std_list.addItem(item)

    def _edit_standard_sizes(self):
        dlg = SheetLibraryDialog(self)
        if dlg.exec() == QDialog.Accepted:
            self._reload_std_list()

    def _on_std_select(self, item):
        data = item.data(Qt.UserRole)
        if data:
            w, h = data[0], data[1]
            label = data[2] if len(data) > 2 else f"{w:.0f}x{h:.0f}"
            self._length.setValue(w)
            self._width.setValue(h)
            self._name.setText(str(label).replace(" × ", "x").replace(" x ", "x"))

    def _update_preview(self):
        l = self._length.value()
        w = self._width.value()
        # Draw scaled preview
        pix = QPixmap(80, 60)
        pix.fill(QColor("#3a3a3a"))
        p = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        aspect = l / w if w > 0 else 1.0
        if aspect >= 80/60:
            rw = 76; rh = max(8, int(76/aspect))
        else:
            rh = 56; rw = max(8, int(56*aspect))
        rx = (80-rw)//2; ry = (60-rh)//2
        p.setBrush(QBrush(QColor("#555555")))
        p.setPen(QPen(QColor("#888888"), 1))
        p.drawRect(rx, ry, rw, rh)
        p.end()
        self._preview.setPixmap(pix)

    def _populate(self, data: dict):
        self._name.setText(data.get("name", "Sheet"))
        self._length.setValue(data.get("width", 2440))
        self._width.setValue(data.get("height", 1220))
        self._thick.setValue(data.get("thickness", 18))
        self._material.setText(data.get("material", "MDF"))
        self._qty.setValue(data.get("quantity", 100))
        pri = data.get("priority", 3)
        for i in range(self._priority.count()):
            if self._priority.itemData(i) == pri:
                self._priority.setCurrentIndex(i); break
        self._remnant.setChecked(data.get("is_remnant", False))

    def result_data(self) -> dict:
        return {
            "name":       self._name.text().strip() or "Sheet",
            "width":      self._length.value(),
            "height":     self._width.value(),
            "thickness":  self._thick.value(),
            "material":   self._material.text().strip() or "MDF",
            "quantity":   self._qty.value(),
            "priority":   self._priority.currentData(),
            "is_remnant": self._remnant.isChecked(),
        }

    def _apply_style(self):
        self.setStyleSheet(f"""
        QDialog, QWidget {{
            background:{C_BG.name()}; color:{C_TEXT.name()};
            font-family:"Segoe UI",Tahoma,sans-serif; font-size:12px;
        }}
        QGroupBox {{
            background:transparent; border:1px solid {C_BORDER.name()};
            border-radius:3px; margin-top:6px; padding-top:6px;
            color:{C_DIM.name()}; font-size:11px; font-weight:600;
        }}
        QGroupBox::title {{ subcontrol-origin:margin; left:8px; padding:0 4px; }}
        QLineEdit, QComboBox, QDoubleSpinBox, QSpinBox {{
            background:#1a1a1a; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:3px 6px; color:{C_TEXT.name()};
        }}
        QListWidget {{
            background:#1a1a1a; border:1px solid {C_BORDER.name()};
            color:{C_TEXT.name()};
        }}
        QListWidget::item {{ padding:4px 8px; }}
        QListWidget::item:selected {{
            background:{C_ACCENT.name()}; color:white;
        }}
        QPushButton {{
            background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:4px 12px; color:{C_TEXT.name()};
        }}
        QPushButton:hover {{ background:#3e3e42; border-color:{C_ACCENT.name()}; }}
        QCheckBox {{ color:{C_TEXT.name()}; }}
        """)


class SheetsTab(QWidget):
    sheets_changed = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._sheet_defs: List[dict] = [
            {"name":"2440x1220","width":2440,"height":1220,
             "thickness":18,"material":"MDF","quantity":100,
             "priority":3,"is_remnant":False}
        ]
        lang.on_change(lambda c, d: self._retranslate())
        self._build_ui(); self._apply_style()
        self._refresh_table(); self._retranslate()

    def _build_ui(self):
        root = QVBoxLayout(self); root.setContentsMargins(0,0,0,0); root.setSpacing(0)
        root.addWidget(self._build_toolbar())
        sep = QFrame(); sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet(f"background:{C_BORDER.name()};"); sep.setFixedHeight(1)
        root.addWidget(sep)

        self._table = QTableWidget(0, 6)
        self._table.setHorizontalHeaderLabels(
            ["Name","X Dim","Y Dim","Quantity","Priority","Preview"])
        self._table.verticalHeader().hide()
        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self._table.setAlternatingRowColors(True)
        self._table.doubleClicked.connect(self._edit_sheet)
        hdr = self._table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.Stretch)
        for i in range(1, 5): hdr.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        hdr.setSectionResizeMode(5, QHeaderView.Fixed); self._table.setColumnWidth(5, 60)
        root.addWidget(self._table, 1)

    def _build_toolbar(self) -> QFrame:
        tb = QFrame(); tb.setFixedHeight(56)
        tb.setStyleSheet(f"background:{C_PANEL.name()}; border-bottom:1px solid {C_BORDER.name()};")
        tl = QHBoxLayout(tb); tl.setContentsMargins(6,4,6,4); tl.setSpacing(2)

        def btn(text, tooltip, icon="", w=90):
            b = QPushButton(); b.setToolTip(tooltip); b.setFixedSize(w, 44)
            b.setText(f"{icon}\n{text}" if icon else text)
            b.setStyleSheet(self._tb_btn_style()); return b

        self._btn_create = btn("Create Sheet", "Create new sheet", "📋", 90)
        self._btn_dxf    = btn("DXF/DWG",      "Import DXF sheet", "📄", 70)
        div1 = self._vdiv()
        self._btn_edit   = btn("Edit Sheet",   "Edit selected sheet", "✎", 80)
        self._btn_remove = btn("Remove\nSelected", "Remove selected sheets", "✕", 80)

        for w in [self._btn_create, self._btn_dxf]:
            tl.addWidget(w)
        tl.addWidget(self._group_label("Create"))
        tl.addWidget(div1)
        for w in [self._btn_edit, self._btn_remove]:
            tl.addWidget(w)
        tl.addWidget(self._group_label("Selected Sheets"))
        tl.addStretch()

        self._btn_create.clicked.connect(self._create_sheet)
        self._btn_dxf.clicked.connect(self._import_dxf)
        self._btn_edit.clicked.connect(self._edit_sheet)
        self._btn_remove.clicked.connect(self._remove_sheets)
        return tb

    def _refresh_table(self):
        t = self._table; t.setRowCount(len(self._sheet_defs))
        for row, sd in enumerate(self._sheet_defs):
            name = ("◈ " if sd.get("is_remnant") else "") + sd["name"]
            pri  = PRIORITY_LABELS.get(sd.get("priority",3),"Normal")
            cells = [name, f"{sd['width']:.0f}", f"{sd['height']:.0f}",
                     str(sd["quantity"]), pri]
            for col, txt in enumerate(cells):
                item = QTableWidgetItem(txt)
                item.setTextAlignment(Qt.AlignCenter)
                if sd.get("is_remnant"):
                    item.setForeground(QColor("#e67e22"))
                t.setItem(row, col, item)

            # Preview pixmap
            w, h = sd["width"], sd["height"]
            pix  = QPixmap(40, 26); pix.fill(QColor("#1a1a1a"))
            p    = QPainter(pix); p.setRenderHint(QPainter.Antialiasing)
            aspect = w / h if h > 0 else 1.0
            if aspect >= 40/26:
                rw=36; rh=max(4,int(36/aspect))
            else:
                rh=22; rw=max(4,int(22*aspect))
            rx=(40-rw)//2; ry=(26-rh)//2
            col_ = QColor("#e67e22") if sd.get("is_remnant") else QColor("#2980b9")
            p.setBrush(QBrush(col_)); p.setPen(QPen(col_.lighter(130),1))
            p.drawRect(rx,ry,rw,rh); p.end()
            prev = QTableWidgetItem()
            prev.setData(Qt.DecorationRole, pix)
            t.setItem(row, 5, prev)
            t.setRowHeight(row, 28)

    def _create_sheet(self):
        dlg = AddSheetsDialog(parent=self)
        if dlg.exec() == QDialog.Accepted:
            self._sheet_defs.append(dlg.result_data())
            self._refresh_table(); self._emit()

    def _edit_sheet(self, idx=None):
        if hasattr(idx, 'row'):  # called from doubleClicked signal
            row = idx.row()
        else:
            rows = list(set(i.row() for i in self._table.selectedIndexes()))
            row  = rows[0] if rows else -1
        if row < 0 or row >= len(self._sheet_defs):
            QMessageBox.information(self, "Edit Sheet", "Select a sheet first.")
            return
        dlg = AddSheetsDialog(existing_data=self._sheet_defs[row], parent=self)
        if dlg.exec() == QDialog.Accepted:
            self._sheet_defs[row] = dlg.result_data()
            self._refresh_table(); self._emit()

    def _remove_sheets(self):
        rows = sorted(set(i.row() for i in self._table.selectedIndexes()), reverse=True)
        if not rows:
            QMessageBox.information(self, "Remove", "Select sheets first.")
            return
        if len(self._sheet_defs) <= 1:
            QMessageBox.warning(self, "Remove", "Cannot remove last sheet.")
            return
        ans = QMessageBox.question(
            self, "Remove Sheets",
            f"Remove {len(rows)} sheet(s)?",
            QMessageBox.Yes | QMessageBox.No)
        if ans == QMessageBox.Yes:
            for r in rows:
                if r < len(self._sheet_defs) and len(self._sheet_defs) > 1:
                    self._sheet_defs.pop(r)
            self._refresh_table(); self._emit()

    def _import_dxf(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Import DXF Sheet", str(Path.home()),
            "DXF Files (*.dxf);;All Files (*)")
        if not path: return
        try:
            import ezdxf
            doc  = ezdxf.readfile(path)
            msp  = doc.modelspace()
            for entity in msp:
                if entity.dxftype() == "LWPOLYLINE":
                    pts = list(entity.get_points())
                    if len(pts) >= 3:
                        xs = [pt[0] for pt in pts]; ys = [pt[1] for pt in pts]
                        w  = max(xs)-min(xs); h = max(ys)-min(ys)
                        if w > 100 and h > 100:
                            self._sheet_defs.append({
                                "name": f"{w:.0f}x{h:.0f}",
                                "width": w, "height": h,
                                "thickness": 18.0, "material": "MDF",
                                "quantity": 1, "priority": 3,
                                "is_remnant": False,
                            })
                            self._refresh_table(); self._emit()
                            QMessageBox.information(
                                self, "DXF Import",
                                f"Sheet {w:.0f}×{h:.0f} imported.")
                            return
            QMessageBox.warning(self, "DXF Import",
                                "No valid sheet outline found in DXF.")
        except ImportError:
            QMessageBox.critical(self, "Missing Library",
                                 "ezdxf required.\nRun: pip install ezdxf")
        except Exception as e:
            QMessageBox.critical(self, "DXF Import Error", str(e))

    def get_sheet_defs(self) -> List[dict]: return self._sheet_defs
    def set_sheet_defs(self, defs: List[dict]):
        self._sheet_defs = defs; self._refresh_table()

    def _emit(self): self.sheets_changed.emit(self._sheet_defs)
    def _retranslate(self):
        self.setLayoutDirection(Qt.RightToLeft if lang.is_rtl else Qt.LeftToRight)

    def _apply_style(self):
        self.setStyleSheet(f"""
        * {{ font-family:"Segoe UI",Tahoma,sans-serif; font-size:12px; }}
        QWidget {{ background:{C_BG.name()}; color:{C_TEXT.name()}; }}
        QTableWidget {{ background:#1a1a1a; gridline-color:{C_BORDER.name()};
            border:none; alternate-background-color:#202020;
            selection-background-color:#264f78; }}
        QTableWidget::item {{ padding:2px 6px; }}
        QHeaderView::section {{ background:{C_PANEL.name()}; border:none;
            border-right:1px solid {C_BORDER.name()}; border-bottom:1px solid {C_BORDER.name()};
            padding:3px 6px; font-weight:600; color:{C_DIM.name()}; font-size:11px; }}
        QScrollBar:vertical {{ background:{C_PANEL.name()}; width:8px; border:none; }}
        QScrollBar::handle:vertical {{ background:{C_BORDER.name()}; border-radius:4px; min-height:20px; }}
        """)

    @staticmethod
    def _tb_btn_style() -> str:
        return (f"background:{C_PANEL.name()}; border:none; color:{C_TEXT.name()}; font-size:11px; "
                f"border-right:1px solid {C_BORDER.name()}; padding:2px 4px; text-align:center;")

    @staticmethod
    def _vdiv() -> QFrame:
        d = QFrame(); d.setFrameShape(QFrame.VLine); d.setFixedWidth(1)
        d.setStyleSheet(f"background:{C_BORDER.name()}; margin:4px 4px;"); return d

    @staticmethod
    def _group_label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet(
            f"color:{C_DIM.name()}; font-size:10px; border-left:1px solid {C_BORDER.name()}; padding-left:4px;")
        lbl.setFixedHeight(44); return lbl
