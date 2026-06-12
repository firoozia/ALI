"""
FIROO CAM v3 — Full UI Shell (runnable, no logic yet)
Run: python firoo_cam_ui.py
"""
from __future__ import annotations
import sys
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QFrame, QLabel, QPushButton,
    QLineEdit, QDoubleSpinBox, QSpinBox, QComboBox, QTextEdit, QCheckBox,
    QTableWidget, QTableWidgetItem, QHeaderView, QTreeWidget, QTreeWidgetItem,
    QVBoxLayout, QHBoxLayout, QGridLayout, QSplitter, QTabWidget, QGroupBox,
    QScrollArea, QSizePolicy, QStackedWidget, QMenuBar, QStatusBar,
)
from PySide6.QtCore import Qt, QTimer, QSize
from PySide6.QtGui import QColor, QPainter, QPen, QPixmap, QFont, QBrush, QIcon

# ── Palette ────────────────────────────────────────────────────────────────────
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
RING_COLORS = ["#ff3333","#3fb950","#00A3FF","#bf5af2","#ffdf00","#ff9f0a"]

STYLE = f"""
QMainWindow, QWidget, QDialog {{
    background: {C_BG}; color: {C_TEXT};
    font-family: "Segoe UI", "Vazirmatn", sans-serif; font-size: 12px;
}}
QFrame {{
    background: {C_PANEL}; border: 1px solid {C_BORDER}; border-radius: 2px;
}}
QLabel {{
    color: {C_TEXT}; border: none; background: transparent;
}}
QLineEdit, QTextEdit, QDoubleSpinBox, QSpinBox, QComboBox {{
    background: #111820; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 3px; padding: 4px; min-height: 24px;
}}
QLineEdit:focus, QDoubleSpinBox:focus, QSpinBox:focus, QComboBox:focus {{
    border-color: {C_ACCENT};
}}
QPushButton {{
    background: {C_PANEL2}; color: {C_TEXT}; border: 1px solid {C_BORDER};
    border-radius: 4px; padding: 5px 12px; min-height: 28px;
}}
QPushButton:hover  {{ border-color: {C_ACCENT}; background: #26313a; }}
QPushButton:pressed {{ background: {C_BLUE}; }}
QPushButton[primary=true] {{
    background: {C_BLUE}; color: white; border-color: {C_BLUE};
}}
QPushButton[primary=true]:hover {{ background: #388bfd; }}
QTabWidget::pane {{
    border: 1px solid {C_BORDER}; background: {C_PANEL};
}}
QTabBar::tab {{
    background: {C_PANEL2}; color: {C_DIM}; padding: 8px 18px;
    border: 1px solid {C_BORDER}; border-bottom: none; margin-right: 2px;
}}
QTabBar::tab:selected {{ background: {C_BG}; color: {C_ACCENT}; border-bottom: 2px solid {C_ACCENT}; font-weight: 700; }}
QTabBar::tab:hover {{ color: {C_TEXT}; }}
QTableWidget {{
    background: #111820; color: {C_TEXT}; gridline-color: {C_BORDER};
    selection-background-color: {C_BLUE};
    alternate-background-color: #151d25; border: 1px solid {C_BORDER};
}}
QHeaderView::section {{
    background: #26313a; color: {C_TEXT}; padding: 5px 8px;
    border: 1px solid {C_BORDER}; font-weight: 600;
}}
QTreeWidget {{
    background: {C_PANEL}; color: {C_TEXT}; border: none;
    outline: none;
}}
QTreeWidget::item {{ padding: 4px 4px; }}
QTreeWidget::item:selected {{ background: {C_BLUE}; color: white; border-radius: 3px; }}
QTreeWidget::item:hover {{ background: #1c2128; }}
QCheckBox {{ background: transparent; border: none; spacing: 6px; }}
QGroupBox {{
    color: {C_YELLOW}; border: 1px solid {C_BORDER}; border-radius: 4px;
    margin-top: 8px; padding-top: 6px; font-weight: 700; font-size: 11px;
}}
QGroupBox::title {{
    subcontrol-origin: margin; left: 10px; padding: 0 5px;
}}
QScrollBar:vertical {{
    background: {C_PANEL}; width: 8px; border-radius: 4px;
}}
QScrollBar::handle:vertical {{
    background: {C_BORDER}; border-radius: 4px; min-height: 24px;
}}
QSplitter::handle {{ background: {C_BORDER}; }}
QComboBox::drop-down {{ border: none; }}
QComboBox QAbstractItemView {{
    background: #111820; color: {C_TEXT}; border: 1px solid {C_BORDER};
    selection-background-color: {C_BLUE};
}}
"""

# ── Helpers ────────────────────────────────────────────────────────────────────

def btn(text, primary=False, w=None, h=28):
    b = QPushButton(text)
    b.setFixedHeight(h)
    if w: b.setFixedWidth(w)
    if primary:
        b.setProperty("primary", True)
        b.style().unpolish(b); b.style().polish(b)
        b.setStyleSheet(f"background:{C_BLUE};color:white;border:1px solid {C_BLUE};border-radius:4px;padding:5px 12px;")
    return b

def lbl(text, color=None, bold=False, size=None, align=None):
    l = QLabel(text)
    s = f"color:{color or C_TEXT};border:none;background:transparent;"
    if bold: s += "font-weight:700;"
    if size: s += f"font-size:{size}px;"
    l.setStyleSheet(s)
    if align: l.setAlignment(align)
    return l

def hdr_lbl(text, color=None):
    return lbl(text, color or C_ACCENT, bold=True, size=11)

def vsep():
    f = QFrame(); f.setFrameShape(QFrame.VLine)
    f.setFixedWidth(1)
    f.setStyleSheet(f"background:{C_BORDER};border:none;")
    return f

def hsep():
    f = QFrame(); f.setFrameShape(QFrame.HLine)
    f.setFixedHeight(1)
    f.setStyleSheet(f"background:{C_BORDER};border:none;")
    return f

def dspin(lo=0, hi=9999, val=0, suffix="", dec=1):
    s = QDoubleSpinBox()
    s.setRange(lo, hi); s.setDecimals(dec); s.setValue(val)
    if suffix: s.setSuffix(suffix)
    return s

def cell(text, ro=False, color=None):
    it = QTableWidgetItem(str(text))
    if ro: it.setFlags(it.flags() & ~Qt.ItemIsEditable)
    if color: it.setForeground(QColor(color))
    return it

def make_table(cols, stretch_col=0, min_h=None):
    t = QTableWidget(0, len(cols))
    t.setHorizontalHeaderLabels(cols)
    t.setAlternatingRowColors(True)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    hh = t.horizontalHeader()
    hh.setSectionResizeMode(stretch_col, QHeaderView.Stretch)
    for i in range(len(cols)):
        if i != stretch_col:
            hh.setSectionResizeMode(i, QHeaderView.ResizeToContents)
    if min_h: t.setMinimumHeight(min_h)
    return t

# ── Door Canvas ────────────────────────────────────────────────────────────────

class DoorCanvas(QWidget):
    def __init__(self, mini=False, parent=None):
        super().__init__(parent)
        self._mini = mini
        if mini:
            self.setFixedSize(230, 290)
        else:
            self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
            self.setMinimumSize(300, 400)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), QColor("#0d1117"))

        pad = 10 if self._mini else 50
        W, H = 900, 2100
        aw = max(1, self.width() - 2*pad)
        ah = max(1, self.height() - 2*pad)
        sc = min(aw/W, ah/H)
        ox = pad + (aw - W*sc)/2
        oy = pad + (ah - H*sc)/2

        def sx(x): return ox + x*sc
        def sy(y): return oy + (H - y)*sc

        if not self._mini:
            p.setPen(QPen(QColor("#1a1f24"), 1))
            step = int(50*sc) if sc > 0.3 else int(100*sc)
            step = max(step, 5)
            for x in range(0, self.width(), step):
                p.drawLine(x, 0, x, self.height())
            for y in range(0, self.height(), step):
                p.drawLine(0, y, self.width(), y)

        p.fillRect(int(sx(0)), int(sy(H)), int(W*sc), int(H*sc), QColor("#131920"))

        offsets = [40, 48, 53, 65]
        for i, off in enumerate(offsets):
            color = QColor(RING_COLORS[i])
            pen = QPen(color, 1.8 if not self._mini else 1.2)
            pen.setStyle(Qt.DashLine if i % 2 else Qt.SolidLine)
            p.setPen(pen)
            p.drawRect(int(sx(off)), int(sy(H-off)), int((W-2*off)*sc), int((H-2*off)*sc))

        p.setPen(QPen(QColor(C_PAT), 0.8))
        for i in range(10 if self._mini else 18):
            y1 = sy(H - 200 - i*80)
            y2 = sy(H - 180 - i*80)
            if sy(0) < y1 < sy(H):
                p.drawLine(int(sx(55)), int(y1), int(sx(W-55)), int(y2))

        p.setPen(QPen(QColor("#b8c1cc"), 1.5))
        p.drawRect(int(sx(0)), int(sy(H)), int(W*sc), int(H*sc))

        if not self._mini:
            p.setPen(QColor(C_DIM))
            f = QFont("Segoe UI", 8); p.setFont(f)
            p.drawText(int(sx(W/2))-30, int(sy(H))-8, "900 mm")
            p.save()
            p.translate(int(sx(0))-18, int((sy(0)+sy(H))/2))
            p.rotate(-90)
            p.drawText(-30, 4, "2100 mm")
            p.restore()
            p.setPen(QColor(C_GREEN))
            f2 = QFont("Segoe UI", 8); p.setFont(f2)
            p.drawText(int(sx(W/2))-50, int(sy(H/2)), "Inner: 806×2006 mm")

        p.end()

# ══════════════════════════════════════════════════════════════════════════════
# LEFT PANEL — Design Tree
# ══════════════════════════════════════════════════════════════════════════════

def build_left_panel():
    panel = QFrame(); panel.setFixedWidth(230)
    panel.setStyleSheet(f"background:{C_PANEL};border-right:1px solid {C_BORDER};border-top:none;border-bottom:none;border-left:none;")
    lay = QVBoxLayout(panel); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

    th = lbl("  Design Tree", C_ACCENT, bold=True, size=11)
    th.setFixedHeight(32)
    th.setStyleSheet(f"color:{C_ACCENT};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    lay.addWidget(th)

    tree = QTreeWidget(); tree.setHeaderHidden(True)
    r = QTreeWidgetItem(tree, ["  📁 F015 – Master Door"])
    r.setForeground(0, QColor(C_ACCENT))

    off = QTreeWidgetItem(r, ["  ⚡ Offset Steps (4)"])
    off.setForeground(0, QColor(C_YELLOW))
    for o, c in [("T1  profile_frame  Σ40","#ff3333"),("T2  v_groove  Σ48","#3fb950"),
                 ("T6  engrave  Σ53","#00A3FF"),("T1  ball_groove  Σ65","#bf5af2")]:
        it = QTreeWidgetItem(off, [f"    ● {o}"])
        it.setForeground(0, QColor(c))

    pat = QTreeWidgetItem(r, ["  🎨 Patterns (2)"])
    pat.setForeground(0, QColor(C_YELLOW))
    for p in ["OuterBorder  stepped_border","Diagonals  diagonal"]:
        it = QTreeWidgetItem(pat, [f"    ◆ {p}"])
        it.setForeground(0, QColor(C_PAT))

    tools = QTreeWidgetItem(r, ["  🔧 Tools (3)"])
    tools.setForeground(0, QColor(C_YELLOW))
    for t, c in [("T1 – 6mm End Mill",C_DIM),("T2 – 90° V-Bit",C_DIM),("T6 – 0.2mm Engraver",C_DIM)]:
        it = QTreeWidgetItem(tools, [f"    {t}"])
        it.setForeground(0, QColor(c))

    tree.expandAll()
    lay.addWidget(tree, 1)

    lay.addWidget(hsep())
    mini = DoorCanvas(mini=True)
    lay.addWidget(mini)
    inner_lbl = lbl("  Inner: 806 × 2006 mm", C_GREEN, bold=True, size=10)
    inner_lbl.setFixedHeight(26)
    inner_lbl.setStyleSheet(f"color:{C_GREEN};font-weight:700;font-size:10px;background:{C_PANEL2};border-top:1px solid {C_BORDER};padding-left:8px;")
    lay.addWidget(inner_lbl)
    return panel

# ══════════════════════════════════════════════════════════════════════════════
# RIGHT PANEL — Properties
# ══════════════════════════════════════════════════════════════════════════════

def build_right_panel():
    panel = QFrame(); panel.setFixedWidth(270)
    panel.setStyleSheet(f"background:{C_PANEL};border-left:1px solid {C_BORDER};border-top:none;border-bottom:none;border-right:none;")
    lay = QVBoxLayout(panel); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

    ph = lbl("  Properties", C_ACCENT, bold=True, size=11)
    ph.setFixedHeight(32)
    ph.setStyleSheet(f"color:{C_ACCENT};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    lay.addWidget(ph)

    sel_h = lbl("  Nothing selected", C_DIM, size=11)
    sel_h.setFixedHeight(28)
    sel_h.setStyleSheet(f"color:{C_YELLOW};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    lay.addWidget(sel_h)

    props_w = QWidget(); props_w.setStyleSheet("background:transparent;border:none;")
    pl = QVBoxLayout(props_w); pl.setContentsMargins(10,8,10,8); pl.setSpacing(4)
    for k, v, c in [("Step","—",C_DIM),("Σ Total","—",C_DIM),("Operation","—",C_DIM),
                     ("Tool","—",C_DIM),("Depth","—",C_DIM),("Link","—",C_DIM)]:
        r = QHBoxLayout(); r.setContentsMargins(0,0,0,0)
        r.addWidget(lbl(k+":", C_DIM, size=11))
        r.addWidget(lbl(v, c, bold=True, size=11))
        r.addStretch(); pl.addLayout(r)
    lay.addWidget(props_w)
    lay.addWidget(hsep())

    # offsets summary
    oh = lbl("  Offset Steps", C_DIM, size=11)
    oh.setFixedHeight(26)
    oh.setStyleSheet(f"color:{C_DIM};font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    lay.addWidget(oh)
    for dot, nm, tot, c in [("●","T1  profile_frame","Σ40","#ff3333"),("●","T2  v_groove","Σ48","#3fb950"),
                              ("●","T6  engrave","Σ53","#00A3FF"),("●","T1  ball_groove","Σ65","#bf5af2")]:
        r = QHBoxLayout(); r.setContentsMargins(10,2,10,2)
        r.addWidget(lbl(dot, c, size=13)); r.addWidget(lbl(nm, C_TEXT, size=11))
        r.addStretch(); r.addWidget(lbl(tot, C_DIM, size=11))
        w2 = QWidget(); w2.setStyleSheet("background:transparent;border:none;"); w2.setLayout(r)
        lay.addWidget(w2)

    lay.addWidget(hsep())
    pat_h = lbl("  Patterns", C_DIM, size=11)
    pat_h.setFixedHeight(26)
    pat_h.setStyleSheet(f"color:{C_DIM};font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    lay.addWidget(pat_h)
    for nm, tp in [("OuterBorder","stepped_border"),("Diagonals","diagonal")]:
        r = QHBoxLayout(); r.setContentsMargins(10,2,10,2)
        r.addWidget(lbl("◆", C_PAT, size=10)); r.addWidget(lbl(nm, C_TEXT, size=11))
        r.addStretch(); r.addWidget(lbl(tp, C_DIM, size=10))
        w2 = QWidget(); w2.setStyleSheet("background:transparent;border:none;"); w2.setLayout(r)
        lay.addWidget(w2)

    lay.addStretch()
    qa = QFrame()
    qa.setStyleSheet(f"background:{C_PANEL2};border-top:1px solid {C_BORDER};border-bottom:none;border-left:none;border-right:none;")
    qal = QVBoxLayout(qa); qal.setContentsMargins(8,8,8,8); qal.setSpacing(6)
    qal.addWidget(hdr_lbl("Quick Actions"))
    r1 = QHBoxLayout()
    for t in ["Add Offset","Add Pattern"]:
        r1.addWidget(btn(t))
    qal.addLayout(r1)
    qal.addWidget(btn("⟳  Recalculate", primary=True))
    lay.addWidget(qa)
    return panel

# ══════════════════════════════════════════════════════════════════════════════
# TAB 1 — Door Design
# ══════════════════════════════════════════════════════════════════════════════

def build_tab_door():
    w = QWidget()
    lay = QVBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

    # canvas toolbar
    ctb = QFrame(); ctb.setFixedHeight(36)
    ctb.setStyleSheet(f"background:{C_PANEL2};border:none;border-bottom:1px solid {C_BORDER};")
    ctl = QHBoxLayout(ctb); ctl.setContentsMargins(8,0,8,0); ctl.setSpacing(4)
    for t in ["⤢ Fit","🔍+","🔍−","↺ Undo","↻ Redo","┼ Grid","◑ Patterns","⟳ Refresh"]:
        b = btn(t, h=26); ctl.addWidget(b)
    ctl.addStretch()
    ctl.addWidget(lbl("X: 0.000", C_DIM, size=10))
    ctl.addWidget(lbl("|", C_BORDER))
    ctl.addWidget(lbl("Y: 0.000", C_DIM, size=10))
    lay.addWidget(ctb)

    body = QSplitter(Qt.Horizontal)

    # left sub-panel: door settings
    settings = QFrame(); settings.setFixedWidth(260)
    settings.setStyleSheet(f"background:{C_PANEL};border:none;border-right:1px solid {C_BORDER};")
    sl = QVBoxLayout(settings); sl.setContentsMargins(10,10,10,10); sl.setSpacing(8)

    sl.addWidget(hdr_lbl("Door Information"))
    for lb, ph in [("Code","F015"),("Name","Master Door – 15 Offset")]:
        sl.addWidget(lbl(lb, C_DIM, size=11))
        e = QLineEdit(ph); e.setFixedHeight(26); sl.addWidget(e)
    sl.addWidget(lbl("Description", C_DIM, size=11))
    desc = QTextEdit("Multi-layer offset door with stepped border pattern")
    desc.setFixedHeight(56); sl.addWidget(desc)

    sl.addWidget(hsep())
    sl.addWidget(hdr_lbl("Base Size"))
    grid = QGridLayout(); grid.setContentsMargins(0,0,0,0); grid.setSpacing(6)
    for row,(lb,val,sfx) in enumerate([("Width","900"," mm"),("Height","2100"," mm"),("Thickness","18"," mm")]):
        grid.addWidget(lbl(lb+":", C_DIM, size=11), row, 0)
        sp = dspin(1, 5000, float(val), sfx); sp.setFixedHeight(26)
        grid.addWidget(sp, row, 1)
    sl.addLayout(grid)
    sl.addWidget(lbl("Material", C_DIM, size=11))
    cmb = QComboBox(); cmb.addItems(["MDF","HDF","Plywood","Acrylic","Solid Wood"])
    cmb.setFixedHeight(26); sl.addWidget(cmb)

    sl.addWidget(hsep())
    sl.addWidget(hdr_lbl("Offset Steps"))
    off_tbl = make_table(["✓","Step","Σ","Operation","🔗"], stretch_col=3, min_h=120)
    off_tbl.setFixedHeight(130)
    data=[("✓","40","Σ40","profile_frame","🔗"),("✓","8","Σ48","v_groove","🔗"),
          ("✓","5","Σ53","engrave","🔗"),("✓","12","Σ65","ball_groove","🔗")]
    off_tbl.setRowCount(len(data))
    for r,(chk,step,tot,op,lnk) in enumerate(data):
        off_tbl.setItem(r,0,cell(chk,ro=True,color=C_GREEN))
        off_tbl.setItem(r,1,cell(step))
        off_tbl.setItem(r,2,cell(tot,ro=True,color=RING_COLORS[r]))
        off_tbl.setItem(r,3,cell(op))
        off_tbl.setItem(r,4,cell(lnk,ro=True,color=C_ACCENT))
    sl.addWidget(off_tbl)

    br = QHBoxLayout()
    for t in ["+ Add","Dup","Del","↑","↓"]:
        br.addWidget(btn(t, h=24))
    sl.addLayout(br)
    sl.addStretch()
    body.addWidget(settings)

    # center: canvas
    canvas_frame = QFrame()
    canvas_frame.setStyleSheet(f"background:{C_BG};border:none;")
    cf = QVBoxLayout(canvas_frame); cf.setContentsMargins(0,0,0,0)
    canvas = DoorCanvas()
    cf.addWidget(canvas, 1)
    cs = QFrame(); cs.setFixedHeight(24)
    cs.setStyleSheet(f"background:{C_PANEL2};border:none;border-top:1px solid {C_BORDER};")
    csl = QHBoxLayout(cs); csl.setContentsMargins(10,0,10,0); csl.setSpacing(16)
    for t in ["F015","W: 900mm","H: 2100mm","Offsets: 4","Patterns: 2","Inner: 806×2006mm"]:
        csl.addWidget(lbl(t, C_DIM, size=10))
    csl.addStretch()
    cf.addWidget(cs)
    body.addWidget(canvas_frame)

    body.setSizes([260, 800])
    lay.addWidget(body, 1)
    return w

# ══════════════════════════════════════════════════════════════════════════════
# TAB 2 — Parts List
# ══════════════════════════════════════════════════════════════════════════════

def build_tab_parts():
    w = QWidget()
    lay = QVBoxLayout(w); lay.setContentsMargins(8,8,8,8); lay.setSpacing(6)

    tr = QHBoxLayout()
    tr.addWidget(hdr_lbl("Parts List"))
    tr.addStretch()
    for t, p in [("Import CSV",False),("Export CSV",False),("+ Add Part",True),("Delete",False)]:
        tr.addWidget(btn(t, primary=p))
    lay.addLayout(tr)

    tbl = make_table(["#","Part Name","Design","W (mm)","H (mm)","Thick","Material","Qty","Status"], stretch_col=1)
    tbl.setRowCount(6)
    rows = [
        ("1","Main Panel","F015","900","2100","18","MDF","1","✅ Ready"),
        ("2","Top Rail","F015","900","80","18","MDF","1","✅ Ready"),
        ("3","Bottom Rail","F015","900","100","18","MDF","1","✅ Ready"),
        ("4","Left Stile","F015","60","1940","18","MDF","1","✅ Ready"),
        ("5","Center Panel","F015","760","960","18","MDF","1","⚠ Pending"),
        ("6","Arch Piece","F008","700","200","18","MDF","1","❌ Missing"),
    ]
    for r, row in enumerate(rows):
        for c, v in enumerate(row):
            color = {8: C_GREEN if "✅" in v else C_YELLOW if "⚠" in v else C_RED}.get(c)
            tbl.setItem(r, c, cell(v, ro=(c in (0,8)), color=color))
    lay.addWidget(tbl, 1)

    bot = QHBoxLayout()
    for k, v, c in [("Total Parts:","6",C_TEXT),("Sheets Needed:","2",C_ACCENT),
                     ("Total Area:","5.8 m²",C_TEXT),("Estimated Waste:","12.4%",C_YELLOW)]:
        bot.addWidget(lbl(k, C_DIM, size=11))
        bot.addWidget(lbl(v, c, bold=True, size=12))
        bot.addSpacing(20)
    bot.addStretch()
    bot.addWidget(btn("→  Go to Nesting", primary=True))
    lay.addLayout(bot)
    return w

# ══════════════════════════════════════════════════════════════════════════════
# TAB 3 — Nesting
# ══════════════════════════════════════════════════════════════════════════════

def build_tab_nesting():
    w = QWidget()
    lay = QHBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

    # left settings
    left = QFrame(); left.setFixedWidth(240)
    left.setStyleSheet(f"background:{C_PANEL};border:none;border-right:1px solid {C_BORDER};")
    ll = QVBoxLayout(left); ll.setContentsMargins(12,12,12,12); ll.setSpacing(8)
    ll.addWidget(hdr_lbl("Sheet Settings"))
    for lb, val, sfx in [("Sheet Width","2800"," mm"),("Sheet Height","2070"," mm"),
                          ("Part Gap","4"," mm"),("Border","10"," mm")]:
        ll.addWidget(lbl(lb, C_DIM, size=11))
        sp = dspin(0, 9999, float(val), sfx); sp.setFixedHeight(26); ll.addWidget(sp)
    ll.addWidget(lbl("Algorithm", C_DIM, size=11))
    alg = QComboBox(); alg.addItems(["Guillotine","Shelf","MaxRects","First Fit"])
    alg.setFixedHeight(26); ll.addWidget(alg)
    ll.addWidget(lbl("Allow Rotation", C_DIM, size=11))
    rot = QComboBox(); rot.addItems(["No Rotation","90°","90° / 180°","Any"])
    rot.setFixedHeight(26); ll.addWidget(rot)
    ll.addWidget(hsep())
    ll.addWidget(btn("▶  Run Nesting", primary=True))
    ll.addWidget(btn("⟳  Re-optimize"))
    ll.addWidget(hsep())
    res = QGroupBox("Result")
    rl2 = QVBoxLayout(res); rl2.setContentsMargins(8,8,8,8); rl2.setSpacing(4)
    for k, v, c in [("Sheets","—",C_TEXT),("Efficiency","—",C_TEXT),("Waste","—",C_TEXT),("Runtime","—",C_DIM)]:
        r2 = QHBoxLayout(); r2.addWidget(lbl(k+":", C_DIM, size=11))
        r2.addWidget(lbl(v, c, bold=True, size=12)); r2.addStretch(); rl2.addLayout(r2)
    ll.addWidget(res)
    ll.addStretch()
    lay.addWidget(left)

    # center: placeholder
    center = QFrame(); center.setStyleSheet(f"background:{C_BG};border:none;")
    cl = QVBoxLayout(center); cl.setContentsMargins(0,0,0,0)
    ctb = QFrame(); ctb.setFixedHeight(34)
    ctb.setStyleSheet(f"background:{C_PANEL2};border:none;border-bottom:1px solid {C_BORDER};")
    ctl = QHBoxLayout(ctb); ctl.setContentsMargins(8,0,8,0); ctl.setSpacing(6)
    for i in range(1, 4):
        b = btn(f"Sheet {i}", h=26)
        if i == 1: b.setStyleSheet(f"background:{C_BLUE};color:white;border:1px solid {C_BLUE};border-radius:4px;padding:0 12px;font-size:11px;")
        ctl.addWidget(b)
    ctl.addStretch()
    ctl.addWidget(lbl("No nesting result yet — press Run Nesting", C_DIM, size=11))
    cl.addWidget(ctb)
    ph = lbl("Run Nesting to see sheet layout", C_DIM, size=14, align=Qt.AlignCenter)
    cl.addWidget(ph, 1)
    lay.addWidget(center, 1)

    # right: parts
    right = QFrame(); right.setFixedWidth(260)
    right.setStyleSheet(f"background:{C_PANEL};border:none;border-left:1px solid {C_BORDER};")
    rl = QVBoxLayout(right); rl.setContentsMargins(0,0,0,0)
    rh = lbl("  Parts on Sheet", C_YELLOW, bold=True, size=11)
    rh.setFixedHeight(30)
    rh.setStyleSheet(f"color:{C_YELLOW};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    rl.addWidget(rh)
    ptbl = make_table(["Part","W","H","Rot"], stretch_col=0)
    rl.addWidget(ptbl, 1)
    rl.addWidget(btn("→  Go to Toolpaths", primary=True))
    lay.addWidget(right)
    return w

# ══════════════════════════════════════════════════════════════════════════════
# TAB 4 — Toolpaths
# ══════════════════════════════════════════════════════════════════════════════

def build_tab_toolpaths():
    w = QWidget()
    lay = QHBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

    # left: operations list
    left = QFrame(); left.setFixedWidth(270)
    left.setStyleSheet(f"background:{C_PANEL};border:none;border-right:1px solid {C_BORDER};")
    ll = QVBoxLayout(left); ll.setContentsMargins(0,0,0,0)
    lh = lbl("  Toolpath Operations", C_ACCENT, bold=True, size=11)
    lh.setFixedHeight(30)
    lh.setStyleSheet(f"color:{C_ACCENT};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    ll.addWidget(lh)

    tptbl = make_table(["✓","Operation","Tool","Depth"], stretch_col=1)
    tptbl.setRowCount(5)
    ops = [("✓","profile_frame","T1 6mm","18mm"),("✓","v_groove","T2 V90°","3mm"),
           ("✓","engrave","T6 0.2mm","1.5mm"),("✓","ball_groove","T1 6mm","3mm"),("✓","stepped_border","T1 6mm","2mm")]
    for r,(chk,op,tool,dep) in enumerate(ops):
        tptbl.setItem(r,0,cell(chk,ro=True,color=C_GREEN))
        tptbl.setItem(r,1,cell(op))
        tptbl.setItem(r,2,cell(tool,ro=True))
        tptbl.setItem(r,3,cell(dep,ro=True))
    ll.addWidget(tptbl, 1)

    br = QHBoxLayout(); br.setContentsMargins(8,6,8,6)
    for t in ["+ Add","Del","↑","↓"]: br.addWidget(btn(t, h=26))
    bw = QWidget(); bw.setStyleSheet("background:transparent;border:none;"); bw.setLayout(br)
    ll.addWidget(bw)
    ll.addWidget(hsep())
    ll.addWidget(btn("⚡  Calculate All", primary=True))
    lay.addWidget(left)

    # center
    center = QFrame(); center.setStyleSheet(f"background:{C_BG};border:none;")
    cl = QVBoxLayout(center); cl.setContentsMargins(0,0,0,0)
    ctb = QFrame(); ctb.setFixedHeight(34)
    ctb.setStyleSheet(f"background:{C_PANEL2};border:none;border-bottom:1px solid {C_BORDER};")
    ctl = QHBoxLayout(ctb); ctl.setContentsMargins(8,0,8,0); ctl.setSpacing(4)
    for t in ["Top View","Side View","▶ Preview","⟳ Simulate"]:
        ctl.addWidget(btn(t, h=26))
    ctl.addStretch()
    ctl.addWidget(lbl("Select an operation to preview toolpath", C_DIM, size=11))
    cl.addWidget(ctb)
    canvas2 = DoorCanvas()
    cl.addWidget(canvas2, 1)
    lay.addWidget(center, 1)

    # right: op details
    right = QFrame(); right.setFixedWidth(260)
    right.setStyleSheet(f"background:{C_PANEL};border:none;border-left:1px solid {C_BORDER};")
    rl = QVBoxLayout(right); rl.setContentsMargins(0,0,0,0)
    rh2 = lbl("  Operation Details", C_YELLOW, bold=True, size=11)
    rh2.setFixedHeight(30)
    rh2.setStyleSheet(f"color:{C_YELLOW};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    rl.addWidget(rh2)

    df = QWidget(); df.setStyleSheet("background:transparent;border:none;")
    dfl = QVBoxLayout(df); dfl.setContentsMargins(10,8,10,8); dfl.setSpacing(6)
    for k, v in [("Tool","—"),("Spindle","—"),("Feed Rate","—"),("Plunge Rate","—"),
                  ("Depth","—"),("Passes","—"),("Cut Length","—"),("Est. Time","—")]:
        r2 = QHBoxLayout(); r2.setContentsMargins(0,0,0,0)
        r2.addWidget(lbl(k+":", C_DIM, size=11))
        r2.addWidget(lbl(v, C_TEXT, bold=True, size=11))
        r2.addStretch(); dfl.addLayout(r2)
    rl.addWidget(df)
    rl.addStretch()
    rl.addWidget(btn("→  Generate G-Code", primary=True))
    lay.addWidget(right)
    return w

# ══════════════════════════════════════════════════════════════════════════════
# TAB 5 — G-Code Output
# ══════════════════════════════════════════════════════════════════════════════

def build_tab_gcode():
    w = QWidget()
    lay = QHBoxLayout(w); lay.setContentsMargins(0,0,0,0); lay.setSpacing(0)

    # left
    left = QFrame(); left.setFixedWidth(250)
    left.setStyleSheet(f"background:{C_PANEL};border:none;border-right:1px solid {C_BORDER};")
    ll = QVBoxLayout(left); ll.setContentsMargins(12,12,12,12); ll.setSpacing(8)
    ll.addWidget(hdr_lbl("Post Processor"))
    pp_cmb = QComboBox()
    pp_cmb.addItems(["ALIFIROOZI (mm) *.tap","G-Code Arcs (mm) *.tap","Mach3 (mm)","GRBL 1.1","Radonix","Custom..."])
    pp_cmb.setFixedHeight(26); ll.addWidget(pp_cmb)
    ll.addWidget(hdr_lbl("Output Options"))
    for t, ch in [("Line Numbers",True),("Tool Change Comments",True),("Safe Z Move",True),("Home on Finish",True),("Arc Support (G2/G3)",False)]:
        cb = QCheckBox(t); cb.setChecked(ch)
        cb.setStyleSheet(f"background:transparent;color:{C_TEXT};border:none;spacing:6px;")
        ll.addWidget(cb)
    ll.addWidget(lbl("Safe Z Height", C_DIM, size=11))
    ll.addWidget(dspin(0, 100, 5, " mm"))
    ll.addWidget(hsep())
    ll.addWidget(hdr_lbl("Output Files"))
    for fn, st, c in [("F015_profile.tap","Ready",C_GREEN),("F015_vgroove.tap","Ready",C_GREEN),
                       ("F015_engrave.tap","Ready",C_GREEN),("F015_pattern.tap","Pending",C_YELLOW)]:
        r2 = QHBoxLayout(); r2.setContentsMargins(0,0,0,0)
        r2.addWidget(lbl(fn, C_TEXT, size=10)); r2.addStretch()
        r2.addWidget(lbl(st, c, size=10)); ll.addLayout(r2)
    ll.addStretch()
    ll.addWidget(btn("⚡  Generate All Files", primary=True))
    ll.addWidget(btn("📁  Save All to Folder"))
    lay.addWidget(left)

    # center: code view
    center = QFrame(); center.setStyleSheet(f"background:{C_BG};border:none;")
    cl = QVBoxLayout(center); cl.setContentsMargins(0,0,0,0)
    ctb = QFrame(); ctb.setFixedHeight(34)
    ctb.setStyleSheet(f"background:{C_PANEL2};border:none;border-bottom:1px solid {C_BORDER};")
    ctl = QHBoxLayout(ctb); ctl.setContentsMargins(8,0,8,0); ctl.setSpacing(4)
    for i, t in enumerate(["F015_profile.tap","F015_vgroove.tap","F015_engrave.tap","F015_pattern.tap"]):
        b = btn(t, h=26)
        if i == 0: b.setStyleSheet(f"background:{C_BLUE};color:white;border:1px solid {C_BLUE};border-radius:4px;padding:0 10px;font-size:11px;")
        ctl.addWidget(b)
    ctl.addStretch()
    cl.addWidget(ctb)
    code_view = QTextEdit()
    code_view.setReadOnly(True)
    code_view.setStyleSheet(f"background:#0d1117;color:{C_TEXT};border:none;font-family:Consolas,'Courier New',monospace;font-size:12px;")
    code_view.setHtml(f"""
<pre style='line-height:1.7;color:{C_DIM}'>
<span style='color:{C_DIM}'>; FIROO CAM v3.0  ─  F015 Master Door</span>
<span style='color:{C_DIM}'>; Post: ALIFIROOZI (mm)  |  Op: profile_frame  |  Tool: T1</span>
<span style='color:{C_DIM}'>; ─────────────────────────────────────────────────────</span>
<span style='color:{C_ACCENT}'>(09177761252)</span>
<span style='color:{C_ACCENT}'>(ALIFIROOZI)</span>
<span style='color:{C_YELLOW}'>G90</span>
<span style='color:{C_YELLOW}'>M6 T1</span>
<span style='color:{C_GREEN}'>G0 Z5.000</span>
<span style='color:{C_GREEN}'>G0 X0.000 Y0.000</span>
<span style='color:{C_YELLOW}'>M3 S18000</span>
<span style='color:{C_DIM}'>; ── profile_frame ─────────────────────────────</span>
<span style='color:{C_GREEN}'>G0 X40.000 Y40.000 Z5.000</span>
<span style='color:{C_TEXT}'>G1 X40.000 Y40.000 Z-18.000 F800</span>
<span style='color:{C_TEXT}'>G1 X860.000 Y40.000 F3000</span>
<span style='color:{C_TEXT}'>X860.000 Y2060.000</span>
<span style='color:{C_TEXT}'>X40.000 Y2060.000</span>
<span style='color:{C_TEXT}'>X40.000 Y40.000</span>
<span style='color:{C_GREEN}'>G0 Z5.000</span>
<span style='color:{C_DIM}'>; ── Footer ────────────────────────────────────</span>
<span style='color:{C_GREEN}'>G0 Z5.000</span>
<span style='color:{C_GREEN}'>G0 X0.000 Y0.000</span>
<span style='color:{C_YELLOW}'>M5</span>
<span style='color:{C_YELLOW}'>M30</span>
<span style='color:{C_YELLOW}'>M2</span>
</pre>""")
    cl.addWidget(code_view, 1)
    lay.addWidget(center, 1)

    # right: stats
    right = QFrame(); right.setFixedWidth(260)
    right.setStyleSheet(f"background:{C_PANEL};border:none;border-left:1px solid {C_BORDER};")
    rl = QVBoxLayout(right); rl.setContentsMargins(0,0,0,0)
    rh3 = lbl("  Machine / Stats", C_YELLOW, bold=True, size=11)
    rh3.setFixedHeight(30)
    rh3.setStyleSheet(f"color:{C_YELLOW};font-weight:700;font-size:11px;background:{C_PANEL2};border-bottom:1px solid {C_BORDER};padding-left:8px;")
    rl.addWidget(rh3)
    mf = QWidget(); mf.setStyleSheet("background:transparent;border:none;")
    mfl = QVBoxLayout(mf); mfl.setContentsMargins(10,8,10,8); mfl.setSpacing(6)
    for k, v, c in [("Post Processor","ALIFIROOZI",C_TEXT),("Format","*.tap",C_TEXT),
                     ("Units","MM",C_GREEN),("Line Ending","CR+LF",C_DIM),
                     ("Max Feed","24,000 mm/min",C_TEXT),("Safe Z","5 mm",C_TEXT)]:
        r2 = QHBoxLayout(); r2.setContentsMargins(0,0,0,0)
        r2.addWidget(lbl(k+":", C_DIM, size=11))
        r2.addWidget(lbl(v, c, bold=True, size=11))
        r2.addStretch(); mfl.addLayout(r2)
    rl.addWidget(mf)
    rl.addWidget(hsep())
    stbl = make_table(["File","Lines","Time"], stretch_col=0)
    stbl.setRowCount(4)
    for r2, (fn, ln, tm) in enumerate([("profile.tap","312","12m 30s"),("vgroove.tap","247","4m 58s"),("engrave.tap","189","8m 12s"),("pattern.tap","—","—")]):
        c = C_GREEN if ln != "—" else C_YELLOW
        stbl.setItem(r2,0,cell(fn,ro=True)); stbl.setItem(r2,1,cell(ln,ro=True,color=c)); stbl.setItem(r2,2,cell(tm,ro=True,color=c))
    rl.addWidget(stbl)
    rl.addStretch()
    bl = QVBoxLayout(); bl.setContentsMargins(8,8,8,8); bl.setSpacing(6)
    bl.addWidget(btn("📤  Save to USB / Folder", primary=True))
    bl.addWidget(btn("🖨  Print Job Sheet"))
    bw2 = QWidget(); bw2.setStyleSheet("background:transparent;border:none;"); bw2.setLayout(bl)
    rl.addWidget(bw2)
    lay.addWidget(right)
    return w

# ══════════════════════════════════════════════════════════════════════════════
# MAIN WINDOW
# ══════════════════════════════════════════════════════════════════════════════

class FirooCAM(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("FIROO CAM  v3.0")
        self.resize(1600, 940)
        self._build()

    def _build(self):
        cw = QWidget(); self.setCentralWidget(cw)
        root = QVBoxLayout(cw); root.setContentsMargins(0,0,0,0); root.setSpacing(0)
        root.addWidget(self._header())
        root.addWidget(self._workflow_bar())

        body = QSplitter(Qt.Horizontal); body.setHandleWidth(1)
        body.addWidget(build_left_panel())
        body.addWidget(self._center())
        body.addWidget(build_right_panel())
        body.setSizes([230, 1100, 270])
        root.addWidget(body, 1)
        root.addWidget(self._bottom_bar())

    def _header(self):
        hdr = QFrame(); hdr.setFixedHeight(52)
        hdr.setStyleSheet(f"background:#0d1117;border-bottom:2px solid {C_BLUE};border-radius:0;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(14,0,14,0); hl.setSpacing(8)

        logo = lbl("🔷 FIROO CAM", C_ACCENT, bold=True, size=17)
        hl.addWidget(logo); hl.addWidget(vsep())

        for t in ["New","Open","Save","Save As"]:
            hl.addWidget(btn(t))
        hl.addWidget(vsep())
        for t in ["Import DXF","Export"]:
            hl.addWidget(btn(t))

        hl.addStretch()

        # mode toggle
        mf = QFrame()
        mf.setStyleSheet(f"background:{C_PANEL2};border:1px solid {C_BORDER};border-radius:14px;")
        mfl = QHBoxLayout(mf); mfl.setContentsMargins(4,3,4,3); mfl.setSpacing(2)
        for t, active in [("Simple",False),("Advanced",True)]:
            b = QPushButton(t); b.setFixedHeight(24)
            if active:
                b.setStyleSheet(f"background:{C_BLUE};color:white;border-radius:10px;padding:0 14px;font-size:11px;border:none;")
            else:
                b.setStyleSheet(f"background:transparent;color:{C_DIM};border:none;padding:0 14px;font-size:11px;")
            mfl.addWidget(b)
        hl.addWidget(mf); hl.addSpacing(10)
        hl.addWidget(btn("⚙ Settings"))
        hl.addWidget(btn("👤 Admin"))
        return hdr

    def _workflow_bar(self):
        bar = QFrame(); bar.setFixedHeight(44)
        bar.setStyleSheet(f"background:{C_PANEL};border-bottom:1px solid {C_BORDER};border-radius:0;")
        bl = QHBoxLayout(bar); bl.setContentsMargins(0,0,0,0); bl.setSpacing(0)
        self._wf_btns = []
        labels = ["①  Door Design","②  Parts List","③  Nesting","④  Toolpaths","⑤  G-Code Output"]
        for i, lbl_text in enumerate(labels):
            b = QPushButton(lbl_text); b.setFixedHeight(44)
            self._wf_btns.append(b)
            b.clicked.connect(lambda _, idx=i: self._switch_tab(idx))
            bl.addWidget(b)
        self._update_wf_style(0)
        bl.addStretch()
        guides = ["Design door panels & layers","Manage door parts","Sheet nesting layout","Configure toolpath operations","Generate & export G-Code"]
        self._guide_lbl = lbl(f"Step 1 of 5  —  {guides[0]}", C_DIM, size=11)
        self._guides = guides
        bl.addWidget(self._guide_lbl); bl.addSpacing(14)
        return bar

    def _update_wf_style(self, active):
        for i, b in enumerate(self._wf_btns):
            if i == active:
                b.setStyleSheet(f"background:{C_BG};color:{C_ACCENT};border-bottom:2px solid {C_ACCENT};border-top:none;border-left:none;border-right:1px solid {C_BORDER};font-weight:700;font-size:12px;padding:0 18px;")
            else:
                b.setStyleSheet(f"background:{C_PANEL};color:{C_DIM};border:none;border-right:1px solid {C_BORDER};font-size:12px;padding:0 18px;")

    def _switch_tab(self, idx):
        self._stack.setCurrentIndex(idx)
        self._update_wf_style(idx)
        self._guide_lbl.setText(f"Step {idx+1} of 5  —  {self._guides[idx]}")

    def _center(self):
        self._stack = QStackedWidget()
        self._stack.setStyleSheet(f"background:{C_BG};border:none;")
        self._stack.addWidget(build_tab_door())
        self._stack.addWidget(build_tab_parts())
        self._stack.addWidget(build_tab_nesting())
        self._stack.addWidget(build_tab_toolpaths())
        self._stack.addWidget(build_tab_gcode())
        return self._stack

    def _bottom_bar(self):
        bar = QFrame(); bar.setFixedHeight(48)
        bar.setStyleSheet(f"background:{C_PANEL};border-top:1px solid {C_BORDER};border-radius:0;")
        bl = QHBoxLayout(bar); bl.setContentsMargins(12,0,12,0); bl.setSpacing(8)
        for t, p in [("💾 Save",True),("📤 Export DXF",False),("⚙ G-Code",False),("🖨 Barcode",False)]:
            bl.addWidget(btn(t, primary=p))
        bl.addStretch()
        self._status = lbl("✅  Ready  —  FIROO CAM v3.0", C_GREEN, size=11)
        bl.addWidget(self._status)
        bl.addStretch()
        bl.addWidget(lbl("F015 – Master Door  |  900 × 2100 mm  |  MDF 18mm", C_DIM, size=11))
        bl.addSpacing(16)
        bl.addWidget(btn("✕  Close"))
        return bar

def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(STYLE)
    w = FirooCAM()
    w.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
