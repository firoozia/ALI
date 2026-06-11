"""
FIROO CAM - Tool Library Manager
Full CRUD tool library with:
  • JSON persistence
  • Vectric .vtdb import (text format)
  • Group management
  • PySide6 UI widget
  • Integration with gcode_generator
"""

from __future__ import annotations
import json
import re
import uuid
from copy import deepcopy
from pathlib import Path
from typing import List, Dict, Optional

# ── Paths ─────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent
LIBRARY_FILE = BASE_DIR / "tool_library.json"

# ── Tool type display ─────────────────────────────────────────
TOOL_TYPE_ICONS = {
    "endmill":  "⬛",
    "vbit":     "🔻",
    "ballnose": "🔵",
    "drill":    "⭕",
    "form":     "🔷",
    "laser":    "⚡",
}
TOOL_TYPE_NAMES = {
    "endmill":  "End Mill",
    "vbit":     "V-Bit",
    "ballnose": "Ball Nose",
    "drill":    "Drill",
    "form":     "Form Tool",
    "laser":    "Laser",
}
TOOL_TYPE_NAMES_FA = {
    "endmill":  "فرز انگشتی",
    "vbit":     "فرز V شکل",
    "ballnose": "فرز کروی",
    "drill":    "مته",
    "form":     "ابزار فرم",
    "laser":    "لیزر",
}


# ═══════════════════════════════════════════════════════════════
# Tool Model (extended)
# ═══════════════════════════════════════════════════════════════
class Tool:
    """
    Full tool model with all CNC-relevant parameters.
    Compatible with data_models.Tool but extends it.
    """

    __slots__ = [
        "tool_id", "group", "name", "name_fa", "tool_type",
        "material", "diameter", "angle", "flutes",
        "cutting_length", "shank_diameter",
        "spindle_rpm", "feed_rate", "plunge_rate",
        "pass_depth", "stepover", "safe_z",
        "notes", "enabled",
    ]

    def __init__(self, **kwargs):
        defaults = {
            "tool_id":        str(uuid.uuid4())[:8].upper(),
            "group":          "roughing",
            "name":           "New Tool",
            "name_fa":        "",
            "tool_type":      "endmill",
            "material":       "Carbide",
            "diameter":       6.0,
            "angle":          0.0,
            "flutes":         2,
            "cutting_length": 35.0,
            "shank_diameter": 6.0,
            "spindle_rpm":    18000,
            "feed_rate":      3000.0,
            "plunge_rate":    800.0,
            "pass_depth":     6.0,
            "stepover":       40,
            "safe_z":         15.0,
            "notes":          "",
            "enabled":        True,
        }
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(self, k, v)

    # ── Serialization ─────────────────────────────────────────

    def to_dict(self) -> dict:
        return {s: getattr(self, s) for s in self.__slots__}

    @classmethod
    def from_dict(cls, d: dict) -> "Tool":
        return cls(**d)

    # ── Compatibility with data_models.Tool ───────────────────

    def to_datamodel(self):
        """Convert to data_models.Tool for gcode_generator compatibility."""
        from data_models import Tool as DmTool
        return DmTool(
            tool_id       = self.tool_id,
            name          = self.name,
            tool_type     = self.tool_type,
            diameter      = self.diameter,
            angle         = self.angle,
            cutting_length= self.cutting_length,
            feed_rate     = self.feed_rate,
            plunge_rate   = self.plunge_rate,
            spindle_rpm   = int(self.spindle_rpm),
            pass_depth    = self.pass_depth,
            safe_z        = self.safe_z,
            enabled       = self.enabled,
        )

    # ── Display helpers ───────────────────────────────────────

    def icon(self) -> str:
        return TOOL_TYPE_ICONS.get(self.tool_type, "🔧")

    def type_display(self, lang_code="en") -> str:
        if lang_code == "fa":
            return TOOL_TYPE_NAMES_FA.get(self.tool_type, self.tool_type)
        return TOOL_TYPE_NAMES.get(self.tool_type, self.tool_type)

    def display_name(self, lang_code="en") -> str:
        if lang_code == "fa" and self.name_fa:
            return self.name_fa
        return self.name

    def diameter_display(self) -> str:
        if self.tool_type == "vbit":
            return f"{int(self.angle)}°"
        return f"Ø{self.diameter:.1f}mm"

    def summary(self) -> str:
        return (f"{self.icon()} {self.name} | "
                f"{self.diameter_display()} | "
                f"F{self.feed_rate:.0f} | "
                f"S{self.spindle_rpm}")

    def is_valid(self) -> bool:
        return (self.feed_rate > 0 and
                self.spindle_rpm > 0 and
                self.pass_depth > 0 and
                bool(self.name))

    def __repr__(self):
        return f"<Tool {self.tool_id}: {self.name}>"


# ═══════════════════════════════════════════════════════════════
# Library Manager
# ═══════════════════════════════════════════════════════════════
class ToolLibraryManager:
    """
    Manages the complete tool library.
    Singleton — use `tool_lib` module-level instance.
    """

    def __init__(self, library_file: Path = LIBRARY_FILE):
        self._file   = library_file
        self._tools: List[Tool]       = []
        self._groups: List[dict]      = []
        self._modified: bool          = False
        self.load()

    # ── Persistence ───────────────────────────────────────────

    def load(self, path: Path = None) -> bool:
        path = path or self._file
        if not path.exists():
            print(f"[ToolLib] File not found: {path} — starting empty")
            self._init_empty()
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._groups = data.get("groups", [])
            self._tools  = [Tool.from_dict(t) for t in data.get("tools", [])]
            self._modified = False
            print(f"[ToolLib] Loaded {len(self._tools)} tools from {path.name}")
            return True
        except Exception as e:
            print(f"[ToolLib] Load error: {e}")
            self._init_empty()
            return False

    def save(self, path: Path = None) -> bool:
        path = path or self._file
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "_meta":  {"version": "1.0.0", "units": "mm"},
                "groups": self._groups,
                "tools":  [t.to_dict() for t in self._tools],
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            self._modified = False
            print(f"[ToolLib] Saved {len(self._tools)} tools to {path.name}")
            return True
        except Exception as e:
            print(f"[ToolLib] Save error: {e}")
            return False

    def _init_empty(self):
        self._groups = [
            {"id": "roughing",  "name": "Roughing / Profile Cut", "icon": "⬛", "color": "#e74c3c"},
            {"id": "vcarve",    "name": "V-Carve / Engraving",    "icon": "🔻", "color": "#9b59b6"},
            {"id": "finishing", "name": "Finishing / Detail",      "icon": "✨", "color": "#3498db"},
            {"id": "drilling",  "name": "Drilling / Boring",       "icon": "⭕", "color": "#2ecc71"},
            {"id": "form",      "name": "Form / Special",          "icon": "🔷", "color": "#f39c12"},
        ]
        self._tools = []

    # ── CRUD ──────────────────────────────────────────────────

    def all_tools(self, enabled_only=False) -> List[Tool]:
        if enabled_only:
            return [t for t in self._tools if t.enabled]
        return list(self._tools)

    def by_group(self, group_id: str, enabled_only=False) -> List[Tool]:
        tools = [t for t in self._tools if t.group == group_id]
        if enabled_only:
            tools = [t for t in tools if t.enabled]
        return tools

    def by_type(self, tool_type: str) -> List[Tool]:
        return [t for t in self._tools if t.tool_type == tool_type]

    def get(self, tool_id: str) -> Optional[Tool]:
        for t in self._tools:
            if t.tool_id == tool_id:
                return t
        return None

    def add(self, tool: Tool) -> Tool:
        # Ensure unique ID
        existing_ids = {t.tool_id for t in self._tools}
        if tool.tool_id in existing_ids:
            tool.tool_id = str(uuid.uuid4())[:8].upper()
        self._tools.append(tool)
        self._modified = True
        return tool

    def update(self, tool_id: str, **kwargs) -> bool:
        tool = self.get(tool_id)
        if not tool:
            return False
        for k, v in kwargs.items():
            if hasattr(tool, k):
                setattr(tool, k, v)
        self._modified = True
        return True

    def delete(self, tool_id: str) -> bool:
        before = len(self._tools)
        self._tools = [t for t in self._tools if t.tool_id != tool_id]
        changed = len(self._tools) < before
        if changed:
            self._modified = True
        return changed

    def duplicate(self, tool_id: str) -> Optional[Tool]:
        tool = self.get(tool_id)
        if not tool:
            return None
        new_tool = Tool.from_dict(deepcopy(tool.to_dict()))
        new_tool.tool_id = str(uuid.uuid4())[:8].upper()
        new_tool.name    = tool.name + " (Copy)"
        new_tool.name_fa = (tool.name_fa + " (کپی)") if tool.name_fa else ""
        idx = self._tools.index(tool)
        self._tools.insert(idx + 1, new_tool)
        self._modified = True
        return new_tool

    def reorder(self, tool_id: str, new_index: int):
        tool = self.get(tool_id)
        if not tool:
            return
        self._tools.remove(tool)
        self._tools.insert(max(0, new_index), tool)
        self._modified = True

    # ── Groups ────────────────────────────────────────────────

    def groups(self) -> List[dict]:
        return list(self._groups)

    def group_name(self, group_id: str) -> str:
        for g in self._groups:
            if g["id"] == group_id:
                return g["name"]
        return group_id

    def group_color(self, group_id: str) -> str:
        for g in self._groups:
            if g["id"] == group_id:
                return g.get("color", "#555555")
        return "#555555"

    # ── Export ────────────────────────────────────────────────

    def export_json(self, path: str) -> bool:
        return self.save(Path(path))

    def export_for_gcode(self) -> dict:
        """Return {tool_id: data_models.Tool} dict for gcode_generator."""
        result = {}
        for t in self._tools:
            if t.enabled:
                try:
                    result[t.tool_id] = t.to_datamodel()
                except Exception:
                    pass
        return result

    # ── Import ────────────────────────────────────────────────

    def import_json(self, path: str) -> tuple:
        """Returns (imported_count, errors)."""
        errors = []
        count  = 0
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            tools_data = data.get("tools", data if isinstance(data, list) else [])
            for td in tools_data:
                try:
                    tool = Tool.from_dict(td)
                    self.add(tool)
                    count += 1
                except Exception as e:
                    errors.append(str(e))
        except Exception as e:
            errors.append(f"File error: {e}")
        return count, errors

    def import_vectric_vtdb(self, path: str) -> tuple:
        """
        Import from Vectric .vtdb (text/XML format).
        The .vtdb.vectric file that ships with Aspire/VCarve is XML.
        Returns (imported_count, errors).
        """
        errors = []
        count  = 0
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            # Try XML parse first
            try:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(content)
                tools_el = root.findall(".//Tool") or root.findall(".//tool")
                for el in tools_el:
                    try:
                        tool = self._parse_vectric_xml_tool(el)
                        if tool:
                            self.add(tool)
                            count += 1
                    except Exception as e:
                        errors.append(str(e))
            except Exception:
                # Fallback: regex parse
                count, errors = self._import_vectric_regex(content)

        except Exception as e:
            errors.append(f"File error: {e}")
        return count, errors

    def _parse_vectric_xml_tool(self, el) -> Optional[Tool]:
        """Parse a single Vectric XML <Tool> element."""
        def get(tag, default=""):
            child = el.find(tag)
            return child.text.strip() if child is not None and child.text else default

        def getf(tag, default=0.0):
            try: return float(get(tag, str(default)))
            except: return default

        def geti(tag, default=0):
            try: return int(float(get(tag, str(default))))
            except: return default

        name = get("Name") or get("name")
        if not name:
            return None

        raw_type = get("ToolType") or get("type") or "endmill"
        tool_type = self._map_vectric_type(raw_type)

        return Tool(
            name          = name,
            tool_type     = tool_type,
            group         = self._type_to_group(tool_type),
            material      = get("Material", "Carbide"),
            diameter      = getf("Diameter") or getf("diameter"),
            angle         = getf("Angle") or getf("angle"),
            flutes        = geti("Flutes", 2),
            cutting_length= getf("CuttingLength", 35),
            shank_diameter= getf("ShankDiameter", 6),
            spindle_rpm   = geti("SpindleSpeed") or geti("RPM", 18000),
            feed_rate     = getf("FeedRate") or getf("feed_rate", 3000),
            plunge_rate   = getf("PlungeRate") or getf("plunge_rate", 800),
            pass_depth    = getf("PassDepth") or getf("pass_depth", 6),
            stepover      = getf("Stepover", 40),
            safe_z        = 15.0,
            notes         = get("Notes", ""),
            enabled       = True,
        )

    def _import_vectric_regex(self, content: str) -> tuple:
        """Regex-based fallback parser for Vectric tool files."""
        errors = []
        count  = 0
        # Match tool blocks
        blocks = re.findall(r'<Tool[^>]*>(.*?)</Tool>', content, re.DOTALL | re.IGNORECASE)
        for block in blocks:
            try:
                def get_val(tag):
                    m = re.search(fr'<{tag}[^>]*>(.*?)</{tag}>', block, re.IGNORECASE | re.DOTALL)
                    return m.group(1).strip() if m else ""

                name = get_val("Name")
                if not name:
                    continue
                raw_type  = get_val("ToolType") or "endmill"
                tool_type = self._map_vectric_type(raw_type)

                tool = Tool(
                    name      = name,
                    tool_type = tool_type,
                    group     = self._type_to_group(tool_type),
                    diameter  = float(get_val("Diameter") or 6),
                    angle     = float(get_val("Angle") or 0),
                    spindle_rpm  = int(float(get_val("SpindleSpeed") or 18000)),
                    feed_rate    = float(get_val("FeedRate") or 3000),
                    plunge_rate  = float(get_val("PlungeRate") or 800),
                    pass_depth   = float(get_val("PassDepth") or 6),
                )
                self.add(tool)
                count += 1
            except Exception as e:
                errors.append(str(e))
        return count, errors

    @staticmethod
    def _map_vectric_type(raw: str) -> str:
        raw = raw.lower().strip()
        if "ball" in raw:     return "ballnose"
        if "vbit" in raw or "v-bit" in raw or "v bit" in raw or "engraving" in raw: return "vbit"
        if "drill" in raw:    return "drill"
        if "form" in raw:     return "form"
        return "endmill"

    @staticmethod
    def _type_to_group(tool_type: str) -> str:
        return {
            "endmill":  "roughing",
            "vbit":     "vcarve",
            "ballnose": "finishing",
            "drill":    "drilling",
            "form":     "form",
        }.get(tool_type, "roughing")

    # ── Stats ─────────────────────────────────────────────────

    def stats(self) -> dict:
        by_type   = {}
        by_group  = {}
        for t in self._tools:
            by_type[t.tool_type]  = by_type.get(t.tool_type, 0) + 1
            by_group[t.group]     = by_group.get(t.group, 0) + 1
        return {
            "total":    len(self._tools),
            "enabled":  sum(1 for t in self._tools if t.enabled),
            "by_type":  by_type,
            "by_group": by_group,
        }

    @property
    def is_modified(self) -> bool:
        return self._modified

    def __len__(self):
        return len(self._tools)

    def __repr__(self):
        return f"<ToolLibraryManager: {len(self._tools)} tools>"


# ═══════════════════════════════════════════════════════════════
# PySide6 UI Widget
# ═══════════════════════════════════════════════════════════════
try:
    from PySide6.QtCore import Qt, Signal, QSortFilterProxyModel
    from PySide6.QtGui  import QColor, QFont, QIcon
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QSplitter,
        QTreeWidget, QTreeWidgetItem, QTableWidget, QTableWidgetItem,
        QHeaderView, QAbstractItemView, QPushButton, QLineEdit,
        QLabel, QComboBox, QDoubleSpinBox, QSpinBox, QCheckBox,
        QGroupBox, QFormLayout, QDialog, QDialogButtonBox,
        QMessageBox, QFileDialog, QTextEdit, QTabWidget,
        QFrame, QToolButton, QSizePolicy
    )
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:

    # ── Colours ───────────────────────────────────────────────
    C_BG     = "#1e1e1e"
    C_PANEL  = "#252526"
    C_BORDER = "#3e3e42"
    C_ACCENT = "#0078d4"
    C_TEXT   = "#cccccc"
    C_DIM    = "#858585"

    TOOL_COLORS = {
        "roughing":  "#e74c3c",
        "vcarve":    "#9b59b6",
        "finishing": "#3498db",
        "drilling":  "#2ecc71",
        "form":      "#f39c12",
        "laser":     "#1abc9c",
    }

    class ToolEditDialog(QDialog):
        """Full tool editor dialog."""

        def __init__(self, tool: Tool = None, parent=None):
            super().__init__(parent)
            self._tool = deepcopy(tool) if tool else Tool()
            self._build()
            self._populate()

        def _build(self):
            self.setWindowTitle("Edit Tool" if self._tool else "New Tool")
            self.setModal(True)
            self.setMinimumWidth(480)
            layout = QVBoxLayout(self)

            tabs = QTabWidget()

            # ── Tab 1: Basic ──────────────────────────────────
            basic = QWidget()
            form  = QFormLayout(basic)

            self._name      = QLineEdit()
            self._name_fa   = QLineEdit()
            self._type      = QComboBox()
            for k, v in TOOL_TYPE_NAMES.items():
                self._type.addItem(f"{TOOL_TYPE_ICONS[k]}  {v}", k)
            self._group     = QComboBox()
            self._material  = QComboBox()
            for m in ["Carbide", "HSS", "Diamond", "CBN", "Ceramic"]:
                self._material.addItem(m)
            self._diameter  = QDoubleSpinBox(); self._diameter.setRange(0, 200); self._diameter.setDecimals(2)
            self._angle     = QDoubleSpinBox(); self._angle.setRange(0, 180);   self._angle.setDecimals(1)
            self._flutes    = QSpinBox();        self._flutes.setRange(1, 12)
            self._cut_len   = QDoubleSpinBox(); self._cut_len.setRange(1, 300);  self._cut_len.setDecimals(1)
            self._shank_d   = QDoubleSpinBox(); self._shank_d.setRange(1, 50);   self._shank_d.setDecimals(2)
            self._enabled   = QCheckBox("Active")

            form.addRow("Name (EN):",         self._name)
            form.addRow("Name (FA):",         self._name_fa)
            form.addRow("Type:",              self._type)
            form.addRow("Group:",             self._group)
            form.addRow("Material:",          self._material)
            form.addRow("Diameter (mm):",     self._diameter)
            form.addRow("Angle (°):",         self._angle)
            form.addRow("Flutes:",            self._flutes)
            form.addRow("Cutting Length:",    self._cut_len)
            form.addRow("Shank Diameter:",    self._shank_d)
            form.addRow("",                   self._enabled)

            tabs.addTab(basic, "⬛  Basic")

            # ── Tab 2: Cutting Params ─────────────────────────
            cutting = QWidget()
            form2   = QFormLayout(cutting)

            self._rpm      = QSpinBox();        self._rpm.setRange(1000, 60000); self._rpm.setSingleStep(1000)
            self._feed     = QDoubleSpinBox(); self._feed.setRange(10, 30000);  self._feed.setSuffix(" mm/min")
            self._plunge   = QDoubleSpinBox(); self._plunge.setRange(10, 10000); self._plunge.setSuffix(" mm/min")
            self._pass_d   = QDoubleSpinBox(); self._pass_d.setRange(0.1, 50);  self._pass_d.setDecimals(2)
            self._stepover = QDoubleSpinBox(); self._stepover.setRange(1, 100); self._stepover.setSuffix(" %")
            self._safe_z   = QDoubleSpinBox(); self._safe_z.setRange(1, 200)

            form2.addRow("Spindle RPM:",    self._rpm)
            form2.addRow("Feed Rate:",      self._feed)
            form2.addRow("Plunge Rate:",    self._plunge)
            form2.addRow("Pass Depth (mm):",self._pass_d)
            form2.addRow("Stepover %:",     self._stepover)
            form2.addRow("Safe Z (mm):",    self._safe_z)

            tabs.addTab(cutting, "⚙  Cutting")

            # ── Tab 3: Notes ──────────────────────────────────
            notes_w = QWidget()
            nl      = QVBoxLayout(notes_w)
            self._notes = QTextEdit()
            self._notes.setPlaceholderText("Notes, usage tips, warnings...")
            nl.addWidget(self._notes)
            tabs.addTab(notes_w, "📝  Notes")

            layout.addWidget(tabs)

            btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
            btns.accepted.connect(self._on_ok)
            btns.rejected.connect(self.reject)
            layout.addWidget(btns)

        def _populate(self):
            t = self._tool
            self._name.setText(t.name)
            self._name_fa.setText(t.name_fa)
            # Set type combo
            for i in range(self._type.count()):
                if self._type.itemData(i) == t.tool_type:
                    self._type.setCurrentIndex(i)
                    break
            # Material
            idx = self._material.findText(t.material)
            if idx >= 0: self._material.setCurrentIndex(idx)
            self._diameter.setValue(t.diameter)
            self._angle.setValue(t.angle)
            self._flutes.setValue(t.flutes)
            self._cut_len.setValue(t.cutting_length)
            self._shank_d.setValue(t.shank_diameter)
            self._enabled.setChecked(t.enabled)
            self._rpm.setValue(int(t.spindle_rpm))
            self._feed.setValue(t.feed_rate)
            self._plunge.setValue(t.plunge_rate)
            self._pass_d.setValue(t.pass_depth)
            self._stepover.setValue(t.stepover)
            self._safe_z.setValue(t.safe_z)
            self._notes.setPlainText(t.notes)

        def _on_ok(self):
            t = self._tool
            t.name          = self._name.text().strip()
            t.name_fa       = self._name_fa.text().strip()
            t.tool_type     = self._type.currentData()
            t.material      = self._material.currentText()
            t.diameter      = self._diameter.value()
            t.angle         = self._angle.value()
            t.flutes        = self._flutes.value()
            t.cutting_length= self._cut_len.value()
            t.shank_diameter= self._shank_d.value()
            t.enabled       = self._enabled.isChecked()
            t.spindle_rpm   = self._rpm.value()
            t.feed_rate     = self._feed.value()
            t.plunge_rate   = self._plunge.value()
            t.pass_depth    = self._pass_d.value()
            t.stepover      = self._stepover.value()
            t.safe_z        = self._safe_z.value()
            t.notes         = self._notes.toPlainText().strip()
            if not t.name:
                QMessageBox.warning(self, "Error", "Tool name cannot be empty.")
                return
            self.accept()

        def result_tool(self) -> Tool:
            return self._tool


    class ToolLibraryWidget(QWidget):
        """
        Full tool library UI widget.
        Embed in main window as a tab.
        Signal: tool_selected(Tool)
        """
        tool_selected = Signal(object)

        def __init__(self, manager: ToolLibraryManager, parent=None):
            super().__init__(parent)
            self._mgr  = manager
            self._lang = "en"
            self._build()
            self._apply_style()
            self._refresh()

        def set_language(self, lang_code: str):
            self._lang = lang_code
            self._refresh()

        # ── Build UI ──────────────────────────────────────────
        def _build(self):
            root = QVBoxLayout(self)
            root.setContentsMargins(4, 4, 4, 4)
            root.setSpacing(4)

            # Toolbar
            tb = QHBoxLayout()

            self._btn_add   = QPushButton("＋  Add")
            self._btn_edit  = QPushButton("✎  Edit")
            self._btn_dup   = QPushButton("⧉  Duplicate")
            self._btn_del   = QPushButton("✕  Delete")
            self._btn_imp   = QPushButton("📥  Import")
            self._btn_exp   = QPushButton("📤  Export")
            self._btn_save  = QPushButton("💾  Save")

            self._btn_add.setObjectName("btn_primary")
            self._btn_del.setObjectName("btn_danger")
            self._btn_save.setObjectName("btn_success")

            for btn in [self._btn_add, self._btn_edit, self._btn_dup,
                        self._btn_del, self._btn_imp, self._btn_exp, self._btn_save]:
                btn.setFixedHeight(28)
                tb.addWidget(btn)

            tb.addStretch()

            # Search
            self._search = QLineEdit()
            self._search.setPlaceholderText("🔍  Search tools...")
            self._search.setFixedWidth(220)
            self._search.textChanged.connect(self._on_search)
            tb.addWidget(self._search)

            # Type filter
            self._filter_type = QComboBox()
            self._filter_type.addItem("All Types", "")
            for k, v in TOOL_TYPE_NAMES.items():
                self._filter_type.addItem(f"{TOOL_TYPE_ICONS[k]} {v}", k)
            self._filter_type.currentIndexChanged.connect(self._refresh)
            self._filter_type.setFixedWidth(150)
            tb.addWidget(self._filter_type)

            root.addLayout(tb)

            # Splitter: group tree | tool table | detail panel
            splitter = QSplitter(Qt.Horizontal)

            # Group tree
            self._group_tree = QTreeWidget()
            self._group_tree.setHeaderHidden(True)
            self._group_tree.setFixedWidth(180)
            self._group_tree.itemSelectionChanged.connect(self._refresh)
            splitter.addWidget(self._group_tree)

            # Tool table
            self._table = QTableWidget(0, 7)
            self._table.setHorizontalHeaderLabels([
                "", "Name", "Type", "Ø / Angle", "RPM", "Feed", "Pass Depth"
            ])
            self._table.verticalHeader().hide()
            self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
            self._table.setEditTriggers(QAbstractItemView.NoEditTriggers)
            self._table.setAlternatingRowColors(True)
            self._table.doubleClicked.connect(self._on_edit)
            self._table.itemSelectionChanged.connect(self._on_selection)

            hdr = self._table.horizontalHeader()
            hdr.setSectionResizeMode(0, QHeaderView.Fixed); self._table.setColumnWidth(0, 28)
            hdr.setSectionResizeMode(1, QHeaderView.Stretch)
            for i in range(2, 7):
                hdr.setSectionResizeMode(i, QHeaderView.ResizeToContents)

            splitter.addWidget(self._table)

            # Detail panel
            self._detail = self._build_detail()
            splitter.addWidget(self._detail)

            splitter.setStretchFactor(0, 0)
            splitter.setStretchFactor(1, 2)
            splitter.setStretchFactor(2, 1)

            root.addWidget(splitter, 1)

            # Status bar
            self._status = QLabel("Ready")
            self._status.setStyleSheet(f"color: {C_DIM}; font-size: 11px;")
            root.addWidget(self._status)

            # Connect buttons
            self._btn_add.clicked.connect(self._on_add)
            self._btn_edit.clicked.connect(self._on_edit)
            self._btn_dup.clicked.connect(self._on_duplicate)
            self._btn_del.clicked.connect(self._on_delete)
            self._btn_imp.clicked.connect(self._on_import)
            self._btn_exp.clicked.connect(self._on_export)
            self._btn_save.clicked.connect(self._on_save)

        def _build_detail(self) -> QWidget:
            w   = QGroupBox("Tool Details")
            lay = QVBoxLayout(w)
            w.setFixedWidth(240)

            self._detail_icon  = QLabel("🔧")
            self._detail_icon.setAlignment(Qt.AlignCenter)
            self._detail_icon.setStyleSheet("font-size: 32px;")

            self._detail_name  = QLabel("—")
            self._detail_name.setAlignment(Qt.AlignCenter)
            self._detail_name.setWordWrap(True)
            self._detail_name.setStyleSheet("font-weight: bold; font-size: 13px;")

            self._detail_type  = QLabel("—")
            self._detail_type.setAlignment(Qt.AlignCenter)
            self._detail_type.setStyleSheet(f"color: {C_DIM};")

            sep = QFrame(); sep.setFrameShape(QFrame.HLine)
            sep.setStyleSheet(f"color: {C_BORDER};")

            self._detail_params = QLabel("—")
            self._detail_params.setWordWrap(True)
            self._detail_params.setAlignment(Qt.AlignLeft | Qt.AlignTop)
            self._detail_params.setStyleSheet(f"color: {C_TEXT}; font-size: 11px; font-family: monospace;")

            lay.addWidget(self._detail_icon)
            lay.addWidget(self._detail_name)
            lay.addWidget(self._detail_type)
            lay.addWidget(sep)
            lay.addWidget(self._detail_params)
            lay.addStretch()
            return w

        # ── Refresh ───────────────────────────────────────────
        def _refresh(self):
            self._refresh_group_tree()
            self._refresh_table()
            self._update_status()

        def _refresh_group_tree(self):
            self._group_tree.clear()
            # All tools item
            all_item = QTreeWidgetItem(["  🗂  All Tools"])
            all_item.setData(0, Qt.UserRole, None)
            all_item.setForeground(0, QColor(C_TEXT))
            self._group_tree.addTopLevelItem(all_item)

            stats = self._mgr.stats()
            total = stats["total"]
            all_item.setText(0, f"  🗂  All Tools  ({total})")

            for g in self._mgr.groups():
                count = stats["by_group"].get(g["id"], 0)
                item  = QTreeWidgetItem([f"  {g['icon']}  {g['name']}  ({count})"])
                item.setData(0, Qt.UserRole, g["id"])
                item.setForeground(0, QColor(g.get("color", C_DIM)))
                self._group_tree.addTopLevelItem(item)

            self._group_tree.expandAll()
            # Select first item if none selected
            if not self._group_tree.selectedItems():
                self._group_tree.setCurrentItem(
                    self._group_tree.topLevelItem(0))

        def _refresh_table(self):
            # Get active filters
            sel = self._group_tree.selectedItems()
            group_filter = sel[0].data(0, Qt.UserRole) if sel else None
            type_filter  = self._filter_type.currentData()
            search_text  = self._search.text().lower().strip()

            tools = self._mgr.all_tools()

            if group_filter:
                tools = [t for t in tools if t.group == group_filter]
            if type_filter:
                tools = [t for t in tools if t.tool_type == type_filter]
            if search_text:
                tools = [t for t in tools if
                         search_text in t.name.lower() or
                         search_text in t.name_fa.lower() or
                         search_text in t.tool_id.lower()]

            self._table.setRowCount(len(tools))
            for row, tool in enumerate(tools):
                # Icon col
                icon_item = QTableWidgetItem(tool.icon())
                icon_item.setTextAlignment(Qt.AlignCenter)
                icon_item.setForeground(QColor(TOOL_COLORS.get(tool.group, C_DIM)))
                self._table.setItem(row, 0, icon_item)

                # Name
                name_item = QTableWidgetItem(tool.display_name(self._lang))
                if not tool.enabled:
                    name_item.setForeground(QColor(C_DIM))
                name_item.setData(Qt.UserRole, tool.tool_id)
                self._table.setItem(row, 1, name_item)

                # Type
                type_item = QTableWidgetItem(tool.type_display(self._lang))
                type_item.setForeground(QColor(TOOL_COLORS.get(tool.group, C_DIM)))
                type_item.setTextAlignment(Qt.AlignCenter)
                self._table.setItem(row, 2, type_item)

                # Diameter/Angle
                dim_item = QTableWidgetItem(tool.diameter_display())
                dim_item.setTextAlignment(Qt.AlignCenter)
                self._table.setItem(row, 3, dim_item)

                # RPM
                rpm_item = QTableWidgetItem(f"{tool.spindle_rpm:,}")
                rpm_item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self._table.setItem(row, 4, rpm_item)

                # Feed
                feed_item = QTableWidgetItem(f"{tool.feed_rate:.0f}")
                feed_item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self._table.setItem(row, 5, feed_item)

                # Pass depth
                pd_item = QTableWidgetItem(f"{tool.pass_depth:.1f}")
                pd_item.setTextAlignment(Qt.AlignCenter)
                self._table.setItem(row, 6, pd_item)

            self._table.resizeRowsToContents()

        def _update_status(self):
            s = self._mgr.stats()
            mod = " •" if self._mgr.is_modified else ""
            self._status.setText(
                f"Tools: {s['total']}  |  Active: {s['enabled']}{mod}")

        # ── Selection → Detail ────────────────────────────────
        def _on_selection(self):
            tool = self._selected_tool()
            if not tool:
                self._detail_icon.setText("🔧")
                self._detail_name.setText("—")
                self._detail_type.setText("—")
                self._detail_params.setText("—")
                return

            color = TOOL_COLORS.get(tool.group, C_DIM)
            self._detail_icon.setText(tool.icon())
            self._detail_name.setText(tool.display_name(self._lang))
            self._detail_name.setStyleSheet(
                f"font-weight: bold; font-size: 13px; color: {color};")
            self._detail_type.setText(
                f"{tool.type_display(self._lang)} — {tool.material}")

            params = (
                f"ID:          {tool.tool_id}\n"
                f"Diameter:    {tool.diameter_display()}\n"
                f"Flutes:      {tool.flutes}\n"
                f"Cut Length:  {tool.cutting_length:.0f} mm\n"
                f"Shank:       Ø{tool.shank_diameter:.0f} mm\n"
                f"─────────────────\n"
                f"RPM:         {tool.spindle_rpm:,}\n"
                f"Feed:        {tool.feed_rate:.0f} mm/min\n"
                f"Plunge:      {tool.plunge_rate:.0f} mm/min\n"
                f"Pass Depth:  {tool.pass_depth:.1f} mm\n"
                f"Stepover:    {tool.stepover:.0f}%\n"
                f"Safe Z:      {tool.safe_z:.0f} mm\n"
            )
            if tool.notes:
                params += f"─────────────────\n{tool.notes}"

            self._detail_params.setText(params)
            self.tool_selected.emit(tool)

        def _selected_tool(self) -> Optional[Tool]:
            rows = self._table.selectedIndexes()
            if not rows:
                return None
            row = rows[0].row()
            item = self._table.item(row, 1)
            if not item:
                return None
            return self._mgr.get(item.data(Qt.UserRole))

        # ── Actions ───────────────────────────────────────────
        def _on_add(self):
            dlg = ToolEditDialog(parent=self)
            if dlg.exec() == QDialog.Accepted:
                self._mgr.add(dlg.result_tool())
                self._refresh()

        def _on_edit(self):
            tool = self._selected_tool()
            if not tool:
                return
            dlg = ToolEditDialog(tool, parent=self)
            if dlg.exec() == QDialog.Accepted:
                updated = dlg.result_tool()
                self._mgr.update(tool.tool_id, **updated.to_dict())
                self._refresh()

        def _on_duplicate(self):
            tool = self._selected_tool()
            if tool:
                self._mgr.duplicate(tool.tool_id)
                self._refresh()

        def _on_delete(self):
            tool = self._selected_tool()
            if not tool:
                return
            ans = QMessageBox.question(
                self, "Delete Tool",
                f"Delete '{tool.name}'?",
                QMessageBox.Yes | QMessageBox.No)
            if ans == QMessageBox.Yes:
                self._mgr.delete(tool.tool_id)
                self._refresh()

        def _on_import(self):
            path, _ = QFileDialog.getOpenFileName(
                self, "Import Tools",
                str(Path.home()),
                "Tool Files (*.json *.vtdb *.vectric);;All Files (*)")
            if not path:
                return
            p = path.lower()
            if p.endswith(".json"):
                count, errors = self._mgr.import_json(path)
            else:
                count, errors = self._mgr.import_vectric_vtdb(path)

            self._refresh()
            msg = f"Imported {count} tools."
            if errors:
                msg += f"\n{len(errors)} error(s):\n" + "\n".join(errors[:5])
            QMessageBox.information(self, "Import", msg)

        def _on_export(self):
            path, _ = QFileDialog.getSaveFileName(
                self, "Export Tool Library",
                str(Path.home() / "tool_library.json"),
                "JSON (*.json)")
            if path:
                ok = self._mgr.export_json(path)
                if ok:
                    QMessageBox.information(self, "Export",
                                            f"Saved to:\n{path}")

        def _on_save(self):
            ok = self._mgr.save()
            self._status.setText("Saved ✓" if ok else "Save failed!")

        def _on_search(self):
            self._refresh_table()

        # ── Style ─────────────────────────────────────────────
        def _apply_style(self):
            self.setStyleSheet(f"""
                QWidget {{
                    background: {C_BG};
                    color: {C_TEXT};
                    font-family: "Segoe UI", Tahoma, sans-serif;
                    font-size: 12px;
                }}
                QGroupBox {{
                    background: {C_PANEL};
                    border: 1px solid {C_BORDER};
                    border-radius: 4px;
                    margin-top: 6px;
                    padding-top: 8px;
                    color: {C_DIM};
                    font-weight: 600;
                    font-size: 11px;
                }}
                QGroupBox::title {{
                    subcontrol-origin: margin;
                    subcontrol-position: top left;
                    padding: 0 4px; left: 8px;
                }}
                QPushButton {{
                    background: {C_PANEL};
                    border: 1px solid {C_BORDER};
                    border-radius: 3px;
                    padding: 4px 10px;
                    color: {C_TEXT};
                }}
                QPushButton:hover {{ background: #3e3e42; border-color: {C_ACCENT}; }}
                QPushButton#btn_primary {{ background: {C_ACCENT}; border-color: {C_ACCENT}; color: white; font-weight: 600; }}
                QPushButton#btn_primary:hover {{ background: #106ebe; }}
                QPushButton#btn_danger {{ background: #8b1a1a; border-color: #c0392b; color: white; }}
                QPushButton#btn_danger:hover {{ background: #c0392b; }}
                QPushButton#btn_success {{ background: #1a5c2a; border-color: #27ae60; color: white; }}
                QPushButton#btn_success:hover {{ background: #27ae60; }}
                QTableWidget {{
                    background: #1a1a1a;
                    gridline-color: {C_BORDER};
                    border: 1px solid {C_BORDER};
                    selection-background-color: #264f78;
                    alternate-background-color: #222222;
                }}
                QHeaderView::section {{
                    background: {C_PANEL};
                    border: none;
                    border-right: 1px solid {C_BORDER};
                    border-bottom: 1px solid {C_BORDER};
                    padding: 4px 6px;
                    font-weight: 600;
                    color: {C_DIM};
                    font-size: 11px;
                }}
                QTreeWidget {{
                    background: {C_PANEL};
                    border: 1px solid {C_BORDER};
                    outline: none;
                }}
                QTreeWidget::item {{ padding: 4px 6px; border-radius: 2px; }}
                QTreeWidget::item:selected {{ background: #264f78; color: white; }}
                QLineEdit, QComboBox {{
                    background: #1a1a1a;
                    border: 1px solid {C_BORDER};
                    border-radius: 3px;
                    padding: 3px 6px;
                    color: {C_TEXT};
                }}
                QLineEdit:focus, QComboBox:focus {{ border-color: {C_ACCENT}; }}
                QSplitter::handle {{ background: {C_BORDER}; width: 1px; }}
            """)


# ═══════════════════════════════════════════════════════════════
# Singleton
# ═══════════════════════════════════════════════════════════════
tool_lib = ToolLibraryManager()


# ═══════════════════════════════════════════════════════════════
# Test
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 55)
    print("FIROO CAM - Tool Library Manager")
    print("=" * 55)

    lib = ToolLibraryManager(LIBRARY_FILE)
    s   = lib.stats()

    print(f"\nTotal tools : {s['total']}")
    print(f"Active      : {s['enabled']}")
    print(f"\nBy group:")
    for g, c in s["by_group"].items():
        print(f"  {lib.group_name(g):30} {c} tools")
    print(f"\nBy type:")
    for tp, c in s["by_type"].items():
        print(f"  {TOOL_TYPE_NAMES.get(tp, tp):20} {c} tools")

    print("\nAll tools:")
    for t in lib.all_tools():
        print(f"  {t.tool_id:6} {t.icon()} {t.name:40} {t.diameter_display():8} "
              f"F{t.feed_rate:>5.0f}  S{t.spindle_rpm:>6}")

    print("\nTest G-code export map:")
    dm = lib.export_for_gcode()
    for tid, tool in dm.items():
        print(f"  {tid}: {tool.name}")

    print(f"\n✅ Tool Library Manager OK — {len(lib)} tools loaded")

    # UI test
    if HAS_QT:
        import sys
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance() or QApplication(sys.argv)
        app.setStyle("Fusion")
        w = ToolLibraryWidget(lib)
        w.setWindowTitle("FIROO CAM — Tool Library")
        w.resize(1100, 700)
        w.show()
        sys.exit(app.exec())
