"""
FIROO CAM - Parametric Design Studio  v3
Three-Engine Parametric Design Editor
======================================
Engine 1: Offset Engine
Engine 2: Step Border Pattern Engine
Engine 3: Inner DXF Pattern Clip Engine
Plus layer/toolpath mapping and real-time preview.
"""
from __future__ import annotations
import json, copy, re
from pathlib import Path
from typing import List, Dict, Optional

from PySide6.QtCore import Qt, Signal, QRectF, QPointF, QTimer
from PySide6.QtGui import QPainter, QColor, QPen, QBrush, QFont, QLinearGradient
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QSplitter, QLabel, QPushButton,
    QDoubleSpinBox, QSpinBox, QComboBox, QCheckBox, QGroupBox, QFileDialog,
    QMessageBox, QDialog, QFormLayout, QLineEdit, QTableWidget, QTableWidgetItem,
    QHeaderView, QAbstractItemView, QSizePolicy, QTabWidget, QTextEdit, QFrame,
    QDialogButtonBox
)

from config import config
from design_engines.offset_engine import OffsetRow, compute_offsets, generate_offset_entities, offset_total_map
from design_engines.border_step_engine import generate_step_border
from design_engines.pattern_clip_engine import preview_trim_boundary
from design_engines.toolpath_preview import generate_preview_paths
from design_engines.dxf_writer import write_r12_polyline

FDR_EXTENSION = '.fdr'
LAYER_COLORS = [QColor(c) for c in ['#e74c3c','#f1c40f','#e67e22','#2ecc71','#3498db','#9b59b6','#ff9800','#00bcd4','#ff5722','#8bc34a','#e91e63','#607d8b','#cddc39','#9e9e9e','#ffc107','#00ffaa']]

C_BG=QColor('#0d1117'); C_PANEL=QColor('#161b22'); C_PANEL2=QColor('#21262d')
C_BORDER=QColor('#30363d'); C_TEXT=QColor('#e6edf3'); C_DIM=QColor('#8b949e')
C_ACCENT=QColor('#58a6ff'); C_GOOD=QColor('#3fb950'); C_WARN=QColor('#e3b341'); C_RED=QColor('#f85149')

STRATEGIES = [
    'outside_profile','inside_profile','on_line_profile','pocket','engraving','v_bit','v_carve','drill','clearance_pocket'
]

# Standard design codes — F-series (main), C-series (classic), M-series (modern), V-series (vitrine)
STANDARD_CODES = (
    [f'F{i:03d}' for i in range(1, 21)] +
    [f'C{i:03d}' for i in range(1, 4)] +
    [f'M{i:03d}' for i in range(1, 4)] +
    ['V001', 'V002', 'NEW']
)

_TOOL_TYPE_NAMES = {
    "endmill": "End Mill", "vbit": "V-Bit", "ballnose": "Ball Nose",
    "drill": "Drill", "form": "Form Tool", "laser": "Laser",
}


def _default_offsets(code='NEW') -> List[Dict]:
    steps = [60, 10, 15, 12, 8, 15, 5, 5, 5, 5, 5, 5, 5, 10, 5]
    return [{'name': f'OF{i+1}', 'step': float(v), 'enabled': i < 6,
             'layer_id': f'{code}_OF{i+1:02d}'} for i, v in enumerate(steps)]


def _default_border(code='NEW') -> List[Dict]:
    return [{
        'slot': 1, 'enabled': False, 'pattern_id': 'step_border_v1',
        'from_offset': 'OF5', 'to_offset': 'OF6',
        'layer_id': f'{code}_BORDER_01_T2_3.0mm',
        'corner_clearance': 8.0, 'target_pitch': 60.0, 'step_width': 22.0,
        'rounding_mode': 'nearest', 'close_joined': True,
        'tool_id': 'T2', 'cut_depth': 3.0,
    }]


def _default_inner(code='NEW') -> Dict:
    return {
        'enabled': False, 'pattern_type': 'imported_dxf_center_trim', 'dxf_file': '',
        'trim_offset': 'OF6', 'trim_offset_adjust': 0.0,
        'layer_id': f'{code}_INNER_DXF_01',
        'scale_x': 1.0, 'scale_y': 1.0, 'link_scale': True, 'rotation_deg': 0.0,
        'close_trimmed_curves': True, 'close_policy': 'only_originally_closed',
        'close_method': 'boundary_shortest_path',
    }


def _default_toolpaths(code='NEW') -> List[Dict]:
    return [
        {'layer_id': f'{code}_OUTER_CUT', 'operation': 'outside_profile', 'tool_id': 'T1',
         'start_depth': 0, 'cut_depth': 18, 'pass_depth': 6, 'safe_z': 8,
         'feed_rate': 6000, 'plunge_rate': 1800, 'spindle_rpm': 18000,
         'direction': 'climb', 'allowance': 0,
         'ramp': {'enabled': True, 'type': 'linear', 'length': 30, 'angle': 5}},
        {'layer_id': f'{code}_BORDER_01_T2_3.0mm', 'operation': 'engraving', 'tool_id': 'T2',
         'start_depth': 0, 'cut_depth': 3, 'pass_depth': 1.5, 'safe_z': 8,
         'feed_rate': 3500, 'plunge_rate': 1000, 'spindle_rpm': 18000,
         'direction': 'climb', 'allowance': 0,
         'ramp': {'enabled': True, 'type': 'linear', 'length': 20, 'angle': 5}},
        {'layer_id': f'{code}_INNER_DXF_01', 'operation': 'v_bit', 'tool_id': 'T2',
         'start_depth': 0, 'cut_depth': 3, 'pass_depth': 1.5, 'safe_z': 8,
         'feed_rate': 3500, 'plunge_rate': 1000, 'spindle_rpm': 18000,
         'direction': 'climb', 'allowance': 0,
         'ramp': {'enabled': True, 'type': 'linear', 'length': 20, 'angle': 5}},
    ]


def _auto_layer_id(code: str, base: str, tool: str = '', depth: float = 0.0) -> str:
    """Generate a layer ID: {code}_{base}_{tool}_{depth}mm when tool/depth provided."""
    if tool and depth:
        return f'{code}_{base}_{tool}_{depth:.1f}mm'
    return f'{code}_{base}'


# ── DesignData ─────────────────────────────────────────────────────────────

class DesignData:
    """FIROO v2 parametric design model."""

    def __init__(self):
        self.design_code = 'NEW'
        self.name = 'New FIROO Door'; self.name_fa = 'درب جدید'
        self.category = 'custom_doors'; self.tags = []
        self.width = 900.0; self.height = 2100.0
        self.min_width = 250.0; self.min_height = 400.0
        self.max_width = 1600.0; self.max_height = 3000.0
        self.offsets = _default_offsets(self.design_code)
        self.border_patterns = _default_border(self.design_code)
        self.inner_pattern_settings = _default_inner(self.design_code)
        self.toolpaths = _default_toolpaths(self.design_code)
        self.preview_options = {'show_geometry': True, 'show_toolpaths': True,
                                'show_direction': True, 'show_rapid': False,
                                'show_vbit': True, 'show_pocket': True}
        self.notes = ''; self.tools = {}; self.pass_depth = 2.0
        self.pattern = {'enabled': False, 'type': 'none'}
        self.layers = []
        self._sync_compat_layers()

    def set_code(self, code: str):
        old = self.design_code
        self.design_code = (code or 'NEW').strip()
        for i, o in enumerate(self.offsets):
            o['layer_id'] = f'{self.design_code}_OF{i+1:02d}'
        for i, b in enumerate(self.border_patterns):
            tool = b.get('tool_id', 'T2')
            depth = float(b.get('cut_depth', 3.0))
            b['layer_id'] = _auto_layer_id(self.design_code, f'BORDER_{i+1:02d}', tool, depth)
        self.inner_pattern_settings['layer_id'] = f'{self.design_code}_INNER_DXF_01'
        for tp in self.toolpaths:
            lid = str(tp.get('layer_id', ''))
            tp['layer_id'] = lid.replace(old, self.design_code) if old and old != 'NEW' else lid
        self.toolpaths[0]['layer_id'] = f'{self.design_code}_OUTER_CUT'
        self._sync_compat_layers()

    def _sync_compat_layers(self):
        layers = [{'id': 0, 'name': 'Outer Cut', 'name_fa': 'برش بیرونی', 'type': 'profile',
                   'tool': 'T1', 'depth_mm': 18.0, 'offset_mm': 0.0, 'pass_count': 3, 'enabled': True}]
        total = 0.0
        for i, o in enumerate(self.offsets, start=1):
            if o.get('enabled', False):
                total += float(o.get('step', 0) or 0)
                layers.append({'id': i, 'name': o.get('layer_id', f'OF{i:02d}'),
                               'name_fa': o.get('name', f'OF{i}'), 'type': 'groove',
                               'tool': 'T2', 'depth_mm': 2.0, 'offset_mm': total,
                               'pass_count': 1, 'enabled': True})
        for b in self.border_patterns:
            if b.get('enabled', False):
                layers.append({'id': len(layers), 'name': b.get('layer_id', 'BORDER'),
                               'name_fa': 'Border Pattern', 'type': 'groove',
                               'tool': b.get('tool_id', 'T2'),
                               'depth_mm': float(b.get('cut_depth', 3.0)),
                               'offset_mm': 0.0, 'pass_count': 1, 'enabled': True})
        if self.inner_pattern_settings.get('enabled', False):
            layers.append({'id': len(layers),
                           'name': self.inner_pattern_settings.get('layer_id', 'INNER'),
                           'name_fa': 'Inner DXF', 'type': 'groove',
                           'tool': 'T2', 'depth_mm': 3.0, 'offset_mm': 0.0,
                           'pass_count': 1, 'enabled': True})
        self.layers = layers

    def offset_rows(self):
        return [OffsetRow(o.get('name', f'OF{i+1}'), float(o.get('step', 0) or 0),
                          bool(o.get('enabled', False)),
                          o.get('layer_id', f'{self.design_code}_OF{i+1:02d}'))
                for i, o in enumerate(self.offsets)]

    def generate_geometry(self) -> List[Dict]:
        rows = self.offset_rows()
        ents = generate_offset_entities(self.design_code, self.width, self.height, rows)
        totals = offset_total_map(self.width, self.height, rows)
        for b in self.border_patterns:
            if not b.get('enabled'):
                continue
            ents += generate_step_border(self.design_code, self.width, self.height,
                                         totals.get(b.get('from_offset', 'OF5'), 0),
                                         totals.get(b.get('to_offset', 'OF6'), 0), b)
        if self.inner_pattern_settings.get('enabled'):
            ents += preview_trim_boundary(self.design_code, self.width, self.height,
                                          totals.get(self.inner_pattern_settings.get('trim_offset', 'OF6'), 0),
                                          self.inner_pattern_settings)
        return ents

    def generate_toolpath_preview(self) -> List[Dict]:
        return generate_preview_paths(self.generate_geometry(), self.toolpaths)

    def to_dict(self) -> Dict:
        self._sync_compat_layers()
        return {
            'firoo_format': 'fdr', 'format_version': '2.0',
            'engine_architecture': 'firoo_three_engine_parametric',
            'design_code': self.design_code, 'name': self.name,
            'name_fa': self.name_fa, 'category': self.category, 'tags': self.tags,
            'default_size': {'width': self.width, 'height': self.height},
            'size_rules': {'min_width': self.min_width, 'min_height': self.min_height,
                           'max_width': self.max_width, 'max_height': self.max_height},
            'offset_engine': {'enabled': True, 'rows': self.offsets},
            'border_pattern_engine': {'slots': self.border_patterns},
            'inner_pattern_engine': self.inner_pattern_settings,
            'toolpaths': self.toolpaths, 'preview_options': self.preview_options,
            'notes': self.notes, 'layers': self.layers, 'pattern': self.pattern,
            'tools': self.tools, 'pass_depth_mm': self.pass_depth,
        }

    @classmethod
    def from_dict(cls, d: Dict):
        obj = cls()
        obj.design_code = d.get('design_code', d.get('code', 'NEW')) or 'NEW'
        obj.name = d.get('name', 'New FIROO Door')
        obj.name_fa = d.get('name_fa', '')
        obj.category = d.get('category', 'custom_doors')
        obj.tags = d.get('tags', [])
        sz = d.get('default_size', {})
        obj.width = float(sz.get('width', d.get('width', 900)) or 900)
        obj.height = float(sz.get('height', d.get('height', 2100)) or 2100)
        sr = d.get('size_rules', {})
        obj.min_width = float(sr.get('min_width', 250))
        obj.min_height = float(sr.get('min_height', 400))
        obj.max_width = float(sr.get('max_width', 1600))
        obj.max_height = float(sr.get('max_height', 3000))
        if d.get('format_version') == '2.0' or 'offset_engine' in d:
            obj.offsets = d.get('offset_engine', {}).get('rows', _default_offsets(obj.design_code))
            obj.border_patterns = d.get('border_pattern_engine', {}).get('slots', _default_border(obj.design_code))
            obj.inner_pattern_settings = d.get('inner_pattern_engine', _default_inner(obj.design_code))
            obj.toolpaths = d.get('toolpaths', _default_toolpaths(obj.design_code))
        else:
            obj.offsets = []
            prev = 0.0
            for lyr in d.get('layers', []):
                if lyr.get('type') == 'profile':
                    continue
                off = float(lyr.get('offset_mm', 0) or 0)
                if off > 0:
                    obj.offsets.append({'name': f'OF{len(obj.offsets)+1}',
                                        'step': max(0, off - prev), 'enabled': True,
                                        'layer_id': f'{obj.design_code}_OF{len(obj.offsets)+1:02d}'})
                    prev = off
            if not obj.offsets:
                obj.offsets = _default_offsets(obj.design_code)
            obj.border_patterns = _default_border(obj.design_code)
            obj.inner_pattern_settings = _default_inner(obj.design_code)
            obj.toolpaths = _default_toolpaths(obj.design_code)
        obj.preview_options = d.get('preview_options', obj.preview_options)
        obj.notes = d.get('notes', '')
        obj.tools = d.get('tools', {})
        obj.pass_depth = float(d.get('pass_depth_mm', 2) or 2)
        obj._sync_compat_layers()
        return obj

    def save(self, path: str) -> bool:
        try:
            Path(path).write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding='utf-8')
            return True
        except Exception as e:
            print('[DesignData] save error', e)
            return False

    @classmethod
    def load(cls, path: str) -> Optional['DesignData']:
        try:
            return cls.from_dict(json.loads(Path(path).read_text(encoding='utf-8')))
        except Exception as e:
            print('[DesignData] load error', path, e)
            return None


# ── DoorPreviewCanvas ──────────────────────────────────────────────────────

class DoorPreviewCanvas(QWidget):
    layer_clicked = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._design = None; self._zoom = 1.0; self._ox = 40; self._oy = 40
        self._drag = False; self._last = QPointF(); self._selected_layer = 0
        self.show_geometry = True; self.show_toolpaths = True
        self.show_direction = True; self.show_grid = False
        self.setMinimumSize(520, 420)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMouseTracking(True)

    def set_design(self, d, fit: bool = True):
        self._design = d
        if fit:
            self.fit_to_window()
        else:
            self.update()

    def set_selected_layer(self, idx):
        self._selected_layer = idx; self.update()

    def fit_to_window(self):
        if not self._design:
            return
        pad = 50
        aw = max(1, self.width() - 2 * pad)
        ah = max(1, self.height() - 2 * pad)
        self._zoom = min(aw / self._design.width, ah / self._design.height)
        self._ox = pad + (aw - self._design.width * self._zoom) / 2
        self._oy = pad + (ah - self._design.height * self._zoom) / 2
        self.update()

    def resizeEvent(self, e): self.fit_to_window()

    def wheelEvent(self, e):
        self._zoom = max(.05, min(20, self._zoom * (1.15 if e.angleDelta().y() > 0 else .87)))
        self.update()

    def mousePressEvent(self, e): self._drag = True; self._last = e.position()

    def mouseMoveEvent(self, e):
        if self._drag:
            p = e.position()
            self._ox += p.x() - self._last.x()
            self._oy += p.y() - self._last.y()
            self._last = p; self.update()

    def mouseReleaseEvent(self, e): self._drag = False
    def mouseDoubleClickEvent(self, e): self.fit_to_window()
    def _sx(self, x): return self._ox + x * self._zoom
    def _sy(self, y): return self._oy + (self._design.height - y) * self._zoom if self._design else y

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), C_BG)
        if not self._design:
            p.setPen(C_DIM); p.drawText(self.rect(), Qt.AlignCenter, 'No design'); return
        d = self._design; dw, dh = d.width, d.height
        if self.show_grid:
            p.setPen(QPen(QColor('#1a1f26'), 1)); step = 50
            x = 0
            while x <= dw:
                p.drawLine(int(self._sx(x)), int(self._sy(0)), int(self._sx(x)), int(self._sy(dh))); x += step
            y = 0
            while y <= dh:
                p.drawLine(int(self._sx(0)), int(self._sy(y)), int(self._sx(dw)), int(self._sy(y))); y += step
        door = QRectF(self._sx(0), self._sy(dh), dw * self._zoom, dh * self._zoom)
        grad = QLinearGradient(door.topLeft(), door.bottomRight())
        grad.setColorAt(0, QColor('#403022')); grad.setColorAt(1, QColor('#251a13'))
        p.fillRect(door, grad); p.setPen(QPen(QColor('#6b4c3b'), 2)); p.drawRect(door)
        ents = d.generate_geometry()
        for ent in ents:
            pts = ent.get('points') or []
            if len(pts) < 2:
                continue
            kind = ent.get('kind', '')
            col = (QColor('#e74c3c') if kind == 'outer' else
                   QColor('#58a6ff') if kind == 'offset' else
                   QColor('#ff9800') if kind == 'border_step' else
                   QColor('#e3b341'))
            p.setPen(QPen(col, 2 if kind == 'outer' else 1.2))
            for a, b in zip(pts, pts[1:]):
                p.drawLine(int(self._sx(a[0])), int(self._sy(a[1])),
                           int(self._sx(b[0])), int(self._sy(b[1])))
        if self.show_toolpaths:
            for path in d.generate_toolpath_preview():
                pts = path.get('points') or []
                if len(pts) < 2:
                    continue
                op = path.get('operation') or ''
                col = (QColor('#bf5af2') if 'v' in op or 'engraving' in op else
                       QColor('#3fb950') if 'pocket' in op else
                       QColor('#f85149'))
                pen = QPen(col, 1.6); pen.setStyle(Qt.DashLine); p.setPen(pen)
                for a, b in zip(pts, pts[1:]):
                    p.drawLine(int(self._sx(a[0])), int(self._sy(a[1])),
                               int(self._sx(b[0])), int(self._sy(b[1])))
                if self.show_direction and len(pts) > 1:
                    a, b2 = pts[0], pts[1]
                    p.setBrush(QBrush(col))
                    p.drawEllipse(QPointF(self._sx(b2[0]), self._sy(b2[1])), 3, 3)
        p.setPen(QPen(C_DIM, 1))
        f = QFont('Segoe UI'); f.setPixelSize(10); p.setFont(f)
        p.drawText(10, self.height() - 10,
                   f'{d.design_code}  |  {dw:.0f} × {dh:.0f} mm  |  '
                   f'Engines: Offset + Border + Inner + Toolpath Preview')
        p.end()


# ── ToolPickerDialog ───────────────────────────────────────────────────────

class ToolPickerDialog(QDialog):
    """Browse and select a tool from the tool library to populate a toolpath row."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle('Tool Database — Select Tool')
        self.setMinimumSize(740, 460)
        self._all_tools = []
        self._filtered = []
        self._build()
        self._load_tools()

    def _build(self):
        lay = QVBoxLayout(self)

        # Search / filter bar
        bar = QHBoxLayout()
        bar.addWidget(QLabel('Search:'))
        self._search = QLineEdit()
        self._search.setPlaceholderText('name or ID...')
        self._search.textChanged.connect(self._filter)
        bar.addWidget(self._search)

        self._type_cb = QComboBox()
        self._type_cb.addItem('All Types', '')
        for k, v in _TOOL_TYPE_NAMES.items():
            self._type_cb.addItem(v, k)
        self._type_cb.currentIndexChanged.connect(self._filter)
        bar.addWidget(self._type_cb)
        lay.addLayout(bar)

        # Tool table — read-only, row selection
        self._table = QTableWidget(0, 8)
        self._table.setHorizontalHeaderLabels(
            ['ID', 'Name', 'Type', 'Ø / Angle', 'RPM', 'Feed', 'Plunge', 'Pass Depth'])
        self._table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self._table.setAlternatingRowColors(True)
        self._table.doubleClicked.connect(self.accept)
        lay.addWidget(self._table)

        # Status label
        self._status = QLabel('No tool library found — showing empty list.')
        self._status.setStyleSheet(f'color:{C_DIM.name()};font-size:10px;')
        lay.addWidget(self._status)

        # Button row
        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.accepted.connect(self.accept)
        btns.rejected.connect(self.reject)
        lay.addWidget(btns)

    def _load_tools(self):
        try:
            from tool_library import ToolLibraryManager
            mgr = ToolLibraryManager()
            self._all_tools = mgr.all_tools()
            count = len(self._all_tools)
            self._status.setText(f'{count} tools loaded from library.')
        except Exception as e:
            self._all_tools = []
            self._status.setText(f'Tool library unavailable: {e}')
        self._filter()

    def _filter(self):
        txt = self._search.text().lower()
        type_key = self._type_cb.currentData() or ''
        self._filtered = [
            t for t in self._all_tools
            if (not txt or txt in t.name.lower() or txt in t.tool_id.lower())
            and (not type_key or t.tool_type == type_key)
        ]
        self._table.setRowCount(len(self._filtered))
        for r, t in enumerate(self._filtered):
            dia = (f'{int(t.angle)}°' if t.tool_type == 'vbit'
                   else f'Ø{t.diameter:.1f}mm')
            for c, v in enumerate([t.tool_id, t.name,
                                    _TOOL_TYPE_NAMES.get(t.tool_type, t.tool_type),
                                    dia, str(t.spindle_rpm), str(t.feed_rate),
                                    str(t.plunge_rate), str(t.pass_depth)]):
                self._table.setItem(r, c, QTableWidgetItem(v))

    def selected_tool(self):
        r = self._table.currentRow()
        if 0 <= r < len(self._filtered):
            return self._filtered[r]
        return None


# ── DesignEditorWidget ─────────────────────────────────────────────────────

class DesignEditorWidget(QWidget):
    design_saved = Signal(str)

    def __init__(self, parent=None, designs_dir=None):
        super().__init__(parent)
        self._designs_dir = (Path(designs_dir) if designs_dir
                             else Path(config.output_folder).parent / 'designs')
        self._designs_dir.mkdir(parents=True, exist_ok=True)
        self._design = DesignData()
        self._filepath = ''; self._modified = False; self._updating = False
        self._preview_timer = QTimer(self)
        self._preview_timer.setInterval(250)
        self._preview_timer.setSingleShot(True)
        self._preview_timer.timeout.connect(self._refresh_preview)
        self._build_ui(); self._apply_style(); self._refresh_all()

    # ── UI Construction ────────────────────────────────────────────────────

    def _build_ui(self):
        root = QVBoxLayout(self); root.setContentsMargins(0, 0, 0, 0); root.setSpacing(0)
        root.addWidget(self._toolbar())
        split = QSplitter(Qt.Horizontal)
        left = QWidget(); ll = QVBoxLayout(left); ll.setContentsMargins(8, 8, 8, 8)
        self._tabs = QTabWidget()
        self._tabs.addTab(self._tab_info(), 'Design Info')
        self._tabs.addTab(self._tab_offsets(), 'Offsets')
        self._tabs.addTab(self._tab_border(), 'Border Pattern')
        self._tabs.addTab(self._tab_inner(), 'Inner Pattern')
        self._tabs.addTab(self._tab_toolpaths(), 'Layers / Toolpath')
        self._tabs.addTab(self._tab_validate(), 'Save / Validate')
        ll.addWidget(self._tabs); split.addWidget(left)
        right = QWidget(); rl = QVBoxLayout(right); rl.setContentsMargins(0, 0, 0, 0)
        bar = QHBoxLayout(); bar.setContentsMargins(8, 4, 8, 4)
        bar.addWidget(QLabel('Real-Time Preview'))
        self._chk_geom = QCheckBox('Geometry'); self._chk_geom.setChecked(True)
        self._chk_tp = QCheckBox('Toolpaths'); self._chk_tp.setChecked(True)
        self._chk_dir = QCheckBox('Direction'); self._chk_dir.setChecked(True)
        self._chk_grid = QCheckBox('Grid')
        for c in [self._chk_geom, self._chk_tp, self._chk_dir, self._chk_grid]:
            c.toggled.connect(self._view_changed); bar.addWidget(c)
        bar.addStretch(); rl.addLayout(bar)
        self._canvas = DoorPreviewCanvas()
        rl.addWidget(self._canvas, 1)
        split.addWidget(right); split.setSizes([470, 820])
        root.addWidget(split, 1)
        self._btn_fit.clicked.connect(self._canvas.fit_to_window)
        self._status = QLabel(' Ready'); self._status.setFixedHeight(22)
        root.addWidget(self._status)

    def _toolbar(self):
        tb = QFrame(); lay = QHBoxLayout(tb); lay.setContentsMargins(6, 4, 6, 4); lay.setSpacing(6)
        def b(txt):
            x = QPushButton(txt); x.setFixedHeight(32); return x
        self._btn_new = b('⊕ New'); self._btn_open = b('📂 Open')
        self._btn_save = b('💾 Save'); self._btn_saveas = b('💾 Save As')
        self._btn_dxf = b('⬇ Generate DXF'); self._btn_fit = b('⊡ Fit')
        for w in [self._btn_new, self._btn_open, self._btn_save,
                  self._btn_saveas, self._btn_dxf, self._btn_fit]:
            lay.addWidget(w)
        lay.addStretch()
        self._mod = QLabel(''); lay.addWidget(self._mod)
        self._btn_new.clicked.connect(self._new_design)
        self._btn_open.clicked.connect(self._open_design)
        self._btn_save.clicked.connect(self._save_design)
        self._btn_saveas.clicked.connect(self._save_as)
        self._btn_dxf.clicked.connect(self._generate_dxf)
        return tb

    def _spin(self, lo, hi, val, dec=1, step=1, suffix=''):
        s = QDoubleSpinBox()
        s.setRange(lo, hi); s.setDecimals(dec); s.setValue(val)
        s.setSingleStep(step); s.setSuffix(suffix)
        s.editingFinished.connect(self._mark_changed)
        return s

    def _tab_info(self):
        w = QWidget(); f = QFormLayout(w)
        # Fix 1: Design Code → editable QComboBox with standard codes
        self._code = QComboBox()
        self._code.setEditable(True)
        self._code.addItems(STANDARD_CODES)
        self._code.setCurrentText('NEW')
        self._name = QLineEdit(); self._namefa = QLineEdit()
        self._cat = QComboBox()
        self._cat.addItems(['custom_doors', 'modern', 'classic', 'vitrines', 'decorative', 'others'])
        self._width = self._spin(50, 5000, 900, 1, 10, ' mm')
        self._height = self._spin(50, 5000, 2100, 1, 10, ' mm')
        self._minw = self._spin(50, 5000, 250, 1, 10, ' mm')
        self._minh = self._spin(50, 5000, 400, 1, 10, ' mm')
        self._maxw = self._spin(50, 5000, 1600, 1, 10, ' mm')
        self._maxh = self._spin(50, 5000, 3000, 1, 10, ' mm')
        self._code.editTextChanged.connect(self._mark_changed)
        for x in [self._name, self._namefa]:
            x.textChanged.connect(self._mark_changed)
        self._cat.currentIndexChanged.connect(self._mark_changed)
        f.addRow('Design Code', self._code)
        f.addRow('Name', self._name)
        f.addRow('Persian Name', self._namefa)
        f.addRow('Group', self._cat)
        f.addRow('Default Width', self._width)
        f.addRow('Default Height', self._height)
        f.addRow('Min Width', self._minw)
        f.addRow('Min Height', self._minh)
        f.addRow('Max Width', self._maxw)
        f.addRow('Max Height', self._maxh)
        return w

    def _tab_offsets(self):
        w = QWidget(); lay = QVBoxLayout(w)
        self._off_table = QTableWidget(15, 4)
        self._off_table.setHorizontalHeaderLabels(['Enable', 'Name', 'Step mm', 'Layer ID'])
        self._off_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self._off_table.itemChanged.connect(self._table_changed)
        lay.addWidget(self._off_table)
        return w

    def _tab_border(self):
        w = QWidget(); f = QFormLayout(w)
        self._border_enabled = QCheckBox('Enable Step Border V1')
        self._border_from = QComboBox(); self._border_to = QComboBox()
        for c in [self._border_from, self._border_to]:
            c.addItems([f'OF{i}' for i in range(1, 16)])
            c.currentIndexChanged.connect(self._mark_changed)
        # Tool ID and depth for auto Layer ID format: {code}_BORDER_01_{tool}_{depth}mm
        self._border_tool = QLineEdit('T2')
        self._border_tool.setPlaceholderText('e.g. T2')
        self._border_depth = self._spin(0.1, 50, 3.0, 1, 0.5, ' mm')
        self._border_layer = QLineEdit()
        self._border_layer.setPlaceholderText('auto-generated')
        self._border_corner = self._spin(0, 500, 8, 1, 1, ' mm')
        self._border_pitch = self._spin(1, 500, 60, 1, 1, ' mm')
        self._border_stepw = self._spin(1, 500, 22, 1, 1, ' mm')
        self._border_enabled.toggled.connect(self._mark_changed)
        self._border_layer.textChanged.connect(self._mark_changed)
        self._border_tool.textChanged.connect(self._on_border_params_changed)
        self._border_depth.editingFinished.connect(self._on_border_params_changed)
        f.addRow('', self._border_enabled)
        f.addRow('From Offset', self._border_from)
        f.addRow('To Offset', self._border_to)
        f.addRow('Tool ID', self._border_tool)
        f.addRow('Cut Depth', self._border_depth)
        f.addRow('Layer ID', self._border_layer)
        f.addRow('Corner Clearance', self._border_corner)
        f.addRow('Target Pitch', self._border_pitch)
        f.addRow('Step Width', self._border_stepw)
        return w

    def _tab_inner(self):
        w = QWidget(); f = QFormLayout(w)
        row = QHBoxLayout()
        self._inner_dxf = QLineEdit(); self._inner_browse = QPushButton('Browse')
        row.addWidget(self._inner_dxf); row.addWidget(self._inner_browse)
        self._inner_enabled = QCheckBox('Enable Inner DXF Center Trim')
        self._inner_trim = QComboBox()
        self._inner_trim.addItems([f'OF{i}' for i in range(1, 16)])
        self._inner_adjust = self._spin(-500, 500, 0, 1, 1, ' mm')
        self._inner_sx = self._spin(.01, 100, 1, 3, .05, ' ×')
        self._inner_sy = self._spin(.01, 100, 1, 3, .05, ' ×')
        self._inner_link = QCheckBox('Link X/Y'); self._inner_link.setChecked(True)
        self._inner_rot = self._spin(-360, 360, 0, 1, 1, ' °')
        self._inner_layer = QLineEdit()
        self._inner_close = QCheckBox('Close Trimmed Curves'); self._inner_close.setChecked(True)
        self._inner_policy = QComboBox()
        self._inner_policy.addItems(['only_originally_closed', 'all_trimmed', 'off'])
        self._inner_method = QComboBox()
        self._inner_method.addItems(['boundary_shortest_path', 'boundary_clockwise',
                                     'boundary_counterclockwise', 'straight_line'])
        self._inner_browse.clicked.connect(self._browse_inner)
        self._inner_enabled.toggled.connect(self._mark_changed)
        self._inner_dxf.textChanged.connect(self._mark_changed)
        self._inner_trim.currentIndexChanged.connect(self._mark_changed)
        self._inner_layer.textChanged.connect(self._mark_changed)
        self._inner_link.toggled.connect(self._mark_changed)
        self._inner_close.toggled.connect(self._mark_changed)
        self._inner_policy.currentIndexChanged.connect(self._mark_changed)
        self._inner_method.currentIndexChanged.connect(self._mark_changed)
        f.addRow('', self._inner_enabled)
        f.addRow('DXF File', row)
        f.addRow('Trim Offset', self._inner_trim)
        f.addRow('Trim Adjust', self._inner_adjust)
        f.addRow('Scale X', self._inner_sx)
        f.addRow('Scale Y', self._inner_sy)
        f.addRow('', self._inner_link)
        f.addRow('Rotation', self._inner_rot)
        f.addRow('Layer ID', self._inner_layer)
        f.addRow('', self._inner_close)
        f.addRow('Close Policy', self._inner_policy)
        f.addRow('Close Method', self._inner_method)
        return w

    def _tab_toolpaths(self):
        w = QWidget(); lay = QVBoxLayout(w)
        hint = QLabel('Column "Tool": click to open Tool Database and auto-fill row parameters.')
        hint.setStyleSheet(f'color:{C_DIM.name()};font-size:10px;')
        lay.addWidget(hint)
        self._tp_table = QTableWidget(8, 13)
        self._tp_table.setHorizontalHeaderLabels([
            'Layer ID', 'Operation', 'Tool', 'Start', 'Depth', 'Pass',
            'Safe Z', 'Feed', 'Plunge', 'RPM', 'Direction', 'Ramp', 'Ramp Len'])
        self._tp_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self._tp_table.itemChanged.connect(self._table_changed)
        # Fix 4: clicking Tool column opens tool picker
        self._tp_table.cellClicked.connect(self._on_tp_cell_clicked)
        lay.addWidget(self._tp_table)
        return w

    def _tab_validate(self):
        w = QWidget(); lay = QVBoxLayout(w)
        self._validate_text = QTextEdit(); self._validate_text.setReadOnly(True)
        self._btn_validate = QPushButton('Validate Model')
        self._btn_validate.clicked.connect(self._validate_model)
        lay.addWidget(self._btn_validate); lay.addWidget(self._validate_text)
        return w

    # ── Event handlers ─────────────────────────────────────────────────────

    def _browse_inner(self):
        p, _ = QFileDialog.getOpenFileName(self, 'Select Inner Pattern DXF',
                                           str(Path.home()), 'DXF Files (*.dxf);;All Files (*)')
        if p:
            self._inner_dxf.setText(p)

    def _view_changed(self):
        if not hasattr(self, '_canvas') or self._canvas is None:
            return
        self._canvas.show_geometry = self._chk_geom.isChecked()
        self._canvas.show_toolpaths = self._chk_tp.isChecked()
        self._canvas.show_direction = self._chk_dir.isChecked()
        self._canvas.show_grid = self._chk_grid.isChecked()
        self._canvas.update()

    def _on_border_params_changed(self):
        """Auto-update border Layer ID when tool or depth changes."""
        if self._updating:
            return
        code = self._code.currentText().strip() or 'NEW'
        tool = self._border_tool.text().strip() or 'T2'
        depth = self._border_depth.value()
        new_id = _auto_layer_id(code, 'BORDER_01', tool, depth)
        cur = self._border_layer.text()
        # Only overwrite if it still looks like an auto-generated ID
        if not cur or re.match(r'^[A-Za-z0-9]+_BORDER_\d+', cur):
            self._border_layer.blockSignals(True)
            self._border_layer.setText(new_id)
            self._border_layer.blockSignals(False)
        self._mark_changed()

    def _on_tp_cell_clicked(self, row: int, col: int):
        """Fix 4: clicking Tool column (col 2) opens the tool picker dialog."""
        if col != 2:
            return
        dlg = ToolPickerDialog(self)
        if dlg.exec() == QDialog.Accepted:
            tool = dlg.selected_tool()
            if tool:
                self._tp_table.blockSignals(True)
                self._tp_table.setItem(row, 2, QTableWidgetItem(tool.tool_id))
                self._tp_table.setItem(row, 5, QTableWidgetItem(str(tool.pass_depth)))
                self._tp_table.setItem(row, 6, QTableWidgetItem(str(tool.safe_z)))
                self._tp_table.setItem(row, 7, QTableWidgetItem(str(tool.feed_rate)))
                self._tp_table.setItem(row, 8, QTableWidgetItem(str(tool.plunge_rate)))
                self._tp_table.setItem(row, 9, QTableWidgetItem(str(tool.spindle_rpm)))
                self._tp_table.blockSignals(False)
                self._mark_changed()

    def _table_changed(self, *a): self._mark_changed()

    def _mark_changed(self, *a):
        if self._updating:
            return
        self._sync_from_ui()
        self._modified = True
        self._mod.setText('Modified')
        self._preview_timer.start()

    def _refresh_preview(self):
        if not hasattr(self, '_canvas') or self._canvas is None:
            return
        # Fix 1: fit=False preserves user zoom/pan during live editing
        self._canvas.set_design(self._design, fit=False)

    def _refresh_all(self):
        self._updating = True
        self._load_ui()
        self._updating = False
        # fit=True only on explicit reload (new/open)
        self._canvas.set_design(self._design, fit=True)
        self._validate_model()

    # ── Data ↔ UI sync ─────────────────────────────────────────────────────

    def _load_ui(self):
        d = self._design

        # Design Info — block signals to prevent re-entrant _mark_changed
        self._code.blockSignals(True); self._code.setCurrentText(d.design_code); self._code.blockSignals(False)
        self._name.blockSignals(True); self._name.setText(d.name); self._name.blockSignals(False)
        self._namefa.blockSignals(True); self._namefa.setText(d.name_fa); self._namefa.blockSignals(False)
        self._cat.blockSignals(True); self._cat.setCurrentText(d.category); self._cat.blockSignals(False)
        for sp, val in [(self._width, d.width), (self._height, d.height),
                        (self._minw, d.min_width), (self._minh, d.min_height),
                        (self._maxw, d.max_width), (self._maxh, d.max_height)]:
            sp.blockSignals(True); sp.setValue(val); sp.blockSignals(False)

        # Offsets — Fix 3: Enable column uses QCheckBox widget
        self._off_table.blockSignals(True)
        for r, o in enumerate(d.offsets):
            # Create centered-checkbox container widget
            container = QWidget(); hlay = QHBoxLayout(container)
            hlay.setContentsMargins(0, 0, 0, 0); hlay.setAlignment(Qt.AlignCenter)
            cb = QCheckBox(); cb.setChecked(bool(o.get('enabled', False)))
            cb.toggled.connect(self._mark_changed)
            hlay.addWidget(cb)
            self._off_table.setCellWidget(r, 0, container)
            self._off_table.setItem(r, 1, QTableWidgetItem(o.get('name', f'OF{r+1}')))
            self._off_table.setItem(r, 2, QTableWidgetItem(str(o.get('step', 0))))
            self._off_table.setItem(r, 3, QTableWidgetItem(
                o.get('layer_id', f'{d.design_code}_OF{r+1:02d}')))
        self._off_table.blockSignals(False)

        # Border Pattern
        b = (d.border_patterns[0] if d.border_patterns
             else _default_border(d.design_code)[0])
        self._border_enabled.blockSignals(True)
        self._border_enabled.setChecked(b.get('enabled', False))
        self._border_enabled.blockSignals(False)
        self._border_from.blockSignals(True); self._border_from.setCurrentText(b.get('from_offset', 'OF5')); self._border_from.blockSignals(False)
        self._border_to.blockSignals(True); self._border_to.setCurrentText(b.get('to_offset', 'OF6')); self._border_to.blockSignals(False)
        self._border_tool.blockSignals(True); self._border_tool.setText(b.get('tool_id', 'T2')); self._border_tool.blockSignals(False)
        self._border_depth.blockSignals(True); self._border_depth.setValue(float(b.get('cut_depth', 3.0))); self._border_depth.blockSignals(False)
        # Auto-generate border Layer ID from current code + tool + depth
        auto_lid = _auto_layer_id(d.design_code, 'BORDER_01', b.get('tool_id', 'T2'), float(b.get('cut_depth', 3.0)))
        self._border_layer.blockSignals(True); self._border_layer.setText(b.get('layer_id', auto_lid)); self._border_layer.blockSignals(False)
        self._border_corner.blockSignals(True); self._border_corner.setValue(float(b.get('corner_clearance', 8))); self._border_corner.blockSignals(False)
        self._border_pitch.blockSignals(True); self._border_pitch.setValue(float(b.get('target_pitch', 60))); self._border_pitch.blockSignals(False)
        self._border_stepw.blockSignals(True); self._border_stepw.setValue(float(b.get('step_width', 22))); self._border_stepw.blockSignals(False)

        # Inner Pattern
        inn = d.inner_pattern_settings
        self._inner_enabled.blockSignals(True); self._inner_enabled.setChecked(inn.get('enabled', False)); self._inner_enabled.blockSignals(False)
        self._inner_dxf.blockSignals(True); self._inner_dxf.setText(inn.get('dxf_file', '')); self._inner_dxf.blockSignals(False)
        self._inner_trim.blockSignals(True); self._inner_trim.setCurrentText(inn.get('trim_offset', 'OF6')); self._inner_trim.blockSignals(False)
        self._inner_adjust.blockSignals(True); self._inner_adjust.setValue(float(inn.get('trim_offset_adjust', 0))); self._inner_adjust.blockSignals(False)
        self._inner_sx.blockSignals(True); self._inner_sx.setValue(float(inn.get('scale_x', 1))); self._inner_sx.blockSignals(False)
        self._inner_sy.blockSignals(True); self._inner_sy.setValue(float(inn.get('scale_y', 1))); self._inner_sy.blockSignals(False)
        self._inner_link.blockSignals(True); self._inner_link.setChecked(bool(inn.get('link_scale', True))); self._inner_link.blockSignals(False)
        self._inner_rot.blockSignals(True); self._inner_rot.setValue(float(inn.get('rotation_deg', 0))); self._inner_rot.blockSignals(False)
        self._inner_layer.blockSignals(True); self._inner_layer.setText(inn.get('layer_id', f'{d.design_code}_INNER_DXF_01')); self._inner_layer.blockSignals(False)
        self._inner_close.blockSignals(True); self._inner_close.setChecked(bool(inn.get('close_trimmed_curves', True))); self._inner_close.blockSignals(False)
        self._inner_policy.blockSignals(True); self._inner_policy.setCurrentText(inn.get('close_policy', 'only_originally_closed')); self._inner_policy.blockSignals(False)
        self._inner_method.blockSignals(True); self._inner_method.setCurrentText(inn.get('close_method', 'boundary_shortest_path')); self._inner_method.blockSignals(False)

        # Toolpaths
        self._tp_table.blockSignals(True)
        self._tp_table.setRowCount(max(8, len(d.toolpaths)))
        for r, tp in enumerate(d.toolpaths):
            vals = [tp.get('layer_id', ''), tp.get('operation', ''), tp.get('tool_id', ''),
                    tp.get('start_depth', 0), tp.get('cut_depth', 0), tp.get('pass_depth', 0),
                    tp.get('safe_z', 8), tp.get('feed_rate', 0), tp.get('plunge_rate', 0),
                    tp.get('spindle_rpm', 0), tp.get('direction', 'climb'),
                    '1' if tp.get('ramp', {}).get('enabled') else '0',
                    tp.get('ramp', {}).get('length', 0)]
            for c, v in enumerate(vals):
                self._tp_table.setItem(r, c, QTableWidgetItem(str(v)))
        self._tp_table.blockSignals(False)

    def _sync_from_ui(self):
        d = self._design
        # Fix 1: read from QComboBox
        code = self._code.currentText().strip() or 'NEW'
        d.design_code = code
        d.name = self._name.text()
        d.name_fa = self._namefa.text()
        d.category = self._cat.currentText()
        d.width = self._width.value(); d.height = self._height.value()
        d.min_width = self._minw.value(); d.min_height = self._minh.value()
        d.max_width = self._maxw.value(); d.max_height = self._maxh.value()

        # Offsets — Fix 3: read enabled state from QCheckBox widget
        offs = []
        for r in range(self._off_table.rowCount()):
            name = (self._off_table.item(r, 1).text()
                    if self._off_table.item(r, 1) else f'OF{r+1}') or f'OF{r+1}'
            try:
                step = float(self._off_table.item(r, 2).text()) if self._off_table.item(r, 2) else 0
            except Exception:
                step = 0
            container = self._off_table.cellWidget(r, 0)
            cb = container.findChild(QCheckBox) if container else None
            enabled = cb.isChecked() if cb else False
            layer = (self._off_table.item(r, 3).text()
                     if self._off_table.item(r, 3) else f'{code}_OF{r+1:02d}')
            offs.append({'name': name, 'step': step, 'enabled': enabled, 'layer_id': layer})
        d.offsets = offs

        # Border Pattern
        b_tool = self._border_tool.text().strip() or 'T2'
        b_depth = self._border_depth.value()
        b_layer = self._border_layer.text().strip() or _auto_layer_id(code, 'BORDER_01', b_tool, b_depth)
        d.border_patterns = [{
            'slot': 1, 'enabled': self._border_enabled.isChecked(),
            'pattern_id': 'step_border_v1',
            'from_offset': self._border_from.currentText(),
            'to_offset': self._border_to.currentText(),
            'layer_id': b_layer,
            'corner_clearance': self._border_corner.value(),
            'target_pitch': self._border_pitch.value(),
            'step_width': self._border_stepw.value(),
            'rounding_mode': 'nearest', 'close_joined': True,
            'tool_id': b_tool, 'cut_depth': b_depth,
        }]

        # Inner Pattern
        d.inner_pattern_settings = {
            'enabled': self._inner_enabled.isChecked(),
            'pattern_type': 'imported_dxf_center_trim',
            'dxf_file': self._inner_dxf.text().strip(),
            'trim_offset': self._inner_trim.currentText(),
            'trim_offset_adjust': self._inner_adjust.value(),
            'layer_id': self._inner_layer.text().strip() or f'{code}_INNER_DXF_01',
            'scale_x': self._inner_sx.value(), 'scale_y': self._inner_sy.value(),
            'link_scale': self._inner_link.isChecked(),
            'rotation_deg': self._inner_rot.value(),
            'close_trimmed_curves': self._inner_close.isChecked(),
            'close_policy': self._inner_policy.currentText(),
            'close_method': self._inner_method.currentText(),
        }

        # Toolpaths
        tps = []
        for r in range(self._tp_table.rowCount()):
            layer = (self._tp_table.item(r, 0).text().strip()
                     if self._tp_table.item(r, 0) else '')
            if not layer:
                continue
            def val(c, default=0, _r=r):
                try:
                    return float(self._tp_table.item(_r, c).text()) if self._tp_table.item(_r, c) else default
                except Exception:
                    return default
            tps.append({
                'layer_id': layer,
                'operation': (self._tp_table.item(r, 1).text()
                              if self._tp_table.item(r, 1) else 'on_line_profile'),
                'tool_id': (self._tp_table.item(r, 2).text()
                            if self._tp_table.item(r, 2) else 'T1'),
                'start_depth': val(3), 'cut_depth': val(4), 'pass_depth': val(5),
                'safe_z': val(6, 8), 'feed_rate': val(7), 'plunge_rate': val(8),
                'spindle_rpm': val(9),
                'direction': (self._tp_table.item(r, 10).text()
                              if self._tp_table.item(r, 10) else 'climb'),
                'ramp': {
                    'enabled': (self._tp_table.item(r, 11).text().strip()
                                if self._tp_table.item(r, 11) else '0') in ('1', 'true', 'True', 'yes'),
                    'type': 'linear', 'length': val(12, 0), 'angle': 5,
                },
                'allowance': 0,
            })
        d.toolpaths = tps or _default_toolpaths(code)
        d._sync_compat_layers()

    # ── Validation ─────────────────────────────────────────────────────────

    def _validate_model(self):
        self._sync_from_ui()
        d = self._design; msgs = []
        if not d.design_code or d.design_code == 'NEW':
            msgs.append('⚠ Design Code should be set before saving.')
        if d.width < d.min_width or d.height < d.min_height:
            msgs.append('❌ Size is smaller than minimum rule.')
        totals = offset_total_map(d.width, d.height, d.offset_rows())
        max_total = max(totals.values() or [0])
        if max_total >= min(d.width, d.height) / 2:
            msgs.append('❌ Offset total is larger than half of smallest dimension.')
        if d.inner_pattern_settings.get('enabled') and not d.inner_pattern_settings.get('dxf_file'):
            msgs.append('⚠ Inner Pattern enabled but DXF file is empty.')
        if not msgs:
            msgs.append('✅ Model validation OK. Ready to save / generate DXF.')
        self._validate_text.setPlainText('\n'.join(msgs))
        return msgs

    # ── File operations ────────────────────────────────────────────────────

    def _new_design(self):
        self._design = DesignData(); self._filepath = ''
        self._modified = False; self._mod.setText('')
        self._refresh_all(); self._status.setText(' New FIROO design')

    def load_design(self, code_or_path: str) -> bool:
        p = Path(str(code_or_path))
        if not p.exists():
            for ext in (FDR_EXTENSION, '.json'):
                q = self._designs_dir / f'{code_or_path}{ext}'
                if q.exists():
                    p = q; break
        if not p.exists():
            QMessageBox.critical(self, 'Open Error', f'Cannot find design: {code_or_path}')
            return False
        d = DesignData.load(str(p))
        if not d:
            QMessageBox.critical(self, 'Open Error', f'Cannot read: {p}')
            return False
        self._design = d; self._filepath = str(p)
        self._modified = False; self._mod.setText('')
        self._refresh_all(); self._status.setText(f' Opened: {p.name}')
        return True

    def _open_design(self):
        p, _ = QFileDialog.getOpenFileName(
            self, 'Open FIROO Design', str(self._designs_dir),
            f'FIROO Design (*{FDR_EXTENSION});;JSON (*.json);;All Files (*)')
        if p:
            self.load_design(p)

    def _save_design(self):
        if not self._filepath:
            return self._save_as()
        self._do_save(self._filepath)

    def _save_as(self):
        self._sync_from_ui()
        default = str(self._designs_dir / f'{self._design.design_code or "design"}{FDR_EXTENSION}')
        p, _ = QFileDialog.getSaveFileName(
            self, 'Save FIROO Design', default,
            f'FIROO Design (*{FDR_EXTENSION});;All Files (*)')
        if p:
            if not p.endswith(FDR_EXTENSION):
                p += FDR_EXTENSION
            self._filepath = p; self._do_save(p)

    def _do_save(self, path):
        self._sync_from_ui()
        if self._design.save(path):
            self._modified = False; self._mod.setText('')
            self._status.setText(f' Saved: {Path(path).name}')
            self.design_saved.emit(path); self._update_index()
        else:
            QMessageBox.critical(self, 'Save Error', f'Cannot save: {path}')

    def _update_index(self):
        designs = []
        for fp in sorted(self._designs_dir.glob(f'*{FDR_EXTENSION}')):
            d = DesignData.load(str(fp))
            if d:
                designs.append({'code': d.design_code, 'name': d.name,
                                 'name_fa': d.name_fa, 'category': d.category,
                                 'file': fp.name, 'tags': d.tags})
        (self._designs_dir / '_index.json').write_text(
            json.dumps({'library': 'FIROO CAM Parametric Design Studio',
                        'version': '2.0', 'designs': designs},
                       ensure_ascii=False, indent=2), encoding='utf-8')

    def _generate_dxf(self):
        self._sync_from_ui()
        default = str(Path(config.output_folder) / f'{self._design.design_code}_design.dxf')
        p, _ = QFileDialog.getSaveFileName(
            self, 'Generate Design DXF', default, 'DXF Files (*.dxf);;All Files (*)')
        if not p:
            return
        if not p.lower().endswith('.dxf'):
            p += '.dxf'
        write_r12_polyline(self._design.generate_geometry(), p)
        QMessageBox.information(self, 'DXF Export', f'DXF generated:\n{p}')

    def _apply_style(self):
        self.setStyleSheet(
            f"QWidget{{background:{C_BG.name()};color:{C_TEXT.name()};"
            f"font-family:Segoe UI;font-size:12px;}}"
            f"QFrame{{background:{C_PANEL.name()};border:0;}}"
            f"QTabWidget::pane{{border:1px solid {C_BORDER.name()};}}"
            f"QTabBar::tab{{background:{C_PANEL2.name()};padding:7px 12px;"
            f"border:1px solid {C_BORDER.name()};}}"
            f"QTabBar::tab:selected{{background:#1f6feb;color:white;}}"
            f"QLineEdit,QComboBox,QDoubleSpinBox,QSpinBox,"
            f"QTableWidget,QTextEdit{{background:#111820;color:{C_TEXT.name()};"
            f"border:1px solid {C_BORDER.name()};border-radius:3px;}}"
            f"QPushButton{{background:{C_PANEL2.name()};border:1px solid {C_BORDER.name()};"
            f"border-radius:4px;padding:5px 10px;}}"
            f"QPushButton:hover{{border-color:{C_ACCENT.name()};}}"
            f"QLabel{{background:transparent;}}"
            f"QCheckBox{{background:transparent;}}"
        )


if __name__ == '__main__':
    import sys
    from PySide6.QtWidgets import QApplication
    app = QApplication(sys.argv)
    w = DesignEditorWidget()
    w.resize(1280, 760)
    w.show()
    sys.exit(app.exec())
