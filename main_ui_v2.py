"""
FIROO CAM - Main UI v2  (updated)
Complete main window: Parts | Sheets | Nesting | Export | Design
"""
from __future__ import annotations
import json, os, sys
from pathlib import Path

from PySide6.QtCore  import Qt, QTimer, QSettings, QSize, Signal
from PySide6.QtGui   import (QColor, QAction, QKeySequence,
                              QIcon, QPixmap, QPainter, QPen,
                              QBrush, QFont, QCloseEvent)
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QTabWidget, QLabel, QPushButton,
    QStatusBar, QMenuBar, QMenu, QToolBar, QFileDialog,
    QMessageBox, QDialog, QFormLayout, QDialogButtonBox,
    QComboBox, QDoubleSpinBox, QSpinBox, QCheckBox,
    QGroupBox, QLineEdit, QFrame, QSizePolicy,
    QTabBar, QStyle
)

from language_manager import lang, init_from_config
from config import config
from parts_tab    import PartsTab
from sheets_tab   import SheetsTab
from nesting_tab  import NestingTab
from export_tab   import ExportTab
try:
    from toolpaths_tab import ToolpathsTab
except Exception:
    ToolpathsTab = None

C_BG      = "#0d1117"
C_PANEL   = "#161b22"
C_BORDER  = "#30363d"
C_ACCENT  = "#58a6ff"
C_TEXT    = "#e6edf3"
C_DIM     = "#8b949e"
C_TITLE   = "#569cd6"
APP_NAME  = "FIROO CAM"
VERSION   = "1.0.0"
FILE_EXT  = ".firoo"


class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Settings — FIROO CAM")
        self.setModal(True); self.setFixedSize(460, 500)
        self._build()

    def _build(self):
        lay  = QVBoxLayout(self)
        tabs = QTabWidget()

        t_sheet = QWidget(); f = QFormLayout(t_sheet); f.setSpacing(8)
        self._sheet_w = QDoubleSpinBox(); self._sheet_w.setRange(100,9999); self._sheet_w.setValue(config.sheet_width)
        self._sheet_h = QDoubleSpinBox(); self._sheet_h.setRange(100,9999); self._sheet_h.setValue(config.sheet_height)
        self._sheet_t = QDoubleSpinBox(); self._sheet_t.setRange(1,100);    self._sheet_t.setValue(config.get("sheet","thickness"))
        self._sheet_m = QLineEdit(config.get("sheet","material"))
        f.addRow("Width (mm):",    self._sheet_w); f.addRow("Height (mm):",   self._sheet_h)
        f.addRow("Thickness (mm):",self._sheet_t); f.addRow("Material:",      self._sheet_m)
        tabs.addTab(t_sheet, "Sheet")

        t_nest = QWidget(); fn = QFormLayout(t_nest); fn.setSpacing(8)
        self._margin  = QDoubleSpinBox(); self._margin.setRange(0,100);   self._margin.setValue(config.edge_margin)
        self._gap     = QDoubleSpinBox(); self._gap.setRange(0,100);      self._gap.setValue(config.part_gap)
        self._autorot = QCheckBox();      self._autorot.setChecked(config.get("nesting","auto_rotation"))
        self._grain   = QCheckBox();      self._grain.setChecked(config.get("nesting","respect_grain"))
        fn.addRow("Edge Margin (mm):", self._margin); fn.addRow("Part Gap (mm):", self._gap)
        fn.addRow("Auto Rotation:", self._autorot);   fn.addRow("Respect Grain:", self._grain)
        tabs.addTab(t_nest, "Nesting")

        t_mach = QWidget(); fm = QFormLayout(t_mach); fm.setSpacing(8)
        self._safe_z = QDoubleSpinBox(); self._safe_z.setRange(1,200); self._safe_z.setValue(config.safe_z)
        self._home_z = QDoubleSpinBox(); self._home_z.setRange(1,300); self._home_z.setValue(config.get("machine","home_z"))
        self._rpm    = QSpinBox();       self._rpm.setRange(1000,60000); self._rpm.setValue(config.get("machine","spindle_rpm"))
        self._feed   = QDoubleSpinBox(); self._feed.setRange(10,30000);  self._feed.setValue(config.get("machine","feed_rate"))
        self._plunge = QDoubleSpinBox(); self._plunge.setRange(10,10000); self._plunge.setValue(config.get("machine","plunge_rate"))
        fm.addRow("Safe Z (mm):", self._safe_z); fm.addRow("Home Z (mm):", self._home_z)
        fm.addRow("Spindle RPM:", self._rpm);    fm.addRow("Feed Rate:", self._feed)
        fm.addRow("Plunge Rate:", self._plunge)
        tabs.addTab(t_mach, "Machine")

        t_gc = QWidget(); fg = QFormLayout(t_gc); fg.setSpacing(8)
        self._fmt = QComboBox()
        for v in ["tap","nc","gc","cnc"]: self._fmt.addItem(v)
        idx = ["tap","nc","gc","cnc"].index(config.gcode_format) if config.gcode_format in ["tap","nc","gc","cnc"] else 0
        self._fmt.setCurrentIndex(idx)
        self._origin = QComboBox()
        for v in ["(0,0)","(X,Y)","(0,Y)","(X,0)"]: self._origin.addItem(v)
        fg.addRow("Format:", self._fmt); fg.addRow("Origin:", self._origin)
        tabs.addTab(t_gc, "G-code")

        t_ui = QWidget(); fu = QFormLayout(t_ui); fu.setSpacing(8)
        self._lang = QComboBox()
        self._lang.addItem("English (EN)", "en")
        self._lang.addItem("فارسی (FA)",   "fa")
        self._lang.addItem("العربية (AR)", "ar")
        cur = config.language
        for i in range(self._lang.count()):
            if self._lang.itemData(i) == cur: self._lang.setCurrentIndex(i); break
        self._output_folder = QLineEdit(config.output_folder)
        self._btn_browse = QPushButton("Browse...")
        self._btn_browse.clicked.connect(
            lambda: self._output_folder.setText(
                QFileDialog.getExistingDirectory(self,"Output Folder",self._output_folder.text())
                or self._output_folder.text()))
        path_row = QHBoxLayout(); path_row.addWidget(self._output_folder,1); path_row.addWidget(self._btn_browse)
        fu.addRow("Language:", self._lang); fu.addRow("Output Folder:", path_row)
        tabs.addTab(t_ui, "Interface")

        lay.addWidget(tabs)
        btns = QDialogButtonBox(QDialogButtonBox.Ok|QDialogButtonBox.Cancel|QDialogButtonBox.RestoreDefaults)
        btns.accepted.connect(self._save); btns.rejected.connect(self.reject)
        btns.button(QDialogButtonBox.RestoreDefaults).clicked.connect(self._reset)
        lay.addWidget(btns)
        self._apply_style()

    def _save(self):
        config.set(self._sheet_w.value(),"sheet","width"); config.set(self._sheet_h.value(),"sheet","height")
        config.set(self._sheet_t.value(),"sheet","thickness"); config.set(self._sheet_m.text(),"sheet","material")
        config.set(self._margin.value(),"nesting","edge_margin"); config.set(self._gap.value(),"nesting","part_gap")
        config.set(self._autorot.isChecked(),"nesting","auto_rotation"); config.set(self._grain.isChecked(),"nesting","respect_grain")
        config.set(self._safe_z.value(),"machine","safe_z"); config.set(self._home_z.value(),"machine","home_z")
        config.set(self._rpm.value(),"machine","spindle_rpm"); config.set(self._feed.value(),"machine","feed_rate")
        config.set(self._plunge.value(),"machine","plunge_rate"); config.set(self._fmt.currentText(),"gcode","format")
        config.set(self._origin.currentText(),"gcode","origin"); config.set(self._output_folder.text(),"output","folder")
        new_lang = self._lang.currentData()
        config.set(new_lang,"language"); lang.set(new_lang)
        self.accept()

    def _reset(self):
        ans=QMessageBox.question(self,"Reset","Reset all settings to defaults?",QMessageBox.Yes|QMessageBox.No)
        if ans==QMessageBox.Yes: config.reset(); self.reject()

    def _apply_style(self):
        self.setStyleSheet(f"""
        QDialog,QWidget{{background:{C_BG};color:{C_TEXT};font-family:"Segoe UI",sans-serif;font-size:12px;}}
        QTabWidget::pane{{border:1px solid {C_BORDER};background:{C_BG};}}
        QTabBar::tab{{background:{C_PANEL};border:1px solid {C_BORDER};padding:5px 12px;color:{C_DIM};}}
        QTabBar::tab:selected{{background:{C_BG};color:{C_TEXT};border-bottom:2px solid {C_ACCENT};}}
        QFormLayout QLabel{{color:{C_DIM};}}
        QDoubleSpinBox,QSpinBox,QLineEdit,QComboBox{{background:#111820;border:1px solid {C_BORDER};
            border-radius:3px;padding:3px 6px;color:{C_TEXT};}}
        QCheckBox::indicator{{width:13px;height:13px;border:1px solid {C_BORDER};background:#111820;}}
        QCheckBox::indicator:checked{{background:{C_ACCENT};border-color:{C_ACCENT};}}
        QPushButton{{background:{C_PANEL};border:1px solid {C_BORDER};border-radius:3px;padding:4px 10px;color:{C_TEXT};}}
        QPushButton:hover{{background:#30363d;border-color:{C_ACCENT};}}
        """)


class AboutDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"About {APP_NAME}")
        self.setModal(True); self.setFixedSize(380, 280)
        lay = QVBoxLayout(self); lay.setSpacing(12)
        logo=QLabel("🔧"); logo.setAlignment(Qt.AlignCenter); logo.setStyleSheet("font-size:48px;"); lay.addWidget(logo)
        title=QLabel(f"<b>{APP_NAME}</b>"); title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet(f"font-size:18px;color:{C_TITLE};"); lay.addWidget(title)
        info=QLabel(f"Version {VERSION}<br>CNC Door Manufacturing CAM Software<br><br>"
                    "Nesting Engine: Genetic Algorithm + MaxRects<br>"
                    "Compatible with Solid Edge 2D Nesting workflow<br><br>"
                    "© 2026 FIROO CAM — All rights reserved")
        info.setAlignment(Qt.AlignCenter); info.setStyleSheet(f"color:{C_DIM}; font-size:11px;")
        info.setWordWrap(True); lay.addWidget(info)
        btns=QDialogButtonBox(QDialogButtonBox.Ok); btns.accepted.connect(self.accept); lay.addWidget(btns)
        self.setStyleSheet(f"""QDialog{{background:{C_BG};color:{C_TEXT};font-family:"Segoe UI",sans-serif;}}
        QLabel{{color:{C_TEXT};background:transparent;}}
        QPushButton{{background:{C_PANEL};border:1px solid {C_BORDER};border-radius:3px;padding:4px 20px;color:{C_TEXT};}}
        QPushButton:hover{{background:#30363d;}}""")


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self._project_path = ""; self._modified = False; self._sheets_cache = []
        init_from_config(); lang.on_change(self._on_lang_change)
        self.setWindowTitle(APP_NAME); self.resize(1440, 860); self.setMinimumSize(1024, 600)
        self._build_menu(); self._build_toolbar(); self._build_central()
        self._build_status_bar(); self._apply_style(); self._restore_geometry()
        self._on_lang_change(lang.code, lang.direction)
        self._status("New project created")

    def _build_menu(self):
        mb = self.menuBar()
        self._m_file = mb.addMenu(lang.t("menu.file") or "File")
        self._act_new    = self._m_file.addAction(lang.t("menu.new")     or "New Project")
        self._act_open   = self._m_file.addAction(lang.t("menu.open")    or "Open Project...")
        self._act_save   = self._m_file.addAction(lang.t("menu.save")    or "Save Project")
        self._act_saveas = self._m_file.addAction(lang.t("menu.save_as") or "Save Project As...")
        self._m_file.addSeparator()
        self._act_import_csv = self._m_file.addAction(lang.t("menu.import_csv") or "Import CSV Order...")
        self._m_file.addSeparator()
        self._act_exit = self._m_file.addAction(lang.t("menu.exit") or "Exit")
        self._act_new.setShortcut(QKeySequence.New); self._act_open.setShortcut(QKeySequence.Open)
        self._act_save.setShortcut(QKeySequence.Save); self._act_saveas.setShortcut(QKeySequence("Ctrl+Shift+S"))
        self._act_import_csv.setShortcut(QKeySequence("Ctrl+I")); self._act_exit.setShortcut(QKeySequence("Alt+F4"))
        self._act_new.triggered.connect(self._new_project); self._act_open.triggered.connect(self._open_project)
        self._act_save.triggered.connect(self._save_project); self._act_saveas.triggered.connect(self._save_project_as)
        self._act_import_csv.triggered.connect(self._import_csv); self._act_exit.triggered.connect(self.close)

        self._m_edit = mb.addMenu("Edit")
        self._act_settings = self._m_edit.addAction("Settings..."); self._act_settings.triggered.connect(self._show_settings)

        self._m_nest = mb.addMenu("Nesting")
        self._act_run_nest  = self._m_nest.addAction("Run Nesting"); self._act_run_nest.setShortcut(QKeySequence("F5"))
        self._act_stop_nest = self._m_nest.addAction("Stop")
        self._act_clear     = self._m_nest.addAction("Clear Layout")
        self._act_run_nest.triggered.connect(self._run_nesting)
        self._act_stop_nest.triggered.connect(self._stop_nesting)
        self._act_clear.triggered.connect(self._clear_nesting)

        self._m_view = mb.addMenu("View")
        self._act_lang_en = self._m_view.addAction("English")
        self._act_lang_fa = self._m_view.addAction("فارسی")
        self._act_lang_ar = self._m_view.addAction("العربية")
        self._m_view.addSeparator()
        self._act_fullscreen = self._m_view.addAction("Full Screen")
        self._act_fullscreen.setShortcut(QKeySequence("F11")); self._act_fullscreen.setCheckable(True)
        self._act_lang_en.triggered.connect(lambda: self._set_lang("en"))
        self._act_lang_fa.triggered.connect(lambda: self._set_lang("fa"))
        self._act_lang_ar.triggered.connect(lambda: self._set_lang("ar"))
        self._act_fullscreen.triggered.connect(self._toggle_fullscreen)

        # Design menu
        self._m_design = mb.addMenu("Design")
        self._act_design_lib = self._m_design.addAction("Design Library")
        self._act_design_lib.triggered.connect(lambda: self._tab_widget.setCurrentWidget(self._design_tab))

        self._m_help = mb.addMenu("Help")
        self._act_about = self._m_help.addAction(f"About {APP_NAME}")
        self._act_about.triggered.connect(lambda: AboutDialog(self).exec())

    def _build_toolbar(self):
        tb = QToolBar("Main Toolbar"); tb.setMovable(False)
        tb.setIconSize(QSize(20,20)); tb.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        tb.setFixedHeight(52)
        tb.setStyleSheet(
            f"QToolBar{{background:qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #202124, stop:0.45 #161b22, stop:1 #1f2933);border-bottom:1px solid {C_BORDER};padding:5px 8px;spacing:6px;}}"
            f"QToolButton{{background:#21262d;border:1px solid {C_BORDER};color:{C_TEXT};padding:6px 12px;border-radius:6px;font-weight:600;}}"
            f"QToolButton:hover{{background:#3a3d41;border-color:{C_ACCENT};color:white;}}"
            f"QToolButton:pressed{{background:{C_ACCENT};}}"
            f"QToolBar::separator{{background:{C_BORDER};width:1px;margin:6px 8px;}}")
        self._tb_new    = tb.addAction("⊕  New");        self._tb_open  = tb.addAction("📂  Open")
        self._tb_save   = tb.addAction("💾  Save");       tb.addSeparator()
        self._tb_import = tb.addAction("📊  Import CSV"); tb.addSeparator()
        self._tb_run    = tb.addAction("▶  Run Nesting"); self._tb_stop  = tb.addAction("■  Stop")
        tb.addSeparator()
        self._tb_export = tb.addAction("📤  Export");     self._tb_report= tb.addAction("📋  Report")
        tb.addSeparator()
        self._tb_settings = tb.addAction("⚙  Settings")
        self._tb_new.triggered.connect(self._new_project); self._tb_open.triggered.connect(self._open_project)
        self._tb_save.triggered.connect(self._save_project); self._tb_import.triggered.connect(self._import_csv)
        self._tb_run.triggered.connect(self._run_nesting); self._tb_stop.triggered.connect(self._stop_nesting)
        self._tb_export.triggered.connect(lambda: self._tab_widget.setCurrentIndex(3))
        self._tb_report.triggered.connect(self._show_report); self._tb_settings.triggered.connect(self._show_settings)
        self.addToolBar(tb)

    def _build_central(self):
        self._tab_widget = QTabWidget()
        self._tab_widget.setTabPosition(QTabWidget.North)
        self._tab_widget.setDocumentMode(True)
        self._tab_widget.setStyleSheet(self._tab_style())

        self._parts_tab   = PartsTab()
        self._sheets_tab  = SheetsTab()
        self._nesting_tab = NestingTab()
        self._export_tab  = ExportTab()

        # Design tab — try to load, fallback to placeholder
        self._design_tab  = self._build_design_tab()

        # CAM / Toolpaths tab
        if ToolpathsTab:
            self._cam_tab = ToolpathsTab()
        else:
            self._cam_tab = self._cam_placeholder()

        self._tab_widget.addTab(self._parts_tab,   "Parts")
        self._tab_widget.addTab(self._sheets_tab,  "Sheets")
        self._tab_widget.addTab(self._nesting_tab, "Nesting")
        self._tab_widget.addTab(self._export_tab,  "Export")
        self._tab_widget.addTab(self._design_tab,  "Design")
        self._tab_widget.addTab(self._cam_tab,     "CAM")

        self._parts_tab.parts_changed.connect(self._on_parts_changed)
        self._sheets_tab.sheets_changed.connect(self._on_sheets_changed)
        self._nesting_tab.layout_applied.connect(self._on_layout_applied)

        self.setCentralWidget(self._tab_widget)

    def _build_design_tab(self) -> QWidget:
        """Load DesignLibraryWidget if available, else placeholder."""
        try:
            from design_library import DesignLibraryWidget
            designs_dir = str(Path(__file__).parent / "designs")
            w = DesignLibraryWidget(designs_dir=designs_dir)
            w.design_opened.connect(self._on_design_open)
            w.design_selected.connect(self._on_design_select)
            return w
        except Exception as e:
            print(f"[Design] Could not load design library: {e}")
            return self._design_placeholder()

    def _cam_placeholder(self) -> QWidget:
        w   = QWidget()
        lay = QVBoxLayout(w); lay.setAlignment(Qt.AlignCenter)
        lbl = QLabel("⚙  CAM Toolpaths\n\ntoolpaths_tab.py not found.\n"
                     "Place toolpaths_tab.py in the project folder.")
        lbl.setAlignment(Qt.AlignCenter)
        lbl.setStyleSheet(f"color:{C_DIM}; font-size:13px;")
        lbl.setWordWrap(True); lay.addWidget(lbl)
        return w

    def _design_placeholder(self) -> QWidget:
        w   = QWidget()
        lay = QVBoxLayout(w); lay.setAlignment(Qt.AlignCenter)
        lbl = QLabel("🎨  Design Library\n\ndesign_library.py not found or error loading.\n"
                     "Place design_library.py and designs/ folder in C:\\FIROO_CAM\\")
        lbl.setAlignment(Qt.AlignCenter)
        lbl.setStyleSheet(f"color:{C_DIM}; font-size:13px;")
        lbl.setWordWrap(True); lay.addWidget(lbl)
        return w

    def _build_status_bar(self):
        sb=QStatusBar()
        sb.setStyleSheet(f"QStatusBar{{background:{C_PANEL};color:{C_DIM};border-top:1px solid {C_BORDER};font-size:11px;}}")
        self.setStatusBar(sb)
        self._lbl_status  = QLabel("Ready");    self._lbl_parts  = QLabel("Parts: 0")
        self._lbl_sheets  = QLabel("Sheets: 0");self._lbl_util   = QLabel("Util: —")
        self._lbl_lang    = QLabel("EN");        self._lbl_modified=QLabel("")
        for w in [self._lbl_status,self._lbl_parts,self._lbl_sheets,self._lbl_util]:
            sb.addWidget(w); sb.addWidget(self._sep())
        sb.addPermanentWidget(self._lbl_modified); sb.addPermanentWidget(self._sep())
        sb.addPermanentWidget(self._lbl_lang)

    @staticmethod
    def _sep():
        s=QFrame(); s.setFrameShape(QFrame.VLine); s.setStyleSheet(f"color:{C_BORDER};"); s.setFixedWidth(1); return s

    # ── Tab signals ───────────────────────────────────────────
    def _on_parts_changed(self, parts: list):
        self._nesting_tab.set_parts(parts)
        self._lbl_parts.setText(f"Parts: {len(parts)}"); self._mark_modified()

    def _on_sheets_changed(self, sheets: list):
        self._nesting_tab._sheet_defs = sheets
        self._nesting_tab._refresh_sheet_table(); self._mark_modified()

    def _on_layout_applied(self, sheets: list):
        self._sheets_cache = sheets
        self._export_tab.set_sheets(sheets)
        if ToolpathsTab and hasattr(self._cam_tab, "set_sheets"):
            self._cam_tab.set_sheets(sheets)
        n=len(sheets); parts=sum(s.part_count() for s in sheets)
        util=sum(s.utilization() for s in sheets)/max(n,1)
        self._lbl_sheets.setText(f"Sheets: {n}"); self._lbl_util.setText(f"Util: {util:.1f}%")
        self._status(f"Layout applied — {n} sheets, {parts} parts, {util:.1f}% avg")

    def _on_design_open(self, code: str):
        """Open design in editor — uses v8 DesignEditorWidget API."""
        try:
            from design_editor import DesignEditorWidget
            designs_dir = str(Path(__file__).parent / "designs")
            dlg = QDialog(self)
            dlg.setWindowTitle(f"Design Editor — {code if code != '__new__' else 'New Design'}")
            dlg.resize(1200, 800)
            lay = QVBoxLayout(dlg); lay.setContentsMargins(0,0,0,0)
            # v8: DesignEditorWidget accepts designs_dir as keyword arg
            editor = DesignEditorWidget(designs_dir=designs_dir)
            if code and code != "__new__":
                editor.load_design(code)
            else:
                # New design — call _new_design only if it exists
                if hasattr(editor, "_new_design"):
                    editor._new_design()
            lay.addWidget(editor)
            dlg.exec()
        except Exception as e:
            import traceback
            QMessageBox.warning(self, "Design Editor",
                                f"Cannot open editor:\n{e}\n\n{traceback.format_exc()[-300:]}")

    def _on_design_select(self, code: str):
        """Assign selected design to selected parts."""
        pass  # future: assign design_code to selected parts in parts_tab

    # ── Actions ───────────────────────────────────────────────
    def _new_project(self):
        if self._modified:
            ans=QMessageBox.question(self,"Unsaved","Save before new project?",
                                      QMessageBox.Save|QMessageBox.Discard|QMessageBox.Cancel)
            if ans==QMessageBox.Save: self._save_project()
            elif ans==QMessageBox.Cancel: return
        self._parts_tab.set_rows([]); self._nesting_tab.clear_layout()
        self._sheets_cache=[]; self._export_tab.set_sheets([])
        self._project_path=""; self._modified=False; self._update_title()
        self._status("New project created")
        n_sheets = len(self._sheets_tab.get_sheet_defs())
        self._lbl_status.setText(f"New project created  |  Parts: 0  |  Sheets: {n_sheets}  |  Util: —")

    def _open_project(self):
        path,_=QFileDialog.getOpenFileName(self,"Open FIROO CAM Project",str(Path.home()),
                                            f"FIROO CAM Project (*{FILE_EXT});;All Files (*)")
        if not path: return
        try:
            with open(path,"r",encoding="utf-8") as f: data=json.load(f)
            rows=data.get("parts",[])
            self._parts_tab.set_rows(rows)
            sheets_def=data.get("sheets",[])
            if sheets_def: self._sheets_tab.set_sheet_defs(sheets_def)
            self._project_path=path; self._modified=False; self._update_title()
            self._status(f"Opened: {Path(path).name}")
        except Exception as e: QMessageBox.critical(self,"Open Error",str(e))

    def _save_project(self):
        if not self._project_path: self._save_project_as(); return
        self._do_save(self._project_path)

    def _save_project_as(self):
        path,_=QFileDialog.getSaveFileName(self,"Save FIROO CAM Project",
                                            str(Path.home()/"project.firoo"),
                                            f"FIROO CAM Project (*{FILE_EXT});;All Files (*)")
        if path:
            if not path.endswith(FILE_EXT): path+=FILE_EXT
            self._project_path=path; self._do_save(path)

    def _do_save(self, path: str):
        try:
            data={"version":VERSION,"parts":self._parts_tab._rows,
                  "sheets":self._sheets_tab.get_sheet_defs()}
            with open(path,"w",encoding="utf-8") as f: json.dump(data,f,ensure_ascii=False,indent=2)
            self._modified=False; self._update_title()
            self._status(f"Saved: {Path(path).name}")
        except Exception as e: QMessageBox.critical(self,"Save Error",str(e))

    def _import_csv(self):
        self._tab_widget.setCurrentIndex(0); self._parts_tab._import_csv()

    def _run_nesting(self):
        self._tab_widget.setCurrentIndex(2); self._nesting_tab.run_nesting()

    def _stop_nesting(self): self._nesting_tab.stop_nesting()
    def _clear_nesting(self): self._nesting_tab.clear_layout()

    def _show_report(self):
        if not self._sheets_cache:
            QMessageBox.warning(self,"No Layout","Run nesting first."); return
        self._tab_widget.setCurrentIndex(3); self._export_tab._export_report(detailed=True)

    def _show_settings(self): SettingsDialog(self).exec()

    def _set_lang(self, code: str):
        lang.set(code); config.set(code,"language")

    def _toggle_fullscreen(self, checked):
        self.showFullScreen() if checked else self.showNormal()

    def _on_lang_change(self, code: str, direction: str):
        self.setLayoutDirection(Qt.RightToLeft if direction=="rtl" else Qt.LeftToRight)
        self.menuBar().setLayoutDirection(Qt.RightToLeft if direction=="rtl" else Qt.LeftToRight)
        self._lbl_lang.setText(code.upper())
        self._status(f"Language: {lang.native_name}")

        # Update menus and actions
        self._m_file.setTitle(lang.t("menu.file") or "File")
        self._m_edit.setTitle("ویرایش" if code == "fa" else ("تحرير" if code == "ar" else "Edit"))
        self._m_nest.setTitle(lang.t("tabs.nesting") or "Nesting")
        self._m_view.setTitle("نمایش" if code == "fa" else ("عرض" if code == "ar" else "View"))
        self._m_design.setTitle(lang.t("tabs.design") or "Design")
        self._m_help.setTitle(lang.t("menu.help") or "Help")

        self._act_new.setText(lang.t("menu.new") or "New Project")
        self._act_open.setText(lang.t("menu.open") or "Open")
        self._act_save.setText(lang.t("menu.save") or "Save")
        self._act_saveas.setText(lang.t("menu.save_as") or "Save As")
        self._act_import_csv.setText(lang.t("menu.import_csv") or "Import CSV")
        self._act_exit.setText(lang.t("menu.exit") or "Exit")
        self._act_settings.setText(lang.t("menu.settings") or "Settings")
        self._act_run_nest.setText("اجرای چیدمان" if code == "fa" else ("تشغيل التعشيش" if code == "ar" else "Run Nesting"))
        self._act_stop_nest.setText("توقف" if code == "fa" else ("إيقاف" if code == "ar" else "Stop"))
        self._act_clear.setText("پاک کردن چیدمان" if code == "fa" else ("مسح التعشيش" if code == "ar" else "Clear Layout"))
        self._act_fullscreen.setText("تمام صفحه" if code == "fa" else ("ملء الشاشة" if code == "ar" else "Full Screen"))
        self._act_design_lib.setText("کتابخانه طراحی" if code == "fa" else ("مكتبة التصميم" if code == "ar" else "Design Library"))
        self._act_about.setText(("درباره" if code == "fa" else ("حول" if code == "ar" else "About")) + f" {APP_NAME}")

        self._tb_new.setText("⊕  " + (lang.t("menu.new") or "New"))
        self._tb_open.setText("📂  " + (lang.t("menu.open") or "Open"))
        self._tb_save.setText("💾  " + (lang.t("menu.save") or "Save"))
        self._tb_import.setText("📊  " + (lang.t("menu.import_csv") or "Import CSV"))
        self._tb_run.setText("▶  " + ("اجرای چیدمان" if code == "fa" else ("تشغيل التعشيش" if code == "ar" else "Run Nesting")))
        self._tb_stop.setText("■  " + ("توقف" if code == "fa" else ("إيقاف" if code == "ar" else "Stop")))
        self._tb_export.setText("📤  " + (lang.t("tabs.export") or "Export"))
        self._tb_report.setText("📋  " + ("گزارش" if code == "fa" else ("تقرير" if code == "ar" else "Report")))
        self._tb_settings.setText("⚙  " + (lang.t("menu.settings") or "Settings"))

        # Update tab names
        tab_names = [
            lang.t("tabs.parts")   or "Parts",
            lang.t("tabs.sheets")  or "Sheets",
            lang.t("tabs.nesting") or "Nesting",
            lang.t("tabs.export")  or "Export",
            lang.t("tabs.design")  or "Design",
            "CAM" if code == "en" else ("کم" if code == "fa" else "CAM"),
        ]
        for i, name in enumerate(tab_names):
            if i < self._tab_widget.count():
                self._tab_widget.setTabText(i, name)

        # Let Design Library refresh its own labels if supported.
        if hasattr(self._design_tab, "set_language"):
            self._design_tab.set_language(code)

    def _status(self, msg: str): self._lbl_status.setText(msg)
    def _mark_modified(self):
        self._modified=True; self._lbl_modified.setText("●  Modified")
        self._lbl_modified.setStyleSheet(f"color:#ce9178;"); self._update_title()

    def _update_title(self):
        name=(Path(self._project_path).stem if self._project_path else "Untitled")
        mod=" *" if self._modified else ""
        self.setWindowTitle(f"{name}{mod} — {APP_NAME} {VERSION}")

    def _restore_geometry(self):
        s=QSettings("FIROO","CAM"); geo=s.value("geometry")
        if geo: self.restoreGeometry(geo)

    def closeEvent(self, ev: QCloseEvent):
        if self._modified:
            ans=QMessageBox.question(self,"Unsaved Changes","Save changes before exiting?",
                                      QMessageBox.Save|QMessageBox.Discard|QMessageBox.Cancel)
            if ans==QMessageBox.Save: self._save_project()
            elif ans==QMessageBox.Cancel: ev.ignore(); return
        s=QSettings("FIROO","CAM"); s.setValue("geometry",self.saveGeometry()); ev.accept()

    def _apply_style(self):
        self.setStyleSheet(f"""
        QMainWindow{{background:{C_BG};}}
        QMenuBar{{background:qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #181818, stop:1 #24272b);color:{C_TEXT};border-bottom:1px solid {C_BORDER};font-size:12px;padding:2px 6px;}}
        QMenuBar::item{{padding:6px 13px;background:transparent;border-radius:5px;margin:1px;}}
        QMenuBar::item:selected{{background:#333842;color:white;}}
        QMenuBar::item:pressed{{background:{C_ACCENT};color:white;}}
        QMenu{{background:#161b22;color:{C_TEXT};border:1px solid #4b4b4f;border-radius:6px;font-size:12px;padding:5px;}}
        QMenu::item{{padding:7px 34px 7px 18px;border-radius:4px;}}
        QMenu::item:selected{{background:{C_ACCENT};color:white;}}
        QMenu::separator{{background:{C_BORDER};height:1px;margin:5px 8px;}}
        """)

    @staticmethod
    def _tab_style() -> str:
        return f"""
        QTabWidget::pane{{border:none;border-top:1px solid {C_BORDER};background:{C_BG};}}
        QTabBar{{background:{C_PANEL};}}
        QTabBar::tab{{background:{C_PANEL};color:{C_DIM};border:none;
            border-right:1px solid {C_BORDER};padding:6px 20px;font-size:12px;min-width:80px;}}
        QTabBar::tab:selected{{background:{C_BG};color:{C_TEXT};
            border-bottom:2px solid {C_ACCENT};font-weight:600;}}
        QTabBar::tab:hover:!selected{{background:#21262d;color:{C_TEXT};}}
        """


def main():
    app=QApplication(sys.argv); app.setApplicationName(APP_NAME)
    app.setApplicationVersion(VERSION); app.setOrganizationName("FIROO"); app.setStyle("Fusion")
    from PySide6.QtGui import QPalette
    pal=QPalette()
    pal.setColor(QPalette.Window,       QColor(C_BG))
    pal.setColor(QPalette.WindowText,   QColor(C_TEXT))
    pal.setColor(QPalette.Base,         QColor("#111820"))
    pal.setColor(QPalette.AlternateBase,QColor("#222222"))
    pal.setColor(QPalette.Text,         QColor(C_TEXT))
    pal.setColor(QPalette.Button,       QColor(C_PANEL))
    pal.setColor(QPalette.ButtonText,   QColor(C_TEXT))
    pal.setColor(QPalette.Highlight,    QColor(C_ACCENT))
    pal.setColor(QPalette.HighlightedText,QColor("#ffffff"))
    app.setPalette(pal)
    window=MainWindow(); window.show()
    sys.exit(app.exec())


if __name__=="__main__":
    main()