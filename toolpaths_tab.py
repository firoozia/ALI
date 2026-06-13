"""
FIROO CAM - Toolpaths Tab  (CAM Tab — 6th tab)

Lets users configure and generate G-code toolpaths for all parts
from the nesting result.  Connects to NestingTab.layout_applied signal.
"""
from __future__ import annotations
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QComboBox, QTableWidget, QTableWidgetItem, QHeaderView,
    QAbstractItemView, QMessageBox, QFileDialog, QFrame
)
from PySide6.QtGui import QColor

from config import config

try:
    from toolpath_dialog import ToolpathConfig, ToolpathDialog
except ImportError:
    ToolpathConfig = None
    ToolpathDialog = None

# ── Palette ────────────────────────────────────────────────────
C_BG     = QColor("#1e1e1e")
C_PANEL  = QColor("#252526")
C_BORDER = QColor("#3e3e42")
C_ACCENT = QColor("#0078d4")
C_TEXT   = QColor("#cccccc")
C_DIM    = QColor("#858585")
C_GOOD   = QColor("#4ec9b0")
C_WARN   = QColor("#ce9178")

# ── Column indices ─────────────────────────────────────────────
COL_NUM       = 0
COL_PART_CODE = 1
COL_DESIGN    = 2
COL_SIZE      = 3
COL_OPERATION = 4
COL_TOOL      = 5
COL_DEPTH     = 6
COL_STATUS    = 7


# ═══════════════════════════════════════════════════════════════
# ToolpathsTab
# ═══════════════════════════════════════════════════════════════
class ToolpathsTab(QWidget):
    """
    CAM / Toolpaths tab — configure and generate G-code for nested parts.
    """

    gcode_exported = Signal(list)   # list of Path objects

    def __init__(self, parent=None):
        super().__init__(parent)

        # ── State ─────────────────────────────────────────────
        self._sheets: list = []
        self._configs: dict = {}          # design_code → ToolpathConfig
        self._pp_id: str = "gcode_mm"
        self._output_folder: Path = Path(config.get("output_folder", str(Path.home())))

        self._build()
        self.apply_style()
        self._load_postprocessors()

    # ──────────────────────────────────────────────────────────
    # Build UI
    # ──────────────────────────────────────────────────────────
    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(6, 6, 6, 6)
        root.setSpacing(4)

        # ── Toolbar ───────────────────────────────────────────
        root.addWidget(self._build_toolbar())

        # ── Separator ─────────────────────────────────────────
        sep = QFrame()
        sep.setFrameShape(QFrame.HLine)
        sep.setFrameShadow(QFrame.Plain)
        sep.setStyleSheet(f"color: {C_BORDER.name()};")
        root.addWidget(sep)

        # ── Table ─────────────────────────────────────────────
        self._table = QTableWidget(0, 8)
        self._table.setHorizontalHeaderLabels([
            "#", "Part Code", "Design", "Size (W×H)",
            "Operation", "Tool", "Depth (mm)", "Status"
        ])
        hdr = self._table.horizontalHeader()
        hdr.setSectionResizeMode(COL_NUM,       QHeaderView.Fixed)
        hdr.setSectionResizeMode(COL_PART_CODE, QHeaderView.Stretch)
        hdr.setSectionResizeMode(COL_DESIGN,    QHeaderView.Fixed)
        hdr.setSectionResizeMode(COL_SIZE,      QHeaderView.Fixed)
        hdr.setSectionResizeMode(COL_OPERATION, QHeaderView.Fixed)
        hdr.setSectionResizeMode(COL_TOOL,      QHeaderView.Fixed)
        hdr.setSectionResizeMode(COL_DEPTH,     QHeaderView.Fixed)
        hdr.setSectionResizeMode(COL_STATUS,    QHeaderView.Fixed)

        self._table.setColumnWidth(COL_NUM,       40)
        self._table.setColumnWidth(COL_DESIGN,    80)
        self._table.setColumnWidth(COL_SIZE,     120)
        self._table.setColumnWidth(COL_OPERATION,100)
        self._table.setColumnWidth(COL_TOOL,      60)
        self._table.setColumnWidth(COL_DEPTH,     80)
        self._table.setColumnWidth(COL_STATUS,    80)

        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self._table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self._table.setAlternatingRowColors(True)
        self._table.verticalHeader().setVisible(False)
        self._table.setShowGrid(False)
        self._table.doubleClicked.connect(self._on_double_click)

        root.addWidget(self._table, stretch=1)

        # ── Summary bar ───────────────────────────────────────
        root.addWidget(self._build_summary_bar())

    def _build_toolbar(self) -> QWidget:
        bar = QWidget()
        lay = QHBoxLayout(bar)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)

        self._btn_configure = QPushButton("Configure Selected")
        self._btn_configure.setStyleSheet(self._small_btn_style())
        self._btn_configure.clicked.connect(self._configure_selected)

        self._btn_apply_all = QPushButton("Apply to All")
        self._btn_apply_all.setStyleSheet(self._small_btn_style())
        self._btn_apply_all.clicked.connect(self._apply_to_all)

        self._btn_generate = QPushButton("▶  Gen G-code")
        self._btn_generate.setStyleSheet(
            f"background:{C_ACCENT.name()}; border:none; border-radius:3px;"
            f"color:#ffffff; font-size:11px; font-weight:600; padding:3px 10px;"
        )
        self._btn_generate.clicked.connect(self._generate_gcode)

        self._btn_browse = QPushButton("📂  Output Folder")
        self._btn_browse.setStyleSheet(self._small_btn_style())
        self._btn_browse.clicked.connect(self._browse_output)

        lbl_pp = QLabel("Postprocessor:")
        lbl_pp.setStyleSheet(f"color:{C_DIM.name()}; font-size:11px;")

        self._cmb_pp = QComboBox()
        self._cmb_pp.setMinimumWidth(160)
        self._cmb_pp.currentTextChanged.connect(self._on_pp_changed)

        lay.addWidget(self._btn_configure)
        lay.addWidget(self._btn_apply_all)
        lay.addWidget(self._btn_generate)
        lay.addSpacing(12)
        lay.addWidget(self._btn_browse)
        lay.addSpacing(12)
        lay.addWidget(lbl_pp)
        lay.addWidget(self._cmb_pp)
        lay.addStretch()

        return bar

    def _build_summary_bar(self) -> QWidget:
        bar = QWidget()
        bar.setFixedHeight(28)
        lay = QHBoxLayout(bar)
        lay.setContentsMargins(4, 0, 4, 0)
        lay.setSpacing(16)

        self._lbl_summary = QLabel("No nesting data loaded")
        self._lbl_summary.setStyleSheet(f"color:{C_DIM.name()}; font-size:11px;")

        self._lbl_status = QLabel("")
        self._lbl_status.setStyleSheet(f"color:{C_GOOD.name()}; font-size:11px;")

        lay.addWidget(self._lbl_summary)
        lay.addStretch()
        lay.addWidget(self._lbl_status)

        return bar

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────
    def set_sheets(self, sheets: list):
        """Receive nested Sheet objects from NestingTab and populate the table."""
        self._sheets = sheets or []
        self._refresh_table()

    # ──────────────────────────────────────────────────────────
    # Table population
    # ──────────────────────────────────────────────────────────
    def _refresh_table(self):
        self._table.setRowCount(0)

        row_idx = 0
        total_parts = 0
        tools_used: set = set()

        for sheet in self._sheets:
            for part in sheet.parts:
                cfg = self._configs.get(part.design_code,
                                        ToolpathConfig() if ToolpathConfig else None)

                op_label   = ""
                tool_label = ""
                depth_label= ""
                status_txt = "—"

                if cfg is not None:
                    op_label    = getattr(cfg, "operation", "Profile")
                    tool_id     = getattr(cfg, "tool_id", "T1")
                    tool_label  = str(tool_id)
                    depth_val   = getattr(cfg, "depth", part.thickness if hasattr(part, "thickness") else 18.0)
                    depth_label = f"{depth_val:.0f}mm"
                    tools_used.add(tool_id)
                    if part.design_code in self._configs:
                        status_txt = "✓ Ready"

                size_str = f"{int(part.actual_width())}×{int(part.actual_height())}"

                self._table.insertRow(row_idx)
                self._set_item(row_idx, COL_NUM,       str(row_idx + 1), align=Qt.AlignCenter)
                self._set_item(row_idx, COL_PART_CODE, part.part_code)
                self._set_item(row_idx, COL_DESIGN,    part.design_code, align=Qt.AlignCenter)
                self._set_item(row_idx, COL_SIZE,      size_str,          align=Qt.AlignCenter)
                self._set_item(row_idx, COL_OPERATION, op_label,          align=Qt.AlignCenter)
                self._set_item(row_idx, COL_TOOL,      tool_label,        align=Qt.AlignCenter)
                self._set_item(row_idx, COL_DEPTH,     depth_label,       align=Qt.AlignCenter)

                status_item = QTableWidgetItem(status_txt)
                status_item.setTextAlignment(Qt.AlignCenter)
                if status_txt == "✓ Ready":
                    status_item.setForeground(C_GOOD)
                elif status_txt.startswith("⚠"):
                    status_item.setForeground(C_WARN)
                else:
                    status_item.setForeground(C_DIM)
                self._table.setItem(row_idx, COL_STATUS, status_item)

                row_idx += 1
                total_parts += 1

        sheet_count = len(self._sheets)
        tool_count  = len(tools_used) if tools_used else 0
        if total_parts:
            summary = (
                f"{total_parts} part{'s' if total_parts != 1 else ''}"
                f" | {tool_count} tool{'s' if tool_count != 1 else ''}"
                f" | {sheet_count} sheet{'s' if sheet_count != 1 else ''}"
            )
        else:
            summary = "No nesting data loaded"
        self._lbl_summary.setText(summary)

    def _set_item(self, row: int, col: int, text: str, align=Qt.AlignLeft | Qt.AlignVCenter):
        item = QTableWidgetItem(text)
        item.setTextAlignment(align)
        self._table.setItem(row, col, item)

    # ──────────────────────────────────────────────────────────
    # Button handlers
    # ──────────────────────────────────────────────────────────
    def _configure_selected(self):
        if ToolpathDialog is None:
            QMessageBox.warning(self, "Module Missing", "toolpath_dialog.py not found")
            return

        rows = self._table.selectionModel().selectedRows()
        if not rows:
            QMessageBox.information(self, "No Selection", "Select rows to configure")
            return

        # Collect unique design codes from selected rows
        design_codes: list[str] = []
        seen: set[str] = set()
        for idx in rows:
            r = idx.row()
            item = self._table.item(r, COL_DESIGN)
            if item:
                dc = item.text().strip()
                if dc and dc not in seen:
                    seen.add(dc)
                    design_codes.append(dc)

        if not design_codes:
            return

        # Configure for first unique design code
        design_code = design_codes[0]
        existing_cfg = self._configs.get(design_code, ToolpathConfig())
        dlg = ToolpathDialog(design_code=design_code, config=existing_cfg, parent=self)
        if dlg.exec():
            self._configs[design_code] = dlg.get_config()
            self._refresh_table()
            self._lbl_status.setText(f"Config saved for {design_code}")

    def _apply_to_all(self):
        if ToolpathDialog is None:
            QMessageBox.warning(self, "Module Missing", "toolpath_dialog.py not found")
            return

        default_cfg = ToolpathConfig() if ToolpathConfig else None
        dlg = ToolpathDialog(design_code="(All Parts)", config=default_cfg, parent=self)
        if dlg.exec():
            new_cfg = dlg.get_config()
            # Collect all unique design codes
            unique_codes: set[str] = set()
            for sheet in self._sheets:
                for part in sheet.parts:
                    unique_codes.add(part.design_code)
            for dc in unique_codes:
                self._configs[dc] = new_cfg
            self._refresh_table()
            self._lbl_status.setText(f"Config applied to {len(unique_codes)} design(s)")

    def _generate_gcode(self):
        if not self._sheets:
            QMessageBox.warning(self, "No Data", "No nesting data available.\nRun nesting first.")
            return

        self._lbl_status.setText("Generating G-code…")
        self.repaint()

        try:
            from gcode_generator import GCodeGenerator
            generator = GCodeGenerator(
                output_folder=str(self._output_folder),
                post_processor_id=self._pp_id,
            )
            result_paths = generator.generate_all(self._sheets)
            file_count = len(result_paths) if result_paths else 0
            self._lbl_status.setText(f"Done — {file_count} file(s) written")
            QMessageBox.information(
                self, "G-code Generated",
                f"Generated {file_count} G-code file(s).\n"
                f"Output folder:\n{self._output_folder}"
            )
            self.gcode_exported.emit([Path(p) for p in (result_paths or [])])
        except Exception as exc:
            self._lbl_status.setText("⚠ Generation failed")
            QMessageBox.critical(self, "G-code Error", f"Generation failed:\n{exc}")

    def _browse_output(self):
        folder = QFileDialog.getExistingDirectory(
            self,
            "Select Output Folder",
            str(self._output_folder),
        )
        if folder:
            self._output_folder = Path(folder)
            self._lbl_status.setText(f"Output: {folder}")

    def _load_postprocessors(self):
        self._cmb_pp.blockSignals(True)
        self._cmb_pp.clear()

        try:
            from post_processor_manager import PostProcessorManager
            mgr = PostProcessorManager()
            processors = mgr.all_processors() if hasattr(mgr, "all_processors") else []
            if processors:
                for pp in processors:
                    display = getattr(pp, "name", None) or getattr(pp, "id", str(pp))
                    pp_id   = getattr(pp, "id", display)
                    self._cmb_pp.addItem(display, userData=pp_id)
                # Select default
                for i in range(self._cmb_pp.count()):
                    if self._cmb_pp.itemData(i) == self._pp_id:
                        self._cmb_pp.setCurrentIndex(i)
                        break
            else:
                raise ValueError("empty processor list")
        except Exception:
            # Fallback defaults
            defaults = [
                ("G-code mm (generic)",    "gcode_mm"),
                ("G-code inch (generic)",  "gcode_inch"),
                ("Mach3 mm",               "mach3_mm"),
                ("GRBL mm",                "grbl_mm"),
            ]
            for name, uid in defaults:
                self._cmb_pp.addItem(name, userData=uid)
            # Select default
            for i in range(self._cmb_pp.count()):
                if self._cmb_pp.itemData(i) == self._pp_id:
                    self._cmb_pp.setCurrentIndex(i)
                    break

        self._cmb_pp.blockSignals(False)

    def _on_pp_changed(self, _text: str):
        uid = self._cmb_pp.currentData()
        if uid:
            self._pp_id = uid

    def _on_double_click(self, index):
        row = index.row()
        item = self._table.item(row, COL_DESIGN)
        if not item:
            return
        design_code = item.text().strip()
        if not design_code:
            return

        if ToolpathDialog is None:
            QMessageBox.warning(self, "Module Missing", "toolpath_dialog.py not found")
            return

        existing_cfg = self._configs.get(design_code, ToolpathConfig())
        dlg = ToolpathDialog(design_code=design_code, config=existing_cfg, parent=self)
        if dlg.exec():
            self._configs[design_code] = dlg.get_config()
            self._refresh_table()
            self._lbl_status.setText(f"Config saved for {design_code}")

    # ──────────────────────────────────────────────────────────
    # Style helpers
    # ──────────────────────────────────────────────────────────
    def _small_btn_style(self) -> str:
        return (
            f"background:{C_PANEL.name()}; border:1px solid {C_BORDER.name()};"
            f" border-radius:3px; color:{C_TEXT.name()}; font-size:11px; padding:3px 8px;"
        )

    def apply_style(self):
        self.setStyleSheet(f"""
            ToolpathsTab {{
                background: {C_BG.name()};
            }}
            QWidget {{
                background: {C_BG.name()};
                color: {C_TEXT.name()};
                font-size: 12px;
            }}
            QTableWidget {{
                background: {C_BG.name()};
                alternate-background-color: #222222;
                color: {C_TEXT.name()};
                border: 1px solid {C_BORDER.name()};
                gridline-color: transparent;
                selection-background-color: #264f78;
                selection-color: #ffffff;
                outline: none;
            }}
            QHeaderView::section {{
                background: {C_PANEL.name()};
                color: {C_DIM.name()};
                border: none;
                border-bottom: 1px solid {C_BORDER.name()};
                padding: 4px 6px;
                font-size: 11px;
                font-weight: 600;
            }}
            QTableWidget::item {{
                padding: 3px 6px;
                border: none;
            }}
            QComboBox {{
                background: {C_PANEL.name()};
                border: 1px solid {C_BORDER.name()};
                border-radius: 3px;
                color: {C_TEXT.name()};
                font-size: 11px;
                padding: 2px 6px;
            }}
            QComboBox::drop-down {{
                border: none;
                width: 18px;
            }}
            QComboBox QAbstractItemView {{
                background: {C_PANEL.name()};
                color: {C_TEXT.name()};
                selection-background-color: {C_ACCENT.name()};
                border: 1px solid {C_BORDER.name()};
            }}
            QPushButton:hover {{
                border-color: {C_ACCENT.name()};
            }}
            QPushButton:pressed {{
                background: {C_ACCENT.name()};
                color: #ffffff;
            }}
            QScrollBar:vertical {{
                background: {C_BG.name()};
                width: 8px;
                border: none;
            }}
            QScrollBar::handle:vertical {{
                background: {C_BORDER.name()};
                border-radius: 4px;
                min-height: 20px;
            }}
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
                height: 0px;
            }}
            QScrollBar:horizontal {{
                background: {C_BG.name()};
                height: 8px;
                border: none;
            }}
            QScrollBar::handle:horizontal {{
                background: {C_BORDER.name()};
                border-radius: 4px;
                min-width: 20px;
            }}
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
                width: 0px;
            }}
        """)
