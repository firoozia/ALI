"""
FIROO CAM — Pattern Clip Dialog  (Engine 3 V5)
================================================
DXF pattern → Scale / Rotate / Center → Clip to offset ring → DXF output

UI controls:
  • DXF Input          – file picker
  • Trim Offset Ring   – which offset ring to clip against
  • Scale X / Scale Y  – with Link Scale toggle
  • Rotation           – degrees
  • Offset X / Y       – position shift from door center
  • Close Trimmed      – reconnect cut curves along boundary
  • Layer ID           – output layer name
  • Save With Door     – include door geometry in output
"""
from __future__ import annotations
import math
from pathlib import Path
from typing import List, Optional

from PySide6.QtCore    import Qt, QThread, Signal
from PySide6.QtGui     import QColor, QPainter, QPen, QBrush, QFont
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QVBoxLayout, QGridLayout,
    QGroupBox, QLabel, QLineEdit, QComboBox, QCheckBox,
    QPushButton, QFrame, QFileDialog, QSizePolicy,
    QDoubleSpinBox, QSpinBox, QMessageBox, QWidget,
)

from pattern_clip_engine import (
    parse_dxf, write_dxf, PatternClipper, ClipParams, ClipRect, Entity,
)

# ── Palette (shared with firoo_cam_ui) ─────────────────────────────────────
C_BG     = "#0d1117"
C_PANEL  = "#161b22"
C_PANEL2 = "#21262d"
C_BORDER = "#30363d"
C_TEXT   = "#e6edf3"
C_DIM    = "#8b949e"
C_BLUE   = "#1f6feb"
C_ACCENT = "#58a6ff"
C_GREEN  = "#3fb950"
C_ORANGE = "#f78166"
C_YELLOW = "#e3b341"
C_RED    = "#f85149"
C_PAT    = "#ff5722"
RING_COLORS = ["#ff3333", "#3fb950", "#00A3FF", "#bf5af2", "#ffdf00", "#ff9f0a"]

STYLE = f"""
QDialog, QWidget {{ background:{C_BG}; color:{C_TEXT};
    font-family:"Segoe UI","Vazirmatn",sans-serif; font-size:12px; }}
QFrame {{ background:{C_PANEL}; border:1px solid {C_BORDER}; border-radius:2px; }}
QLabel {{ color:{C_TEXT}; border:none; background:transparent; }}
QLineEdit, QDoubleSpinBox, QSpinBox, QComboBox {{
    background:#111820; color:{C_TEXT}; border:1px solid {C_BORDER};
    border-radius:3px; padding:4px; min-height:24px; }}
QLineEdit:focus, QDoubleSpinBox:focus, QSpinBox:focus, QComboBox:focus {{
    border-color:{C_ACCENT}; }}
QPushButton {{
    background:{C_PANEL2}; color:{C_TEXT}; border:1px solid {C_BORDER};
    border-radius:4px; padding:5px 12px; min-height:28px; }}
QPushButton:hover  {{ border-color:{C_ACCENT}; background:#26313a; }}
QPushButton:pressed {{ background:{C_BLUE}; }}
QGroupBox {{
    color:{C_YELLOW}; border:1px solid {C_BORDER}; border-radius:4px;
    margin-top:8px; padding-top:6px; font-weight:700; font-size:11px; }}
QGroupBox::title {{ subcontrol-origin:margin; left:10px; padding:0 5px; }}
QCheckBox {{ background:transparent; border:none; spacing:6px; }}
QComboBox::drop-down {{ border:none; }}
QComboBox QAbstractItemView {{
    background:#111820; color:{C_TEXT}; border:1px solid {C_BORDER};
    selection-background-color:{C_BLUE}; }}
"""


# ── helpers ────────────────────────────────────────────────────────────────

def _btn(text: str, primary=False, w=None, h=28) -> QPushButton:
    b = QPushButton(text)
    b.setFixedHeight(h)
    if w:
        b.setFixedWidth(w)
    if primary:
        b.setStyleSheet(
            f"background:{C_BLUE};color:white;border:1px solid {C_BLUE};"
            "border-radius:4px;padding:5px 12px;"
        )
    return b


def _lbl(text: str, color=None, bold=False) -> QLabel:
    lb = QLabel(text)
    s  = f"color:{color or C_TEXT};border:none;background:transparent;"
    if bold:
        s += "font-weight:700;"
    lb.setStyleSheet(s)
    return lb


def _dspin(lo=0.0, hi=9999.0, val=0.0, suffix="", dec=2, step=1.0) -> QDoubleSpinBox:
    s = QDoubleSpinBox()
    s.setRange(lo, hi)
    s.setDecimals(dec)
    s.setValue(val)
    s.setSingleStep(step)
    if suffix:
        s.setSuffix(suffix)
    return s


def _hsep() -> QFrame:
    f = QFrame()
    f.setFrameShape(QFrame.HLine)
    f.setFixedHeight(1)
    f.setStyleSheet(f"background:{C_BORDER};border:none;")
    return f


# ── Preview Canvas ─────────────────────────────────────────────────────────

class _PreviewCanvas(QWidget):
    """Renders clip rect + clipped pattern entities."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMinimumSize(360, 480)
        self._entities:  List[Entity]   = []
        self._clip_rect: Optional[ClipRect] = None
        self._door_w = 900.0
        self._door_h = 2100.0
        self._offset_rings: List[float] = []

    def set_data(self, entities: List[Entity], clip_rect: ClipRect,
                 door_w: float, door_h: float,
                 offset_rings: Optional[List[float]] = None) -> None:
        self._entities   = entities
        self._clip_rect  = clip_rect
        self._door_w     = door_w
        self._door_h     = door_h
        self._offset_rings = offset_rings or []
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), QColor(C_BG))

        pad = 32
        dw = self._door_w
        dh = self._door_h
        aw = max(1, self.width()  - 2 * pad)
        ah = max(1, self.height() - 2 * pad)
        sc = min(aw / dw, ah / dh)
        ox = pad + (aw - dw * sc) / 2
        oy = pad + (ah - dh * sc) / 2

        def sx(x): return ox + x * sc
        def sy(y): return oy + (dh - y) * sc

        # grid
        p.setPen(QPen(QColor("#1a1f26"), 1))
        step = max(5, int(50 * sc))
        for gx in range(0, self.width(), step):
            p.drawLine(gx, 0, gx, self.height())
        for gy in range(0, self.height(), step):
            p.drawLine(0, gy, self.width(), gy)

        # door body
        p.fillRect(
            int(sx(0)), int(sy(dh)),
            int(dw * sc), int(dh * sc),
            QColor("#131920"),
        )

        # offset rings
        for i, off in enumerate(self._offset_rings):
            color = QColor(RING_COLORS[i % len(RING_COLORS)])
            pen = QPen(color, 1.2)
            pen.setStyle(Qt.DashLine if i % 2 else Qt.SolidLine)
            p.setPen(pen)
            p.drawRect(
                int(sx(off)), int(sy(dh - off)),
                int((dw - 2 * off) * sc),
                int((dh - 2 * off) * sc),
            )

        # clip rect highlight
        if self._clip_rect:
            r = self._clip_rect
            pen = QPen(QColor(C_ACCENT), 1.5)
            pen.setStyle(Qt.DotLine)
            p.setPen(pen)
            p.drawRect(
                int(sx(r.xmin)), int(sy(r.ymax)),
                int(r.W * sc), int(r.H * sc),
            )

        # pattern entities
        pen_pat = QPen(QColor(C_PAT), 0.9)
        p.setPen(pen_pat)
        for ent in self._entities:
            pts = ent.points
            if len(pts) < 2:
                continue
            for a, b in zip(pts, pts[1:]):
                p.drawLine(
                    int(sx(a[0])), int(sy(a[1])),
                    int(sx(b[0])), int(sy(b[1])),
                )

        # door border
        p.setPen(QPen(QColor("#b8c1cc"), 1.5))
        p.drawRect(
            int(sx(0)), int(sy(dh)),
            int(dw * sc), int(dh * sc),
        )

        # stats
        p.setPen(QColor(C_DIM))
        p.setFont(QFont("Segoe UI", 8))
        p.drawText(pad, self.height() - 8,
                   f"entities: {len(self._entities)}  |  "
                   f"door: {int(dw)}×{int(dh)} mm")
        p.end()


# ── Worker thread ──────────────────────────────────────────────────────────

class _ClipWorker(QThread):
    done  = Signal(list)    # List[Entity]
    error = Signal(str)

    def __init__(self, dxf_path: str, params: ClipParams, parent=None):
        super().__init__(parent)
        self._path   = dxf_path
        self._params = params

    def run(self):
        try:
            clipper = PatternClipper.from_dxf(self._path, self._params)
            result  = clipper.run()
            self.done.emit(result)
        except Exception as exc:
            self.error.emit(str(exc))


# ── Main Dialog ────────────────────────────────────────────────────────────

class PatternClipDialog(QDialog):
    """Pattern Clip Engine — full UI dialog."""

    def __init__(self,
                 door_w: float = 900.0,
                 door_h: float = 2100.0,
                 offset_rings: Optional[List[float]] = None,
                 parent=None):
        super().__init__(parent)
        self._door_w       = door_w
        self._door_h       = door_h
        self._offset_rings = offset_rings or [40.0, 48.0, 53.0, 65.0]
        self._worker: Optional[_ClipWorker] = None
        self._result: List[Entity] = []

        self.setWindowTitle("Pattern Clip Engine — V5")
        self.setModal(True)
        self.setMinimumSize(880, 620)
        self.setStyleSheet(STYLE)
        self._build()

    # ── layout ────────────────────────────────────────────────────────────

    def _build(self):
        root = QHBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        root.addWidget(self._build_left(), 0)
        root.addWidget(self._build_right(), 1)

    def _build_left(self) -> QFrame:
        panel = QFrame()
        panel.setFixedWidth(310)
        panel.setStyleSheet(
            f"background:{C_PANEL};border-right:1px solid {C_BORDER};"
            "border-top:none;border-bottom:none;border-left:none;"
        )
        lay = QVBoxLayout(panel)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(8)

        # header
        hdr = _lbl("  Pattern Clip Engine", C_ACCENT, bold=True)
        hdr.setStyleSheet(
            f"color:{C_ACCENT};font-weight:700;font-size:13px;"
            "background:transparent;border:none;"
        )
        lay.addWidget(hdr)
        lay.addWidget(_hsep())

        # ── DXF input ─────────────────────────────────────────────────────
        grp_in = QGroupBox("DXF Input")
        gl_in  = QGridLayout(grp_in)
        gl_in.setSpacing(6)

        self._dxf_path = QLineEdit()
        self._dxf_path.setPlaceholderText("Select pattern .dxf …")
        self._dxf_path.setReadOnly(True)
        self._btn_browse = _btn("…", w=32)
        self._btn_browse.clicked.connect(self._browse_dxf)

        gl_in.addWidget(_lbl("File"), 0, 0)
        gl_in.addWidget(self._dxf_path, 0, 1)
        gl_in.addWidget(self._btn_browse, 0, 2)
        lay.addWidget(grp_in)

        # ── Clip Settings ─────────────────────────────────────────────────
        grp_clip = QGroupBox("Clip Settings")
        gl_clip  = QGridLayout(grp_clip)
        gl_clip.setSpacing(6)

        self._ring_combo = QComboBox()
        for i, off in enumerate(self._offset_rings):
            color = RING_COLORS[i % len(RING_COLORS)]
            self._ring_combo.addItem(f"Ring {i+1}  (offset {off:.0f} mm)", off)
        self._ring_combo.setCurrentIndex(0)

        gl_clip.addWidget(_lbl("Offset Ring"), 0, 0)
        gl_clip.addWidget(self._ring_combo, 0, 1, 1, 2)
        lay.addWidget(grp_clip)

        # ── Transform ─────────────────────────────────────────────────────
        grp_xf = QGroupBox("Transform  (no auto-scale)")
        gl_xf  = QGridLayout(grp_xf)
        gl_xf.setSpacing(6)

        self._scale_x = _dspin(0.01, 100.0, 1.0, " ×", dec=3, step=0.05)
        self._scale_y = _dspin(0.01, 100.0, 1.0, " ×", dec=3, step=0.05)
        self._link_scale = QCheckBox("Link X/Y")
        self._link_scale.setChecked(True)
        self._scale_x.valueChanged.connect(self._on_scale_x_changed)
        self._scale_y.valueChanged.connect(self._on_scale_y_changed)

        self._rotation = _dspin(-360.0, 360.0, 0.0, " °", dec=1, step=1.0)

        self._offset_x = _dspin(-5000.0, 5000.0, 0.0, " mm", dec=1, step=5.0)
        self._offset_y = _dspin(-5000.0, 5000.0, 0.0, " mm", dec=1, step=5.0)

        gl_xf.addWidget(_lbl("Scale X"), 0, 0)
        gl_xf.addWidget(self._scale_x, 0, 1)
        gl_xf.addWidget(self._link_scale, 0, 2)
        gl_xf.addWidget(_lbl("Scale Y"), 1, 0)
        gl_xf.addWidget(self._scale_y, 1, 1)
        gl_xf.addWidget(_lbl("Rotation"), 2, 0)
        gl_xf.addWidget(self._rotation, 2, 1, 1, 2)
        gl_xf.addWidget(_lbl("Offset X"), 3, 0)
        gl_xf.addWidget(self._offset_x, 3, 1, 1, 2)
        gl_xf.addWidget(_lbl("Offset Y"), 4, 0)
        gl_xf.addWidget(self._offset_y, 4, 1, 1, 2)
        lay.addWidget(grp_xf)

        # ── Output Settings ───────────────────────────────────────────────
        grp_out = QGroupBox("Output Settings")
        gl_out  = QGridLayout(grp_out)
        gl_out.setSpacing(6)

        self._close_trimmed = QCheckBox("Close Trimmed Curves")
        self._close_trimmed.setChecked(True)

        self._layer_id = QLineEdit("PATTERN_CLIP")

        self._save_with_door = QCheckBox("Save With Door Model")
        self._save_with_door.setChecked(True)

        gl_out.addWidget(self._close_trimmed, 0, 0, 1, 2)
        gl_out.addWidget(_lbl("Layer ID"), 1, 0)
        gl_out.addWidget(self._layer_id, 1, 1)
        gl_out.addWidget(self._save_with_door, 2, 0, 1, 2)
        lay.addWidget(grp_out)

        lay.addStretch(1)
        lay.addWidget(_hsep())

        # ── action buttons ────────────────────────────────────────────────
        btn_row = QHBoxLayout()
        self._btn_preview = _btn("Preview", w=90, h=32)
        self._btn_run     = _btn("Run & Save", primary=True, w=110, h=32)
        self._btn_cancel  = _btn("Cancel", w=80, h=32)

        self._btn_preview.clicked.connect(self._on_preview)
        self._btn_run.clicked.connect(self._on_run)
        self._btn_cancel.clicked.connect(self.reject)

        btn_row.addWidget(self._btn_preview)
        btn_row.addStretch()
        btn_row.addWidget(self._btn_run)
        btn_row.addWidget(self._btn_cancel)
        lay.addLayout(btn_row)

        return panel

    def _build_right(self) -> QFrame:
        panel = QFrame()
        panel.setStyleSheet(
            f"background:{C_BG};border:none;"
        )
        lay = QVBoxLayout(panel)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # toolbar
        bar = QFrame()
        bar.setFixedHeight(36)
        bar.setStyleSheet(
            f"background:{C_PANEL2};border-bottom:1px solid {C_BORDER};"
            "border-top:none;border-left:none;border-right:none;"
        )
        bar_lay = QHBoxLayout(bar)
        bar_lay.setContentsMargins(10, 0, 10, 0)
        bar_lay.addWidget(_lbl("Preview", C_ACCENT, bold=True))
        bar_lay.addStretch()
        self._status_lbl = _lbl("—", C_DIM)
        bar_lay.addWidget(self._status_lbl)
        lay.addWidget(bar)

        # canvas
        self._canvas = _PreviewCanvas()
        self._canvas.set_data([], None, self._door_w, self._door_h,
                              self._offset_rings)
        lay.addWidget(self._canvas, 1)

        return panel

    # ── slots ──────────────────────────────────────────────────────────────

    def _browse_dxf(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open Pattern DXF", "", "DXF Files (*.dxf);;All Files (*)"
        )
        if path:
            self._dxf_path.setText(path)

    def _on_scale_x_changed(self, val: float):
        if self._link_scale.isChecked():
            self._scale_y.blockSignals(True)
            self._scale_y.setValue(val)
            self._scale_y.blockSignals(False)

    def _on_scale_y_changed(self, val: float):
        if self._link_scale.isChecked():
            self._scale_x.blockSignals(True)
            self._scale_x.setValue(val)
            self._scale_x.blockSignals(False)

    def _build_params(self) -> Optional[ClipParams]:
        ring_off = self._ring_combo.currentData()
        if ring_off is None:
            return None
        xmin = ring_off
        ymin = ring_off
        xmax = self._door_w - ring_off
        ymax = self._door_h - ring_off
        rect = ClipRect(xmin, ymin, xmax, ymax)
        return ClipParams(
            clip_rect      = rect,
            door_w         = self._door_w,
            door_h         = self._door_h,
            scale_x        = self._scale_x.value(),
            scale_y        = self._scale_y.value(),
            rotation       = self._rotation.value(),
            offset_x       = self._offset_x.value(),
            offset_y       = self._offset_y.value(),
            close_trimmed  = self._close_trimmed.isChecked(),
            layer_id       = self._layer_id.text().strip() or "PATTERN_CLIP",
            save_with_door = self._save_with_door.isChecked(),
        )

    def _on_preview(self):
        dxf_path = self._dxf_path.text().strip()
        if not dxf_path:
            QMessageBox.warning(self, "No Input", "Please select a DXF pattern file.")
            return
        params = self._build_params()
        if params is None:
            return
        self._set_busy(True)
        self._worker = _ClipWorker(dxf_path, params, self)
        self._worker.done.connect(self._on_preview_done)
        self._worker.error.connect(self._on_worker_error)
        self._worker.start()

    def _on_preview_done(self, entities: List[Entity]):
        self._result = entities
        ring_off = self._ring_combo.currentData() or 0.0
        rect = ClipRect(
            ring_off, ring_off,
            self._door_w - ring_off,
            self._door_h - ring_off,
        )
        self._canvas.set_data(
            entities, rect,
            self._door_w, self._door_h,
            self._offset_rings,
        )
        self._status_lbl.setText(
            f"{len(entities)} entities clipped"
        )
        self._status_lbl.setStyleSheet(f"color:{C_GREEN};border:none;background:transparent;")
        self._set_busy(False)

    def _on_worker_error(self, msg: str):
        self._set_busy(False)
        QMessageBox.critical(self, "Clip Error", msg)

    def _on_run(self):
        dxf_path = self._dxf_path.text().strip()
        if not dxf_path:
            QMessageBox.warning(self, "No Input", "Please select a DXF pattern file.")
            return
        params = self._build_params()
        if params is None:
            return

        out_path, _ = QFileDialog.getSaveFileName(
            self, "Save Clipped DXF", "", "DXF Files (*.dxf)"
        )
        if not out_path:
            return

        self._set_busy(True)
        self._worker = _ClipWorker(dxf_path, params, self)
        self._worker.done.connect(lambda ents: self._on_run_done(ents, out_path))
        self._worker.error.connect(self._on_worker_error)
        self._worker.start()

    def _on_run_done(self, entities: List[Entity], out_path: str):
        self._result = entities
        try:
            write_dxf(entities, out_path)
        except Exception as exc:
            self._set_busy(False)
            QMessageBox.critical(self, "Save Error", str(exc))
            return

        # update preview
        ring_off = self._ring_combo.currentData() or 0.0
        rect = ClipRect(
            ring_off, ring_off,
            self._door_w - ring_off,
            self._door_h - ring_off,
        )
        self._canvas.set_data(
            entities, rect,
            self._door_w, self._door_h,
            self._offset_rings,
        )
        self._status_lbl.setText(
            f"Saved {len(entities)} entities → {Path(out_path).name}"
        )
        self._status_lbl.setStyleSheet(
            f"color:{C_GREEN};border:none;background:transparent;"
        )
        self._set_busy(False)
        QMessageBox.information(
            self, "Done",
            f"Clipped {len(entities)} entities\n→ {out_path}"
        )

    def _set_busy(self, busy: bool):
        self._btn_preview.setEnabled(not busy)
        self._btn_run.setEnabled(not busy)
        if busy:
            self._status_lbl.setText("Running …")
            self._status_lbl.setStyleSheet(
                f"color:{C_YELLOW};border:none;background:transparent;"
            )

    def get_result(self) -> List[Entity]:
        return self._result


# ── standalone runner ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    from PySide6.QtWidgets import QApplication
    app = QApplication(sys.argv)
    dlg = PatternClipDialog(
        door_w=900.0,
        door_h=2100.0,
        offset_rings=[40.0, 48.0, 53.0, 65.0],
    )
    dlg.show()
    sys.exit(app.exec())
