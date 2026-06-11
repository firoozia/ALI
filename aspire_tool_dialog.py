"""
FIROO CAM - Aspire-style Tool Database Dialog
Reads Vectric Aspire .vtdb SQLite tool database and presents an Aspire-like picker.
"""
from __future__ import annotations

import json
import math
import shutil
import sqlite3
import uuid
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PySide6.QtCore import Qt, QRectF, QPointF
from PySide6.QtGui import QColor, QPainter, QPen, QBrush
from PySide6.QtWidgets import (
    QDialog, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QFormLayout,
    QLabel, QComboBox, QTreeWidget, QTreeWidgetItem, QTextEdit, QLineEdit,
    QPushButton, QSplitter, QMessageBox, QDoubleSpinBox, QSpinBox,
    QFrame, QSizePolicy, QFileDialog, QInputDialog
)

BASE_DIR = Path(__file__).resolve().parent
DATABASE_DIR = BASE_DIR / "database"
DEFAULT_VTDB = DATABASE_DIR / "aspire_tools.vtdb"
FALLBACK_JSON = BASE_DIR / "tool_library.json"

TOOL_TYPE_NAMES = {
    0: "Ball Nose",
    1: "End Mill",
    2: "Radiused End Mill",
    3: "V-Bit",
    4: "Engraving",
    5: "Tapered Ball Nose",
    6: "Drill",
    8: "Form Tool",
    9: "Specialist",
}

TOOL_TYPE_KEYS = {
    "End Mill": "endmill",
    "Ball Nose": "ballnose",
    "V-Bit": "vbit",
    "Engraving": "vbit",
    "Form Tool": "form",
    "Drill": "drill",
    "Radiused End Mill": "endmill",
    "Tapered Ball Nose": "ballnose",
}

@dataclass
class AspireTool:
    tree_id: str = ""
    geometry_id: str = ""
    entity_id: str = ""
    name: str = ""
    notes: str = ""
    tool_type: str = "End Mill"
    tool_type_key: str = "endmill"
    units: str = "mm"
    diameter: float = 0.0
    angle: float = 0.0
    flat_diameter: float = 0.0
    flutes: int = 0
    pass_depth: float = 0.0
    stepover: float = 0.0
    clear_stepover: float = 0.0
    spindle_rpm: int = 0
    feed_rate: float = 0.0
    plunge_rate: float = 0.0
    tool_number: int = 0
    material: str = "MDF"
    machine: str = "Desktop"
    chip_load: float = 0.0

    def as_design_values(self) -> Dict[str, str]:
        return {
            "name": self.name,
            "tool_type": self.tool_type_key,
            "diameter": str(_clean_num(self.diameter)),
            "angle": str(_clean_num(self.angle)),
            "rpm": str(int(self.spindle_rpm or 0)),
            "feed": str(_clean_num(self.feed_rate)),
            "plunge": str(_clean_num(self.plunge_rate)),
            "pass_depth": str(_clean_num(self.pass_depth)),
            "tool_number": str(int(self.tool_number or 0)),
            "flutes": str(int(self.flutes or 0)),
            "stepover": str(_clean_num(self.stepover)),
        }


def _clean_num(v):
    try:
        f = float(v)
    except Exception:
        return v
    if abs(f - int(f)) < 1e-9:
        return int(f)
    return round(f, 4)


def _fmt_mm(v: Optional[float], suffix: str = " mm") -> str:
    try:
        if v is None:
            return ""
        return f"{_clean_num(float(v))}{suffix}"
    except Exception:
        return ""


class AspireToolDatabase:
    """Small reader for Aspire/Vectric .vtdb SQLite tool database."""

    def __init__(self, path: Path = DEFAULT_VTDB):
        self.path = Path(path)
        self._json_tools: List[AspireTool] = []
        self.is_sqlite = self.path.exists()
        if not self.is_sqlite and FALLBACK_JSON.exists():
            self._load_json_fallback()

    def available(self) -> bool:
        return self.path.exists() or bool(self._json_tools)

    def materials(self) -> List[str]:
        if self.path.exists():
            try:
                with sqlite3.connect(self.path) as con:
                    return [r[0] for r in con.execute("select name from material order by name")]
            except Exception:
                pass
        return sorted(set(t.material for t in self._json_tools)) or ["MDF"]

    def machines(self) -> List[str]:
        if self.path.exists():
            try:
                with sqlite3.connect(self.path) as con:
                    return [r[0] for r in con.execute("select name from machine order by name")]
            except Exception:
                pass
        return sorted(set(t.machine for t in self._json_tools)) or ["Desktop"]

    def tree_rows(self) -> List[Dict]:
        if self.path.exists():
            with sqlite3.connect(self.path) as con:
                con.row_factory = sqlite3.Row
                return [dict(r) for r in con.execute(
                    "select id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded "
                    "from tool_tree_entry order by parent_group_id is not null, sibling_order, name"
                )]
        # JSON fallback as groups + tools under Metric Tools
        rows = [{"id":"root","parent_group_id":None,"sibling_order":0,"tool_geometry_id":None,"name":"Metric Tools","notes":"FIROO JSON Tool Library","expanded":1}]
        groups: Dict[str, str] = {}
        for t in self._json_tools:
            g = t.tool_type or "Tools"
            if g not in groups:
                gid = f"grp_{g}"
                groups[g] = gid
                rows.append({"id":gid,"parent_group_id":"root","sibling_order":len(groups),"tool_geometry_id":None,"name":g,"notes":"","expanded":1})
            rows.append({"id":t.geometry_id,"parent_group_id":groups[g],"sibling_order":len(rows),"tool_geometry_id":t.geometry_id,"name":t.name,"notes":t.notes,"expanded":0})
        return rows

    def get_tool_by_geometry(self, geometry_id: str, material: str = "MDF", machine: str = "Desktop") -> Optional[AspireTool]:
        if not geometry_id:
            return None
        if self.path.exists():
            return self._get_sqlite_tool(geometry_id, material, machine)
        for t in self._json_tools:
            if t.geometry_id == geometry_id:
                return t
        return None

    def _get_sqlite_tool(self, geometry_id: str, material: str, machine: str) -> Optional[AspireTool]:
        with sqlite3.connect(self.path) as con:
            con.row_factory = sqlite3.Row
            geom = con.execute("select * from tool_geometry where id=?", (geometry_id,)).fetchone()
            if not geom:
                return None
            mat = con.execute("select id,name from material where name=?", (material,)).fetchone()
            mach = con.execute("select id,name from machine where name=?", (machine,)).fetchone()
            mat_id = mat["id"] if mat else None
            mach_id = mach["id"] if mach else None
            entity = None
            if mat_id and mach_id:
                entity = con.execute(
                    "select * from tool_entity where tool_geometry_id=? and material_id=? and machine_id=? limit 1",
                    (geometry_id, mat_id, mach_id)).fetchone()
            if not entity and mat_id:
                entity = con.execute(
                    "select * from tool_entity where tool_geometry_id=? and material_id=? limit 1",
                    (geometry_id, mat_id)).fetchone()
            if not entity:
                entity = con.execute(
                    "select * from tool_entity where tool_geometry_id=? limit 1", (geometry_id,)).fetchone()
            cut = None
            if entity:
                cut = con.execute("select * from tool_cutting_data where id=?", (entity["tool_cutting_data_id"],)).fetchone()
            tree = con.execute("select * from tool_tree_entry where tool_geometry_id=? limit 1", (geometry_id,)).fetchone()
            return _tool_from_rows(geom, cut, entity, tree, material, machine)

    def _load_json_fallback(self):
        try:
            data = json.loads(FALLBACK_JSON.read_text(encoding="utf-8"))
            for td in data.get("tools", []):
                ttype_key = td.get("tool_type", "endmill")
                ttype = {
                    "endmill":"End Mill", "ballnose":"Ball Nose", "vbit":"V-Bit",
                    "drill":"Drill", "form":"Form Tool", "laser":"Laser"
                }.get(ttype_key, ttype_key)
                self._json_tools.append(AspireTool(
                    tree_id=td.get("tool_id", ""), geometry_id=td.get("tool_id", ""), entity_id=td.get("tool_id", ""),
                    name=td.get("name", ""), notes=td.get("notes", ""), tool_type=ttype,
                    tool_type_key=ttype_key, diameter=float(td.get("diameter", 0) or 0),
                    angle=float(td.get("angle", 0) or 0), flutes=int(td.get("flutes", 0) or 0),
                    pass_depth=float(td.get("pass_depth", 0) or 0), stepover=float(td.get("stepover", 0) or 0),
                    spindle_rpm=int(td.get("spindle_rpm", 0) or 0), feed_rate=float(td.get("feed_rate", 0) or 0),
                    plunge_rate=float(td.get("plunge_rate", 0) or 0), tool_number=_parse_tool_number(td.get("tool_id", "0")),
                    material=td.get("material", "MDF"), machine="Desktop"
                ))
        except Exception:
            self._json_tools = []


def _parse_tool_number(v) -> int:
    import re
    m = re.search(r"(\d+)", str(v or ""))
    return int(m.group(1)) if m else 0


def _tool_from_rows(geom, cut, entity, tree, material, machine) -> AspireTool:
    type_name = TOOL_TYPE_NAMES.get(int(geom["tool_type"]), "Tool")
    dia = float(geom["diameter"] or 0)
    inc = float(geom["included_angle"] or 0)
    flat = float(geom["flat_diameter"] or 0)
    name = tree["name"] if tree and tree["name"] else _make_tool_name(type_name, dia, inc, flat)
    feed = float(cut["feed_rate"] or 0) if cut else 0.0
    plunge = float(cut["plunge_rate"] or 0) if cut else 0.0
    rpm = int(cut["spindle_speed"] or 0) if cut else 0
    flutes = int(geom["num_flutes"] or 0)
    chip = 0.0
    if rpm and flutes and feed:
        chip = feed / (rpm * flutes)
    return AspireTool(
        tree_id=tree["id"] if tree else "", geometry_id=geom["id"], entity_id=entity["id"] if entity else "",
        name=name, notes=(geom["notes"] or (tree["notes"] if tree else "") or ""),
        tool_type=type_name, tool_type_key=TOOL_TYPE_KEYS.get(type_name, type_name.lower().replace(" ", "_")),
        units="mm", diameter=dia, angle=inc, flat_diameter=flat, flutes=flutes,
        pass_depth=float(cut["stepdown"] or 0) if cut else 0.0,
        stepover=float(cut["stepover"] or 0) if cut else 0.0,
        clear_stepover=float(cut["clear_stepover"] or 0) if cut else 0.0,
        spindle_rpm=rpm, feed_rate=feed, plunge_rate=plunge,
        tool_number=int(cut["tool_number"] or 0) if cut else 0,
        material=material, machine=machine, chip_load=chip,
    )


def _make_tool_name(type_name: str, dia: float, angle: float = 0.0, flat: float = 0.0) -> str:
    if type_name in ("V-Bit", "Drill") and angle:
        return f"{type_name} ({_clean_num(angle)}° - {_clean_num(dia)} mm)"
    if type_name == "Engraving":
        return f"Engraving ({_clean_num(angle/2 if angle else angle)}°, Tip {_clean_num(flat)} - {_clean_num(dia)} mm)"
    return f"{type_name} ({_clean_num(dia)} mm)"


class ToolPreview(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.tool: Optional[AspireTool] = None
        self.setMinimumSize(130, 160)

    def set_tool(self, tool: Optional[AspireTool]):
        self.tool = tool
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        try:
            p.setRenderHint(QPainter.Antialiasing)
            p.fillRect(self.rect(), QColor("#f4f4f4"))
            if not self.tool:
                return
            cx = self.width() * 0.55
            top = 30
            h = min(105, self.height() - 55)
            w = 34
            p.setPen(QPen(QColor("#999"), 1))
            p.setBrush(QBrush(QColor("#cfcfcf")))
            t = self.tool.tool_type
            if t == "V-Bit":
                p.drawRect(QRectF(cx-w/2, top, w, h*0.62))
                pts = [QPointF(cx-w/2, top+h*0.62), QPointF(cx+w/2, top+h*0.62), QPointF(cx, top+h)]
                p.drawPolygon(pts)
            elif t == "Ball Nose":
                p.drawRect(QRectF(cx-w/2, top, w, h*0.78))
                p.drawEllipse(QRectF(cx-w/2, top+h*0.65, w, w))
            elif t == "Form Tool":
                p.setBrush(Qt.NoBrush)
                path = QPainterPath()
                path.moveTo(cx-55, top+h*0.45); path.cubicTo(cx-35, top+h*0.45, cx-35, top+h*0.72, cx-18, top+h*0.72)
                path.lineTo(cx-8, top+h*0.86); path.lineTo(cx+8, top+h*0.86); path.lineTo(cx+18, top+h*0.72)
                path.cubicTo(cx+35, top+h*0.72, cx+35, top+h*0.45, cx+55, top+h*0.45)
                p.drawPath(path)
            elif t == "Engraving":
                p.drawRect(QRectF(cx-w/3, top, w*2/3, h*0.72))
                pts = [QPointF(cx-w/2, top+h*0.72), QPointF(cx+w/2, top+h*0.72), QPointF(cx, top+h)]
                p.drawPolygon(pts)
            else:
                p.drawRect(QRectF(cx-w/2, top, w, h))
                for i in range(4):
                    p.drawLine(QPointF(cx-w/2, top+i*h/4), QPointF(cx+w/2, top+i*h/4+h/5))
            p.setPen(QPen(QColor("#333"), 1))
            p.drawText(8, self.height()-18, self.tool.tool_type)
        finally:
            p.end()


class AspireToolDatabaseDialog(QDialog):
    def __init__(self, parent=None, db_path: Path = DEFAULT_VTDB):
        super().__init__(parent)
        self.setWindowTitle("Tool Database")
        self.resize(980, 620)
        self.db = AspireToolDatabase(db_path)
        self.selected_tool: Optional[AspireTool] = None
        self._build_ui()
        self._load_data()

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(8, 8, 8, 8)
        root.setSpacing(6)

        top = QHBoxLayout()
        top.addWidget(QLabel("Material"))
        self.cmb_material = QComboBox(); self.cmb_material.setFixedWidth(150)
        top.addWidget(self.cmb_material)
        top.addSpacing(18)
        top.addWidget(QLabel("Online")); top.addWidget(QLabel("●"))
        self.cmb_location = QComboBox(); self.cmb_location.addItems(["Local"]); self.cmb_location.setFixedWidth(160)
        top.addWidget(self.cmb_location)
        top.addStretch()
        top.addWidget(QLabel("Machine"))
        self.cmb_machine = QComboBox(); self.cmb_machine.setFixedWidth(160)
        top.addWidget(self.cmb_machine)
        root.addLayout(top)

        split = QSplitter(Qt.Horizontal)
        self.tree = QTreeWidget(); self.tree.setHeaderHidden(True); self.tree.setMinimumWidth(250)
        split.addWidget(self.tree)
        right = QWidget(); right_lay = QVBoxLayout(right); right_lay.setContentsMargins(8, 0, 0, 0)
        title_row = QHBoxLayout()
        self.lbl_title = QLabel("Select a tool")
        self.lbl_title.setStyleSheet("font-weight:700;")
        title_row.addWidget(QLabel("✎")); title_row.addWidget(self.lbl_title, 1)
        right_lay.addLayout(title_row)

        row_notes = QHBoxLayout()
        row_notes.addWidget(QLabel("Notes"))
        self.txt_notes = QTextEdit(); self.txt_notes.setFixedHeight(72)
        row_notes.addWidget(self.txt_notes, 1)
        self.btn_vars = QPushButton("Variables"); self.btn_vars.setFixedWidth(90)
        row_notes.addWidget(self.btn_vars)
        right_lay.addLayout(row_notes)

        mid = QHBoxLayout()
        form_widget = QWidget(); self.form = QGridLayout(form_widget); self.form.setHorizontalSpacing(8); self.form.setVerticalSpacing(5)
        self.widgets: Dict[str, QWidget] = {}
        self._add_fields()
        mid.addWidget(form_widget, 1)
        self.preview = ToolPreview(); mid.addWidget(self.preview)
        right_lay.addLayout(mid, 1)

        buttons = QHBoxLayout(); buttons.addStretch()
        self.btn_remove = QPushButton("Remove"); self.btn_apply = QPushButton("Apply")
        self.btn_select = QPushButton("Select"); self.btn_close = QPushButton("Close")
        buttons.addWidget(self.btn_remove); buttons.addWidget(self.btn_apply); buttons.addSpacing(20)
        buttons.addWidget(self.btn_select); buttons.addWidget(self.btn_close)
        right_lay.addLayout(buttons)
        split.addWidget(right)
        split.setSizes([260, 720])
        root.addWidget(split, 1)

        bottom_icons = QHBoxLayout()
        self.btn_add_tool = QPushButton("＋")
        self.btn_add_tool.setToolTip("Add Tool")
        self.btn_add_group = QPushButton("⚙")
        self.btn_add_group.setToolTip("Add Group")
        self.btn_copy = QPushButton("⧉")
        self.btn_copy.setToolTip("Copy Selected Tool")
        self.btn_import = QPushButton("📁")
        self.btn_import.setToolTip("Import Tool Database")
        self.btn_export = QPushButton("💾")
        self.btn_export.setToolTip("Export Tool Database")
        self.btn_delete_icon = QPushButton("🗑")
        self.btn_delete_icon.setToolTip("Remove Selected Tool or Group")
        for b in [self.btn_add_tool, self.btn_add_group, self.btn_copy, self.btn_import, self.btn_export, self.btn_delete_icon]:
            b.setFixedSize(28, 26)
            bottom_icons.addWidget(b)
        bottom_icons.addStretch()
        root.addLayout(bottom_icons)

        self.tree.currentItemChanged.connect(self._on_tree_changed)
        self.cmb_material.currentIndexChanged.connect(lambda: self._refresh_current())
        self.cmb_machine.currentIndexChanged.connect(lambda: self._refresh_current())
        self.btn_select.clicked.connect(self.accept)
        self.btn_close.clicked.connect(self.reject)
        self.btn_apply.clicked.connect(self._apply_edits_to_selected_tool)
        self.btn_remove.clicked.connect(self._remove_selected_entry)
        self.btn_delete_icon.clicked.connect(self._remove_selected_entry)
        self.btn_add_tool.clicked.connect(self._add_tool)
        self.btn_add_group.clicked.connect(self._add_group)
        self.btn_copy.clicked.connect(self._copy_selected_tool)
        self.btn_import.clicked.connect(self._import_database)
        self.btn_export.clicked.connect(self._export_database)
        self.btn_select.setEnabled(False)

    def _add_fields(self):
        r = 0
        self._section("Tool Type", r); r += 1
        self.cmb_type = QComboBox(); self.cmb_type.addItems(["End Mill", "Radiused End Mill", "V-Bit", "Ball Nose", "Engraving", "Tapered Ball Nose", "Form Tool", "Drill"])
        self._row("Tool Type", self.cmb_type, r); r += 1
        self._section("Geometry", r); r += 1
        self.cmb_units = QComboBox(); self.cmb_units.addItems(["mm"])
        self._row("Units", self.cmb_units, r); r += 1
        for key, label, suffix, spin in [
            ("diameter", "Diameter (D)", "mm", QDoubleSpinBox()),
            ("angle", "Included Angle (A)", "degrees", QDoubleSpinBox()),
            ("flat", "Flat Diameter (F)", "mm", QDoubleSpinBox()),
            ("flutes", "No. Flutes", "", QSpinBox()),
        ]:
            spin.setRange(0, 100000); spin.setDecimals(4) if hasattr(spin, 'setDecimals') else None
            self._row(label, spin, r, suffix); self.widgets[key] = spin; r += 1
        self._section("Cutting Parameters", r); r += 1
        for key, label, suffix in [
            ("pass_depth", "Pass Depth", "mm"),
            ("stepover", "Stepover", "mm"),
            ("clear_stepover", "Clearance Pass Stepover", "mm"),
        ]:
            sp = QDoubleSpinBox(); sp.setRange(0, 100000); sp.setDecimals(4)
            self._row(label, sp, r, suffix); self.widgets[key] = sp; r += 1
        self._section("Feeds and Speeds", r); r += 1
        for key, label, suffix, cls in [
            ("rpm", "Spindle Speed", "r.p.m", QSpinBox),
            ("feed", "Feed Rate", "mm/min", QDoubleSpinBox),
            ("plunge", "Plunge Rate", "mm/min", QDoubleSpinBox),
            ("chip", "Chip Load", "mm", QDoubleSpinBox),
        ]:
            sp = cls(); sp.setRange(0, 1000000)
            if isinstance(sp, QDoubleSpinBox): sp.setDecimals(4)
            self._row(label, sp, r, suffix); self.widgets[key] = sp; r += 1
        self._section("Tool Number", r); r += 1
        sp = QSpinBox(); sp.setRange(0, 9999); self._row("Tool Number", sp, r); self.widgets["tool_number"] = sp

    def _section(self, text, row):
        lab = QLabel(text); lab.setStyleSheet("font-weight:700;")
        self.form.addWidget(lab, row, 0, 1, 3)

    def _row(self, label, widget, row, suffix=""):
        self.form.addWidget(QLabel(label), row, 0)
        self.form.addWidget(widget, row, 1)
        if suffix:
            self.form.addWidget(QLabel(suffix), row, 2)

    def _load_data(self):
        if not self.db.available():
            QMessageBox.warning(self, "Tool Database", "Aspire tool database not found. Manual tool entry will remain available.")
        self.cmb_material.addItems(self.db.materials())
        self.cmb_machine.addItems(self.db.machines())
        self._build_tree()

    def _build_tree(self):
        self.tree.clear()
        rows = self.db.tree_rows()
        items: Dict[str, QTreeWidgetItem] = {}
        pending = list(rows)
        while pending:
            progress = False
            for row in pending[:]:
                parent_id = row.get("parent_group_id")
                parent_item = items.get(parent_id) if parent_id else None
                if parent_id and parent_id not in items:
                    continue
                name = row.get("name") or ""
                if row.get("tool_geometry_id"):
                    tool = self.db.get_tool_by_geometry(row.get("tool_geometry_id"), self.cmb_material.currentText() or "MDF", self.cmb_machine.currentText() or "Desktop")
                    name = row.get("name") or (tool.name if tool else "Tool")
                item = QTreeWidgetItem([name])
                item.setData(0, Qt.UserRole, row.get("tool_geometry_id") or "")
                item.setData(0, Qt.UserRole + 1, row.get("id"))
                if parent_item:
                    parent_item.addChild(item)
                else:
                    self.tree.addTopLevelItem(item)
                items[row.get("id")] = item
                if row.get("expanded"):
                    item.setExpanded(True)
                pending.remove(row); progress = True
            if not progress:
                break
        self.tree.expandToDepth(1)

    def _on_tree_changed(self, item, previous=None):
        if not item:
            return
        gid = item.data(0, Qt.UserRole)
        if not gid:
            self.selected_tool = None
            self.btn_select.setEnabled(False)
            self.lbl_title.setText(item.text(0))
            self.txt_notes.setPlainText("")
            self.preview.set_tool(None)
            return
        self.selected_tool = self.db.get_tool_by_geometry(gid, self.cmb_material.currentText() or "MDF", self.cmb_machine.currentText() or "Desktop")
        self._show_tool(self.selected_tool)

    def _refresh_current(self):
        item = self.tree.currentItem()
        if item:
            self._on_tree_changed(item)

    def _show_tool(self, t: Optional[AspireTool]):
        self.btn_select.setEnabled(bool(t))
        if not t:
            return
        self.lbl_title.setText(t.name)
        self.txt_notes.setPlainText(t.notes or "")
        idx = self.cmb_type.findText(t.tool_type)
        if idx >= 0: self.cmb_type.setCurrentIndex(idx)
        self.widgets["diameter"].setValue(t.diameter)
        self.widgets["angle"].setValue(t.angle)
        self.widgets["flat"].setValue(t.flat_diameter)
        self.widgets["flutes"].setValue(t.flutes)
        self.widgets["pass_depth"].setValue(t.pass_depth)
        self.widgets["stepover"].setValue(t.stepover)
        self.widgets["clear_stepover"].setValue(t.clear_stepover)
        self.widgets["rpm"].setValue(t.spindle_rpm)
        self.widgets["feed"].setValue(t.feed_rate)
        self.widgets["plunge"].setValue(t.plunge_rate)
        self.widgets["chip"].setValue(t.chip_load)
        self.widgets["tool_number"].setValue(t.tool_number)
        self._update_field_visibility(t.tool_type)
        self.preview.set_tool(t)

    def _update_field_visibility(self, tool_type: str):
        # Keep dialog simple and Aspire-like: non-relevant values are zero/blank but fields stay in the same place.
        show_angle = tool_type in ("V-Bit", "Engraving", "Drill", "Specialist")
        show_flat = tool_type == "Engraving"
        self.widgets["angle"].setEnabled(show_angle)
        self.widgets["flat"].setEnabled(show_flat)

    def _apply_edits_to_selected_tool(self):
        if not self.selected_tool:
            return
        t = self.selected_tool
        t.name = self.lbl_title.text().strip() or t.name
        t.notes = self.txt_notes.toPlainText()
        t.tool_type = self.cmb_type.currentText()
        t.tool_type_key = TOOL_TYPE_KEYS.get(t.tool_type, t.tool_type.lower().replace(" ", "_"))
        t.diameter = self.widgets["diameter"].value()
        t.angle = self.widgets["angle"].value()
        t.flat_diameter = self.widgets["flat"].value()
        t.flutes = self.widgets["flutes"].value()
        t.pass_depth = self.widgets["pass_depth"].value()
        t.stepover = self.widgets["stepover"].value()
        t.clear_stepover = self.widgets["clear_stepover"].value()
        t.spindle_rpm = self.widgets["rpm"].value()
        t.feed_rate = self.widgets["feed"].value()
        t.plunge_rate = self.widgets["plunge"].value()
        t.chip_load = self.widgets["chip"].value()
        t.tool_number = self.widgets["tool_number"].value()
        self._save_tool_to_database(t)
        self.preview.set_tool(t)

    def _selected_entry_id(self) -> str:
        item = self.tree.currentItem()
        return item.data(0, Qt.UserRole + 1) if item else ""

    def _selected_geometry_id(self) -> str:
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

    def _save_tool_to_database(self, t: AspireTool):
        if not self.db.path.exists() or not t.geometry_id:
            return
        type_code = {v:k for k,v in TOOL_TYPE_NAMES.items()}.get(t.tool_type, 1)
        try:
            with sqlite3.connect(self.db.path) as con:
                con.execute("""update tool_geometry set notes=?, tool_type=?, diameter=?, included_angle=?,
                            flat_diameter=?, num_flutes=? where id=?""",
                            (t.notes, type_code, t.diameter, t.angle, t.flat_diameter, int(t.flutes or 0), t.geometry_id))
                con.execute("update tool_tree_entry set name=?, notes=? where tool_geometry_id=?",
                            (t.name, t.notes, t.geometry_id))
                ent = con.execute("select * from tool_entity where id=?", (t.entity_id,)).fetchone() if t.entity_id else None
                if ent:
                    cut_id = ent[4]
                    con.execute("""update tool_cutting_data set feed_rate=?, plunge_rate=?, spindle_speed=?,
                                stepdown=?, stepover=?, clear_stepover=?, tool_number=? where id=?""",
                                (t.feed_rate, t.plunge_rate, int(t.spindle_rpm or 0), t.pass_depth,
                                 t.stepover, t.clear_stepover, int(t.tool_number or 0), cut_id))
                con.commit()
        except Exception as e:
            QMessageBox.warning(self, "Apply", f"Could not save tool changes:\n{e}")

    def _add_group(self):
        if not self.db.path.exists():
            QMessageBox.warning(self, "Add Group", "Tool database not found.")
            return
        name, ok = QInputDialog.getText(self, "Add Group", "Group name:")
        if not ok or not name.strip():
            return
        parent_id = self._selected_group_id() or None
        gid = str(uuid.uuid4())
        try:
            with sqlite3.connect(self.db.path) as con:
                order = con.execute("select coalesce(max(sibling_order),0)+1 from tool_tree_entry where parent_group_id is ?", (parent_id,)).fetchone()[0]
                con.execute("insert into tool_tree_entry(id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded) values(?,?,?,?,?,?,?)",
                            (gid, parent_id, order, None, name.strip(), "", 1))
                con.commit()
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Add Group", str(e))

    def _add_tool(self):
        if not self.db.path.exists():
            QMessageBox.warning(self, "Add Tool", "Tool database not found.")
            return
        group_id = self._selected_group_id()
        if not group_id:
            QMessageBox.warning(self, "Add Tool", "Select a tool group first.")
            return
        name, ok = QInputDialog.getText(self, "Add Tool", "Tool name:", text="End Mill (6 mm)")
        if not ok or not name.strip():
            return
        geom_id, cut_id, ent_id, entry_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        try:
            with sqlite3.connect(self.db.path) as con:
                mat = con.execute("select id from material where name=?", (self.cmb_material.currentText(),)).fetchone()
                mach = con.execute("select id from machine where name=?", (self.cmb_machine.currentText(),)).fetchone()
                mat_id = mat[0] if mat else None; mach_id = mach[0] if mach else None
                con.execute("""insert into tool_geometry(id,name_format,notes,tool_type,units,diameter,included_angle,flat_diameter,num_flutes)
                               values(?,?,?,?,?,?,?,?,?)""",
                            (geom_id, "{Tool Type} ({Diameter|F}{Units Short})", "", 1, 0, 6.0, None, None, 2))
                con.execute("""insert into tool_cutting_data(id,rate_units,feed_rate,plunge_rate,spindle_speed,spindle_dir,stepdown,stepover,clear_stepover,length_units,tool_number)
                               values(?,?,?,?,?,?,?,?,?,?,?)""",
                            (cut_id, 4, 3000.0, 800.0, 18000, 0, 6.0, 2.4, 0.0, 0, 1))
                con.execute("insert into tool_entity(id,material_id,machine_id,tool_geometry_id,tool_cutting_data_id) values(?,?,?,?,?)",
                            (ent_id, mat_id, mach_id, geom_id, cut_id))
                order = con.execute("select coalesce(max(sibling_order),0)+1 from tool_tree_entry where parent_group_id=?", (group_id,)).fetchone()[0]
                con.execute("insert into tool_tree_entry(id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded) values(?,?,?,?,?,?,?)",
                            (entry_id, group_id, order, geom_id, name.strip(), "", 0))
                con.commit()
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Add Tool", str(e))

    def _copy_selected_tool(self):
        gid = self._selected_geometry_id()
        if not self.db.path.exists() or not gid:
            QMessageBox.warning(self, "Copy", "Select a tool to copy.")
            return
        group_id = self._selected_group_id()
        try:
            with sqlite3.connect(self.db.path) as con:
                con.row_factory = sqlite3.Row
                geom = con.execute("select * from tool_geometry where id=?", (gid,)).fetchone()
                tree = con.execute("select * from tool_tree_entry where tool_geometry_id=? limit 1", (gid,)).fetchone()
                entity = con.execute("select * from tool_entity where tool_geometry_id=? limit 1", (gid,)).fetchone()
                if not geom or not tree:
                    return
                geom_id, entry_id = str(uuid.uuid4()), str(uuid.uuid4())
                cols = [c for c in geom.keys()]
                vals = [geom[c] for c in cols]; vals[cols.index('id')] = geom_id
                con.execute(f"insert into tool_geometry({','.join(cols)}) values({','.join(['?']*len(cols))})", vals)
                if entity:
                    cut = con.execute("select * from tool_cutting_data where id=?", (entity['tool_cutting_data_id'],)).fetchone()
                    cut_id, ent_id = str(uuid.uuid4()), str(uuid.uuid4())
                    if cut:
                        ccols = [c for c in cut.keys()]; cvals = [cut[c] for c in ccols]; cvals[ccols.index('id')] = cut_id
                        con.execute(f"insert into tool_cutting_data({','.join(ccols)}) values({','.join(['?']*len(ccols))})", cvals)
                    con.execute("insert into tool_entity(id,material_id,machine_id,tool_geometry_id,tool_cutting_data_id) values(?,?,?,?,?)",
                                (ent_id, entity['material_id'], entity['machine_id'], geom_id, cut_id))
                order = con.execute("select coalesce(max(sibling_order),0)+1 from tool_tree_entry where parent_group_id=?", (group_id,)).fetchone()[0]
                con.execute("insert into tool_tree_entry(id,parent_group_id,sibling_order,tool_geometry_id,name,notes,expanded) values(?,?,?,?,?,?,?)",
                            (entry_id, group_id, order, geom_id, (tree['name'] or 'Tool') + ' (Copy)', tree['notes'], 0))
                con.commit()
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Copy", str(e))

    def _remove_selected_entry(self):
        item = self.tree.currentItem()
        if not item or not self.db.path.exists():
            return
        entry_id = self._selected_entry_id()
        geom_id = self._selected_geometry_id()
        name = item.text(0)
        if QMessageBox.question(self, "Remove", f"Remove '{name}'?", QMessageBox.Yes | QMessageBox.No) != QMessageBox.Yes:
            return
        try:
            with sqlite3.connect(self.db.path) as con:
                if geom_id:
                    ent_rows = con.execute("select id,tool_cutting_data_id from tool_entity where tool_geometry_id=?", (geom_id,)).fetchall()
                    con.execute("delete from tool_tree_entry where id=?", (entry_id,))
                    con.execute("delete from tool_entity where tool_geometry_id=?", (geom_id,))
                    con.execute("delete from tool_geometry where id=?", (geom_id,))
                    for _eid, cut_id in ent_rows:
                        con.execute("delete from tool_cutting_data where id=?", (cut_id,))
                else:
                    child_count = item.childCount()
                    if child_count:
                        QMessageBox.warning(self, "Remove", "Group is not empty. Remove or move its tools first.")
                        return
                    con.execute("delete from tool_tree_entry where id=?", (entry_id,))
                con.commit()
            self.selected_tool = None
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Remove", str(e))

    def _import_database(self):
        path, _ = QFileDialog.getOpenFileName(self, "Import Tool Database", str(Path.home()), "Vectric Tool DB (*.vtdb *.vectric);;All Files (*)")
        if not path:
            return
        try:
            DATABASE_DIR.mkdir(exist_ok=True)
            shutil.copy2(path, DEFAULT_VTDB)
            self.db = AspireToolDatabase(DEFAULT_VTDB)
            self.cmb_material.clear(); self.cmb_material.addItems(self.db.materials())
            self.cmb_machine.clear(); self.cmb_machine.addItems(self.db.machines())
            self._build_tree()
        except Exception as e:
            QMessageBox.warning(self, "Import", str(e))

    def _export_database(self):
        if not self.db.path.exists():
            QMessageBox.warning(self, "Export", "Tool database not found.")
            return
        path, _ = QFileDialog.getSaveFileName(self, "Export Tool Database", str(Path.home() / "aspire_tools.vtdb"), "Vectric Tool DB (*.vtdb);;All Files (*)")
        if not path:
            return
        try:
            shutil.copy2(self.db.path, path)
        except Exception as e:
            QMessageBox.warning(self, "Export", str(e))

    def accept(self):
        self._apply_edits_to_selected_tool()
        super().accept()


def ensure_default_database():
    """Copy user-supplied vtdb beside app if no database is present."""
    DATABASE_DIR.mkdir(exist_ok=True)
    if DEFAULT_VTDB.exists():
        return
    for candidate in [BASE_DIR / "tools_2026-06-11.vtdb", BASE_DIR / "tools(1).vtdb"]:
        if candidate.exists():
            shutil.copy2(candidate, DEFAULT_VTDB)
            return
