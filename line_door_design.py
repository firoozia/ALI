"""
FIROO CAM — Line Door Design  (complete standalone door)
=========================================================
File 2 of 2: complete door design with boundary, offset rings,
and line pattern — standalone DXF + PySide6 UI.

Layers in output DXF:
  DOOR_OUTER      — door outer boundary rectangle
  DOOR_OFFSET_N   — N offset rings (inset from outer)
  LINE_DOOR       — serpentine line pattern clipped to selected ring
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from pattern_clip_engine import Entity, ClipRect, write_dxf
from line_door_pattern import LineDoorPattern, _serpentine


# ── DoorDesignParams ───────────────────────────────────────────────────────

@dataclass
class DoorDesignParams:
    # Door dimensions
    door_w:      float = 900.0
    door_h:      float = 2100.0
    # Offset rings (mm inset from outer; cumulative)
    offsets:     List[float] = field(default_factory=lambda: [40.0, 48.0, 53.0, 65.0])
    # Pattern is clipped to this ring (0-based index into offsets)
    clip_ring:   int   = 0
    # Line pattern params (from GHX sliders)
    spacing:     float = 25.2   # slider 1
    extend:      float = 26.0   # slider 2
    ratio:       float = 0.66   # slider 3
    # Output
    layer_outer:   str = "DOOR_OUTER"
    layer_pattern: str = "LINE_DOOR"


# ── LineDoorDesign ─────────────────────────────────────────────────────────

class LineDoorDesign:
    """
    Complete line-door geometry generator.

    Produces:
      1. Outer door boundary (rectangle)
      2. Offset rings (concentric inset rectangles)
      3. Line pattern (serpentine, clipped to selected ring)
    """

    def __init__(self, params: DoorDesignParams):
        self.p        = params
        self._ents: List[Entity] = []

    def build(self) -> List[Entity]:
        p = self.p
        ents: List[Entity] = []

        # ── 1. outer boundary ──────────────────────────────────────────────
        ents.append(self._rect_entity(0, 0, p.door_w, p.door_h,
                                      layer=p.layer_outer))

        # ── 2. offset rings ────────────────────────────────────────────────
        cumulative = 0.0
        ring_rects: List[ClipRect] = []
        for i, off in enumerate(p.offsets):
            cumulative += off
            xmin = cumulative
            ymin = cumulative
            xmax = p.door_w - cumulative
            ymax = p.door_h - cumulative
            if xmax <= xmin or ymax <= ymin:
                break
            lyr = f"DOOR_OFFSET_{i+1}"
            ents.append(self._rect_entity(xmin, ymin, xmax - xmin, ymax - ymin,
                                          layer=lyr))
            ring_rects.append(ClipRect(xmin, ymin, xmax, ymax))

        # ── 3. line pattern ────────────────────────────────────────────────
        ring_idx = min(p.clip_ring, len(ring_rects) - 1)
        if ring_rects:
            clip_rect = ring_rects[ring_idx]
            pat_ents  = _serpentine(
                width    = clip_rect.W,
                height   = clip_rect.H,
                spacing  = p.spacing,
                extend   = p.extend,
                origin_x = clip_rect.cx,
                origin_y = clip_rect.cy,
                layer    = p.layer_pattern,
            )
            # clip to ring boundary
            for e in pat_ents:
                ents.extend(e.clip(clip_rect, close_trimmed=False))

        self._ents = ents
        return ents

    @staticmethod
    def _rect_entity(x: float, y: float, w: float, h: float,
                     layer: str) -> Entity:
        pts = [(x, y), (x+w, y), (x+w, y+h), (x, y+h), (x, y)]
        return Entity(pts, closed=True, layer=layer)

    def write_dxf(self, path: str) -> int:
        if not self._ents:
            self.build()
        write_dxf(self._ents, path)
        return len(self._ents)

    def entity_count(self) -> int:
        return len(self._ents)


# ── PySide6 UI ─────────────────────────────────────────────────────────────

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
C_RED    = "#f85149"
C_PAT    = "#ff5722"
RING_COLORS = ["#ff3333","#3fb950","#00A3FF","#bf5af2","#ffdf00","#ff9f0a"]

STYLE = f"""
QDialog, QWidget {{ background:{C_BG}; color:{C_TEXT};
    font-family:"Segoe UI","Vazirmatn",sans-serif; font-size:12px; }}
QFrame  {{ background:{C_PANEL}; border:1px solid {C_BORDER}; border-radius:2px; }}
QLabel  {{ color:{C_TEXT}; border:none; background:transparent; }}
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
QScrollBar:vertical {{ background:{C_PANEL}; width:8px; border-radius:4px; }}
QScrollBar::handle:vertical {{ background:{C_BORDER}; border-radius:4px; min-height:24px; }}
"""


def _btn(text, primary=False, w=None, h=28):
    from PySide6.QtWidgets import QPushButton
    b = QPushButton(text)
    b.setFixedHeight(h)
    if w: b.setFixedWidth(w)
    if primary:
        b.setStyleSheet(
            f"background:{C_BLUE};color:white;border:1px solid {C_BLUE};"
            "border-radius:4px;padding:5px 12px;")
    return b

def _lbl(text, color=None, bold=False):
    from PySide6.QtWidgets import QLabel
    lb = QLabel(text)
    s  = f"color:{color or C_TEXT};border:none;background:transparent;"
    if bold: s += "font-weight:700;"
    lb.setStyleSheet(s)
    return lb

def _dspin(lo=0.0, hi=9999.0, val=0.0, suffix="", dec=1, step=1.0):
    from PySide6.QtWidgets import QDoubleSpinBox
    s = QDoubleSpinBox()
    s.setRange(lo, hi); s.setDecimals(dec); s.setValue(val)
    s.setSingleStep(step)
    if suffix: s.setSuffix(suffix)
    return s

def _hsep():
    from PySide6.QtWidgets import QFrame
    f = QFrame(); f.setFrameShape(QFrame.HLine)
    f.setFixedHeight(1)
    f.setStyleSheet(f"background:{C_BORDER};border:none;")
    return f


class _DoorCanvas:
    """Reusable painter helper — call draw() inside paintEvent."""

    def __init__(self, door_w, door_h, offsets, clip_ring, pattern_ents=None):
        self.door_w    = door_w
        self.door_h    = door_h
        self.offsets   = offsets
        self.clip_ring = clip_ring
        self.pat_ents  = pattern_ents or []

    def draw(self, painter, widget_w, widget_h):
        from PySide6.QtGui import QColor, QPen, QFont
        from PySide6.QtCore import Qt

        pad = 36
        dw, dh = self.door_w, self.door_h
        aw = max(1, widget_w - 2*pad)
        ah = max(1, widget_h - 2*pad)
        sc = min(aw/dw, ah/dh)
        ox = pad + (aw - dw*sc)/2
        oy = pad + (ah - dh*sc)/2

        def sx(x): return ox + x*sc
        def sy(y): return oy + (dh - y)*sc

        # background grid
        painter.setPen(QPen(QColor("#1a1f26"), 1))
        step = max(5, int(50*sc))
        for gx in range(0, widget_w, step):
            painter.drawLine(gx, 0, gx, widget_h)
        for gy in range(0, widget_h, step):
            painter.drawLine(0, gy, widget_w, gy)

        # door fill
        painter.fillRect(int(sx(0)), int(sy(dh)),
                         int(dw*sc), int(dh*sc), QColor("#131920"))

        # offset rings
        cumul = 0.0
        for i, off in enumerate(self.offsets):
            cumul += off
            xmin, ymin = cumul, cumul
            xmax, ymax = dw-cumul, dh-cumul
            if xmax <= xmin or ymax <= ymin: break
            color = QColor(RING_COLORS[i % len(RING_COLORS)])
            pen   = QPen(color, 1.5 if i == self.clip_ring else 0.8)
            pen.setStyle(Qt.SolidLine if i == self.clip_ring else Qt.DashLine)
            painter.setPen(pen)
            painter.drawRect(int(sx(xmin)), int(sy(ymax)),
                             int((xmax-xmin)*sc), int((ymax-ymin)*sc))

        # pattern entities
        painter.setPen(QPen(QColor(C_PAT), 0.8))
        for ent in self.pat_ents:
            pts = ent.points
            for a, b in zip(pts, pts[1:]):
                painter.drawLine(int(sx(a[0])), int(sy(a[1])),
                                 int(sx(b[0])), int(sy(b[1])))

        # door outer
        painter.setPen(QPen(QColor("#b8c1cc"), 1.5))
        painter.drawRect(int(sx(0)), int(sy(dh)), int(dw*sc), int(dh*sc))

        # dimensions
        painter.setPen(QColor(C_DIM))
        painter.setFont(QFont("Segoe UI", 8))
        painter.drawText(int(sx(dw/2))-25, int(sy(dh))-6, f"{int(dw)} mm")
        painter.save()
        painter.translate(int(sx(0))-14, int((sy(0)+sy(dh))/2))
        painter.rotate(-90)
        painter.drawText(-25, 4, f"{int(dh)} mm")
        painter.restore()


class LineDoorDesignDialog:
    """PySide6 dialog for complete line door design."""

    def __init__(self, parent=None):
        from PySide6.QtWidgets import (
            QDialog, QHBoxLayout, QVBoxLayout, QGridLayout,
            QGroupBox, QComboBox, QCheckBox, QLineEdit,
            QFrame, QFileDialog, QMessageBox, QWidget,
            QSizePolicy, QDoubleSpinBox,
        )
        from PySide6.QtCore import Qt
        from PySide6.QtGui  import QPainter, QColor

        class _Canvas(QWidget):
            def __init__(self2, parent=None):
                super().__init__(parent)
                self2.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
                self2.setMinimumSize(340, 480)
                self2._helper = None
            def set_helper(self2, h): self2._helper = h; self2.update()
            def paintEvent(self2, _):
                p = QPainter(self2)
                p.setRenderHint(QPainter.Antialiasing)
                p.fillRect(self2.rect(), QColor(C_BG))
                if self2._helper:
                    self2._helper.draw(p, self2.width(), self2.height())
                p.end()

        self._dlg = QDialog(parent)
        self._dlg.setWindowTitle("Line Door Design — V5")
        self._dlg.setModal(True)
        self._dlg.setMinimumSize(900, 640)
        self._dlg.setStyleSheet(STYLE)

        root = QHBoxLayout(self._dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── LEFT panel ────────────────────────────────────────────────────
        left = QFrame()
        left.setFixedWidth(320)
        left.setStyleSheet(
            f"background:{C_PANEL};border-right:1px solid {C_BORDER};"
            "border-top:none;border-bottom:none;border-left:none;")
        ll = QVBoxLayout(left)
        ll.setContentsMargins(12,12,12,12); ll.setSpacing(8)

        hdr = _lbl("  Line Door Design", C_ACCENT, bold=True)
        hdr.setStyleSheet(
            f"color:{C_ACCENT};font-weight:700;font-size:13px;"
            "background:transparent;border:none;")
        ll.addWidget(hdr)
        ll.addWidget(_hsep())

        # Door dimensions
        grp_door = QGroupBox("Door Dimensions")
        gd = QGridLayout(grp_door)
        gd.setSpacing(6)
        self._dw = _dspin(100, 5000, 900, " mm", dec=0, step=10)
        self._dh = _dspin(100, 5000, 2100, " mm", dec=0, step=10)
        gd.addWidget(_lbl("Width"),  0, 0); gd.addWidget(self._dw, 0, 1)
        gd.addWidget(_lbl("Height"), 1, 0); gd.addWidget(self._dh, 1, 1)
        ll.addWidget(grp_door)

        # Offset rings
        grp_off = QGroupBox("Offset Rings  (cumulative mm)")
        go = QGridLayout(grp_off)
        go.setSpacing(6)
        self._offs: List[QDoubleSpinBox] = []
        colors = RING_COLORS
        for i in range(4):
            sp = _dspin(0, 500, [40,48,53,65][i], " mm", dec=1, step=1)
            lbl_w = QWidget()
            lbl_lay = QHBoxLayout(lbl_w)
            lbl_lay.setContentsMargins(0,0,0,0)
            dot = QLabel("●")
            dot.setStyleSheet(f"color:{colors[i]};border:none;background:transparent;font-size:10px;")
            lbl_lay.addWidget(dot)
            lbl_lay.addWidget(_lbl(f"Ring {i+1}"))
            lbl_lay.addStretch()
            go.addWidget(lbl_w, i, 0); go.addWidget(sp, i, 1)
            self._offs.append(sp)
        ll.addWidget(grp_off)

        # Clip ring selector
        grp_clip = QGroupBox("Pattern Clip Target")
        gc = QGridLayout(grp_clip)
        gc.setSpacing(6)
        self._clip_ring = QComboBox()
        for i in range(4):
            self._clip_ring.addItem(f"Ring {i+1}", i)
        self._clip_ring.setCurrentIndex(0)
        gc.addWidget(_lbl("Clip to Ring"), 0, 0)
        gc.addWidget(self._clip_ring, 0, 1)
        ll.addWidget(grp_clip)

        # Pattern params
        grp_pat = QGroupBox("Line Pattern  (GHX sliders)")
        gp = QGridLayout(grp_pat)
        gp.setSpacing(6)
        self._spacing = _dspin(1, 500, 25.2, " mm", dec=1, step=0.5)
        self._extend  = _dspin(0, 200, 26.0, " mm", dec=1, step=1)
        self._ratio   = _dspin(0, 1,    0.66, "",   dec=2, step=0.01)
        gp.addWidget(_lbl("Spacing"),  0, 0); gp.addWidget(self._spacing, 0, 1)
        gp.addWidget(_lbl("Extend"),   1, 0); gp.addWidget(self._extend,  1, 1)
        gp.addWidget(_lbl("Ratio"),    2, 0); gp.addWidget(self._ratio,   2, 1)
        ll.addWidget(grp_pat)

        ll.addStretch(1)
        ll.addWidget(_hsep())

        # buttons
        br = QHBoxLayout()
        self._btn_prev = _btn("Preview", w=90, h=32)
        self._btn_save = _btn("Save DXF", primary=True, w=110, h=32)
        self._btn_cancel = _btn("Cancel", w=80, h=32)
        br.addWidget(self._btn_prev)
        br.addStretch()
        br.addWidget(self._btn_save)
        br.addWidget(self._btn_cancel)
        ll.addLayout(br)

        # ── RIGHT panel ───────────────────────────────────────────────────
        right = QFrame()
        right.setStyleSheet(f"background:{C_BG};border:none;")
        rl = QVBoxLayout(right)
        rl.setContentsMargins(0,0,0,0); rl.setSpacing(0)

        bar = QFrame()
        bar.setFixedHeight(36)
        bar.setStyleSheet(
            f"background:{C_PANEL2};border-bottom:1px solid {C_BORDER};"
            "border-top:none;border-left:none;border-right:none;")
        bl = QHBoxLayout(bar); bl.setContentsMargins(10,0,10,0)
        bl.addWidget(_lbl("Preview", C_ACCENT, bold=True))
        bl.addStretch()
        self._status = _lbl("—", C_DIM)
        bl.addWidget(self._status)
        rl.addWidget(bar)

        self._canvas = _Canvas()
        rl.addWidget(self._canvas, 1)

        root.addWidget(left, 0)
        root.addWidget(right, 1)

        # wire signals
        self._btn_prev.clicked.connect(self._preview)
        self._btn_save.clicked.connect(self._save)
        self._btn_cancel.clicked.connect(self._dlg.reject)
        self._design: Optional[LineDoorDesign] = None
        self._preview()

    # ── helpers ───────────────────────────────────────────────────────────

    def _make_params(self) -> DoorDesignParams:
        return DoorDesignParams(
            door_w    = self._dw.value(),
            door_h    = self._dh.value(),
            offsets   = [s.value() for s in self._offs],
            clip_ring = self._clip_ring.currentData(),
            spacing   = self._spacing.value(),
            extend    = self._extend.value(),
            ratio     = self._ratio.value(),
        )

    def _preview(self):
        p = self._make_params()
        d = LineDoorDesign(p)
        d.build()
        self._design = d

        # extract pattern entities for canvas
        pat_ents = [e for e in d._ents if e.layer == p.layer_pattern]
        helper   = _DoorCanvas(p.door_w, p.door_h, p.offsets,
                               p.clip_ring, pat_ents)
        self._canvas.set_helper(helper)

        n_pat = len(pat_ents)
        self._status.setText(f"{d.entity_count()} entities  ({n_pat} pattern)")
        self._status.setStyleSheet(
            f"color:{C_GREEN};border:none;background:transparent;")

    def _save(self):
        from PySide6.QtWidgets import QFileDialog, QMessageBox
        p = self._make_params()
        if self._design is None:
            self._design = LineDoorDesign(p)
            self._design.build()

        out, _ = QFileDialog.getSaveFileName(
            self._dlg, "Save Line Door DXF", "line_door.dxf",
            "DXF Files (*.dxf)")
        if not out:
            return
        try:
            n = self._design.write_dxf(out)
            QMessageBox.information(self._dlg, "Saved",
                f"{n} entities saved\n→ {out}")
        except Exception as exc:
            QMessageBox.critical(self._dlg, "Error", str(exc))

    def exec(self) -> int:
        return self._dlg.exec()


# ── standalone runner ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    # ── headless DXF test ──────────────────────────────────────────────────
    p = DoorDesignParams(
        door_w=900, door_h=2100,
        offsets=[40.0, 48.0, 53.0, 65.0],
        clip_ring=0,
        spacing=25.2, extend=26.0, ratio=0.66,
    )
    d = LineDoorDesign(p)
    ents = d.build()
    d.write_dxf("/tmp/line_door_full.dxf")

    layers = {}
    for e in ents:
        layers[e.layer] = layers.get(e.layer, 0) + 1
    print("Line Door Design — complete DXF")
    print(f"Total entities: {len(ents)}")
    for lyr, cnt in sorted(layers.items()):
        print(f"  {lyr:20} {cnt} entities")
    print("DXF → /tmp/line_door_full.dxf")

    # ── SVG preview ────────────────────────────────────────────────────────
    pad, scale = 40, 0.15
    dw, dh = p.door_w, p.door_h
    sw = int((dw + 2*pad)*scale); sh = int((dh + 2*pad)*scale)

    def sx(x): return (x + pad)*scale
    def sy(y): return (dh + pad - y)*scale

    segs = [
        f'<rect x="{sx(0):.1f}" y="{sy(dh):.1f}" '
        f'width="{dw*scale:.1f}" height="{dh*scale:.1f}" '
        f'fill="#131920" stroke="#b8c1cc" stroke-width="1.5"/>'
    ]
    cumul = 0.0
    for i, off in enumerate(p.offsets):
        cumul += off
        xmn, ymn = cumul, cumul; xmx, ymx = dw-cumul, dh-cumul
        if xmx <= xmn or ymx <= ymn: break
        color = RING_COLORS[i % len(RING_COLORS)]
        dash  = "none" if i == p.clip_ring else "3,2"
        sw2   = 1.2 if i == p.clip_ring else 0.7
        segs.append(
            f'<rect x="{sx(xmn):.1f}" y="{sy(ymx):.1f}" '
            f'width="{(xmx-xmn)*scale:.1f}" height="{(ymx-ymn)*scale:.1f}" '
            f'fill="none" stroke="{color}" stroke-width="{sw2}" '
            f'stroke-dasharray="{dash}"/>')
    for e in ents:
        if e.layer != p.layer_pattern: continue
        for a, b in zip(e.points, e.points[1:]):
            is_bridge = abs(a[0]-b[0]) > 0.01
            color = C_YELLOW if is_bridge else C_PAT
            w2    = "1.2" if is_bridge else "0.7"
            segs.append(
                f'<line x1="{sx(a[0]):.1f}" y1="{sy(a[1]):.1f}" '
                f'x2="{sx(b[0]):.1f}" y2="{sy(b[1]):.1f}" '
                f'stroke="{color}" stroke-width="{w2}"/>')

    svg = (
        '<?xml version="1.0"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{sw}" height="{sh}" style="background:{C_BG}">\n'
        + "\n".join(segs) + "\n</svg>"
    )
    with open("/tmp/line_door_full.svg", "w") as f: f.write(svg)
    print("SVG  → /tmp/line_door_full.svg")

    # ── launch UI if possible ──────────────────────────────────────────────
    if "--ui" in sys.argv:
        from PySide6.QtWidgets import QApplication
        app = QApplication(sys.argv)
        dlg = LineDoorDesignDialog()
        dlg.exec()
