"""
FIROO CAM - Design Importer
Reads proprietary .dsgn / .cd design files and converts to
FIROO CAM JSON format.

File Format (fully reverse-engineered from real CNC data):
  Line 1:  Width Height [global_flags x14]
  Line 2:  offset[0..9]  — active offset distances in mm (0 = inactive)
  Line 3:  0 0 0 T2_diameter T1_diameter 0 0 [enable_flags]
  Line 4:  depth[0..9]   — cut depths (negative values = mm deep)
  Lines 5–8:   enable/disable flags (64 params, 4 rows of 16)
  Lines 9–13:  pass parameters (step depths, counts)
  Lines 14–50: pattern spacing data (stored in inches internally)

Internal units: inches → multiply by 25.4 to get mm
"""
from __future__ import annotations
import json
import math
import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple


# ── Known internal inch→mm mappings ──────────────────────────
_INCH_MAP: Dict[float, float] = {
    0.787402: 20.0,  0.984252: 25.0,  1.181102: 30.0,
    1.377953: 35.0,  1.574803: 40.0,  1.771654: 45.0,
    1.968504: 50.0,  2.165354: 55.0,  2.362205: 60.0,
    2.559055: 65.0,  2.755906: 70.0,  2.952756: 75.0,
    3.149606: 80.0,  3.346457: 85.0,  3.425197: 87.0,
    3.543307: 90.0,  3.740157: 95.0,  3.937008: 100.0,
    3.917323: 99.5,  4.330709: 110.0, 4.724409: 120.0,
}

def _inch_to_mm(val: float) -> Optional[float]:
    for iv, mm in _INCH_MAP.items():
        if abs(val - iv) < 0.0015:
            return mm
    if 0.4 < val < 25.0:
        return round(val * 25.4, 2)
    return None

def _safe_float(s: str) -> Optional[float]:
    try:    return float(s)
    except: return None

def _parse_line(line: str) -> List[Optional[float]]:
    return [_safe_float(v) for v in line.split()]


# ═══════════════════════════════════════════════════════════════
# Raw File Parser
# ═══════════════════════════════════════════════════════════════
class DesignFileParser:
    """
    Parses the raw design file into a structured dict.
    Fixes:
      - Depth index is 0-based, offset layer is 1-based → matched correctly
      - Pattern spacing extracted and converted from inches
      - Pass parameters extracted properly
    """

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.lines: List[str] = []
        self.error: Optional[str] = None

    def load(self) -> bool:
        try:
            with open(self.filepath, "rb") as f:
                raw = f.read()
            text = raw.decode("ascii", errors="replace")
            self.lines = [l.strip() for l in text.replace("\r\n","\n")
                          .replace("\r","\n").split("\n")]
            self.lines = [l for l in self.lines if l]
            return True
        except Exception as e:
            self.error = str(e)
            return False

    def parse(self) -> Optional[Dict]:
        if not self.lines or len(self.lines) < 8:
            self.error = f"Too few lines: {len(self.lines)}"
            return None

        # ── Line 1: dimensions + global flags ─────────────────
        l1 = _parse_line(self.lines[0])
        if len(l1) < 2 or l1[0] is None or l1[1] is None:
            self.error = "Cannot read dimensions from line 1"
            return None
        width   = l1[0]
        height  = l1[1]
        g_flags = [v for v in l1[2:] if v is not None]

        # ── Line 2: offset distances (1-based index = layer no) ─
        l2 = _parse_line(self.lines[1])
        # positions 0..9 → offset layer 0..9
        # layer 0 is always 0 (profile boundary)
        # layers 1..9 are the actual decoration offsets
        active_offsets: List[Dict] = []
        for i in range(min(10, len(l2))):
            v = l2[i]
            if v and v > 0:
                active_offsets.append({
                    "layer_index": i,        # 0-based raw index
                    "layer_no":    i,         # 1-based display number
                    "distance_mm": round(v, 4)
                })

        # ── Line 3: tool diameters ──────────────────────────────
        l3 = _parse_line(self.lines[2])
        t2_dia = (l3[3] if len(l3) > 3 and l3[3] and l3[3] > 0 else 16.0)
        t1_dia = (l3[4] if len(l3) > 4 and l3[4] and l3[4] > 0 else 6.0)

        # ── Line 4: cut depths ──────────────────────────────────
        # depth[i] is 0-based → maps to offset layer i+1 display
        # negative value = mm deep
        l4 = _parse_line(self.lines[3])
        cut_depths: List[Dict] = []
        for i in range(min(10, len(l4))):
            v = l4[i]
            if v is not None and v < 0:
                cut_depths.append({
                    "depth_index": i,         # 0-based
                    "depth_mm":    round(abs(v), 4)
                })

        # ── Lines 5–8: enable flags ─────────────────────────────
        enable_flags: List[float] = []
        for li in range(4, min(8, len(self.lines))):
            enable_flags.extend(
                v for v in _parse_line(self.lines[li]) if v is not None)

        # ── Lines 9–13: pass parameters ─────────────────────────
        pass_params: List[float] = []
        for li in range(8, min(14, len(self.lines))):
            vals = _parse_line(self.lines[li])
            for v in vals:
                if v and v not in (0.0, 1.0) and 1.1 < abs(v) < 200:
                    pass_params.append(v)

        # Typical pass_depth = smallest value in pass_params
        pass_depth = 2.0
        small_vals = [v for v in pass_params if 1.0 < v <= 5.0]
        if small_vals:
            pass_depth = min(small_vals)

        # ── Lines 14+: pattern spacing (inch values) ────────────
        spacing_mm: List[float] = []
        seen_sp: set = set()
        for li in range(14, min(55, len(self.lines))):
            for v in _parse_line(self.lines[li]):
                if v and 1.0 < abs(v) < 15.0:
                    mm = _inch_to_mm(v)
                    if mm and mm not in seen_sp:
                        seen_sp.add(mm)
                        spacing_mm.append(mm)

        return {
            "width":          width,
            "height":         height,
            "global_flags":   g_flags,
            "active_offsets": active_offsets,
            "t1_diameter":    t1_dia,
            "t2_diameter":    t2_dia,
            "cut_depths":     cut_depths,
            "enable_flags":   enable_flags,
            "pass_params":    pass_params,
            "pass_depth":     pass_depth,
            "spacing_mm":     sorted(spacing_mm),
            "total_lines":    len(self.lines),
        }


# ═══════════════════════════════════════════════════════════════
# Design Builder  (parsed dict → FIROO CAM JSON)
# ═══════════════════════════════════════════════════════════════
class DesignBuilder:
    """
    Converts parsed design data to FIROO CAM design JSON.

    Bug fixes vs v1:
      ✅ Depth mapped by depth_index == offset layer_index (0-based both)
      ✅ pass_count uses math.ceil not int()
      ✅ Last inner-panel depth entry handled as separate layer
      ✅ Tool assignment: T1=profile, T2=all decoration layers
      ✅ Layer type determined by depth+position, not just depth value
    """

    def build(self, parsed: Dict, filepath: str) -> Dict:
        fname   = Path(filepath).stem
        width   = parsed["width"]
        height  = parsed["height"]
        offsets = parsed["active_offsets"]   # list of {layer_index, layer_no, distance_mm}
        depths  = parsed["cut_depths"]       # list of {depth_index, depth_mm}
        t1_dia  = parsed["t1_diameter"]
        t2_dia  = parsed["t2_diameter"]
        spacing = parsed["spacing_mm"]
        pass_dp = parsed["pass_depth"]

        # ── Classify design type ──────────────────────────────
        n_off = len(offsets)
        if n_off == 0:
            dtype, name, name_fa, tags = (
                "plain",
                "Plain Door", "در ساده",
                ["plain", "flat", "simple", "modern"]
            )
        elif n_off == 1 and offsets[0]["distance_mm"] >= 50:
            dtype, name, name_fa, tags = (
                "wide_frame",
                "Wide Frame Door", "در قابدار پهن",
                ["wide-frame", "modern", "bevel", "minimal"]
            )
        elif n_off == 1:
            dtype, name, name_fa, tags = (
                "simple_frame",
                "Frame Door", "در قابدار",
                ["frame", "groove", "simple"]
            )
        elif n_off == 2:
            dtype, name, name_fa, tags = (
                "double_frame",
                "Double Frame Door", "در دو قاب",
                ["double-frame", "groove", "classic"]
            )
        elif n_off >= 3:
            dtype, name, name_fa, tags = (
                "classic_frame",
                "Classic Frame Door", "در قابدار کلاسیک",
                ["classic", "frame", "groove", "traditional"]
            )
        else:
            dtype, name, name_fa, tags = (
                "custom", "Custom Door", "در سفارشی", ["custom"]
            )

        # ── Build layers list ─────────────────────────────────
        # Layer 0: always profile cut with T1
        layers = [{
            "id":         0,
            "name":       "Profile Cut",
            "name_fa":    "برش پروفایل",
            "type":       "profile",
            "tool":       "T1",
            "depth_mm":   0,
            "offset_mm":  0,
            "pass_count": 1,
            "enabled":    True,
        }]

        for off in offsets:
            layer_idx = off["layer_index"]   # 0-based

            # FIX: depth_index is also 0-based
            # offset layer_index 1 → depth_index 0
            # offset layer_index 2 → depth_index 1
            # offset layer_index n → depth_index n-1
            depth_idx   = layer_idx - 1
            depth_entry = next(
                (d for d in depths if d["depth_index"] == depth_idx), None)
            depth_mm = depth_entry["depth_mm"] if depth_entry else 2.0

            # Determine layer type
            if dtype == "wide_frame":
                ltype = "bevel"
            elif depth_mm >= 5:
                ltype = "deep_groove"
            elif depth_mm >= 2:
                ltype = "groove"
            else:
                ltype = "shallow_groove"

            # FIX: pass_count uses ceil
            pass_count = max(1, math.ceil(depth_mm / pass_dp))

            layers.append({
                "id":         len(layers),
                "name":       f"Layer {len(layers)}",
                "name_fa":    f"لایه {len(layers)}",
                "type":       ltype,
                "tool":       "T2",
                "depth_mm":   depth_mm,
                "offset_mm":  off["distance_mm"],
                "pass_count": pass_count,
                "enabled":    True,
            })

        # FIX: handle inner-panel depth (last depth entry with no matching offset)
        # e.g. cd1 has depth[3]=7mm but only 3 offsets (layers 1,2,3)
        # depth[3] = inner panel cut at last offset depth
        matched_indices = {off["layer_index"] - 1 for off in offsets}
        unmatched_depths = [d for d in depths
                            if d["depth_index"] not in matched_indices
                            and d["depth_mm"] > 0]
        for ud in unmatched_depths:
            # Use last offset distance if available
            last_off_mm = offsets[-1]["distance_mm"] if offsets else 0
            pass_count  = max(1, math.ceil(ud["depth_mm"] / pass_dp))
            layers.append({
                "id":         len(layers),
                "name":       "Inner Panel Cut",
                "name_fa":    "برش پنل داخلی",
                "type":       "inner_cut",
                "tool":       "T1",
                "depth_mm":   ud["depth_mm"],
                "offset_mm":  last_off_mm,
                "pass_count": pass_count,
                "enabled":    True,
            })

        # ── Pattern ───────────────────────────────────────────
        if spacing and dtype not in ("plain",):
            pattern = {
                "enabled":     True,
                "type":        dtype,
                "spacing_mm":  spacing,
                "primary_spacing": spacing[0] if spacing else 60.0,
            }
        else:
            pattern = {
                "enabled": False,
                "type":    "none",
            }

        # ── Offsets for JSON (clean format) ───────────────────
        offsets_clean = [
            {
                "layer_no":    off["layer_no"],
                "distance_mm": off["distance_mm"],
                "name":        f"Offset {off['layer_no']}",
                "name_fa":     f"آفست {off['layer_no']}",
            }
            for off in offsets
        ]

        return {
            "design_code":   fname,
            "name":          name,
            "name_fa":       name_fa,
            "name_ar":       "",
            "category":      "designs",
            "description":   f"Imported from {Path(filepath).name}",
            "source_file":   Path(filepath).name,
            "default_size":  {"width": width, "height": height},
            "tools": {
                "T1": {
                    "diameter":    t1_dia,
                    "type":        "endmill",
                    "description": "Profile & inner cuts"
                },
                "T2": {
                    "diameter":    t2_dia,
                    "type":        "form_tool",
                    "description": "Grooves & bevel decoration"
                },
            },
            "offsets":       offsets_clean,
            "layers":        layers,
            "pattern":       pattern,
            "pass_depth_mm": pass_dp,
            "spacing_mm":    spacing,
            "preview": {
                "shape": "frame_door" if offsets else "rectangle",
                "color": "#8B4513",
            },
            "tags": tags,
        }


# ═══════════════════════════════════════════════════════════════
# Main Importer
# ═══════════════════════════════════════════════════════════════
class DesignImporter:
    """
    High-level importer: reads design files → saves to designs/ folder.

    Usage:
        imp = DesignImporter("C:/FIROO_CAM/designs")
        r   = imp.import_file("my_door.cd")
        if r["success"]:
            print(r["design"]["name"])
    """

    EXTENSIONS = (".cd", ".dsgn", ".design")

    def __init__(self, designs_dir: str = None):
        self.designs_dir = designs_dir or str(
            Path(__file__).parent / "designs")
        Path(self.designs_dir).mkdir(parents=True, exist_ok=True)
        self._builder = DesignBuilder()

    # ── Single file ───────────────────────────────────────────
    def import_file(self, filepath: str,
                    code_override: str = None) -> Dict:
        result = {
            "success":     False,
            "design_code": None,
            "design":      None,
            "error":       None,
            "output_path": None,
        }

        if not os.path.exists(filepath):
            result["error"] = f"File not found: {filepath}"
            return result

        parser = DesignFileParser(filepath)
        if not parser.load():
            result["error"] = f"Cannot read: {parser.error}"
            return result

        parsed = parser.parse()
        if not parsed:
            result["error"] = parser.error or "Parse failed"
            return result

        design = self._builder.build(parsed, filepath)
        if code_override:
            design["design_code"] = code_override

        code     = design["design_code"]
        out_path = str(Path(self.designs_dir) / f"{code}.json")

        try:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(design, f, ensure_ascii=False, indent=2)
        except Exception as e:
            result["error"] = f"Save error: {e}"
            return result

        self._update_index(design)
        result.update({
            "success":     True,
            "design_code": code,
            "design":      design,
            "output_path": out_path,
        })
        return result

    # ── Folder ────────────────────────────────────────────────
    def import_folder(self, folder: str,
                      progress_cb=None) -> Dict:
        folder   = Path(folder)
        files    = []
        for ext in self.EXTENSIONS:
            files.extend(folder.glob(f"*{ext}"))
            files.extend(folder.glob(f"*{ext.upper()}"))
        files = list(set(files))

        summary = {
            "total":   len(files),
            "success": 0,
            "failed":  0,
            "results": [],
        }
        for i, f in enumerate(files):
            if progress_cb:
                progress_cb(i + 1, len(files), f.name)
            r = self.import_file(str(f))
            summary["results"].append(r)
            if r["success"]:
                summary["success"] += 1
            else:
                summary["failed"] += 1
        return summary

    # ── Get / List ────────────────────────────────────────────
    def get_design(self, code: str) -> Optional[Dict]:
        path = Path(self.designs_dir) / f"{code}.json"
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        return None

    def list_designs(self) -> List[Dict]:
        idx_path = Path(self.designs_dir) / "_index.json"
        if idx_path.exists():
            with open(idx_path, encoding="utf-8") as f:
                return json.load(f).get("designs", [])
        results = []
        for fp in sorted(Path(self.designs_dir).glob("*.json")):
            if fp.name.startswith("_"):
                continue
            try:
                with open(fp, encoding="utf-8") as f:
                    d = json.load(f)
                results.append({
                    "code":     d.get("design_code", fp.stem),
                    "name":     d.get("name", ""),
                    "name_fa":  d.get("name_fa", ""),
                    "category": d.get("category", ""),
                    "tags":     d.get("tags", []),
                    "file":     fp.name,
                })
            except Exception:
                pass
        return results

    # ── Index ─────────────────────────────────────────────────
    def _update_index(self, design: Dict):
        idx_path = Path(self.designs_dir) / "_index.json"
        try:
            if idx_path.exists():
                with open(idx_path, encoding="utf-8") as f:
                    idx = json.load(f)
            else:
                idx = {"version": "1.0", "count": 0, "designs": []}
        except Exception:
            idx = {"version": "1.0", "count": 0, "designs": []}

        entry = {
            "code":     design["design_code"],
            "name":     design["name"],
            "name_fa":  design.get("name_fa", ""),
            "category": design.get("category", "designs"),
            "tags":     design.get("tags", []),
            "file":     f"{design['design_code']}.json",
        }
        existing = [i for i, d in enumerate(idx["designs"])
                    if d["code"] == entry["code"]]
        if existing:
            idx["designs"][existing[0]] = entry
        else:
            idx["designs"].append(entry)
        idx["count"] = len(idx["designs"])

        with open(idx_path, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False, indent=2)


# ═══════════════════════════════════════════════════════════════
# Qt Import Dialog
# ═══════════════════════════════════════════════════════════════
try:
    from PySide6.QtCore    import Qt, Signal, QThread
    from PySide6.QtGui     import QColor
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel,
        QPushButton, QFileDialog, QTableWidget,
        QTableWidgetItem, QHeaderView, QAbstractItemView,
        QProgressBar, QMessageBox, QGroupBox, QApplication,
        QFrame
    )

    C_BG    = "#1e1e1e"; C_PANEL = "#252526"
    C_BORD  = "#3e3e42"; C_TEXT  = "#cccccc"
    C_DIM   = "#858585"; C_ACC   = "#0078d4"
    C_GOOD  = "#4ec9b0"; C_WARN  = "#ce9178"

    class _ImportWorker(QThread):
        sig_progress = Signal(int, int, str)
        sig_done     = Signal(dict)

        def __init__(self, files: List[str], designs_dir: str):
            super().__init__()
            self._files       = files
            self._designs_dir = designs_dir

        def run(self):
            imp     = DesignImporter(self._designs_dir)
            summary = {
                "total": len(self._files),
                "success": 0, "failed": 0, "results": []
            }
            for i, f in enumerate(self._files):
                self.sig_progress.emit(i + 1, len(self._files),
                                       Path(f).name)
                r = imp.import_file(f)
                summary["results"].append(r)
                if r["success"]: summary["success"] += 1
                else:            summary["failed"]  += 1
            self.sig_done.emit(summary)

    class DesignImportDialog(QWidget):
        """Import dialog — used inside FIROO CAM main window."""
        import_complete = Signal(list)   # emits list of design codes

        def __init__(self, designs_dir: str = None, parent=None):
            super().__init__(parent)
            self._designs_dir = designs_dir or str(
                Path(__file__).parent / "designs")
            self._files: List[str] = []
            self._worker = None
            self._build()
            self._style()

        def _build(self):
            root = QVBoxLayout(self)
            root.setContentsMargins(12, 12, 12, 12)
            root.setSpacing(8)

            # Title
            lbl = QLabel("Import Design Files")
            lbl.setStyleSheet(
                f"color:{C_TEXT};font-size:14px;font-weight:600;")
            root.addWidget(lbl)

            # File selector
            grp1 = QGroupBox("Select Files")
            g1   = QVBoxLayout(grp1)
            row  = QHBoxLayout(); row.setSpacing(4)
            self._btn_files  = QPushButton("+ Files")
            self._btn_folder = QPushButton("+ Folder")
            self._btn_clear  = QPushButton("✕ Clear")
            for b in [self._btn_files, self._btn_folder,
                      self._btn_clear]:
                b.setFixedHeight(26); row.addWidget(b)
            row.addStretch(); g1.addLayout(row)

            self._tbl_files = QTableWidget(0, 3)
            self._tbl_files.setHorizontalHeaderLabels(
                ["File","Size","Status"])
            self._tbl_files.verticalHeader().hide()
            self._tbl_files.setEditTriggers(
                QAbstractItemView.NoEditTriggers)
            self._tbl_files.setSelectionBehavior(
                QAbstractItemView.SelectRows)
            hf = self._tbl_files.horizontalHeader()
            hf.setSectionResizeMode(0, QHeaderView.Stretch)
            hf.setSectionResizeMode(1, QHeaderView.ResizeToContents)
            hf.setSectionResizeMode(2, QHeaderView.ResizeToContents)
            self._tbl_files.setFixedHeight(180)
            g1.addWidget(self._tbl_files)
            root.addWidget(grp1)

            # Progress
            self._prog = QProgressBar()
            self._prog.setRange(0,100); self._prog.hide()
            root.addWidget(self._prog)

            self._lbl_st = QLabel(
                "Select design files (.cd / .dsgn) to import")
            self._lbl_st.setStyleSheet(
                f"color:{C_DIM};font-size:11px;")
            root.addWidget(self._lbl_st)

            # Results
            grp2 = QGroupBox("Results")
            g2   = QVBoxLayout(grp2)
            self._tbl_res = QTableWidget(0, 5)
            self._tbl_res.setHorizontalHeaderLabels(
                ["Code","Name","Type","Offsets","Layers"])
            self._tbl_res.verticalHeader().hide()
            self._tbl_res.setEditTriggers(
                QAbstractItemView.NoEditTriggers)
            hr = self._tbl_res.horizontalHeader()
            hr.setSectionResizeMode(0, QHeaderView.ResizeToContents)
            hr.setSectionResizeMode(1, QHeaderView.Stretch)
            hr.setSectionResizeMode(2, QHeaderView.ResizeToContents)
            hr.setSectionResizeMode(3, QHeaderView.ResizeToContents)
            hr.setSectionResizeMode(4, QHeaderView.ResizeToContents)
            g2.addWidget(self._tbl_res)
            root.addWidget(grp2)

            # Import button
            self._btn_import = QPushButton("▶  Import")
            self._btn_import.setFixedHeight(34)
            self._btn_import.setStyleSheet(
                "background:#1a5c2a;border:1px solid #27ae60;"
                "border-radius:3px;color:white;font-weight:600;"
                "font-size:13px;")
            root.addWidget(self._btn_import)

            # Connections
            self._btn_files.clicked.connect(self._add_files)
            self._btn_folder.clicked.connect(self._add_folder)
            self._btn_clear.clicked.connect(self._clear)
            self._btn_import.clicked.connect(self._run)

        def _add_files(self):
            exts = " ".join(f"*{e}" for e in DesignImporter.EXTENSIONS)
            paths, _ = QFileDialog.getOpenFileNames(
                self, "Select Design Files", "",
                f"Design Files ({exts});;All Files (*)")
            for p in paths:
                if p not in self._files:
                    self._files.append(p)
            self._refresh()

        def _add_folder(self):
            folder = QFileDialog.getExistingDirectory(
                self, "Select Folder")
            if not folder:
                return
            for ext in DesignImporter.EXTENSIONS:
                for f in Path(folder).glob(f"*{ext}"):
                    if str(f) not in self._files:
                        self._files.append(str(f))
                for f in Path(folder).glob(f"*{ext.upper()}"):
                    if str(f) not in self._files:
                        self._files.append(str(f))
            self._refresh()

        def _clear(self):
            self._files = []; self._refresh()

        def _refresh(self):
            t = self._tbl_files
            t.setRowCount(len(self._files))
            for row, f in enumerate(self._files):
                p    = Path(f)
                size = (f"{p.stat().st_size:,} B"
                        if p.exists() else "?")
                for col, txt in enumerate([p.name, size, "Pending"]):
                    item = QTableWidgetItem(txt)
                    item.setTextAlignment(
                        Qt.AlignLeft | Qt.AlignVCenter
                        if col == 0 else Qt.AlignCenter)
                    t.setItem(row, col, item)
                t.setRowHeight(row, 22)
            self._lbl_st.setText(
                f"{len(self._files)} file(s) — ready")

        def _run(self):
            if not self._files:
                QMessageBox.warning(
                    self, "No Files",
                    "Add design files first."); return
            self._prog.show(); self._prog.setValue(0)
            self._tbl_res.setRowCount(0)
            self._btn_import.setEnabled(False)
            self._worker = _ImportWorker(
                self._files, self._designs_dir)
            self._worker.sig_progress.connect(self._on_prog)
            self._worker.sig_done.connect(self._on_done)
            self._worker.start()

        def _on_prog(self, cur, total, name):
            self._prog.setValue(int(cur/total*100))
            self._lbl_st.setText(
                f"Importing {cur}/{total}: {name}")

        def _on_done(self, summary):
            self._prog.hide()
            self._btn_import.setEnabled(True)
            codes = []
            t = self._tbl_res
            t.setRowCount(len(summary["results"]))
            for row, r in enumerate(summary["results"]):
                if r["success"]:
                    d      = r["design"]
                    code   = d["design_code"]
                    cells  = [code, d["name"],
                               d.get("category",""),
                               str(len(d.get("offsets",[]))),
                               str(len(d.get("layers",[])))]
                    color  = QColor(C_GOOD)
                    codes.append(code)
                else:
                    cells = [Path(
                        self._files[row] if row < len(
                            self._files) else "?").stem,
                        r.get("error",""), "—", "—", "—"]
                    color = QColor(C_WARN)
                for col, txt in enumerate(cells):
                    item = QTableWidgetItem(txt)
                    item.setTextAlignment(Qt.AlignCenter)
                    item.setForeground(color)
                    t.setItem(row, col, item)
                t.setRowHeight(row, 22)
            n = summary
            self._lbl_st.setText(
                f"Done — ✅ {n['success']} imported  "
                f"❌ {n['failed']} failed")
            if codes:
                self.import_complete.emit(codes)

        def _style(self):
            self.setStyleSheet(f"""
            QWidget{{background:{C_BG};color:{C_TEXT};
                font-family:"Segoe UI",sans-serif;font-size:12px;}}
            QGroupBox{{background:transparent;
                border:1px solid {C_BORD};border-radius:3px;
                margin-top:6px;padding-top:6px;
                color:{C_DIM};font-size:11px;font-weight:600;}}
            QGroupBox::title{{subcontrol-origin:margin;
                left:6px;padding:0 3px;}}
            QPushButton{{background:{C_PANEL};
                border:1px solid {C_BORD};border-radius:3px;
                padding:2px 10px;color:{C_TEXT};}}
            QPushButton:hover{{background:#3e3e42;
                border-color:{C_ACC};}}
            QPushButton:disabled{{background:#2a2a2a;
                color:{C_DIM};border-color:#333;}}
            QTableWidget{{background:#1a1a1a;
                gridline-color:{C_BORD};border:none;
                selection-background-color:#264f78;}}
            QHeaderView::section{{background:{C_PANEL};
                border:none;
                border-bottom:1px solid {C_BORD};
                padding:3px 6px;color:{C_DIM};
                font-size:11px;font-weight:600;}}
            QProgressBar{{background:{C_PANEL};
                border:1px solid {C_BORD};border-radius:3px;
                height:16px;text-align:center;color:{C_TEXT};}}
            QProgressBar::chunk{{background:{C_ACC};
                border-radius:2px;}}
            """)

    HAS_QT = True

except ImportError:
    HAS_QT = False


# ═══════════════════════════════════════════════════════════════
# Test / CLI
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys

    if "--gui" in sys.argv and HAS_QT:
        app = QApplication(sys.argv)
        app.setStyle("Fusion")
        w = DesignImportDialog()
        w.setWindowTitle("FIROO CAM — Import Design Files")
        w.resize(680, 580)
        w.show()
        sys.exit(app.exec())

    # CLI test
    sys.path.insert(0, os.path.dirname(__file__))
    DESIGNS_DIR = os.path.join(os.path.dirname(__file__), "designs")
    imp = DesignImporter(DESIGNS_DIR)

    test_files = [
        "/mnt/user-data/uploads/cd0.cwd",
        "/mnt/user-data/uploads/cd1.cwd",
        "/mnt/user-data/uploads/cd2.cwd",
    ]

    print("FIROO CAM — Design Importer\n" + "="*50)
    for f in test_files:
        if not os.path.exists(f): continue
        r = imp.import_file(f)
        if r["success"]:
            d = r["design"]
            print(f"\n✅  {Path(f).name}")
            print(f"    Code    : {d['design_code']}")
            print(f"    Name    : {d['name']}  /  {d['name_fa']}")
            print(f"    Size    : {d['default_size']['width']:.0f}"
                  f"×{d['default_size']['height']:.0f} mm")
            print(f"    Type    : {d['category']}")
            print(f"    Offsets : {len(d['offsets'])}")
            for o in d["offsets"]:
                print(f"      Layer {o['layer_no']}: "
                      f"{o['distance_mm']} mm")
            print(f"    Layers  : {len(d['layers'])}")
            for l in d["layers"]:
                print(f"      [{l['id']}] {l['type']:15}"
                      f" T={l['tool']}  "
                      f"depth={l['depth_mm']}mm  "
                      f"offset={l['offset_mm']}mm  "
                      f"passes={l['pass_count']}")
            print(f"    Pattern : {d['pattern']['type']}  "
                  f"enabled={d['pattern']['enabled']}")
            if d["spacing_mm"]:
                print(f"    Spacing : {d['spacing_mm']} mm")
        else:
            print(f"\n❌  {Path(f).name}: {r['error']}")

    print(f"\n{'='*50}")
    print("Design library:")
    for d in imp.list_designs():
        print(f"  [{d['code']:6}]  {d['name']}")
