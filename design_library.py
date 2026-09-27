"""
FIROO CAM - Design Library
Manages .fdr design files.
Grid view with preview, search, filter, import/export.
"""
from __future__ import annotations
import json
import shutil
from pathlib import Path
from typing import List, Dict, Optional

from PySide6.QtCore  import Qt, Signal, QSize, QTimer
from PySide6.QtGui   import (QColor, QPainter, QBrush, QPen,
                              QFont, QPixmap)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QLineEdit, QComboBox, QFrame,
    QScrollArea, QFileDialog, QMessageBox,
    QApplication, QDialog, QFormLayout,
    QDialogButtonBox, QGridLayout, QSizePolicy,
    QGroupBox, QAbstractItemView
)

from config import config
from design_editor import DesignData, FDR_EXTENSION, LAYER_COLORS

C_BG     = QColor("#1e1e1e"); C_PANEL  = QColor("#252526")
C_BORDER = QColor("#3e3e42"); C_ACCENT = QColor("#0078d4")
C_TEXT   = QColor("#cccccc"); C_DIM    = QColor("#858585")
C_GOOD   = QColor("#4ec9b0"); C_WARN   = QColor("#ce9178")
C_SEL    = QColor("#264f78")

CATEGORY_LABELS = {
    "en": {
        "All": "All", "designs": "Cabinet Doors", "custom_doors": "Custom Doors",
        "vitrines": "Vitrines", "hoods": "Hoods", "columns": "Columns",
        "decorative": "Decorative", "others": "Others",
    },
    "fa": {
        "All": "همه", "designs": "درب کابینت", "custom_doors": "درب سفارشی",
        "vitrines": "ویترین", "hoods": "هود", "columns": "ستون",
        "decorative": "دکوراتیو", "others": "سایر",
    },
    "ar": {
        "All": "الكل", "designs": "أبواب خزائن", "custom_doors": "أبواب خاصة",
        "vitrines": "واجهات زجاج", "hoods": "هود", "columns": "أعمدة",
        "decorative": "ديكور", "others": "أخرى",
    },
}
CATEGORY_MAP = CATEGORY_LABELS["en"]
BUILTIN_CATEGORIES = ["All", "designs", "vitrines", "hoods", "columns", "decorative", "others", "custom_doors"]
CATEGORIES = list(BUILTIN_CATEGORIES)   # extended at runtime with custom groups

def category_label(cat: str, lang_code: str = "en") -> str:
    return CATEGORY_LABELS.get(lang_code, CATEGORY_LABELS["en"]).get(cat, cat)


def _ask_group_name(parent, title: str, default: str) -> tuple[str, bool]:
    """Simple one-field dialog; returns (name, ok)."""
    dlg = QDialog(parent)
    dlg.setWindowTitle(title)
    dlg.setFixedWidth(300)
    lay = QVBoxLayout(dlg)
    lay.setSpacing(10)
    lay.setContentsMargins(16, 16, 16, 12)
    edit = QLineEdit(default)
    edit.setPlaceholderText("Group name (letters, spaces, digits)")
    edit.selectAll()
    lay.addWidget(QLabel("Group name:"))
    lay.addWidget(edit)
    bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
    bb.accepted.connect(dlg.accept)
    bb.rejected.connect(dlg.reject)
    lay.addWidget(bb)
    edit.returnPressed.connect(dlg.accept)
    ok = dlg.exec() == QDialog.Accepted
    return edit.text().strip(), ok


# ═══════════════════════════════════════════════════════════════
# Design Card Widget
# ═══════════════════════════════════════════════════════════════
class DesignCard(QFrame):
    """
    Single design card in the library grid.
    Shows: preview thumbnail, name, code, layer count.
    """
    clicked      = Signal(str)   # design_code
    double_click = Signal(str)   # design_code
    edit         = Signal(str)
    delete       = Signal(str)

    BASE_W = 160
    BASE_H = 190
    BASE_PREV_H = 110
    # backward-compat alias
    CARD_W = BASE_W
    CARD_H = BASE_H

    def __init__(self, meta: Dict, scale: float = 1.0, parent=None):
        super().__init__(parent)
        self._meta     = meta
        self._selected = False
        self._design: Optional[DesignData] = None
        self._scale    = max(0.5, min(2.0, scale))
        cw = int(self.BASE_W * self._scale)
        ch = int(self.BASE_H * self._scale)
        self.setFixedSize(cw, ch)
        self.setObjectName("design_card")
        self.setCursor(Qt.PointingHandCursor)
        self._build()
        self._load_design()

    def _build(self):
        s   = self._scale
        cw  = int(self.BASE_W * s)
        prev_h = int(self.BASE_PREV_H * s)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(4,4,4,4)
        lay.setSpacing(3)

        # Preview
        self._preview = QLabel()
        self._preview.setFixedSize(cw - 8, prev_h)
        self._preview.setAlignment(Qt.AlignCenter)
        self._preview.setStyleSheet(
            "background:#1a1a1a; border:1px solid #3e3e42;"
            "border-radius:2px;")
        lay.addWidget(self._preview)

        # Code + name
        self._lbl_code = QLabel(self._meta.get("code",""))
        self._lbl_code.setStyleSheet(
            f"color:{C_ACCENT.name()};font-size:10px;"
            f"font-weight:700;background:transparent;")
        lay.addWidget(self._lbl_code)

        self._lbl_name = QLabel(self._meta.get("name",""))
        self._lbl_name.setWordWrap(True)
        self._lbl_name.setStyleSheet(
            f"color:{C_TEXT.name()};font-size:11px;"
            f"background:transparent;")
        lay.addWidget(self._lbl_name)

        # Category tag
        cat = self._meta.get("category","")
        cat_colors = {
            "custom_doors":"#e74c3c", "vitrines":"#3498db",
            "hoods":"#27ae60", "columns":"#f39c12",
            "decorative":"#9b59b6", "others":"#95a5a6",
            "designs":"#0078d4"
        }
        self._lbl_cat = QLabel(category_label(cat, getattr(self, "_lang", "en")))
        self._lbl_cat.setStyleSheet(
            f"color:{cat_colors.get(cat,'#555')};"
            f"font-size:9px;background:transparent;")
        lay.addWidget(self._lbl_cat)
        lay.addStretch()

    def _load_design(self):
        """Load the .fdr file and render thumbnail."""
        path_text = self._meta.get("path", "")
        designs_dir = Path(config.output_folder).parent / "designs"
        fname = self._meta.get("file","")
        path  = Path(path_text) if path_text else designs_dir / fname

        # Also try with .fdr extension
        if not path.exists():
            code = self._meta.get("code","")
            for ext in (FDR_EXTENSION, ".json"):
                p2 = designs_dir / f"{code}{ext}"
                if p2.exists():
                    path = p2; break

        if path.exists():
            self._design = DesignData.load(str(path))
            if self._design:
                self._render_thumbnail()

    def _render_thumbnail(self):
        if not self._design:
            return
        pw = int(self.BASE_W * self._scale) - 8
        ph = int(self.BASE_PREV_H * self._scale)
        pix = QPixmap(pw, ph)
        pix.fill(QColor("#1a1a1a"))
        p   = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)

        d   = self._design
        dw, dh = d.width, d.height
        pad = 10
        sc  = min((pw - 2*pad) / dw, (ph - 2*pad) / dh)
        ox  = (pw - dw*sc) / 2
        oy  = (ph - dh*sc) / 2

        # Background
        from PySide6.QtCore import QRectF
        from PySide6.QtGui  import QLinearGradient
        door_rect = QRectF(ox, oy, dw*sc, dh*sc)
        grad = QLinearGradient(door_rect.topLeft(),
                                door_rect.bottomRight())
        grad.setColorAt(0, QColor("#4a3728"))
        grad.setColorAt(1, QColor("#3a2a1e"))
        p.fillRect(door_rect, grad)
        p.setPen(QPen(QColor("#6b4c3b"), 1))
        p.drawRect(door_rect)

        # Layers
        for layer in reversed(d.layers):
            if not layer.get("enabled"): continue
            if layer["type"] == "profile": continue
            idx = layer["id"]
            off = layer["offset_mm"]
            col = LAYER_COLORS[idx % len(LAYER_COLORS)]
            lw  = dw - 2*off; lh = dh - 2*off
            if lw <= 0 or lh <= 0: continue
            lrect = QRectF(ox + off*sc, oy + off*sc,
                           lw*sc, lh*sc)
            fc = QColor(col); fc.setAlpha(140)
            p.fillRect(lrect, fc)
            p.setPen(QPen(col.lighter(120), 0.8))
            p.drawRect(lrect)

        # Border
        p.setPen(QPen(QColor("#e74c3c"), 1.5))
        p.setBrush(Qt.NoBrush)
        p.drawRect(door_rect)

        p.end()
        self._preview.setPixmap(pix)

    def set_selected(self, v: bool):
        self._selected = v
        border = C_ACCENT.name() if v else "#3e3e42"
        bg     = "#1a3a5c" if v else "#252526"
        self.setStyleSheet(
            f"#design_card{{background:{bg};"
            f"border:2px solid {border};"
            f"border-radius:4px;}}")

    def mousePressEvent(self, ev):
        self.clicked.emit(self._meta.get("code",""))

    def mouseDoubleClickEvent(self, ev):
        self.double_click.emit(self._meta.get("code",""))

    def contextMenuEvent(self, ev):
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        menu.setStyleSheet(
            f"QMenu{{background:#252526;color:#cccccc;"
            f"border:1px solid #3e3e42;}}"
            f"QMenu::item:selected{{background:#0078d4;}}")
        act_edit = menu.addAction("✎  Edit Design")
        act_del  = menu.addAction("✕  Delete")
        act = menu.exec(ev.globalPos())
        if act == act_edit:
            self.edit.emit(self._meta.get("code",""))
        elif act == act_del:
            self.delete.emit(self._meta.get("code",""))


# ═══════════════════════════════════════════════════════════════
# DESIGN LIBRARY WIDGET
# ═══════════════════════════════════════════════════════════════
class DesignLibraryWidget(QWidget):
    """
    Full design library browser.
    Signals:
        design_selected(code)  — single click
        design_opened(code)    — double click / Open button
    """
    design_selected = Signal(str)
    design_opened   = Signal(str)

    def __init__(self, designs_dir: str = None, parent=None):
        super().__init__(parent)
        self._designs_dir = designs_dir or str(
            Path(config.output_folder).parent / "designs")
        Path(self._designs_dir).mkdir(parents=True, exist_ok=True)

        self._all_meta:     List[Dict]       = []
        self._cards:        List[DesignCard] = []
        self._selected:     Optional[str]    = None
        self._lang:         str              = "en"
        self._custom_groups: List[str]       = []
        self._card_scale:   float            = 1.0

        self._load_custom_groups()
        self._build()
        self._apply_style()
        self.setFocusPolicy(Qt.StrongFocus)
        self.refresh()

    # ── custom groups persistence ─────────────────────────────
    def _groups_file(self) -> Path:
        return Path(self._designs_dir) / "groups.json"

    def _load_custom_groups(self):
        gf = self._groups_file()
        if gf.exists():
            try:
                data = json.loads(gf.read_text(encoding="utf-8"))
                self._custom_groups = [g for g in data.get("groups", [])
                                       if g not in BUILTIN_CATEGORIES]
            except Exception:
                self._custom_groups = []
        else:
            self._custom_groups = []

    def _save_custom_groups(self):
        try:
            self._groups_file().write_text(
                json.dumps({"groups": self._custom_groups}, ensure_ascii=False, indent=2),
                encoding="utf-8")
        except Exception:
            pass

    def _all_categories(self) -> List[str]:
        return BUILTIN_CATEGORIES + self._custom_groups

    def set_language(self, lang_code: str):
        self._lang = lang_code if lang_code in CATEGORY_LABELS else "en"
        rtl = self._lang in ("fa", "ar")
        self.setLayoutDirection(Qt.RightToLeft if rtl else Qt.LeftToRight)
        if hasattr(self, "_btn_new"):
            labels = {
                "en": ("New", "Open", "Import", "Delete", "Refresh", "Search by name or code...", "Design Info", "Category:"),
                "fa": ("جدید", "باز کردن", "وارد کردن", "حذف", "تازه‌سازی", "جستجو بر اساس نام یا کد...", "اطلاعات طرح", "دسته:"),
                "ar": ("جديد", "فتح", "استيراد", "حذف", "تحديث", "بحث بالاسم أو الكود...", "معلومات التصميم", "الفئة:"),
            }.get(self._lang)
            self._btn_new.setText("⊕  " + labels[0])
            self._btn_open.setText("📂  " + labels[1])
            self._btn_import.setText("📥  " + labels[2])
            self._btn_delete.setText("✕  " + labels[3])
            self._btn_refresh.setText("↻  " + labels[4])
            self._search.setPlaceholderText(labels[5])
            self._lbl_detail_title.setText(labels[6])
            self._lbl_filter_category.setText(labels[7])
            self._sync_cat_combo()
            self._rebuild_group_bar()
            self._apply_filter()

    # ══════════════════════════════════════════════════════════
    # BUILD
    # ══════════════════════════════════════════════════════════
    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0,0,0,0)
        root.setSpacing(0)

        # Toolbar
        root.addWidget(self._build_toolbar())
        root.addWidget(self._hsep())

        # Search + filter bar
        root.addWidget(self._build_filter_bar())
        root.addWidget(self._hsep())

        # Main area: grid + detail panel
        main = QHBoxLayout()
        main.setContentsMargins(0,0,0,0)
        main.setSpacing(0)

        # Grid scroll area
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarAsNeeded)
        self._scroll.setVerticalScrollBarPolicy(
            Qt.ScrollBarAsNeeded)
        self._scroll.setStyleSheet(
            "QScrollArea{border:none;}")

        self._grid_widget = QWidget()
        self._grid_layout = QGridLayout(self._grid_widget)
        self._grid_layout.setContentsMargins(8,8,8,8)
        self._grid_layout.setSpacing(8)
        self._scroll.setWidget(self._grid_widget)
        main.addWidget(self._scroll, 1)

        # Detail panel
        main.addWidget(self._vsep())
        self._detail = self._build_detail_panel()
        main.addWidget(self._detail)

        root.addLayout(main, 1)

        # Status bar
        sbar = QFrame()
        sbar.setFixedHeight(22)
        sbar.setStyleSheet(
            f"background:{C_PANEL.name()};"
            f"border-top:1px solid {C_BORDER.name()};")
        sbl = QHBoxLayout(sbar)
        sbl.setContentsMargins(0, 0, 8, 0)
        sbl.setSpacing(0)

        self._lbl_status = QLabel("  0 designs")
        self._lbl_status.setStyleSheet(
            f"color:{C_DIM.name()};padding:0 8px;font-size:11px;")
        sbl.addWidget(self._lbl_status, 1)

        self._lbl_scale = QLabel("100%")
        self._lbl_scale.setStyleSheet(
            f"color:{C_DIM.name()};font-size:10px;")
        self._lbl_scale.setToolTip("Ctrl++ / Ctrl+- to resize cards  |  Ctrl+0 to reset")
        sbl.addWidget(self._lbl_scale)

        root.addWidget(sbar)

    def _build_toolbar(self) -> QFrame:
        tb = QFrame(); tb.setFixedHeight(50)
        tb.setStyleSheet(f"background:qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #202124, stop:1 #2b2d30); border-bottom:1px solid {C_BORDER.name()};")
        tl = QHBoxLayout(tb)
        tl.setContentsMargins(6,4,6,4)
        tl.setSpacing(4)

        def btn(icon, label, tip, w=80):
            b = QPushButton(f"{icon}  {label}")
            b.setToolTip(tip); b.setFixedHeight(32)
            b.setFixedWidth(w)
            b.setStyleSheet(
                f"background:#2d2d30;"
                f"border:1px solid {C_BORDER.name()};"
                f"border-radius:5px;color:{C_TEXT.name()};font-weight:600;")
            return b

        self._btn_new    = btn("⊕","New",    "New design",    70)
        self._btn_open   = btn("📂","Open",   "Open in editor",80)
        self._btn_import = btn("📥","Import", "Import design files",90)
        self._btn_delete = btn("✕","Delete", "Delete selected",90)
        self._btn_refresh= btn("↻","Refresh","Refresh library",90)

        for b in [self._btn_new, self._btn_open,
                  self._btn_import, self._btn_delete,
                  self._btn_refresh]:
            tl.addWidget(b)
        tl.addStretch()

        self._btn_new.clicked.connect(self._new_design)
        self._btn_open.clicked.connect(self._open_selected)
        self._btn_import.clicked.connect(self._import_files)
        self._btn_delete.clicked.connect(self._delete_selected)
        self._btn_refresh.clicked.connect(self.refresh)
        return tb

    def _build_filter_bar(self) -> QWidget:
        wrapper = QWidget()
        wl = QVBoxLayout(wrapper)
        wl.setContentsMargins(0, 0, 0, 0)
        wl.setSpacing(0)

        # ── Row 1: search + combo ────────────────────────────
        fb = QFrame(); fb.setFixedHeight(36)
        fb.setStyleSheet(f"background:{C_PANEL.name()};")
        fl = QHBoxLayout(fb)
        fl.setContentsMargins(8, 4, 8, 4)
        fl.setSpacing(8)

        lbl = QLabel("Search:")
        lbl.setStyleSheet(f"color:{C_DIM.name()};")
        self._search = QLineEdit()
        self._search.setPlaceholderText("Search by name or code...")
        self._search.setFixedHeight(26)
        self._search.textChanged.connect(self._apply_filter)

        self._lbl_filter_category = QLabel("Category:")
        self._lbl_filter_category.setStyleSheet(f"color:{C_DIM.name()};")
        self._cat_filter = QComboBox()
        for c in self._all_categories():
            self._cat_filter.addItem(category_label(c, self._lang), c)
        self._cat_filter.setFixedWidth(130)
        self._cat_filter.currentIndexChanged.connect(self._apply_filter)

        fl.addWidget(lbl); fl.addWidget(self._search, 1)
        fl.addWidget(self._lbl_filter_category)
        fl.addWidget(self._cat_filter)
        wl.addWidget(fb)

        # ── Row 2: group tab bar ─────────────────────────────
        self._group_bar = QFrame()
        self._group_bar.setFixedHeight(32)
        self._group_bar.setStyleSheet(
            f"background:{C_BG.name()}; border-bottom:1px solid {C_BORDER.name()};")
        self._group_bar_layout = QHBoxLayout(self._group_bar)
        self._group_bar_layout.setContentsMargins(6, 2, 6, 2)
        self._group_bar_layout.setSpacing(2)
        self._cat_buttons = []
        self._rebuild_group_bar()
        wl.addWidget(self._group_bar)

        return wrapper

    def _build_detail_panel(self) -> QWidget:
        w   = QWidget(); w.setFixedWidth(220)
        lay = QVBoxLayout(w)
        lay.setContentsMargins(8,8,8,8)
        lay.setSpacing(6)

        self._lbl_detail_title = QLabel("Design Info")
        lbl = self._lbl_detail_title
        lbl.setStyleSheet(
            f"color:{C_DIM.name()};font-size:11px;"
            f"font-weight:600;")
        lay.addWidget(lbl)

        self._det_preview = QLabel()
        self._det_preview.setFixedSize(196, 120)
        self._det_preview.setAlignment(Qt.AlignCenter)
        self._det_preview.setStyleSheet(
            "background:#1a1a1a;border:1px solid #3e3e42;"
            "border-radius:2px;")
        lay.addWidget(self._det_preview)

        grp = QGroupBox("Properties")
        gl  = QVBoxLayout(grp)
        self._det_code     = QLabel("—")
        self._det_name     = QLabel("—")
        self._det_size     = QLabel("—")
        self._det_layers   = QLabel("—")
        self._det_offsets  = QLabel("—")
        self._det_category = QLabel("—")

        for lbl2, lbl_w in [
            ("Code:",    self._det_code),
            ("Name:",    self._det_name),
            ("Size:",    self._det_size),
            ("Layers:",  self._det_layers),
            ("Offsets:", self._det_offsets),
            ("Category:",self._det_category),
        ]:
            row = QHBoxLayout()
            row.setSpacing(4)
            key = QLabel(lbl2)
            key.setStyleSheet(
                f"color:{C_DIM.name()};font-size:11px;")
            key.setFixedWidth(60)
            lbl_w.setStyleSheet(
                f"color:{C_TEXT.name()};font-size:11px;")
            lbl_w.setWordWrap(True)
            row.addWidget(key); row.addWidget(lbl_w, 1)
            gl.addLayout(row)

        lay.addWidget(grp)

        self._btn_open_det = QPushButton("Open in Editor")
        self._btn_open_det.setFixedHeight(30)
        self._btn_open_det.clicked.connect(self._open_selected)
        lay.addWidget(self._btn_open_det)
        lay.addStretch()
        return w

    # ══════════════════════════════════════════════════════════
    # LOAD / REFRESH
    # ══════════════════════════════════════════════════════════
    def refresh(self):
        self._all_meta = self._scan_designs()
        self._apply_filter()
        n = len(self._all_meta)
        self._lbl_status.setText(
            f"  {n} design{'s' if n!=1 else ''} in library")

    def _scan_designs(self) -> List[Dict]:
        designs = []
        d = Path(self._designs_dir)

        # Read _index.json first
        idx_path = d / "_index.json"
        if idx_path.exists():
            try:
                with open(idx_path, encoding="utf-8") as f:
                    idx = json.load(f)
                for entry in idx.get("designs", []):
                    entry.setdefault("file",
                        f"{entry['code']}{FDR_EXTENSION}")
                    entry.setdefault("path", str(d / entry["file"]))
                    designs.append(entry)
                return designs
            except Exception:
                pass

        # Fallback: scan folder
        for ext in (FDR_EXTENSION, ".json"):
            for fp in sorted(d.glob(f"*{ext}")):
                if fp.name.startswith("_"):
                    continue
                try:
                    with open(fp, encoding="utf-8") as f:
                        dd = json.load(f)
                    designs.append({
                        "code":     dd.get("design_code", fp.stem),
                        "name":     dd.get("name", fp.stem),
                        "name_fa":  dd.get("name_fa",""),
                        "category": dd.get("category","designs"),
                        "tags":     dd.get("tags", []),
                        "file":     fp.name,
                        "path":     str(fp),
                    })
                except Exception:
                    pass
        return designs

    # ══════════════════════════════════════════════════════════
    # GROUP BAR  (dynamic — built-in + custom groups)
    # ══════════════════════════════════════════════════════════
    def _rebuild_group_bar(self):
        """Rebuild the group-tab row from scratch."""
        lay = self._group_bar_layout
        # Clear old widgets
        while lay.count():
            item = lay.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._cat_buttons = []

        current = (self._cat_filter.currentData()
                   if hasattr(self, "_cat_filter") else "All") or "All"

        for c in self._all_categories():
            btn = QPushButton(category_label(c, self._lang))
            btn.setFixedHeight(24)
            btn.setMinimumWidth(64)
            btn.setProperty("cat", c)
            btn.clicked.connect(lambda chk=False, cat=c: self._select_category(cat))
            btn.setStyleSheet(self._cat_button_style(c == current))
            lay.addWidget(btn)
            self._cat_buttons.append(btn)

            # Rename + Delete buttons for custom groups
            if c not in BUILTIN_CATEGORIES:
                btn_r = QPushButton("✏")
                btn_r.setFixedSize(20, 24)
                btn_r.setToolTip(f"Rename group '{c}'")
                btn_r.setStyleSheet(
                    f"background:#2d2d30;border:none;color:{C_DIM.name()};font-size:10px;")
                btn_r.clicked.connect(lambda chk=False, cat=c: self._rename_group(cat))
                lay.addWidget(btn_r)

                btn_d = QPushButton("×")
                btn_d.setFixedSize(18, 24)
                btn_d.setToolTip(f"Delete group '{c}'")
                btn_d.setStyleSheet(
                    f"background:#2d2d30;border:none;color:{C_WARN.name()};font-size:12px;font-weight:700;")
                btn_d.clicked.connect(lambda chk=False, cat=c: self._delete_group(cat))
                lay.addWidget(btn_d)

        lay.addStretch()

        # "+" button at the end
        btn_add = QPushButton("＋  New Group")
        btn_add.setFixedHeight(24)
        btn_add.setMinimumWidth(90)
        btn_add.setStyleSheet(
            f"background:#2d2d30;border:1px solid {C_BORDER.name()};"
            f"border-radius:3px;color:{C_GOOD.name()};font-size:11px;font-weight:600;")
        btn_add.clicked.connect(self._add_group)
        lay.addWidget(btn_add)

    def _add_group(self):
        name, ok = _ask_group_name(self, "New Group", "")
        if not ok or not name:
            return
        key = name.strip().lower().replace(" ", "_")
        if not key or key in BUILTIN_CATEGORIES or key in self._custom_groups:
            QMessageBox.warning(self, "Duplicate", f"Group '{key}' already exists.")
            return
        self._custom_groups.append(key)
        self._save_custom_groups()
        self._sync_cat_combo()
        self._rebuild_group_bar()

    def _rename_group(self, old_key: str):
        old_display = old_key.replace("_", " ").title()
        name, ok = _ask_group_name(self, "Rename Group", old_display)
        if not ok or not name:
            return
        new_key = name.strip().lower().replace(" ", "_")
        if not new_key or new_key == old_key:
            return
        if new_key in BUILTIN_CATEGORIES or new_key in self._custom_groups:
            QMessageBox.warning(self, "Duplicate", f"Group '{new_key}' already exists.")
            return
        # Update meta for any designs in this group
        for m in self._all_meta:
            if m.get("category") == old_key:
                m["category"] = new_key
        # Update the index file
        self._rewrite_index_categories(old_key, new_key)
        idx = self._custom_groups.index(old_key)
        self._custom_groups[idx] = new_key
        self._save_custom_groups()
        self._sync_cat_combo()
        self._rebuild_group_bar()
        self._apply_filter()

    def _delete_group(self, key: str):
        # Check if any designs are in this group
        count = sum(1 for m in self._all_meta if m.get("category") == key)
        if count:
            reply = QMessageBox.question(
                self, "Delete Group",
                f"Group '{key}' has {count} design(s).\n"
                f"They will be moved to 'others'. Continue?",
                QMessageBox.Yes | QMessageBox.No)
            if reply != QMessageBox.Yes:
                return
            self._rewrite_index_categories(key, "others")
            for m in self._all_meta:
                if m.get("category") == key:
                    m["category"] = "others"
        self._custom_groups.remove(key)
        self._save_custom_groups()
        self._sync_cat_combo()
        self._rebuild_group_bar()
        if (self._cat_filter.currentData() or "All") == key:
            self._select_category("All")
        else:
            self._apply_filter()

    def _sync_cat_combo(self):
        """Keep the combo box in sync with _all_categories()."""
        current = self._cat_filter.currentData() or "All"
        self._cat_filter.blockSignals(True)
        self._cat_filter.clear()
        for c in self._all_categories():
            self._cat_filter.addItem(category_label(c, self._lang), c)
        idx = self._cat_filter.findData(current)
        self._cat_filter.setCurrentIndex(idx if idx >= 0 else 0)
        self._cat_filter.blockSignals(False)

    def _rewrite_index_categories(self, old_key: str, new_key: str):
        """Rename category in _index.json and in individual .fdr files."""
        d = Path(self._designs_dir)
        idx_path = d / "_index.json"
        if idx_path.exists():
            try:
                data = json.loads(idx_path.read_text(encoding="utf-8"))
                changed = False
                for entry in data.get("designs", []):
                    if entry.get("category") == old_key:
                        entry["category"] = new_key
                        changed = True
                if changed:
                    idx_path.write_text(
                        json.dumps(data, ensure_ascii=False, indent=2),
                        encoding="utf-8")
            except Exception:
                pass
        # Also patch individual files for designs in this group
        for m in self._all_meta:
            if m.get("category") == old_key:
                fp = Path(m.get("path", ""))
                if fp.exists():
                    try:
                        dd = json.loads(fp.read_text(encoding="utf-8"))
                        dd["category"] = new_key
                        fp.write_text(
                            json.dumps(dd, ensure_ascii=False, indent=2),
                            encoding="utf-8")
                    except Exception:
                        pass

    # ══════════════════════════════════════════════════════════
    # FILTER
    # ══════════════════════════════════════════════════════════
    def _select_category(self, cat: str):
        idx = self._cat_filter.findData(cat)
        if idx >= 0:
            self._cat_filter.setCurrentIndex(idx)
        self._apply_filter()

    def _update_group_bar_selection(self):
        """Update only the selected-state highlight on group tab buttons."""
        current = self._cat_filter.currentData() or "All"
        for b in getattr(self, "_cat_buttons", []):
            b.setStyleSheet(self._cat_button_style(b.property("cat") == current))

    def _cat_button_style(self, selected: bool) -> str:
        return (
            f"background:{C_ACCENT.name() if selected else '#2d2d30'};"
            f"border:1px solid {C_ACCENT.name() if selected else C_BORDER.name()};"
            f"border-radius:3px;color:white;font-size:11px;padding:0 8px;"
        )

    def _apply_filter(self):
        query = self._search.text().strip().lower()
        cat   = self._cat_filter.currentData() or "All"

        filtered = []
        for m in self._all_meta:
            if cat != "All" and m.get("category") != cat:
                continue
            if query:
                hay = (m.get("code","") + " " +
                       m.get("name","") + " " +
                       m.get("name_fa","") + " " +
                       " ".join(m.get("tags",[]))).lower()
                if query not in hay:
                    continue
            filtered.append(m)

        self._update_group_bar_selection()
        self._rebuild_grid(filtered)
        self._lbl_status.setText(
            f"  {len(filtered)} of {len(self._all_meta)}"
            f" design{'s' if len(self._all_meta)!=1 else ''}")

    # ══════════════════════════════════════════════════════════
    # GRID
    # ══════════════════════════════════════════════════════════
    def _rebuild_grid(self, meta_list: List[Dict]):
        # Clear
        while self._grid_layout.count():
            item = self._grid_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._cards.clear()

        sc   = getattr(self, "_card_scale", 1.0)
        cw   = int(DesignCard.BASE_W * sc)
        ch   = int(DesignCard.BASE_H * sc)
        cols = max(1, (self._scroll.viewport().width() - 16) // (cw + 8))
        cols = max(2, cols)

        for i, meta in enumerate(meta_list):
            card = DesignCard(meta, scale=sc)
            card.clicked.connect(self._on_card_click)
            card.double_click.connect(self._on_card_dblclick)
            card.edit.connect(self._on_card_edit)
            card.delete.connect(self._on_card_delete)
            self._grid_layout.addWidget(card, i // cols, i % cols)
            self._cards.append(card)

        # Filler spacers
        total = len(meta_list)
        r = total // cols
        remaining = cols - (total % cols)
        if remaining < cols:
            for j in range(remaining):
                sp = QWidget()
                sp.setFixedSize(cw, ch)
                self._grid_layout.addWidget(sp, r, (total % cols) + j)

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        QTimer.singleShot(0, lambda: self._apply_filter())

    def keyPressEvent(self, ev):
        ctrl = ev.modifiers() & Qt.ControlModifier
        if ctrl:
            if ev.key() in (Qt.Key_Plus, Qt.Key_Equal):
                self._set_card_scale(self._card_scale + 0.1)
                return
            if ev.key() == Qt.Key_Minus:
                self._set_card_scale(self._card_scale - 0.1)
                return
            if ev.key() == Qt.Key_0:
                self._set_card_scale(1.0)
                return
        super().keyPressEvent(ev)

    def wheelEvent(self, ev):
        if ev.modifiers() & Qt.ControlModifier:
            delta = ev.angleDelta().y()
            if delta > 0:
                self._set_card_scale(self._card_scale + 0.1)
            elif delta < 0:
                self._set_card_scale(self._card_scale - 0.1)
            ev.accept()
        else:
            super().wheelEvent(ev)

    def _set_card_scale(self, scale: float):
        self._card_scale = round(max(0.5, min(2.0, scale)), 1)
        pct = int(self._card_scale * 100)
        self._lbl_scale.setText(f"{pct}%")
        self._apply_filter()

    # ══════════════════════════════════════════════════════════
    # CARD EVENTS
    # ══════════════════════════════════════════════════════════
    def _on_card_click(self, code: str):
        self._selected = code
        for card in self._cards:
            card.set_selected(
                card._meta.get("code") == code)
        self._update_detail(code)
        self.design_selected.emit(code)

    def _on_card_dblclick(self, code: str):
        self.design_opened.emit(code)

    def _on_card_edit(self, code: str):
        self.design_opened.emit(code)

    def _on_card_delete(self, code: str):
        self._delete_design(code)

    def _update_detail(self, code: str):
        """Fill detail panel for selected design."""
        d_path = self._find_design_path(code)
        if not d_path:
            return
        d = DesignData.load(str(d_path))
        if not d:
            return
        # Update thumbnail
        from design_editor import DoorPreviewCanvas
        pix = QPixmap(196, 120)
        pix.fill(QColor("#1a1a1a"))
        p   = QPainter(pix)
        p.setRenderHint(QPainter.Antialiasing)
        from PySide6.QtCore import QRectF
        dw, dh = d.width, d.height
        sc = min(180/dw, 100/dh)
        ox = (196 - dw*sc)/2; oy = (120 - dh*sc)/2
        from PySide6.QtGui import QLinearGradient
        door_rect = QRectF(ox, oy, dw*sc, dh*sc)
        g = QLinearGradient(door_rect.topLeft(),
                             door_rect.bottomRight())
        g.setColorAt(0, QColor("#4a3728"))
        g.setColorAt(1, QColor("#3a2a1e"))
        p.fillRect(door_rect, g)
        for layer in reversed(d.layers):
            if not layer.get("enabled"): continue
            if layer["type"] == "profile": continue
            idx = layer["id"]
            off = layer["offset_mm"]
            col = LAYER_COLORS[idx % len(LAYER_COLORS)]
            lw = dw-2*off; lh = dh-2*off
            if lw <= 0 or lh <= 0: continue
            lr = QRectF(ox+off*sc, oy+off*sc, lw*sc, lh*sc)
            fc = QColor(col); fc.setAlpha(140)
            p.fillRect(lr, fc)
        p.setPen(QPen(QColor("#e74c3c"), 1.5))
        p.setBrush(Qt.NoBrush)
        p.drawRect(door_rect)
        p.end()
        self._det_preview.setPixmap(pix)

        # Info labels
        self._det_code.setText(d.design_code)
        self._det_name.setText(d.name)
        self._det_size.setText(
            f"{d.width:.0f}×{d.height:.0f} mm")
        self._det_layers.setText(str(len(d.layers)))
        n_off = sum(1 for l in d.layers
                    if l.get("offset_mm",0) > 0)
        self._det_offsets.setText(str(n_off))
        self._det_category.setText(category_label(d.category, getattr(self, "_lang", "en")))

    # ══════════════════════════════════════════════════════════
    # ACTIONS
    # ══════════════════════════════════════════════════════════
    def _new_design(self):
        self.design_opened.emit("__new__")

    def _open_selected(self):
        if self._selected:
            self.design_opened.emit(self._selected)

    def _import_files(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Import Design Files",
            str(Path.home()),
            "Design Files (*.cd *.dsgn *.design "
            f"*{FDR_EXTENSION});;All Files (*)")
        if not paths:
            return
        imported = 0
        errors   = []
        for path in paths:
            p = Path(path)
            if p.suffix.lower() in (FDR_EXTENSION, ".json"):
                # Direct copy
                dest = Path(self._designs_dir) / p.name
                try:
                    shutil.copy2(str(p), str(dest))
                    imported += 1
                except Exception as e:
                    errors.append(f"{p.name}: {e}")
            else:
                # Use importer
                try:
                    import sys, os
                    sys.path.insert(0, os.path.dirname(__file__))
                    from design_importer import (DesignImporter,
                        DesignFileParser, DesignBuilder)
                    parser = DesignFileParser(path)
                    parser.load()
                    parsed = parser.parse()
                    if parsed:
                        builder = DesignBuilder()
                        d_dict  = builder.build(parsed, path)
                        d       = DesignData.from_dict(d_dict)
                        dest    = str(
                            Path(self._designs_dir) /
                            f"{d.design_code}{FDR_EXTENSION}")
                        d.save(dest)
                        imported += 1
                    else:
                        errors.append(f"{p.name}: parse failed")
                except Exception as e:
                    errors.append(f"{p.name}: {e}")

        self.refresh()
        msg = f"Imported {imported} design(s)."
        if errors:
            msg += f"\n\nErrors:\n" + "\n".join(errors[:5])
        QMessageBox.information(self, "Import Complete", msg)

    def _delete_selected(self):
        if not self._selected:
            QMessageBox.warning(
                self,"No Selection","Select a design first.")
            return
        self._delete_design(self._selected)

    def _delete_design(self, code: str):
        ans = QMessageBox.question(
            self,"Delete Design",
            f"Delete design '{code}'? This cannot be undone.",
            QMessageBox.Yes | QMessageBox.No)
        if ans != QMessageBox.Yes:
            return
        path = self._find_design_path(code)
        if path and path.exists():
            path.unlink()
            self._update_index_remove(code)
        self._selected = None
        self._clear_detail()
        self.refresh()

    def _find_design_path(self, code: str) -> Optional[Path]:
        d = Path(self._designs_dir)
        for ext in (FDR_EXTENSION, ".json"):
            p = d / f"{code}{ext}"
            if p.exists():
                return p
        return None

    def _update_index_remove(self, code: str):
        idx_path = Path(self._designs_dir) / "_index.json"
        if not idx_path.exists():
            return
        try:
            with open(idx_path, encoding="utf-8") as f:
                idx = json.load(f)
            idx["designs"] = [d for d in idx["designs"]
                               if d.get("code") != code]
            idx["count"]   = len(idx["designs"])
            with open(idx_path, "w", encoding="utf-8") as f:
                json.dump(idx, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _clear_detail(self):
        self._det_preview.clear()
        self._det_preview.setText("No selection")
        for lbl in [self._det_code, self._det_name,
                    self._det_size, self._det_layers,
                    self._det_offsets, self._det_category]:
            lbl.setText("—")

    # ── Style ─────────────────────────────────────────────────
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
            padding-top:6px; color:{C_DIM.name()};
            font-size:11px; font-weight:600;
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
        QLineEdit, QComboBox {{
            background:#1a1a1a;
            border:1px solid {C_BORDER.name()};
            border-radius:3px; padding:2px 6px;
            color:{C_TEXT.name()};
        }}
        QLineEdit:focus, QComboBox:focus {{
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
        QScrollBar:horizontal {{
            background:{C_PANEL.name()};
            height:8px; border:none;
        }}
        QScrollBar::handle:horizontal {{
            background:{C_BORDER.name()};
            border-radius:4px; min-width:20px;
        }}
        """)

    @staticmethod
    def _hsep() -> QFrame:
        s = QFrame(); s.setFrameShape(QFrame.HLine)
        s.setFixedHeight(1)
        s.setStyleSheet(
            f"background:{C_BORDER.name()};")
        return s

    @staticmethod
    def _vsep() -> QFrame:
        s = QFrame(); s.setFrameShape(QFrame.VLine)
        s.setFixedWidth(1)
        s.setStyleSheet(
            f"background:{C_BORDER.name()};")
        return s


# Test
if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    w = DesignLibraryWidget()
    w.setWindowTitle("FIROO CAM — Design Library")
    w.resize(1100, 700)

    def on_open(code):
        print(f"Open design: {code}")
    w.design_opened.connect(on_open)
    w.show()
    sys.exit(app.exec())
