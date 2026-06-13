"""
FIROO CAM – Aspire-style Tool Database Dialog  (v2)

Reads the Vectric Aspire .vtdb SQLite tool database and presents
a full Aspire-like tool editor / picker.

Fixes vs v1:
  • Correct type map: 0=Ball Nose, 1=End Mill (confirmed from DB)
  • Stepover stored as mm absolute → display mm + auto-% (stepover/diameter×100)
  • V-Bit: two stepovers (Final Pass + Clearance Pass) each with mm+%
  • Engraving: Side Angle (= included_angle/2) + Flat Diameter field
  • Chip Load: read-only, auto-calculated = feed_mm_min / (rpm × flutes)
  • Feed units: read from rate_units column in DB
  • Dark theme matching main app palette
  • QPainterPath added for Form Tool preview shape
  • Field visibility changes per tool type
"""
from __future__ import annotations

import shutil
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from PySide6.QtCore import Qt, QRectF, QPointF
from PySide6.QtGui import (
    QColor, QPainter, QPen, QBrush, QPainterPath, QFont
)
from PySide6.QtWidgets import (
    QDialog, QWidget, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLabel, QComboBox, QTreeWidget, QTreeWidgetItem, QTextEdit,
    QLineEdit, QPushButton, QSplitter, QMessageBox, QDoubleSpinBox,
    QSpinBox, QFrame, QSizePolicy, QFileDialog, QInputDialog,
    QScrollArea, QAbstractItemView,
)

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).resolve().parent
DATABASE_DIR = BASE_DIR / "database"
DEFAULT_VTDB = DATABASE_DIR / "aspire_tools.vtdb"
FALLBACK_JSON = BASE_DIR / "tool_library.json"

# ── Palette (matches firoo_cam_ui.py) ─────────────────────────────────────────
C_BG     = "#0d1117"
C_PANEL  = "#161b22"
C_PANEL2 = "#21262d"
C_BORDER = "#30363d"
C_TEXT   = "#e6edf3"
C_DIM    = "#8b949e"
C_BLUE   = "#1f6feb"
C_ACCENT = "#58a6ff"
C_GREEN  = "#3fb950"
C_YELLOW = "#e3b341"
C_SECTION = "#e3b341"

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
QDoubleSpinBox[readOnly=true], QSpinBox[readOnly=true] {{
    color: {C_DIM}; background: #0d1117;
}}
QPushButton {{
    background: {C_PANEL2}; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 4px; padding: 4px 10px; min-height: 26px;
}}
QPushButton:hover  {{ border-color: {C_ACCENT}; background: #26313a; }}
QPushButton:pressed {{ background: {C_BLUE}; }}
QPushButton[primary=true] {{
    background: {C_BLUE}; color: white; border-color: {C_BLUE};
}}
QPushButton[primary=true]:hover {{ background: #388bfd; }}
QTreeWidget {{
    background: {C_PANEL}; color: {C_TEXT};
    border: 1px solid {C_BORDER}; outline: none;
}}
QTreeWidget::item {{ padding: 3px 4px; }}
QTreeWidget::item:selected {{ background: {C_BLUE}; color: white; border-radius: 2px; }}
QTreeWidget::item:hover {{ background: #1c2128; }}
QScrollBar:vertical {{
    background: {C_PANEL}; width: 6px; border-radius: 3px;
}}
QScrollBar::handle:vertical {{
    background: {C_BORDER}; border-radius: 3px; min-height: 20px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0px; }}
QSplitter::handle {{ background: {C_BORDER}; width: 1px; }}
QFrame[frameShape="4"] {{ background: {C_BORDER}; max-height: 1px; border: none; }}
"""

# ── Tool type mapping (confirmed from SQLite DB) ───────────────────────────────
TOOL_TYPE_INT: Dict[int, str] = {
    0:  "Ball Nose",
    1:  "End Mill",
    2:  "Radiused End Mill",
    3:  "V-Bit",
    4:  "Engraving",
    5:  "Tapered Ball Nose",
    6:  "Drill",
    8:  "Form Tool",
    9:  "Specialist",
    12: "Laser",
}
TOOL_TYPE_INT_REV: Dict[str, int] = {v: k for k, v in TOOL_TYPE_INT.items()}

TOOL_TYPE_DISPLAY_ORDER = [
    "End Mill", "Radiused End Mill", "V-Bit", "Ball Nose",
    "Engraving", "Tapered Ball Nose", "Form Tool", "Drill", "Specialist",
]

# rate_units column → display string
RATE_UNITS: Dict[int, str] = {
    0: "mm/sec",
    1: "mm/min",
    2: "m/min",
    3: "inches/sec",
    4: "inches/min",
    5: "feet/min",
}
# rate_units → multiplier to get mm/min (for chip load calculation)
RATE_TO_MM_MIN: Dict[int, float] = {
    0: 60.0,
    1: 1.0,
    2: 1000.0,
    3: 1524.0,
    4: 25.4,
    5: 304.8,
}


# ── Data model ─────────────────────────────────────────────────────────────────
@dataclass
class AspireTool:
    tree_id:       str   = ""
    geometry_id:   str   = ""
    entity_id:     str   = ""
    name:          str   = ""
    notes:         str   = ""
    tool_type:     str   = "End Mill"
    units:         str   = "mm"
    diameter:      float = 6.0
    included_angle: float = 0.0
    flat_diameter: float  = 0.0
    flutes:        int    = 2
    pass_depth:    float  = 6.0
    stepover:      float  = 0.0   # stored as mm (absolute)
    clear_stepover: float = 0.0   # stored as mm (absolute)
    spindle_rpm:   int    = 18000
    feed_rate:     float  = 3000.0
    plunge_rate:   float  = 800.0
    rate_units:    int    = 1      # 0=mm/sec 1=mm/min …
    tool_number:   int    = 1
    material:      str    = "MDF"
    machine:       str    = "Desktop"

    @property
    def side_angle(self) -> float:
        """Engraving: side angle = included_angle / 2."""
        return self.included_angle / 2.0

    def stepover_pct(self) -> float:
        ref = self.flat_diameter if (self.tool_type == "Engraving" and self.flat_diameter) else self.diameter
        return (self.stepover / ref * 100.0) if ref else 0.0

    def clear_stepover_pct(self) -> float:
        return (self.clear_stepover / self.diameter * 100.0) if self.diameter else 0.0

    def chip_load(self) -> float:
        rpm = self.spindle_rpm or 0
        flutes = self.flutes or 1
        if not rpm or not flutes:
            return 0.0
        feed_mm_min = self.feed_rate * RATE_TO_MM_MIN.get(self.rate_units, 1.0)
        return feed_mm_min / (rpm * flutes)

    def as_tool_values(self) -> Dict:
        return {
            "name":        self.name,
            "tool_type":   self.tool_type,
            "diameter":    self.diameter,
            "angle":       self.included_angle,
            "flat_dia":    self.flat_diameter,
            "rpm":         self.spindle_rpm,
            "feed":        self.feed_rate,
            "plunge":      self.plunge_rate,
            "pass_depth":  self.pass_depth,
            "tool_number": self.tool_number,
            "flutes":      self.flutes,
            "stepover":    self.stepover,
        }


# ── DB helper ─────────────────────────────────────────────────────────────────
def _make_tool_name(type_name: str, dia: float,
                    angle: float = 0.0, flat: float = 0.0) -> str:
    if type_name in ("V-Bit", "Drill", "Specialist") and angle:
        return f"{type_name} ({_n(angle)}° - {_n(dia)} mm)"
    if type_name == "Engraving":
        sa = angle / 2 if angle else 0
        return f"Engraving ({_n(sa)}°, Tip {_n(flat)} - {_n(dia)} mm)"
    return f"{type_name} ({_n(dia)} mm)"


def _n(v) -> str:
    try:
        f = float(v)
        return str(int(f)) if abs(f - int(f)) < 1e-9 else f"{f:.4g}"
    except Exception:
        return str(v)


def _tool_from_rows(geom, cut, entity, tree, material, machine) -> AspireTool:
    type_name  = TOOL_TYPE_INT.get(int(geom["tool_type"] or 0), "Tool")
    dia        = float(geom["diameter"]       or 0.0)
    angle      = float(geom["included_angle"] or 0.0)
    flat       = float(geom["flat_diameter"]  or 0.0)
    name       = (tree["name"] if tree and tree["name"]
                  else _make_tool_name(type_name, dia, angle, flat))
    rate_units = int(cut["rate_units"] or 1) if cut else 1
    return AspireTool(
        tree_id        = tree["id"]       if tree   else "",
        geometry_id    = geom["id"],
        entity_id      = entity["id"]     if entity else "",
        name           = name,
        notes          = (geom["notes"]   or ""),
        tool_type      = type_name,
        units          = "mm",
        diameter       = dia,
        included_angle = angle,
        flat_diameter  = flat,
        flutes         = int(geom["num_flutes"] or 0),
        pass_depth     = float(cut["stepdown"]  or 0.0) if cut else 0.0,
        stepover       = float(cut["stepover"]  or 0.0) if cut else 0.0,
        clear_stepover = float(cut["clear_stepover"] or 0.0) if cut else 0.0,
        spindle_rpm    = int(cut["spindle_speed"] or 0) if cut else 0,
        feed_rate      = float(cut["feed_rate"]   or 0.0) if cut else 0.0,
        plunge_rate    = float(cut["plunge_rate"] or 0.0) if cut else 0.0,
        rate_units     = rate_units,
        tool_number    = int(cut["tool_number"]  or 0) if cut else 0,
        material       = material,
        machine        = machine,
    )


# ── Database reader ────────────────────────────────────────────────────────────
class AspireToolDatabase:
    def __init__(self, path: Path = DEFAULT_VTDB):
        self.path = Path(path)

    def available(self) -> bool:
        return self.path.exists()

    def materials(self) -> List[str]:
        if not self.path.exists():
            return ["MDF", "Softwood", "Hardwood", "Acrylic"]
        try:
            with sqlite3.connect(self.path) as con:
                return [r[0] for r in con.execute(
                    "select name from material order by name")]
        except Exception:
            return ["MDF"]

    def machines(self) -> List[str]:
        if not self.path.exists():
            return ["Desktop"]
        try:
            with sqlite3.connect(self.path) as con:
                return [r[0] for r in con.execute(
                    "select name from machine order by name")]
        except Exception:
            return ["Desktop"]

    def tree_rows(self) -> List[Dict]:
        if not self.path.exists():
            return []
        with sqlite3.connect(self.path) as con:
            con.row_factory = sqlite3.Row
            return [dict(r) for r in con.execute(
                "select tt.id, tt.parent_group_id, tt.sibling_order,"
                " tt.tool_geometry_id,"
                " coalesce(nullif(tt.name,''), '') as name,"
                " tt.notes, tt.expanded,"
                " tg.tool_type, tg.diameter, tg.included_angle, tg.flat_diameter"
                " from tool_tree_entry tt"
                " left join tool_geometry tg on tt.tool_geometry_id = tg.id"
                " order by tt.parent_group_id is not null, tt.sibling_order, tt.name"
            )]

    def get_tool(self, geometry_id: str,
                 material: str = "MDF",
                 machine: str  = "Desktop") -> Optional[AspireTool]:
        if not geometry_id or not self.path.exists():
            return None
        with sqlite3.connect(self.path) as con:
            con.row_factory = sqlite3.Row
            geom = con.execute(
                "select * from tool_geometry where id=?",
                (geometry_id,)).fetchone()
            if not geom:
                return None
            mat_row  = con.execute(
                "select id from material where name=?", (material,)).fetchone()
            mach_row = con.execute(
                "select id from machine where name=?", (machine,)).fetchone()
            mat_id   = mat_row["id"]  if mat_row  else None
            mach_id  = mach_row["id"] if mach_row else None

            entity = None
            if mat_id and mach_id:
                entity = con.execute(
                    "select * from tool_entity "
                    "where tool_geometry_id=? and material_id=? and machine_id=? limit 1",
                    (geometry_id, mat_id, mach_id)).fetchone()
            if not entity and mat_id:
                entity = con.execute(
                    "select * from tool_entity "
                    "where tool_geometry_id=? and material_id=? limit 1",
                    (geometry_id, mat_id)).fetchone()
            if not entity:
                entity = con.execute(
                    "select * from tool_entity "
                    "where tool_geometry_id=? "
                    "and (select feed_rate from tool_cutting_data where id=tool_cutting_data_id) is not null "
                    "limit 1",
                    (geometry_id,)).fetchone()
            if not entity:
                entity = con.execute(
                    "select * from tool_entity where tool_geometry_id=? limit 1",
                    (geometry_id,)).fetchone()

            cut  = None
            if entity:
                cut = con.execute(
                    "select * from tool_cutting_data where id=?",
                    (entity["tool_cutting_data_id"],)).fetchone()

            tree = con.execute(
                "select * from tool_tree_entry where tool_geometry_id=? limit 1",
                (geometry_id,)).fetchone()

            return _tool_from_rows(geom, cut, entity, tree, material, machine)

    def save_tool(self, t: AspireTool):
        if not self.path.exists() or not t.geometry_id:
            return
        type_code = TOOL_TYPE_INT_REV.get(t.tool_type, 1)
        with sqlite3.connect(self.path) as con:
            con.execute(
                "update tool_geometry set notes=?,tool_type=?,diameter=?,"
                "included_angle=?,flat_diameter=?,num_flutes=? where id=?",
                (t.notes, type_code, t.diameter, t.included_angle,
                 t.flat_diameter, t.flutes, t.geometry_id))
            con.execute(
                "update tool_tree_entry set name=?,notes=? "
                "where tool_geometry_id=?",
                (t.name, t.notes, t.geometry_id))
            if t.entity_id:
                ent = con.execute(
                    "select tool_cutting_data_id from tool_entity where id=?",
                    (t.entity_id,)).fetchone()
                if ent:
                    cut_id = ent[0]
                    con.execute(
                        "update tool_cutting_data set "
                        "feed_rate=?,plunge_rate=?,spindle_speed=?,"
                        "stepdown=?,stepover=?,clear_stepover=?,"
                        "tool_number=?,rate_units=? where id=?",
                        (t.feed_rate, t.plunge_rate, t.spindle_rpm,
                         t.pass_depth, t.stepover, t.clear_stepover,
                         t.tool_number, t.rate_units, cut_id))
            con.commit()


# ── Stepover dual widget ───────────────────────────────────────────────────────
class StepoverWidget(QWidget):
    """Two spin-boxes side by side: mm (editable) and % (read-only auto-calc)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._diameter = 1.0
        self._ref_is_flat = False   # True for Engraving (use flat_dia)
        self._flat_dia = 0.0

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)

        self.sp_mm = QDoubleSpinBox()
        self.sp_mm.setRange(0, 9999)
        self.sp_mm.setDecimals(4)
        self.sp_mm.setSuffix(" mm")
        self.sp_mm.setFixedWidth(100)

        self.sp_pct = QDoubleSpinBox()
        self.sp_pct.setRange(0, 9999)
        self.sp_pct.setDecimals(1)
        self.sp_pct.setSuffix(" %")
        self.sp_pct.setFixedWidth(80)

        lay.addWidget(self.sp_mm)
        lay.addWidget(self.sp_pct)
        lay.addStretch()

        self.sp_mm.valueChanged.connect(self._mm_changed)
        self.sp_pct.valueChanged.connect(self._pct_changed)
        self._updating = False

    def set_diameter(self, dia: float, flat_dia: float = 0.0,
                     ref_is_flat: bool = False):
        self._diameter  = max(dia, 1e-6)
        self._flat_dia  = flat_dia or dia
        self._ref_is_flat = ref_is_flat
        self._mm_changed(self.sp_mm.value())

    def _ref(self) -> float:
        return self._flat_dia if (self._ref_is_flat and self._flat_dia) else self._diameter

    def _mm_changed(self, mm: float):
        if self._updating:
            return
        self._updating = True
        ref = self._ref()
        self.sp_pct.setValue(mm / ref * 100.0 if ref else 0.0)
        self._updating = False

    def _pct_changed(self, pct: float):
        if self._updating:
            return
        self._updating = True
        self.sp_mm.setValue(pct / 100.0 * self._ref())
        self._updating = False

    def value_mm(self) -> float:
        return self.sp_mm.value()

    def set_value_mm(self, mm: float):
        self.sp_mm.setValue(mm)

    def setEnabled(self, en: bool):
        self.sp_mm.setEnabled(en)
        self.sp_pct.setEnabled(en)


# ── Tool preview widget ────────────────────────────────────────────────────────
class ToolPreview(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.tool: Optional[AspireTool] = None
        self.setMinimumSize(110, 160)
        self.setMaximumWidth(140)
        self.setStyleSheet(f"background: {C_PANEL}; border: 1px solid {C_BORDER}; border-radius: 4px;")

    def set_tool(self, tool: Optional[AspireTool]):
        self.tool = tool
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        try:
            p.setRenderHint(QPainter.Antialiasing)
            p.fillRect(self.rect(), QColor(C_PANEL))
            if not self.tool:
                p.setPen(QColor(C_DIM))
                p.drawText(self.rect(), Qt.AlignCenter, "No tool")
                return

            cx   = self.width() * 0.5
            top  = 24
            h    = min(110, self.height() - 48)
            sw   = 30  # shank width
            t    = self.tool.tool_type

            silver = QColor("#b0b8c0")
            dark   = QColor("#707880")
            pen    = QPen(QColor("#505860"), 1)
            p.setPen(pen)
            p.setBrush(QBrush(silver))

            if t == "V-Bit":
                p.drawRect(QRectF(cx - sw/2, top, sw, h * 0.55))
                pts = [QPointF(cx - sw/2, top + h*0.55),
                       QPointF(cx + sw/2, top + h*0.55),
                       QPointF(cx,         top + h)]
                p.drawPolygon(pts)

            elif t == "Ball Nose":
                p.drawRect(QRectF(cx - sw/2, top, sw, h * 0.75))
                p.drawEllipse(QRectF(cx - sw/2, top + h*0.62, sw, sw))

            elif t == "Engraving":
                tip_w = sw * 0.2
                p.drawRect(QRectF(cx - sw/3, top, sw*2/3, h * 0.65))
                pts = [QPointF(cx - sw/2,  top + h*0.65),
                       QPointF(cx + sw/2,  top + h*0.65),
                       QPointF(cx + tip_w, top + h),
                       QPointF(cx - tip_w, top + h)]
                p.drawPolygon(pts)

            elif t == "Drill":
                p.drawRect(QRectF(cx - sw/2, top, sw, h * 0.60))
                pts = [QPointF(cx - sw/2, top + h*0.60),
                       QPointF(cx + sw/2, top + h*0.60),
                       QPointF(cx,         top + h)]
                p.drawPolygon(pts)

            elif t == "Form Tool":
                p.setBrush(Qt.NoBrush)
                p.setPen(QPen(silver, 2))
                path = QPainterPath()
                x0, x1 = cx - sw * 0.9, cx + sw * 0.9
                y0 = float(top + h * 0.35)
                y1 = float(top + h * 0.60)
                y2 = float(top + h)
                path.moveTo(x0, y0)
                path.cubicTo(x0, y1, cx - sw*0.3, y1, cx - sw*0.3, y2)
                path.lineTo(cx + sw*0.3, y2)
                path.cubicTo(cx + sw*0.3, y1, x1, y1, x1, y0)
                p.drawPath(path)

            elif t == "Specialist":
                p.drawRect(QRectF(cx - sw/2, top, sw, h * 0.55))
                p.setBrush(QBrush(dark))
                pts = [QPointF(cx - sw/2, top + h*0.55),
                       QPointF(cx + sw/2, top + h*0.55),
                       QPointF(cx,         top + h)]
                p.drawPolygon(pts)

            else:
                # End Mill, Radiused End Mill, Tapered Ball Nose
                p.drawRect(QRectF(cx - sw/2, top, sw, h))
                p.setPen(QPen(dark, 1))
                for i in range(1, 5):
                    y = top + i * h / 5
                    p.drawLine(QPointF(cx - sw/2, y), QPointF(cx + sw/2, y + h/8))

            # Type label
            p.setPen(QColor(C_DIM))
            p.setFont(QFont("Segoe UI", 8))
            lbl = t.replace(" ", "\n") if len(t) > 8 else t
            r = QRectF(0, self.height() - 30, self.width(), 28)
            p.drawText(r, Qt.AlignHCenter | Qt.AlignTop, lbl)
        finally:
            p.end()


# ── Section separator ──────────────────────────────────────────────────────────
def _section_label(text: str) -> QLabel:
    lbl = QLabel(text)
    lbl.setStyleSheet(
        f"color: {C_SECTION}; font-weight: 700; font-size: 11px; "
        f"background: transparent; padding: 6px 0 2px 0; border: none;")
    return lbl


def _hline() -> QFrame:
    f = QFrame()
    f.setFrameShape(QFrame.HLine)
    f.setStyleSheet(f"background: {C_BORDER}; max-height: 1px; border: none;")
    return f


# ── Main dialog ────────────────────────────────────────────────────────────────
class AspireToolDatabaseDialog(QDialog):
    """
    Aspire-style Tool Database picker/editor.

    Usage:
        dlg = AspireToolDatabaseDialog(parent)
        if dlg.exec() == QDialog.Accepted:
            tool = dlg.selected_tool   # AspireTool
    """

    def __init__(self, parent=None, db_path: Path = DEFAULT_VTDB):
        super().__init__(parent)
        self.setWindowTitle("Tool Database")
        self.resize(1020, 660)
        self.db = AspireToolDatabase(db_path)
        self.selected_tool: Optional[AspireTool] = None
        self._current_geom_id: str = ""
        self._updating_fields = False
        self.setStyleSheet(DIALOG_STYLE)
        self._build_ui()
        self._load_data()

    # ── UI construction ────────────────────────────────────────────────────────
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(8, 8, 8, 8)
        root.setSpacing(6)

        # Top bar
        top = QHBoxLayout()
        top.setSpacing(8)
        top.addWidget(QLabel("Material"))
        self.cmb_material = QComboBox(); self.cmb_material.setFixedWidth(140)
        top.addWidget(self.cmb_material)
        top.addSpacing(20)
        top.addWidget(QLabel("Online"))
        dot = QLabel("●"); dot.setStyleSheet(f"color: {C_GREEN};")
        top.addWidget(dot)
        self.cmb_location = QComboBox()
        self.cmb_location.addItem("Local"); self.cmb_location.setFixedWidth(150)
        top.addWidget(self.cmb_location)
        top.addStretch()
        top.addWidget(QLabel("Machine"))
        self.cmb_machine = QComboBox(); self.cmb_machine.setFixedWidth(150)
        top.addWidget(self.cmb_machine)
        root.addLayout(top)

        # Splitter: tree | detail panel
        split = QSplitter(Qt.Horizontal)

        # ── Left: tool tree ──
        left_w = QWidget()
        left_lay = QVBoxLayout(left_w)
        left_lay.setContentsMargins(0, 0, 0, 0)
        left_lay.setSpacing(4)

        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setMinimumWidth(230)
        self.tree.setAnimated(True)
        left_lay.addWidget(self.tree, 1)

        # Toolbar buttons
        tb = QHBoxLayout()
        tb.setSpacing(2)
        self.btn_add_tool  = self._icon_btn("＋",  "Add tool under selected group")
        self.btn_add_group = self._icon_btn("⊞",  "Add group")
        self.btn_copy_tool = self._icon_btn("⧉",  "Copy selected tool / group")
        tb.addWidget(self.btn_add_tool)
        tb.addWidget(self.btn_add_group)
        tb.addWidget(self.btn_copy_tool)
        tb.addStretch()
        self.btn_import_db = self._icon_btn("📁", "Import tool database (.vtdb)")
        self.btn_export_db = self._icon_btn("💾", "Export selected tool / group")
        self.btn_delete    = self._icon_btn("🗑",  "Remove selected tool or group")
        tb.addWidget(self.btn_import_db)
        tb.addWidget(self.btn_export_db)
        tb.addWidget(self.btn_delete)
        left_lay.addLayout(tb)
        split.addWidget(left_w)

        # ── Right: detail panel ──
        right_w = QWidget()
        right_lay = QVBoxLayout(right_w)
        right_lay.setContentsMargins(6, 0, 0, 0)
        right_lay.setSpacing(4)

        # Title row
        title_row = QHBoxLayout()
        self.lbl_edit_icon = QLabel("✎")
        self.lbl_edit_icon.setStyleSheet(f"color: {C_DIM}; font-size: 14px;")
        self.txt_name = QLineEdit()
        self.txt_name.setPlaceholderText("Tool name")
        self.txt_name.setStyleSheet(
            f"font-weight:700; font-size:13px; background:#111820; "
            f"color:{C_TEXT}; border:1px solid {C_BORDER}; border-radius:3px; padding:4px;")
        title_row.addWidget(self.lbl_edit_icon)
        title_row.addWidget(self.txt_name, 1)
        right_lay.addLayout(title_row)

        # Notes + Variables
        notes_row = QHBoxLayout()
        self.txt_notes = QTextEdit()
        self.txt_notes.setFixedHeight(54)
        self.txt_notes.setPlaceholderText("Notes...")
        notes_row.addWidget(self.txt_notes, 1)
        self.btn_vars = QPushButton("Variables")
        self.btn_vars.setFixedWidth(80)
        notes_row.addWidget(self.btn_vars, 0, Qt.AlignTop)
        right_lay.addLayout(notes_row)

        # Main area: form + preview
        mid = QHBoxLayout()
        mid.setSpacing(8)

        # Scrollable form
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        form_container = QWidget()
        self._vlay = QVBoxLayout(form_container)
        self._vlay.setContentsMargins(0, 0, 4, 0)
        self._vlay.setSpacing(2)
        self._build_form()
        self._vlay.addStretch()
        scroll.setWidget(form_container)
        mid.addWidget(scroll, 1)

        # Preview
        self.preview = ToolPreview()
        mid.addWidget(self.preview, 0)
        right_lay.addLayout(mid, 1)

        # Bottom buttons
        btn_row = QHBoxLayout()
        self.btn_remove = QPushButton("Remove")
        self.btn_apply  = QPushButton("Apply")
        self.btn_select = QPushButton("Select")
        self.btn_select.setProperty("primary", True)
        self.btn_close  = QPushButton("Close")
        btn_row.addWidget(self.btn_remove)
        btn_row.addWidget(self.btn_apply)
        btn_row.addStretch()
        btn_row.addWidget(self.btn_select)
        btn_row.addWidget(self.btn_close)
        right_lay.addLayout(btn_row)
        split.addWidget(right_w)
        split.setSizes([240, 780])
        root.addWidget(split, 1)

        # Connections
        self.tree.currentItemChanged.connect(self._on_tree_changed)
        self.cmb_material.currentIndexChanged.connect(self._refresh_current)
        self.cmb_machine.currentIndexChanged.connect(self._refresh_current)
        self.btn_select.clicked.connect(self.accept)
        self.btn_close.clicked.connect(self.reject)
        self.btn_apply.clicked.connect(self._apply_edits)
        self.btn_remove.clicked.connect(self._remove_selected)
        self.btn_delete.clicked.connect(self._remove_selected)
        self.btn_add_tool.clicked.connect(self._add_tool)
        self.btn_add_group.clicked.connect(self._add_group)
        self.btn_copy_tool.clicked.connect(self._copy_tool)
        self.btn_import_db.clicked.connect(self._import_db)
        self.btn_export_db.clicked.connect(self._export_db)
        self.btn_select.setEnabled(False)
        self.btn_apply.setEnabled(False)

    def _icon_btn(self, icon: str, tip: str) -> QPushButton:
        b = QPushButton(icon)
        b.setToolTip(tip)
        b.setFixedSize(28, 26)
        b.setStyleSheet(
            f"QPushButton{{background:{C_PANEL2};border:1px solid {C_BORDER};"
            f"border-radius:3px;font-size:13px;padding:0;}}"
            f"QPushButton:hover{{border-color:{C_ACCENT};}}"
        )
        return b

    # ── Form layout ────────────────────────────────────────────────────────────
    def _build_form(self):
        """Build all form rows. Rows stored as (container QWidget) for show/hide."""
        self._rows: Dict[str, QWidget] = {}

        def section(text):
            self._vlay.addWidget(_section_label(text))
            self._vlay.addWidget(_hline())

        def row(key: str, label: str, widget: QWidget,
                suffix: str = "", bold_label: bool = False):
            c = QWidget()
            lay = QHBoxLayout(c)
            lay.setContentsMargins(0, 1, 0, 1)
            lay.setSpacing(6)
            lbl = QLabel(label)
            lbl.setFixedWidth(160)
            if bold_label:
                lbl.setStyleSheet("font-weight:700;")
            lay.addWidget(lbl)
            lay.addWidget(widget, 1)
            if suffix:
                suf = QLabel(suffix)
                suf.setStyleSheet(f"color:{C_DIM};")
                lay.addWidget(suf)
            self._vlay.addWidget(c)
            self._rows[key] = c
            return c

        # ── Tool Type ──────────────────────────────────────────────────────────
        section("Tool Type")
        self.cmb_type = QComboBox()
        self.cmb_type.addItems(TOOL_TYPE_DISPLAY_ORDER)
        self.cmb_type.currentTextChanged.connect(self._on_type_changed)
        row("tool_type", "Tool Type", self.cmb_type)

        # ── Geometry ───────────────────────────────────────────────────────────
        section("Geometry")
        self.cmb_units = QComboBox()
        self.cmb_units.addItem("mm"); self.cmb_units.addItem("inches")
        row("units", "Units", self.cmb_units)

        self.sp_diameter = self._dspin(0, 500, dec=3)
        self.sp_diameter.valueChanged.connect(self._on_diameter_changed)
        row("diameter", "Diameter (D)", self.sp_diameter, "mm")

        self.sp_angle = self._dspin(0, 360, dec=2)
        row("angle", "Included Angle (A)", self.sp_angle, "degrees")

        self.sp_side_angle = self._dspin(0, 180, dec=2)
        row("side_angle", "Side Angle", self.sp_side_angle, "degrees")

        self.sp_flat = self._dspin(0, 500, dec=3)
        self.sp_flat.valueChanged.connect(self._on_flat_changed)
        row("flat", "Flat Diameter (F)", self.sp_flat, "mm")

        self.sp_flutes = QSpinBox()
        self.sp_flutes.setRange(0, 20)
        self.sp_flutes.valueChanged.connect(self._update_chip_load)
        row("flutes", "No. Flutes", self.sp_flutes)

        # ── Cutting Parameters ─────────────────────────────────────────────────
        section("Cutting Parameters")

        self.sp_pass_depth = self._dspin(0, 500, dec=3)
        row("pass_depth", "Pass Depth", self.sp_pass_depth, "mm")

        self.sw_stepover = StepoverWidget()
        row("stepover", "Stepover", self.sw_stepover)

        self.sw_clear = StepoverWidget()
        row("clear_stepover", "Clearance Stepover", self.sw_clear)

        # ── Feeds and Speeds ───────────────────────────────────────────────────
        section("Feeds and Speeds")

        self.sp_rpm = QSpinBox()
        self.sp_rpm.setRange(0, 100000)
        self.sp_rpm.setSingleStep(100)
        self.sp_rpm.valueChanged.connect(self._update_chip_load)
        row("rpm", "Spindle Speed", self.sp_rpm, "RPM")

        feed_w = QWidget()
        feed_lay = QHBoxLayout(feed_w)
        feed_lay.setContentsMargins(0, 0, 0, 0)
        feed_lay.setSpacing(4)
        self.sp_feed = self._dspin(0, 999999, dec=3)
        self.sp_feed.valueChanged.connect(self._update_chip_load)
        self.cmb_feed_units = QComboBox()
        self.cmb_feed_units.setFixedWidth(90)
        for u in RATE_UNITS.values():
            self.cmb_feed_units.addItem(u)
        self.cmb_feed_units.currentIndexChanged.connect(self._update_chip_load)
        feed_lay.addWidget(self.sp_feed, 1)
        feed_lay.addWidget(self.cmb_feed_units)
        row("feed", "Feed Rate", feed_w)

        plunge_w = QWidget()
        plunge_lay = QHBoxLayout(plunge_w)
        plunge_lay.setContentsMargins(0, 0, 0, 0)
        plunge_lay.setSpacing(4)
        self.sp_plunge = self._dspin(0, 999999, dec=3)
        self.cmb_plunge_units = QComboBox()
        self.cmb_plunge_units.setFixedWidth(90)
        for u in RATE_UNITS.values():
            self.cmb_plunge_units.addItem(u)
        plunge_lay.addWidget(self.sp_plunge, 1)
        plunge_lay.addWidget(self.cmb_plunge_units)
        row("plunge", "Plunge Rate", plunge_w)

        self.sp_chip = self._dspin(0, 9999, dec=6)
        self.sp_chip.setReadOnly(True)
        self.sp_chip.setButtonSymbols(QDoubleSpinBox.NoButtons)
        row("chip", "Chip Load", self.sp_chip, "mm")

        self.sp_tool_num = QSpinBox()
        self.sp_tool_num.setRange(0, 9999)
        row("tool_number", "Tool Number", self.sp_tool_num)

        # ── Copy Settings From ─────────────────────────────────────────────────
        section("Copy Settings From")
        copy_w = QWidget()
        copy_lay = QHBoxLayout(copy_w)
        copy_lay.setContentsMargins(0, 0, 0, 0)
        copy_lay.setSpacing(4)
        self.cmb_copy_tool = QComboBox()
        self.cmb_copy_tool.addItem("<This Tool>")
        self.cmb_copy_size = QComboBox()
        for s in ["Small", "Medium", "Large"]:
            self.cmb_copy_size.addItem(s)
        self.cmb_copy_size.setCurrentText("Large")
        self.cmb_copy_mat = QComboBox()
        self.btn_copy_settings = QPushButton("Copy")
        self.btn_copy_settings.setFixedWidth(60)
        self.btn_copy_settings.clicked.connect(self._copy_settings)
        copy_lay.addWidget(self.cmb_copy_tool, 2)
        copy_lay.addWidget(self.cmb_copy_size, 1)
        copy_lay.addWidget(self.cmb_copy_mat, 1)
        copy_lay.addWidget(self.btn_copy_settings)
        self._rows["copy_section"] = copy_w
        self._vlay.addWidget(copy_w)

    @staticmethod
    def _dspin(lo=0, hi=9999, dec=3) -> QDoubleSpinBox:
        s = QDoubleSpinBox()
        s.setRange(lo, hi)
        s.setDecimals(dec)
        return s

    # ── Data load ──────────────────────────────────────────────────────────────
    def _load_data(self):
        mats = self.db.materials()
        self.cmb_material.addItems(mats)
        self.cmb_machine.addItems(self.db.machines())
        self.cmb_copy_mat.addItems(mats)
        if "MDF" in mats:
            self.cmb_copy_mat.setCurrentText("MDF")
        self._build_tree()

    def _build_tree(self):
        self.tree.clear()
        rows = self.db.tree_rows()
        items: Dict[str, QTreeWidgetItem] = {}
        pending = list(rows)
        # Iterative topological build
        while pending:
            progress = False
            for row in pending[:]:
                pid = row.get("parent_group_id")
                if pid and pid not in items:
                    continue
                name     = row.get("name") or ""
                geom_id  = row.get("tool_geometry_id") or ""
                entry_id = row.get("id") or ""

                if not name and geom_id:
                    type_int  = row.get("tool_type") or 1
                    type_name = TOOL_TYPE_INT.get(type_int, "End Mill")
                    dia       = float(row.get("diameter")       or 6.0)
                    angle     = float(row.get("included_angle") or 0.0)
                    flat      = float(row.get("flat_diameter")  or 0.0)
                    name = _make_tool_name(type_name, dia, angle, flat)

                item = QTreeWidgetItem([name or "(unnamed)"])
                item.setData(0, Qt.UserRole,     geom_id)
                item.setData(0, Qt.UserRole + 1, entry_id)

                if geom_id:
                    item.setForeground(0, QColor(C_TEXT))
                else:
                    item.setForeground(0, QColor(C_ACCENT))
                    f = item.font(0)
                    f.setBold(True)
                    item.setFont(0, f)

                if pid:
                    items[pid].addChild(item)
                else:
                    self.tree.addTopLevelItem(item)

                items[entry_id] = item
                if row.get("expanded"):
                    item.setExpanded(True)
                pending.remove(row)
                progress = True
            if not progress:
                break
        self.tree.expandToDepth(0)

    # ── Tree events ────────────────────────────────────────────────────────────
    def _on_tree_changed(self, item, _prev=None):
        if not item:
            return
        geom_id = item.data(0, Qt.UserRole)
        self._current_geom_id = geom_id or ""
        if not geom_id:
            self.selected_tool = None
            self.btn_select.setEnabled(False)
            self.btn_apply.setEnabled(False)
            self.txt_name.setText(item.text(0))
            self.txt_notes.clear()
            self.preview.set_tool(None)
            return
        tool = self.db.get_tool(
            geom_id,
            self.cmb_material.currentText() or "MDF",
            self.cmb_machine.currentText()   or "Desktop",
        )
        self.selected_tool = tool
        self._show_tool(tool)

    def _refresh_current(self):
        item = self.tree.currentItem()
        if item:
            self._on_tree_changed(item)

    # ── Show tool in form ──────────────────────────────────────────────────────
    def _show_tool(self, t: Optional[AspireTool]):
        self.btn_select.setEnabled(bool(t))
        self.btn_apply.setEnabled(bool(t))
        if not t:
            return
        self._updating_fields = True

        self.txt_name.setText(t.name)
        self.txt_notes.setPlainText(t.notes)

        idx = self.cmb_type.findText(t.tool_type)
        if idx >= 0:
            self.cmb_type.setCurrentIndex(idx)

        self.sp_diameter.setValue(t.diameter)
        self.sp_angle.setValue(t.included_angle)
        self.sp_side_angle.setValue(t.side_angle)
        self.sp_flat.setValue(t.flat_diameter)
        self.sp_flutes.setValue(t.flutes)
        self.sp_pass_depth.setValue(t.pass_depth)

        # Stepover widgets
        is_engrave = (t.tool_type == "Engraving")
        self.sw_stepover.set_diameter(t.diameter, t.flat_diameter, is_engrave)
        self.sw_stepover.set_value_mm(t.stepover)
        self.sw_clear.set_diameter(t.diameter)
        self.sw_clear.set_value_mm(t.clear_stepover)

        self.sp_rpm.setValue(t.spindle_rpm)
        self.sp_feed.setValue(t.feed_rate)
        self.sp_plunge.setValue(t.plunge_rate)

        # Set unit dropdowns
        unit_idx = t.rate_units if 0 <= t.rate_units < self.cmb_feed_units.count() else 1
        self.cmb_feed_units.setCurrentIndex(unit_idx)
        self.cmb_plunge_units.setCurrentIndex(unit_idx)

        self.sp_tool_num.setValue(t.tool_number)

        self._updating_fields = False
        self._update_chip_load()
        self._update_field_visibility(t.tool_type)
        self.preview.set_tool(t)

    # ── Field visibility ───────────────────────────────────────────────────────
    def _on_type_changed(self, type_name: str):
        self._update_field_visibility(type_name)

    def _update_field_visibility(self, t: str):
        has_angle   = t in ("V-Bit", "Drill", "Specialist")
        has_side    = (t == "Engraving")
        has_flat    = (t == "Engraving")
        has_flutes  = t not in ("Form Tool", "Drill", "Specialist", "Laser")
        has_step    = t not in ("Form Tool", "Drill", "Specialist", "Laser")
        has_clear   = (t == "V-Bit")
        has_passdep = t not in ("Form Tool", "Specialist", "Laser")
        has_chip    = t not in ("Form Tool", "Drill", "Specialist", "Laser")

        def sv(key, visible):
            w = self._rows.get(key)
            if w:
                w.setVisible(visible)

        sv("angle",          has_angle)
        sv("side_angle",     has_side)
        sv("flat",           has_flat)
        sv("flutes",         has_flutes)
        sv("pass_depth",     has_passdep)
        sv("stepover",       has_step)
        sv("clear_stepover", has_clear)
        sv("chip",           has_chip)

        # Update stepover ref on type change
        if has_flat:
            self.sw_stepover.set_diameter(
                self.sp_diameter.value(),
                self.sp_flat.value(),
                ref_is_flat=True)
        else:
            self.sw_stepover.set_diameter(self.sp_diameter.value())

    def _on_diameter_changed(self, dia: float):
        is_eng = (self.cmb_type.currentText() == "Engraving")
        self.sw_stepover.set_diameter(dia, self.sp_flat.value(), is_eng)
        self.sw_clear.set_diameter(dia)

    def _on_flat_changed(self, flat: float):
        if self.cmb_type.currentText() == "Engraving":
            self.sw_stepover.set_diameter(self.sp_diameter.value(), flat, True)

    def _update_chip_load(self):
        if self._updating_fields:
            return
        rpm    = self.sp_rpm.value()
        flutes = self.sp_flutes.value()
        feed   = self.sp_feed.value()
        u_idx  = self.cmb_feed_units.currentIndex()
        factor = RATE_TO_MM_MIN.get(u_idx, 1.0)
        feed_mm_min = feed * factor
        if rpm and flutes:
            cl = feed_mm_min / (rpm * flutes)
        else:
            cl = 0.0
        self.sp_chip.setValue(cl)

    # ── Apply edits ────────────────────────────────────────────────────────────
    def _apply_edits(self):
        if not self.selected_tool:
            return
        t = self.selected_tool

        t.name          = self.txt_name.text().strip() or t.name
        t.notes         = self.txt_notes.toPlainText()
        t.tool_type     = self.cmb_type.currentText()
        t.diameter      = self.sp_diameter.value()
        t.flat_diameter = self.sp_flat.value()
        t.flutes        = self.sp_flutes.value()
        t.pass_depth    = self.sp_pass_depth.value()
        t.stepover      = self.sw_stepover.value_mm()
        t.clear_stepover = self.sw_clear.value_mm()
        t.spindle_rpm   = self.sp_rpm.value()
        t.feed_rate     = self.sp_feed.value()
        t.plunge_rate   = self.sp_plunge.value()
        t.rate_units    = self.cmb_feed_units.currentIndex()
        t.tool_number   = self.sp_tool_num.value()

        # Side Angle → Included Angle (Engraving)
        if t.tool_type == "Engraving":
            t.included_angle = self.sp_side_angle.value() * 2.0
        else:
            t.included_angle = self.sp_angle.value()

        try:
            self.db.save_tool(t)
        except Exception as e:
            QMessageBox.warning(self, "Apply", f"Could not save changes:\n{e}")
            return

        # Refresh tree item name
        item = self.tree.currentItem()
        if item:
            item.setText(0, t.name)
        self.preview.set_tool(t)

    # ── Copy Settings ──────────────────────────────────────────────────────────
    def _copy_settings(self):
        """Copy cutting parameters from another material to the current."""
        if not self.selected_tool:
            return
        src_mat = self.cmb_copy_mat.currentText()
        if src_mat == (self.cmb_material.currentText() or "MDF"):
            return
        src = self.db.get_tool(
            self._current_geom_id, src_mat,
            self.cmb_machine.currentText() or "Desktop")
        if not src:
            QMessageBox.warning(self, "Copy Settings",
                                f"No data for material: {src_mat}")
            return
        self._updating_fields = True
        self.sp_rpm.setValue(src.spindle_rpm)
        self.sp_feed.setValue(src.feed_rate)
        self.sp_plunge.setValue(src.plunge_rate)
        self.sp_pass_depth.setValue(src.pass_depth)
        self.sw_stepover.set_value_mm(src.stepover)
        self.sw_clear.set_value_mm(src.clear_stepover)
        self._updating_fields = False
        self._update_chip_load()

    # ── Tree selection helpers ─────────────────────────────────────────────────
    def _selected_entry_id(self) -> str:
        item = self.tree.currentItem()
        return item.data(0, Qt.UserRole + 1) if item else ""

    def _selected_geom_id(self) -> str:
        item = self.tree.currentItem()
        return item.data(0, Qt.UserRole) if item else ""

    def _selected_group_id(self) -> str:
        item = self.tree.currentItem()
        if not item:
            return ""
        if not item.data(0, Qt.UserRole):
            return item.data(0, Qt.UserRole + 1)
        parent = item.parent()
        return parent.data(0, Qt.UserRole + 1) if parent else ""

    # ── CRUD ───────────────────────────────────────────────────────────────────
    def _add_group(self):
        if not self.db.available():
            QMessageBox.warning(self, "Add Group", "No tool database found.")
            return
        name, ok = QInputDialog.getText(self, "Add Group", "Group name:")
        if not ok or not name.strip():
            return
        parent_id = self._selected_group_id() or None
        gid = str(uuid.uuid4())
        try:
            with sqlite3.connect(self.db.path) as con:
                order = con.execute(
                    "select coalesce(max(sibling_order),0)+1 "
                    "from tool_tree_entry where parent_group_id is ?",
                    (parent_id,)).fetchone()[0]
                con.execute(
                    "insert into tool_tree_entry"
                    "(id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded)"
                    " values(?,?,?,?,?,?,?)",
                    (gid, parent_id, order, None, name.strip(), "", 1))
                con.commit()
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Add Group", str(e))

    def _add_tool(self):
        if not self.db.available():
            QMessageBox.warning(self, "Add Tool", "No tool database found.")
            return
        group_id = self._selected_group_id()
        if not group_id:
            QMessageBox.warning(self, "Add Tool",
                                "Please select a tool group first.")
            return
        name, ok = QInputDialog.getText(
            self, "Add Tool", "Tool name:", text="End Mill (6 mm)")
        if not ok or not name.strip():
            return
        geom_id = str(uuid.uuid4())
        cut_id  = str(uuid.uuid4())
        ent_id  = str(uuid.uuid4())
        entry_id = str(uuid.uuid4())
        try:
            with sqlite3.connect(self.db.path) as con:
                mat  = con.execute(
                    "select id from material where name=?",
                    (self.cmb_material.currentText(),)).fetchone()
                mach = con.execute(
                    "select id from machine where name=?",
                    (self.cmb_machine.currentText(),)).fetchone()
                mat_id  = mat[0]  if mat  else None
                mach_id = mach[0] if mach else None
                con.execute(
                    "insert into tool_geometry"
                    "(id,name_format,notes,tool_type,units,"
                    " diameter,included_angle,flat_diameter,num_flutes)"
                    " values(?,?,?,?,?,?,?,?,?)",
                    (geom_id, "{Tool Type} ({Diameter|F}{Units Short})",
                     "", 1, 0, 6.0, None, None, 2))
                con.execute(
                    "insert into tool_cutting_data"
                    "(id,rate_units,feed_rate,plunge_rate,spindle_speed,"
                    " spindle_dir,stepdown,stepover,clear_stepover,"
                    " length_units,tool_number)"
                    " values(?,?,?,?,?,?,?,?,?,?,?)",
                    (cut_id, 1, 3000.0, 800.0, 18000, 0,
                     6.0, 2.4, 0.0, 0, 1))
                con.execute(
                    "insert into tool_entity"
                    "(id,material_id,machine_id,tool_geometry_id,tool_cutting_data_id)"
                    " values(?,?,?,?,?)",
                    (ent_id, mat_id, mach_id, geom_id, cut_id))
                order = con.execute(
                    "select coalesce(max(sibling_order),0)+1 "
                    "from tool_tree_entry where parent_group_id=?",
                    (group_id,)).fetchone()[0]
                con.execute(
                    "insert into tool_tree_entry"
                    "(id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded)"
                    " values(?,?,?,?,?,?,?)",
                    (entry_id, group_id, order, geom_id, name.strip(), "", 0))
                con.commit()
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Add Tool", str(e))

    def _copy_tool(self):
        gid = self._selected_geom_id()
        if not gid:
            QMessageBox.warning(self, "Copy", "Select a tool to copy.")
            return
        group_id = self._selected_group_id()
        try:
            with sqlite3.connect(self.db.path) as con:
                con.row_factory = sqlite3.Row
                geom   = con.execute(
                    "select * from tool_geometry where id=?",
                    (gid,)).fetchone()
                tree   = con.execute(
                    "select * from tool_tree_entry where tool_geometry_id=? limit 1",
                    (gid,)).fetchone()
                entity = con.execute(
                    "select * from tool_entity where tool_geometry_id=? limit 1",
                    (gid,)).fetchone()
                if not geom:
                    return
                new_geom_id  = str(uuid.uuid4())
                new_entry_id = str(uuid.uuid4())
                gcols = list(geom.keys())
                gvals = [geom[c] for c in gcols]
                gvals[gcols.index("id")] = new_geom_id
                con.execute(
                    f"insert into tool_geometry({','.join(gcols)})"
                    f" values({','.join(['?']*len(gcols))})",
                    gvals)
                if entity:
                    cut = con.execute(
                        "select * from tool_cutting_data where id=?",
                        (entity["tool_cutting_data_id"],)).fetchone()
                    if cut:
                        new_cut_id = str(uuid.uuid4())
                        new_ent_id = str(uuid.uuid4())
                        ccols = list(cut.keys())
                        cvals = [cut[c] for c in ccols]
                        cvals[ccols.index("id")] = new_cut_id
                        con.execute(
                            f"insert into tool_cutting_data({','.join(ccols)})"
                            f" values({','.join(['?']*len(ccols))})",
                            cvals)
                        con.execute(
                            "insert into tool_entity"
                            "(id,material_id,machine_id,tool_geometry_id,tool_cutting_data_id)"
                            " values(?,?,?,?,?)",
                            (new_ent_id, entity["material_id"],
                             entity["machine_id"], new_geom_id, new_cut_id))
                order = con.execute(
                    "select coalesce(max(sibling_order),0)+1 "
                    "from tool_tree_entry where parent_group_id=?",
                    (group_id,)).fetchone()[0]
                orig_name = tree["name"] if tree else "Tool"
                con.execute(
                    "insert into tool_tree_entry"
                    "(id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded)"
                    " values(?,?,?,?,?,?,?)",
                    (new_entry_id, group_id, order,
                     new_geom_id, f"{orig_name} (Copy)",
                     tree["notes"] if tree else "", 0))
                con.commit()
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Copy", str(e))

    def _remove_selected(self):
        item = self.tree.currentItem()
        if not item or not self.db.available():
            return
        entry_id = self._selected_entry_id()
        geom_id  = self._selected_geom_id()
        name     = item.text(0)
        ans = QMessageBox.question(
            self, "Remove", f"Remove '{name}'?",
            QMessageBox.Yes | QMessageBox.No)
        if ans != QMessageBox.Yes:
            return
        try:
            with sqlite3.connect(self.db.path) as con:
                if geom_id:
                    ents = con.execute(
                        "select id,tool_cutting_data_id from tool_entity "
                        "where tool_geometry_id=?",
                        (geom_id,)).fetchall()
                    con.execute(
                        "delete from tool_tree_entry where id=?", (entry_id,))
                    con.execute(
                        "delete from tool_entity where tool_geometry_id=?",
                        (geom_id,))
                    con.execute(
                        "delete from tool_geometry where id=?", (geom_id,))
                    for _, cut_id in ents:
                        con.execute(
                            "delete from tool_cutting_data where id=?",
                            (cut_id,))
                else:
                    if item.childCount():
                        QMessageBox.warning(
                            self, "Remove",
                            "Group is not empty. Remove its tools first.")
                        return
                    con.execute(
                        "delete from tool_tree_entry where id=?", (entry_id,))
                con.commit()
            self.selected_tool = None
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Remove", str(e))

    def _import_db(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Import Tool Database", str(Path.home()),
            "Vectric Tool DB (*.vtdb *.vectric);;All Files (*)")
        if not path:
            return
        try:
            DATABASE_DIR.mkdir(exist_ok=True)
            shutil.copy2(path, DEFAULT_VTDB)
            self.db = AspireToolDatabase(DEFAULT_VTDB)
            self.cmb_material.clear()
            self.cmb_material.addItems(self.db.materials())
            self.cmb_machine.clear()
            self.cmb_machine.addItems(self.db.machines())
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Import", str(e))

    def _export_db(self):
        if not self.db.available():
            QMessageBox.warning(self, "Export", "No tool database found.")
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Export Tool Database",
            str(Path.home() / "aspire_tools.vtdb"),
            "Vectric Tool DB (*.vtdb);;All Files (*)")
        if not path:
            return
        try:
            shutil.copy2(self.db.path, path)
        except Exception as e:
            QMessageBox.warning(self, "Export", str(e))

    def accept(self):
        if self.selected_tool:
            self._apply_edits()
        super().accept()


# ── Standalone launch helper ───────────────────────────────────────────────────
def ensure_default_database():
    DATABASE_DIR.mkdir(exist_ok=True)
    if DEFAULT_VTDB.exists():
        return
    for candidate in [BASE_DIR / "tools.vtdb",
                      BASE_DIR / "aspire_tools.vtdb"]:
        if candidate.exists():
            shutil.copy2(candidate, DEFAULT_VTDB)
            return


if __name__ == "__main__":
    import sys
    from PySide6.QtWidgets import QApplication
    ensure_default_database()
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    dlg = AspireToolDatabaseDialog()
    if dlg.exec() == QDialog.Accepted and dlg.selected_tool:
        t = dlg.selected_tool
        print(f"Selected: {t.name}")
        print(f"  Type:    {t.tool_type}")
        print(f"  Ø:       {t.diameter} mm")
        print(f"  Feed:    {t.feed_rate} {RATE_UNITS.get(t.rate_units,'?')}")
        print(f"  RPM:     {t.spindle_rpm}")
        print(f"  Chip:    {t.chip_load():.6f} mm")
    sys.exit(0)
