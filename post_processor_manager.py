"""
FIROO CAM - Post-Processor Manager
Loads post-processor bank, generates G-code headers/footers,
and provides a PySide6 selection UI.
"""

from __future__ import annotations
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import List, Dict, Optional

BASE_DIR = Path(__file__).parent
BANK_FILE = BASE_DIR / "post_processor_bank.json"
CUSTOM_DIR = BASE_DIR / "post_processors_custom"


# ═══════════════════════════════════════════════════════════════
# Post-Processor Model
# ═══════════════════════════════════════════════════════════════
class PostProcessor:
    def __init__(self, data: dict):
        self.id              = data.get("id", "")
        self.category        = data.get("category", "generic")
        self.name            = data.get("name", "")
        self.name_fa         = data.get("name_fa", "")
        self.description     = data.get("description", "")
        self.description_fa  = data.get("description_fa", "")
        self.file_extension  = data.get("file_extension", "tap")
        self.units           = data.get("units", "mm")
        self.has_arcs        = data.get("has_arcs", False)
        self.has_atc         = data.get("has_atc", False)
        self.line_numbers    = data.get("line_numbers", False)
        self.machines        = data.get("machines", [])
        self._header         = data.get("header", [])
        self._footer         = data.get("footer", [])
        self._rapid          = data.get("rapid", "G0 X{x} Y{y} Z{z}")
        self._feed_first     = data.get("feed_first", "G1 X{x} Y{y} Z{z} F{feed}")
        self._feed           = data.get("feed", "G1 X{x} Y{y} Z{z}")
        self._toolchange     = data.get("toolchange", "T{t} M6\nM3 S{rpm}")
        self._cw_arc_first   = data.get("cw_arc_first")
        self._cw_arc         = data.get("cw_arc")
        self._ccw_arc_first  = data.get("ccw_arc_first")
        self._ccw_arc        = data.get("ccw_arc")
        self.is_custom       = data.get("is_custom", False)

    # ── Code generation ───────────────────────────────────────

    def render_header(self, params: dict) -> str:
        lines = [self._fmt(line, params) for line in self._header]
        return "\n".join(lines)

    def render_footer(self, params: dict) -> str:
        lines = [self._fmt(line, params) for line in self._footer]
        return "\n".join(lines)

    def render_rapid(self, x, y, z, params: dict = None) -> str:
        p = dict(params or {}); p.update({"x": f"{x:.3f}", "y": f"{y:.3f}", "z": f"{z:.3f}"})
        return self._fmt(self._rapid, p)

    def render_feed(self, x, y, z, feed, params: dict = None, first=False) -> str:
        p = dict(params or {}); p.update({"x": f"{x:.3f}", "y": f"{y:.3f}", "z": f"{z:.3f}", "feed": f"{feed:.1f}"})
        tpl = self._feed_first if first else self._feed
        return self._fmt(tpl, p)

    def render_toolchange(self, tool_num: int, rpm: int, params: dict = None) -> str:
        p = dict(params or {}); p.update({"t": str(tool_num), "rpm": str(rpm)})
        return self._fmt(self._toolchange, p)

    def render_arc(self, x, y, i, j, feed, cw=True, first=False, params: dict = None) -> Optional[str]:
        if cw:
            tpl = self._cw_arc_first if first else self._cw_arc
        else:
            tpl = self._ccw_arc_first if first else self._ccw_arc
        if tpl is None:
            return None
        p = dict(params or {})
        p.update({"x": f"{x:.3f}", "y": f"{y:.3f}",
                  "i": f"{i:.3f}", "j": f"{j:.3f}", "feed": f"{feed:.1f}"})
        return self._fmt(tpl, p)

    @staticmethod
    def _fmt(template: str, params: dict) -> str:
        try:
            return template.format(**params)
        except KeyError:
            return template

    # ── Display ───────────────────────────────────────────────
    def display_name(self, lang="en") -> str:
        if lang == "fa" and self.name_fa:
            return self.name_fa
        return self.name

    def machines_str(self) -> str:
        return " • ".join(self.machines[:4])

    def badge(self) -> str:
        parts = []
        if self.has_arcs: parts.append("Arcs")
        if self.has_atc:  parts.append("ATC")
        if self.line_numbers: parts.append("N#")
        return "  ".join(parts)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "category": self.category,
            "name": self.name, "name_fa": self.name_fa,
            "description": self.description, "description_fa": self.description_fa,
            "file_extension": self.file_extension, "units": self.units,
            "has_arcs": self.has_arcs, "has_atc": self.has_atc,
            "line_numbers": self.line_numbers, "machines": self.machines,
            "header": self._header, "footer": self._footer,
            "rapid": self._rapid, "feed_first": self._feed_first,
            "feed": self._feed, "toolchange": self._toolchange,
            "cw_arc_first": self._cw_arc_first, "cw_arc": self._cw_arc,
            "ccw_arc_first": self._ccw_arc_first, "ccw_arc": self._ccw_arc,
            "is_custom": self.is_custom,
        }

    def __repr__(self):
        return f"<PP {self.id}: {self.name}>"


# ═══════════════════════════════════════════════════════════════
# Manager
# ═══════════════════════════════════════════════════════════════
class PostProcessorManager:
    """
    Manages all post-processors (built-in + custom).
    Singleton — use `pp_manager` module instance.
    """

    def __init__(self):
        self._bank:    List[PostProcessor] = []
        self._custom:  List[PostProcessor] = []
        self._cats:    List[dict]          = []
        self._active_id: str               = "syntec_arc_mm"
        self.load()
        # Restore last-used post processor from config
        try:
            from config import config as _cfg
            saved_id = _cfg.get("gcode", "active_post_processor")
            if saved_id:
                self._active_id = saved_id
        except Exception:
            pass

    # ── Load ──────────────────────────────────────────────────
    def load(self):
        # Built-in bank
        if BANK_FILE.exists():
            try:
                with open(BANK_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._cats = data.get("categories", [])
                self._bank = [PostProcessor(p)
                              for p in data.get("post_processors", [])]
                print(f"[PP] Loaded {len(self._bank)} post-processors")
            except Exception as e:
                print(f"[PP] Bank load error: {e}")

        # Custom post-processors
        CUSTOM_DIR.mkdir(parents=True, exist_ok=True)
        for path in CUSTOM_DIR.glob("*.json"):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                d["is_custom"] = True
                pp = PostProcessor(d)
                self._custom.append(pp)
                print(f"[PP] Custom loaded: {pp.name}")
            except Exception as e:
                print(f"[PP] Custom load error {path.name}: {e}")

    # ── Access ────────────────────────────────────────────────
    def all(self) -> List[PostProcessor]:
        return self._bank + self._custom

    def by_category(self, cat_id: str) -> List[PostProcessor]:
        return [p for p in self.all() if p.category == cat_id]

    def get(self, pp_id: str) -> Optional[PostProcessor]:
        for p in self.all():
            if p.id == pp_id:
                return p
        return None

    def categories(self) -> List[dict]:
        return self._cats

    def category_name(self, cat_id: str) -> str:
        for c in self._cats:
            if c["id"] == cat_id:
                return c["name"]
        return cat_id

    def category_color(self, cat_id: str) -> str:
        for c in self._cats:
            if c["id"] == cat_id:
                return c.get("color", "#555")
        return "#555"

    # ── Active selection ──────────────────────────────────────
    @property
    def active(self) -> Optional[PostProcessor]:
        return self.get(self._active_id)

    def set_active(self, pp_id: str) -> bool:
        pp = self.get(pp_id)
        if pp:
            self._active_id = pp_id
            try:
                from config import config as _cfg
                _cfg.set(pp_id, "gcode", "active_post_processor")
            except Exception:
                pass
            return True
        return False

    # ── Save custom ───────────────────────────────────────────
    def save_custom(self, pp: PostProcessor) -> bool:
        pp.is_custom = True
        path = CUSTOM_DIR / f"{pp.id}.json"
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(pp.to_dict(), f, ensure_ascii=False, indent=2)
            # Update in-memory list
            self._custom = [c for c in self._custom if c.id != pp.id]
            self._custom.append(pp)
            return True
        except Exception as e:
            print(f"[PP] Save custom error: {e}")
            return False

    def delete_custom(self, pp_id: str) -> bool:
        pp = self.get(pp_id)
        if pp and pp.is_custom:
            path = CUSTOM_DIR / f"{pp_id}.json"
            if path.exists():
                path.unlink()
            self._custom = [c for c in self._custom if c.id != pp_id]
            return True
        return False

    # ── Import from .pp file (Vectric format) ─────────────────
    def import_pp_file(self, path: str) -> Optional[PostProcessor]:
        """Import a Vectric .pp file and convert to our format."""
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            return self._parse_vectric_pp(content, Path(path).stem)
        except Exception as e:
            print(f"[PP] Import error: {e}")
            return None

    def _parse_vectric_pp(self, content: str, stem: str) -> PostProcessor:
        """Parse Vectric .pp file format."""
        def get_val(key):
            m = re.search(rf'^{key}\s*=\s*"?([^"\n]+)"?', content, re.MULTILINE)
            return m.group(1).strip() if m else ""

        def get_block(name):
            m = re.search(rf'begin {name}\s*\n(.*?)(?=\nbegin |\Z)',
                          content, re.DOTALL)
            if not m:
                return []
            lines = []
            for line in m.group(1).split('\n'):
                line = line.strip()
                if line.startswith('"') and line.endswith('"'):
                    # Convert Vectric template vars to our {var} format
                    l = line[1:-1]
                    l = re.sub(r'\[X\]', 'X{x}', l)
                    l = re.sub(r'\[Y\]', 'Y{y}', l)
                    l = re.sub(r'\[Z\]', 'Z{z}', l)
                    l = re.sub(r'\[F\]', 'F{feed}', l)
                    l = re.sub(r'\[S\]', 'S{rpm}', l)
                    l = re.sub(r'\[T\]', '{t}', l)
                    l = re.sub(r'\[I\]', 'I{i}', l)
                    l = re.sub(r'\[J\]', 'J{j}', l)
                    l = re.sub(r'\[XH\]', 'X{home_x}', l)
                    l = re.sub(r'\[YH\]', 'Y{home_y}', l)
                    l = re.sub(r'\[ZH\]', 'Z{home_z}', l)
                    l = re.sub(r'\[N\]', '', l)
                    l = re.sub(r'\[SAFEZ\]', 'Z{safe_z}', l)
                    lines.append(l.strip())
            return [l for l in lines if l]

        post_name = get_val("POST_NAME") or stem
        ext       = get_val("FILE_EXTENSION") or "tap"
        units_raw = get_val("UNITS").lower()
        units     = "mm" if "mm" in units_raw else "inch"
        has_arcs  = bool(get_block("FIRST_CW_ARC_MOVE"))
        has_atc   = bool(get_block("TOOLCHANGE"))

        header    = get_block("HEADER")
        footer    = get_block("FOOTER")
        rapid     = "\n".join(get_block("RAPID_MOVE")) or "G0 X{x} Y{y} Z{z}"
        feed_1st  = "\n".join(get_block("FIRST_FEED_MOVE")) or "G1 X{x} Y{y} Z{z} F{feed}"
        feed      = "\n".join(get_block("FEED_MOVE")) or "G1 X{x} Y{y} Z{z}"
        tc        = "\n".join(get_block("TOOLCHANGE")) or "T{t} M6\nM3 S{rpm}"
        cw1       = "\n".join(get_block("FIRST_CW_ARC_MOVE")) or None
        cw        = "\n".join(get_block("CW_ARC_MOVE")) or None
        ccw1      = "\n".join(get_block("FIRST_CCW_ARC_MOVE")) or None
        ccw       = "\n".join(get_block("CCW_ARC_MOVE")) or None

        pp_id = re.sub(r'[^a-z0-9_]', '_', stem.lower())

        pp = PostProcessor({
            "id":             pp_id,
            "category":       "generic",
            "name":           post_name,
            "name_fa":        "",
            "description":    f"Imported from {stem}.pp",
            "description_fa": "",
            "file_extension": ext,
            "units":          units,
            "has_arcs":       has_arcs,
            "has_atc":        has_atc,
            "line_numbers":   False,
            "machines":       ["Imported"],
            "header":         header,
            "footer":         footer,
            "rapid":          rapid,
            "feed_first":     feed_1st,
            "feed":           feed,
            "toolchange":     tc,
            "cw_arc_first":   cw1,
            "cw_arc":         cw,
            "ccw_arc_first":  ccw1,
            "ccw_arc":        ccw,
            "is_custom":      True,
        })
        return pp

    # ── Stats ─────────────────────────────────────────────────
    def stats(self) -> dict:
        by_cat = {}
        for p in self.all():
            by_cat[p.category] = by_cat.get(p.category, 0) + 1
        return {
            "total":   len(self.all()),
            "builtin": len(self._bank),
            "custom":  len(self._custom),
            "by_category": by_cat,
        }


# ═══════════════════════════════════════════════════════════════
# PySide6 Widget
# ═══════════════════════════════════════════════════════════════
try:
    from PySide6.QtCore import Qt, Signal
    from PySide6.QtGui  import QColor, QFont
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QSplitter,
        QTreeWidget, QTreeWidgetItem, QListWidget, QListWidgetItem,
        QLabel, QPushButton, QLineEdit, QGroupBox,
        QTextEdit, QFileDialog, QMessageBox, QFrame,
        QAbstractItemView, QSizePolicy
    )
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:

    C_BG     = "#1e1e1e"
    C_PANEL  = "#252526"
    C_BORDER = "#3e3e42"
    C_ACCENT = "#0078d4"
    C_TEXT   = "#cccccc"
    C_DIM    = "#858585"

    class PostProcessorWidget(QWidget):
        """
        Post-Processor selector & manager widget.
        Signal: pp_selected(PostProcessor)
        """
        pp_selected = Signal(object)

        def __init__(self, manager: PostProcessorManager, parent=None):
            super().__init__(parent)
            self._mgr  = manager
            self._lang = "en"
            self._build()
            self._apply_style()
            self._refresh()

        def set_language(self, lang: str):
            self._lang = lang
            self._refresh()

        # ── Build ─────────────────────────────────────────────
        def _build(self):
            root = QVBoxLayout(self)
            root.setContentsMargins(4, 4, 4, 4)
            root.setSpacing(4)

            # Toolbar
            tb = QHBoxLayout()
            self._btn_import = QPushButton("📥  Import .pp")
            self._btn_import.setFixedHeight(28)
            self._btn_import.clicked.connect(self._on_import)
            self._search = QLineEdit()
            self._search.setPlaceholderText("🔍  Search controllers...")
            self._search.setFixedWidth(220)
            self._search.textChanged.connect(self._on_search)
            tb.addWidget(self._btn_import)
            tb.addStretch()
            tb.addWidget(self._search)
            root.addLayout(tb)

            # Splitter: categories | list | detail
            splitter = QSplitter(Qt.Horizontal)

            # Category tree
            self._cat_tree = QTreeWidget()
            self._cat_tree.setHeaderHidden(True)
            self._cat_tree.setFixedWidth(200)
            self._cat_tree.itemSelectionChanged.connect(self._refresh_list)
            splitter.addWidget(self._cat_tree)

            # PP list
            self._list = QListWidget()
            self._list.setAlternatingRowColors(True)
            self._list.itemSelectionChanged.connect(self._on_selection)
            self._list.itemDoubleClicked.connect(self._on_select)
            splitter.addWidget(self._list)

            # Detail
            detail_w = QWidget()
            dl = QVBoxLayout(detail_w)
            dl.setContentsMargins(8, 8, 8, 8)

            self._detail_name = QLabel("—")
            self._detail_name.setStyleSheet(
                "font-weight: bold; font-size: 14px; color: #4ec9b0;")
            self._detail_name.setWordWrap(True)

            self._detail_badge = QLabel("")
            self._detail_badge.setStyleSheet(f"color: {C_DIM}; font-size: 11px;")

            self._detail_desc = QLabel("—")
            self._detail_desc.setWordWrap(True)
            self._detail_desc.setStyleSheet(f"color: {C_TEXT}; font-size: 12px;")

            sep = QFrame(); sep.setFrameShape(QFrame.HLine)
            sep.setStyleSheet(f"color: {C_BORDER};")

            self._detail_machines = QLabel("—")
            self._detail_machines.setWordWrap(True)
            self._detail_machines.setStyleSheet(
                f"color: {C_DIM}; font-size: 11px;")

            sep2 = QFrame(); sep2.setFrameShape(QFrame.HLine)
            sep2.setStyleSheet(f"color: {C_BORDER};")

            self._detail_header = QTextEdit()
            self._detail_header.setReadOnly(True)
            self._detail_header.setFixedHeight(120)
            self._detail_header.setStyleSheet(
                f"background: #1a1a1a; color: #9cdcfe; "
                f"font-family: Consolas, monospace; font-size: 11px; "
                f"border: 1px solid {C_BORDER};")

            self._btn_select = QPushButton("✔  Use This Post-Processor")
            self._btn_select.setObjectName("btn_primary")
            self._btn_select.setFixedHeight(32)
            self._btn_select.clicked.connect(self._on_select)

            dl.addWidget(QLabel("Selected:"))
            dl.addWidget(self._detail_name)
            dl.addWidget(self._detail_badge)
            dl.addWidget(sep)
            dl.addWidget(self._detail_desc)
            dl.addWidget(sep2)
            lbl_m = QLabel("Compatible machines:")
            lbl_m.setStyleSheet(f"color: {C_DIM}; font-size: 11px; font-weight: 600;")
            dl.addWidget(lbl_m)
            dl.addWidget(self._detail_machines)
            lbl_h = QLabel("Header preview:")
            lbl_h.setStyleSheet(f"color: {C_DIM}; font-size: 11px; font-weight: 600; margin-top: 8px;")
            dl.addWidget(lbl_h)
            dl.addWidget(self._detail_header)
            dl.addStretch()
            dl.addWidget(self._btn_select)

            splitter.addWidget(detail_w)
            splitter.setStretchFactor(0, 0)
            splitter.setStretchFactor(1, 2)
            splitter.setStretchFactor(2, 1)

            root.addWidget(splitter, 1)

            # Status
            self._status = QLabel()
            self._status.setStyleSheet(f"color: {C_DIM}; font-size: 11px;")
            root.addWidget(self._status)

        # ── Refresh ───────────────────────────────────────────
        def _refresh(self):
            self._refresh_cat_tree()
            self._refresh_list()

        def _refresh_cat_tree(self):
            self._cat_tree.clear()
            stats = self._mgr.stats()

            all_item = QTreeWidgetItem([f"  🗂  All  ({stats['total']})"])
            all_item.setData(0, Qt.UserRole, None)
            all_item.setForeground(0, QColor(C_TEXT))
            self._cat_tree.addTopLevelItem(all_item)

            for cat in self._mgr.categories():
                count = stats["by_category"].get(cat["id"], 0)
                item  = QTreeWidgetItem(
                    [f"  {cat['icon']}  {cat['name']}  ({count})"])
                item.setData(0, Qt.UserRole, cat["id"])
                item.setForeground(0, QColor(cat.get("color", C_DIM)))
                self._cat_tree.addTopLevelItem(item)

            if stats["custom"] > 0:
                cust_item = QTreeWidgetItem(
                    [f"  ⭐  Custom  ({stats['custom']})"])
                cust_item.setData(0, Qt.UserRole, "__custom__")
                cust_item.setForeground(0, QColor("#f39c12"))
                self._cat_tree.addTopLevelItem(cust_item)

            self._cat_tree.expandAll()
            if not self._cat_tree.selectedItems():
                self._cat_tree.setCurrentItem(
                    self._cat_tree.topLevelItem(0))

        def _refresh_list(self):
            sel  = self._cat_tree.selectedItems()
            filt = sel[0].data(0, Qt.UserRole) if sel else None
            srch = self._search.text().lower().strip()

            if filt == "__custom__":
                pps = [p for p in self._mgr.all() if p.is_custom]
            elif filt:
                pps = self._mgr.by_category(filt)
            else:
                pps = self._mgr.all()

            if srch:
                pps = [p for p in pps if
                       srch in p.name.lower() or
                       srch in p.name_fa.lower() or
                       srch in " ".join(p.machines).lower()]

            self._list.clear()
            for pp in pps:
                color  = self._mgr.category_color(pp.category)
                badges = []
                if pp.has_arcs: badges.append("⌒")
                if pp.has_atc:  badges.append("ATC")
                badge_str = "  ".join(badges)
                text = f"{pp.display_name(self._lang)}"
                if badge_str:
                    text += f"  [{badge_str}]"

                item = QListWidgetItem(text)
                item.setData(Qt.UserRole, pp.id)
                item.setForeground(QColor(C_TEXT))
                if pp.id == self._mgr._active_id:
                    item.setForeground(QColor("#4ec9b0"))
                    f = item.font(); f.setBold(True); item.setFont(f)
                self._list.addItem(item)

            s = self._mgr.stats()
            self._status.setText(
                f"Total: {s['total']}  |  Built-in: {s['builtin']}  |  Custom: {s['custom']}")

        def _on_search(self):
            self._refresh_list()

        # ── Selection → Detail ────────────────────────────────
        def _on_selection(self):
            items = self._list.selectedItems()
            if not items:
                return
            pp_id = items[0].data(Qt.UserRole)
            pp    = self._mgr.get(pp_id)
            if not pp:
                return

            color = self._mgr.category_color(pp.category)
            self._detail_name.setText(pp.display_name(self._lang))
            self._detail_name.setStyleSheet(
                f"font-weight: bold; font-size: 14px; color: {color};")

            badges = []
            if pp.has_arcs: badges.append("✔ Arc support (G2/G3)")
            if pp.has_atc:  badges.append("✔ ATC (Auto Tool Change)")
            if pp.line_numbers: badges.append("✔ Line numbers")
            self._detail_badge.setText("  |  ".join(badges) if badges
                                       else "Basic G-code")

            desc = pp.description_fa if self._lang == "fa" else pp.description
            self._detail_desc.setText(desc)

            self._detail_machines.setText(
                "\n".join(f"• {m}" for m in pp.machines))

            # Header preview with sample params
            sample = {
                "t": "1", "rpm": "18000",
                "home_x": "0.000", "home_y": "0.000",
                "home_z": "50.000", "safe_z": "15.000",
                "sheet_width": "2800", "sheet_height": "1220",
                "thickness": "18", "n": "10",
            }
            preview = pp.render_header(sample)
            self._detail_header.setPlainText(preview)

        def _on_select(self):
            items = self._list.selectedItems()
            if not items:
                return
            pp_id = items[0].data(Qt.UserRole)
            pp    = self._mgr.get(pp_id)
            if pp:
                self._mgr.set_active(pp_id)
                self._refresh_list()
                self.pp_selected.emit(pp)

        def _on_import(self):
            paths, _ = QFileDialog.getOpenFileNames(
                self, "Import Post-Processor",
                str(Path.home()),
                "Post-Processor Files (*.pp *.json);;All Files (*)")
            count = 0
            for path in paths:
                p = path.lower()
                if p.endswith(".pp"):
                    pp = self._mgr.import_pp_file(path)
                    if pp:
                        ok = self._mgr.save_custom(pp)
                        if ok: count += 1
                elif p.endswith(".json"):
                    try:
                        with open(path, "r", encoding="utf-8") as f:
                            d = json.load(f)
                        d["is_custom"] = True
                        pp = PostProcessor(d)
                        self._mgr.save_custom(pp)
                        count += 1
                    except Exception as e:
                        QMessageBox.warning(self, "Error", str(e))
            if count:
                self._refresh()
                QMessageBox.information(
                    self, "Import", f"Imported {count} post-processor(s).")

        # ── Style ─────────────────────────────────────────────
        def _apply_style(self):
            self.setStyleSheet(f"""
                QWidget {{
                    background: {C_BG};
                    color: {C_TEXT};
                    font-family: "Segoe UI", Tahoma, sans-serif;
                    font-size: 12px;
                }}
                QListWidget {{
                    background: #1a1a1a;
                    border: 1px solid {C_BORDER};
                    alternate-background-color: #222222;
                }}
                QListWidget::item {{ padding: 5px 8px; }}
                QListWidget::item:selected {{
                    background: #264f78; color: white;
                }}
                QTreeWidget {{
                    background: {C_PANEL};
                    border: 1px solid {C_BORDER};
                    outline: none;
                }}
                QTreeWidget::item {{ padding: 4px 6px; }}
                QTreeWidget::item:selected {{ background: #264f78; color: white; }}
                QPushButton {{
                    background: {C_PANEL};
                    border: 1px solid {C_BORDER};
                    border-radius: 3px;
                    padding: 4px 10px;
                    color: {C_TEXT};
                }}
                QPushButton:hover {{ background: #3e3e42; border-color: {C_ACCENT}; }}
                QPushButton#btn_primary {{
                    background: {C_ACCENT};
                    border-color: {C_ACCENT};
                    color: white;
                    font-weight: 600;
                    font-size: 13px;
                }}
                QPushButton#btn_primary:hover {{ background: #106ebe; }}
                QLineEdit {{
                    background: #1a1a1a;
                    border: 1px solid {C_BORDER};
                    border-radius: 3px;
                    padding: 3px 6px;
                    color: {C_TEXT};
                }}
                QLineEdit:focus {{ border-color: {C_ACCENT}; }}
                QLabel {{ background: transparent; }}
                QSplitter::handle {{ background: {C_BORDER}; width: 1px; }}
            """)


# ═══════════════════════════════════════════════════════════════
# Singleton + test
# ═══════════════════════════════════════════════════════════════
pp_manager = PostProcessorManager()


if __name__ == "__main__":
    print("=" * 60)
    print("FIROO CAM - Post-Processor Manager")
    print("=" * 60)

    mgr   = PostProcessorManager()
    stats = mgr.stats()

    print(f"\nTotal:    {stats['total']}")
    print(f"Built-in: {stats['builtin']}")
    print(f"Custom:   {stats['custom']}")
    print(f"\nBy category:")
    for cat_id, count in stats["by_category"].items():
        print(f"  {mgr.category_name(cat_id):35} {count}")

    print(f"\nAll post-processors:")
    for pp in mgr.all():
        arcs = "⌒" if pp.has_arcs else " "
        atc  = "ATC" if pp.has_atc else "   "
        print(f"  {pp.id:25} {arcs} {atc}  .{pp.file_extension:4}  {pp.name}")

    print(f"\n── Header preview: syntec_arc_mm ──")
    pp = mgr.get("syntec_arc_mm")
    if pp:
        params = {"t": "1", "rpm": "18000", "home_x": "0.000",
                  "home_y": "0.000", "home_z": "50.000", "safe_z": "15.000", "n": "10"}
        print(pp.render_header(params))
        print("── Footer ──")
        print(pp.render_footer(params))

    print(f"\n── Test import from .pp file ──")
    pp_imported = mgr.import_pp_file("/mnt/project/Radonix.pp")
    if pp_imported:
        print(f"Imported: {pp_imported.name}")
        print(f"Has arcs: {pp_imported.has_arcs}")
        print(f"Has ATC:  {pp_imported.has_atc}")
        params = {"t": "1", "rpm": "18000", "home_x": "0.000",
                  "home_y": "0.000", "home_z": "50.000", "safe_z": "15.000"}
        print("Header:", pp_imported.render_header(params))

    print(f"\n✅ Post-Processor Manager OK")

    if HAS_QT:
        import sys
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance() or QApplication(sys.argv)
        app.setStyle("Fusion")
        w = PostProcessorWidget(mgr)
        w.setWindowTitle("FIROO CAM — Post-Processor Bank")
        w.resize(1150, 700)
        w.show()
        sys.exit(app.exec())
