"""
FIROO CAM - Nesting Engine v3.1 CPU-safe
Industrial rectangular nesting core:
- MaxRects multi-variant packing
- order-preserving sort mode so optimizer decisions are real
- multi-start population
- simulated annealing / local search
- time-based continuous optimization
- strategy-aware scoring:
  Best Efficiency / Balanced Repeats / Prefer Repeats
- live best_result updates for UI preview
"""
from __future__ import annotations

import time
import random
import math
import threading
from typing import List, Optional, Tuple
from dataclasses import dataclass, field
from copy import deepcopy

from rectpack import newPacker, PackingMode, SORT_AREA, SORT_LSIDE, SORT_RATIO
try:
    from rectpack import SORT_NONE
except Exception:
    def SORT_NONE(rects):
        return rects

from rectpack import MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf
from data_models import Part, Sheet
from config import config


@dataclass
class SheetDef:
    name:       str   = "Sheet"
    width:      float = 2800.0
    height:     float = 1220.0
    thickness:  float = 18.0
    material:   str   = "MDF"
    quantity:   int   = 999
    priority:   int   = 3  # 1=Highest 2=High 3=Normal 4=Low 5=Lowest
    is_remnant: bool  = False

    def __str__(self):
        tag = "🔸Remnant" if self.is_remnant else "📦Sheet"
        return f"{tag} {self.name} {self.width}×{self.height} P{self.priority}"


@dataclass
class NestResult:
    sheets:      List[Sheet] = field(default_factory=list)
    utilization: float = 0.0
    total_parts: int   = 0
    sheet_count: int   = 0
    algorithm:   str   = ""
    generation:  int   = 0
    time_ms:     float = 0.0
    rank:        int   = 0
    strategy:    str   = "best_efficiency"
    fitness:     float = 0.0
    unique_nests:int   = 0
    max_repeat:  int   = 1

    def score(self) -> float:
        """Backward-compatible score used if the engine did not assign fitness."""
        if self.fitness:
            return self.fitness
        return self.total_parts * 100000 + self.utilization * 100 - self.sheet_count * 1000

    def __str__(self):
        return (f"Rank:{self.rank:2} | Util:{self.utilization:5.1f}% | "
                f"Sheets:{self.sheet_count} | Parts:{self.total_parts} | "
                f"Repeat:{self.max_repeat} | Unique:{self.unique_nests} | "
                f"Gen:{self.generation} | {self.algorithm}")


class NestingEngine:
    PACK_ALGOS = [MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf]

    def __init__(self):
        self.gap           = config.part_gap
        self.margin        = config.edge_margin
        self.margin_top    = config.edge_margin
        self.margin_left   = config.edge_margin
        self.margin_right  = config.edge_margin
        self.margin_bottom = config.edge_margin
        self.auto_rotate   = config.get("nesting", "auto_rotation")
        self.direction     = "bottom_left"
        self.direction_deg = 270
        self.strategy      = "best_efficiency"
        self.sheet_defs: List[SheetDef] = []
        self.all_results: List[NestResult] = []
        self.best_result: Optional[NestResult] = None
        self._start_time = 0.0
        self._add_default_sheet()

    def _add_default_sheet(self):
        self.sheet_defs = [SheetDef(
            name="Default", width=config.sheet_width,
            height=config.sheet_height, priority=3, quantity=999
        )]

    def set_sheets(self, sheet_defs: List[SheetDef]):
        # Solid-style rule: remnants first, then priority, then smaller area.
        self.sheet_defs = sorted(
            sheet_defs,
            key=lambda s: (
                0 if s.is_remnant else 1,
                int(s.priority or 3),
                float(s.width) * float(s.height),
            )
        )

    def add_remnant(self, name, width, height, priority=1):
        self.sheet_defs.insert(0, SheetDef(
            name=name, width=width, height=height,
            priority=priority, quantity=1, is_remnant=True))

    # ──────────────────────────────────────────────────────────
    # Public APIs
    # ──────────────────────────────────────────────────────────

    def run(self, parts: List[Part], generations=20, population=15,
            time_limit=8.0) -> List[Sheet]:
        """Compatibility API. Runs industrial continuous optimizer for time_limit."""
        stop_event = threading.Event()
        return self.run_continuous(
            parts=parts,
            stop_event=stop_event,
            on_progress=None,
            time_limit=float(time_limit),
            population=max(6, min(10, int(population or 8))),
        )

    def run_continuous(self, parts: List[Part], stop_event,
                       on_progress=None, time_limit: Optional[float] = None,
                       population: int = 10,
                       progress_interval: float = 1.0,
                       cpu_yield: float = 0.006,
                       deep_search: bool = False) -> List[Sheet]:
        """Industrial time-based optimizer.

        Runs until:
        - stop_event is set by UI Stop button, or
        - time_limit seconds is reached.

        on_progress callback signature:
            on_progress(gen, util, sheet_count, elapsed, no_improve)
        """
        if not parts:
            self.all_results = []
            self.best_result = None
            return []

        self.all_results = []
        self.best_result = None
        self._start_time = time.time()
        no_improve = 0
        gen = 0
        last_progress_emit = 0.0

        # CPU-safe default:
        # Python/rectpack is not the same as Solid Edge's compiled engine.
        # Keep the UI responsive by limiting population, variants, and yielding the GIL.
        population = max(6, min(10 if not deep_search else 16, int(population or 8)))
        variants = self._pack_variants(deep_search=deep_search)

        # Warm start: several deterministic and randomized starts.
        pop = self._create_population(parts, population)
        best_order = None
        best_energy = float("inf")
        best_result = None

        for order in pop:
            if self._should_stop(stop_event, time_limit):
                break
            energy, result = self._eval_full(order, gen, variants)
            self._add_result(result)
            if energy < best_energy:
                best_energy = energy
                best_order = list(order)
                best_result = result
                self.best_result = result

        # Critical for real-time preview: publish warm-start best immediately.
        if self.best_result and on_progress:
            now = time.time()
            on_progress(0, self.best_result.utilization,
                        self.best_result.sheet_count,
                        now - self._start_time, 0)
            last_progress_emit = now

        if best_order is None:
            self._finalise_results()
            return self.best_result.sheets if self.best_result else []

        current_order = list(best_order)
        current_energy = best_energy

        # SA constants
        T_INIT       = 1.0
        T_MIN        = 0.003
        CYCLE_STEPS  = 55        # deeper local search per cycle vs. 35
        PERTURB_AT   = 6         # ILS perturbation after this many stuck cycles
        ACCEPT_WIN   = 40        # window for adaptive temperature
        TARGET_LOW   = 0.10      # acceptance rate too cold → warm up
        TARGET_HIGH  = 0.30      # acceptance rate too hot → cool down

        T             = T_INIT
        step_in_cycle = 0
        accept_window: list = []

        while not self._should_stop(stop_event, time_limit):
            neighbor = self._make_neighbor(current_order)

            # Fast exploration: one random MaxRects/sort variant.
            n_energy, n_result = self._eval_fast(neighbor, gen, variants)
            self._add_result(n_result)

            delta    = n_energy - current_energy
            accepted = delta < 0 or random.random() < math.exp(-delta / max(T, 1e-9))

            # Adaptive temperature: track recent acceptance rate.
            accept_window.append(1 if accepted else 0)
            if len(accept_window) > ACCEPT_WIN:
                accept_window.pop(0)
                rate = sum(accept_window) / ACCEPT_WIN
                if rate > TARGET_HIGH:
                    T = max(T_MIN, T * 0.91)   # too easy — cool faster
                elif rate < TARGET_LOW:
                    T = min(T_INIT, T * 1.13)  # too hard — warm up

            if accepted:
                current_order  = neighbor
                current_energy = n_energy

                # If fast estimate is promising, verify with full strategy set.
                if n_energy < best_energy:
                    full_energy, full_result = self._eval_full(neighbor, gen, variants)
                    self._add_result(full_result)
                    if full_energy < best_energy:
                        best_energy      = full_energy
                        best_order       = list(neighbor)
                        best_result      = full_result
                        self.best_result = full_result
                        no_improve       = 0

            step_in_cycle += 1

            # Very important for PySide UI responsiveness:
            # rectpack is Python-level work and can otherwise monopolize the GIL.
            if cpu_yield and cpu_yield > 0:
                time.sleep(float(cpu_yield))

            if step_in_cycle >= CYCLE_STEPS:
                step_in_cycle = 0
                gen += 1

                # Periodic full evaluation of the global best order.
                full_energy, full_result = self._eval_full(best_order, gen, variants)
                self._add_result(full_result)
                if full_energy < best_energy:
                    best_energy      = full_energy
                    best_result      = full_result
                    self.best_result = full_result
                    no_improve       = 0
                else:
                    no_improve += 1

                # ILS: double-bridge perturbation when stuck for PERTURB_AT cycles.
                if no_improve >= PERTURB_AT:
                    perturbed = self._perturb(best_order)
                    p_energy, p_result = self._eval_full(perturbed, gen, variants)
                    self._add_result(p_result)
                    if p_energy < best_energy:
                        best_energy      = p_energy
                        best_order       = list(perturbed)
                        best_result      = p_result
                        self.best_result = p_result
                        no_improve       = 0
                    # Accept the perturbed state anyway to escape — ILS key property.
                    current_order  = perturbed
                    current_energy = p_energy
                    accept_window.clear()
                else:
                    # Normal reheat from best known solution.
                    current_order  = list(best_order)
                    current_energy = best_energy

                T = T_INIT

            # Throttle UI/live preview updates to about once per second.
            now = time.time()
            if self.best_result and on_progress and (now - last_progress_emit >= float(progress_interval)):
                last_progress_emit = now
                on_progress(gen, self.best_result.utilization,
                            self.best_result.sheet_count,
                            now - self._start_time, no_improve)

        self._finalise_results()

        # Final progress call so UI gets the last best before finishing.
        if self.best_result and on_progress:
            on_progress(gen, self.best_result.utilization,
                        self.best_result.sheet_count,
                        time.time() - self._start_time, no_improve)

        return self.best_result.sheets if self.best_result else []

    # ──────────────────────────────────────────────────────────
    # Optimizer helpers
    # ──────────────────────────────────────────────────────────

    @staticmethod
    def _should_stop(stop_event, time_limit):
        if stop_event is not None and stop_event.is_set():
            return True
        # time_limit is checked by caller using engine start time below.
        return False

    def _time_over(self, time_limit):
        return bool(time_limit is not None and (time.time() - self._start_time) >= float(time_limit))

    def _should_stop(self, stop_event, time_limit):  # instance method overrides static helper
        if stop_event is not None and stop_event.is_set():
            return True
        return self._time_over(time_limit)

    def _sort_key_design(self, p):
        return str(getattr(p, "design_code", "cd0") or "cd0").lower()

    def _area(self, p):
        return float(getattr(p, "width", 0) or 0) * float(getattr(p, "height", 0) or 0)

    def _create_population(self, parts, size):
        base = list(parts)
        pop = []
        # Keep caller order as one candidate. This makes UI strategy meaningful.
        pop.append(list(base))
        pop.append(sorted(base, key=lambda p: self._area(p), reverse=True))
        pop.append(sorted(base, key=lambda p: max(float(p.width), float(p.height)), reverse=True))
        pop.append(sorted(base, key=lambda p: min(float(p.width), float(p.height)), reverse=True))
        pop.append(sorted(base, key=lambda p: (self._sort_key_design(p), -self._area(p))))
        pop.append(sorted(base, key=lambda p: (str(getattr(p, "material", "")).lower(), -self._area(p))))

        # Strategy-specific starts.
        if self.strategy == "prefer_repeats":
            pop.append(sorted(base, key=lambda p: (self._sort_key_design(p), str(getattr(p, "part_code", "")), -self._area(p))))
        elif self.strategy == "balanced_repeats":
            pop.append(sorted(base, key=lambda p: (self._sort_key_design(p), -max(float(p.width), float(p.height)), -self._area(p))))

        while len(pop) < size:
            s = list(base)
            # Keep some design-code grouping but randomize within groups.
            if random.random() < 0.45:
                groups = {}
                for p in s:
                    groups.setdefault(self._sort_key_design(p), []).append(p)
                keys = list(groups)
                random.shuffle(keys)
                s = []
                for k in keys:
                    random.shuffle(groups[k])
                    s.extend(groups[k])
            else:
                random.shuffle(s)
            pop.append(s)
        return pop[:size]

    def _make_neighbor(self, order):
        n = len(order)
        if n < 2:
            return list(order)

        s = list(order)
        move = random.random()

        if move < 0.28:
            # Swap two random positions
            i, j = random.sample(range(n), 2)
            s[i], s[j] = s[j], s[i]
        elif move < 0.46:
            # 2-opt: reverse a random segment
            i, j = sorted(random.sample(range(n), 2))
            if j > i:
                s[i:j + 1] = s[i:j + 1][::-1]
        elif move < 0.61:
            # Or-opt1: relocate one element
            i = random.randrange(n)
            elem = s.pop(i)
            j = random.randrange(len(s) + 1)
            s.insert(j, elem)
        elif move < 0.75 and n >= 4:
            # Or-opt2: relocate two consecutive elements
            i = random.randrange(n - 1)
            pair = [s[i], s[i + 1]]
            del s[i:i + 2]
            j = random.randrange(len(s) + 1)
            s = s[:j] + pair + s[j:]
        elif move < 0.87 and n >= 5:
            # Or-opt3: relocate three consecutive elements
            i = random.randrange(n - 2)
            triple = s[i:i + 3]
            del s[i:i + 3]
            j = random.randrange(len(s) + 1)
            s = s[:j] + triple + s[j:]
        else:
            # Block move: group same-design parts together (helps repeat strategies)
            d = self._sort_key_design(random.choice(s))
            idxs = [k for k, p in enumerate(s) if self._sort_key_design(p) == d]
            if len(idxs) > 1:
                block = [s[k] for k in idxs]
                rest  = [p for k, p in enumerate(s) if k not in set(idxs)]
                j = random.randrange(len(rest) + 1)
                s = rest[:j] + block + rest[j:]

        return s

    def _perturb(self, order) -> list:
        """Double-bridge perturbation for ILS escaping from local optima.

        Cuts the sequence into 4 segments [A|B|C|D] and reconnects as
        [A|C|B|D] — a non-reversible move that a swap or 2-opt cannot undo.
        Falls back to segment shuffle for very small instances.
        """
        n = len(order)
        s = list(order)
        if n < 8:
            # Small instance: shuffle a random half
            mid = n // 2
            i = random.randrange(max(1, n - mid))
            chunk = s[i:i + mid]
            random.shuffle(chunk)
            s[i:i + mid] = chunk
            return s
        # Double-bridge
        cuts = sorted(random.sample(range(1, n), 3))
        a, b, c = cuts
        return s[:a] + s[b:c] + s[a:b] + s[c:]

    def _pack_variants(self, deep_search: bool = False):
        """Generate packing variants.

        CPU-safe default:
        - Keep enough variety to improve results.
        - Avoid testing 12 variants every full evaluation on every cycle.
        - Include Order/SORT_NONE so GA/SA order still matters.

        Deep search can be enabled later from UI if needed.
        """
        if not deep_search:
            return [
                (MaxRectsBaf,  SORT_NONE, "MaxRectsBaf/Order"),
                (MaxRectsBaf,  SORT_AREA, "MaxRectsBaf/Area"),
                (MaxRectsBssf, SORT_NONE, "MaxRectsBssf/Order"),
                (MaxRectsBlsf, SORT_LSIDE, "MaxRectsBlsf/LongSide"),
            ]

        variants = []
        sort_variants = [
            ("Order", SORT_NONE),
            ("Area", SORT_AREA),
            ("LongSide", SORT_LSIDE),
            ("Ratio", SORT_RATIO),
        ]
        for algo in self.PACK_ALGOS:
            for sname, sort_func in sort_variants:
                variants.append((algo, sort_func, f"{algo.__name__}/{sname}"))
        return variants

    def _eval_fast(self, order, gen, variants):
        algo, sort_func, name = random.choice(variants)
        r = self._evaluate(order, algo, gen, sort_func=sort_func, algo_name=name)
        return -r.score(), r

    def _eval_full(self, order, gen, variants):
        best = None
        for algo, sort_func, name in variants:
            r = self._evaluate(order, algo, gen, sort_func=sort_func, algo_name=name)
            if best is None or r.score() > best.score():
                best = r
        return -best.score(), best

    # ──────────────────────────────────────────────────────────
    # Evaluation / packing
    # ──────────────────────────────────────────────────────────

    def _evaluate(self, parts, algo_cls, gen, sort_func=SORT_NONE, algo_name=None) -> NestResult:
        result = NestResult(
            algorithm=algo_name or algo_cls.__name__,
            generation=gen,
            strategy=self.strategy,
        )
        t0 = time.time()

        remaining = list(parts)
        sheets_used = []
        sheet_counter = 1

        limited = [s for s in self.sheet_defs if s.quantity < 999]
        unlimited = [s for s in self.sheet_defs if s.quantity >= 999]

        for sd in limited:
            for _ in range(int(sd.quantity)):
                if not remaining:
                    break
                sheet, remaining = self._pack_sheet(remaining, sd, sheet_counter, algo_cls, sort_func)
                if sheet.parts:
                    self._apply_direction_transform(sheet, sd)
                    sheets_used.append(sheet)
                    sheet_counter += 1

        while remaining and unlimited:
            sd = unlimited[0]
            sheet, remaining = self._pack_sheet(remaining, sd, sheet_counter, algo_cls, sort_func)
            if sheet.parts:
                self._apply_direction_transform(sheet, sd)
                sheets_used.append(sheet)
                sheet_counter += 1
            else:
                break

        result.sheets = sheets_used
        result.sheet_count = len(sheets_used)
        result.total_parts = sum(s.part_count() for s in sheets_used)
        result.time_ms = (time.time() - t0) * 1000.0

        if sheets_used:
            utils = [s.utilization() for s in sheets_used]
            result.utilization = sum(utils) / len(utils)

        self._apply_repeat_stats(result)
        result.fitness = self._score_result(result, total_required=len(parts))
        return result

    def _pack_sheet(self, parts, sheet_def, sheet_id, algo_cls, sort_func):
        ml = getattr(self, "margin_left",   self.margin)
        mr = getattr(self, "margin_right",  self.margin)
        mt = getattr(self, "margin_top",    self.margin)
        mb = getattr(self, "margin_bottom", self.margin)

        uw = sheet_def.width  - ml - mr
        uh = sheet_def.height - mt - mb

        sheet = Sheet(sheet_id=sheet_id, width=sheet_def.width,
                      height=sheet_def.height, thickness=sheet_def.thickness,
                      material=sheet_def.material)
        # Extra metadata used by reports/scoring. Safe dynamic attributes.
        sheet.source_sheet_name = sheet_def.name
        sheet.is_remnant = sheet_def.is_remnant
        sheet.priority = sheet_def.priority

        if uw <= 0 or uh <= 0:
            return sheet, list(parts)

        packer = newPacker(
            mode=PackingMode.Offline,
            pack_algo=algo_cls,
            rotation=bool(self.auto_rotate),
            sort_algo=sort_func,
        )
        packer.add_bin(uw, uh, count=1)

        for i, p in enumerate(parts):
            pw = float(getattr(p, "width", 0) or 0) + self.gap
            ph = float(getattr(p, "height", 0) or 0) + self.gap
            if pw <= uw and ph <= uh or (self.auto_rotate and ph <= uw and pw <= uh):
                packer.add_rect(pw, ph, rid=i)

        packer.pack()

        placed = set()
        for rect in packer.rect_list():
            _b, x, y, w, h, rid = rect
            src = parts[rid]
            p = deepcopy(src)
            p.sheet_id = sheet_id
            p.x = x + ml
            p.y = y + mb

            # Detect rotation by comparing envelope size against original.
            orig_w = float(getattr(src, "width", 0) or 0) + self.gap
            p.rotated = abs(float(w) - orig_w) > 0.01
            p.status = "nested"
            sheet.parts.append(p)
            placed.add(rid)

        remaining = [p for i, p in enumerate(parts) if i not in placed]
        return sheet, remaining

    # ──────────────────────────────────────────────────────────
    # Strategy scoring
    # ──────────────────────────────────────────────────────────

    def _sheet_signature_for_repeats(self, sheet):
        parts_sig = []
        for p in getattr(sheet, "parts", []) or []:
            parts_sig.append((
                round(float(getattr(p, "x", 0) or 0), 1),
                round(float(getattr(p, "y", 0) or 0), 1),
                round(float(p.actual_width()), 1),
                round(float(p.actual_height()), 1),
                bool(getattr(p, "rotated", False)),
                str(getattr(p, "design_code", "cd0") or "cd0").lower(),
            ))
        return (
            round(float(sheet.width), 1),
            round(float(sheet.height), 1),
            tuple(sorted(parts_sig)),
        )

    def _apply_repeat_stats(self, result: NestResult):
        counts = {}
        for s in result.sheets:
            sig = self._sheet_signature_for_repeats(s)
            counts[sig] = counts.get(sig, 0) + 1
        result.unique_nests = len(counts)
        result.max_repeat = max(counts.values()) if counts else 0

    def _score_result(self, result: NestResult, total_required: int) -> float:
        if not result.sheets:
            return -10**12

        utils = [float(s.utilization()) for s in result.sheets]
        avg_util = sum(utils) / len(utils) if utils else 0.0
        min_util = min(utils) if utils else 0.0
        sheet_count = result.sheet_count
        nested = result.total_parts
        not_nested = max(0, total_required - nested)

        # Repeat statistics
        repeat_gain = max(0, result.max_repeat - 1)
        unique_nests = result.unique_nests or sheet_count

        # Remnants are useful, but not if they destroy efficiency.
        remnant_used = sum(1 for s in result.sheets if getattr(s, "is_remnant", False))

        # Base: never sacrifice completed part count for a tiny utilization improvement.
        score = nested * 1_000_000
        score += avg_util * 6_000
        score += min_util * 800
        score -= sheet_count * 22_000
        score -= not_nested * 1_500_000
        score += remnant_used * 8_000

        if self.strategy == "balanced_repeats":
            # Balanced: keep efficiency, but reward repeated nests and fewer unique setups.
            score += repeat_gain * 32_000
            score -= unique_nests * 9_000
            score += self._util_balance_bonus(utils) * 350
        elif self.strategy == "prefer_repeats":
            # Prefer repeats: stronger reward for repeated nest layouts / fewer setups.
            score += repeat_gain * 80_000
            score -= unique_nests * 24_000
            # Still prevent very poor sheets.
            score += min_util * 1_000
        else:
            # Best efficiency: primarily material usage and low sheet count.
            score += avg_util * 2_500
            score -= unique_nests * 2_500

        return score

    @staticmethod
    def _util_balance_bonus(utils):
        if not utils:
            return 0.0
        avg = sum(utils) / len(utils)
        variance = sum((u - avg) ** 2 for u in utils) / len(utils)
        return max(0.0, 100.0 - math.sqrt(variance))

    def _add_result(self, r: NestResult):
        self.all_results.append(r)
        # Keep memory bounded during long 10-minute runs.
        if len(self.all_results) > 250:
            self.all_results.sort(key=lambda x: -x.score())
            self.all_results = self.all_results[:120]

    def _finalise_results(self):
        # Sort by industrial strategy score, then conventional criteria.
        self.all_results.sort(
            key=lambda r: (-r.score(), -r.total_parts, r.sheet_count, -r.utilization, r.unique_nests)
        )
        for i, r in enumerate(self.all_results):
            r.rank = i + 1
        if self.all_results:
            self.best_result = self.all_results[0]

    # ──────────────────────────────────────────────────────────
    # Direction / validation
    # ──────────────────────────────────────────────────────────

    def _direction_from_deg(self):
        deg = int(getattr(self, "direction_deg", 270) or 270) % 360
        if 45 <= deg < 135:
            return "top_left"
        if 135 <= deg < 225:
            return "bottom_right"
        if 225 <= deg < 315:
            return "bottom_left"
        return "top_right"

    def _apply_direction_transform(self, sheet: Sheet, sheet_def: SheetDef):
        direction = getattr(self, "direction", None) or self._direction_from_deg()
        W, H = sheet_def.width, sheet_def.height
        if direction == "bottom_left":
            return
        for part in sheet.parts:
            pw = part.actual_width()
            ph = part.actual_height()
            if direction == "bottom_right":
                part.x = W - part.x - pw
            elif direction == "top_left":
                part.y = H - part.y - ph
            elif direction == "top_right":
                part.x = W - part.x - pw
                part.y = H - part.y - ph

    def validate(self, sheets: List[Sheet]) -> List[str]:
        ml = getattr(self, "margin_left",   self.margin)
        mr = getattr(self, "margin_right",  self.margin)
        mt = getattr(self, "margin_top",    self.margin)
        mb = getattr(self, "margin_bottom", self.margin)

        errors = []
        for sheet in sheets:
            for i, p1 in enumerate(sheet.parts):
                if p1.x < ml:
                    errors.append(f"⚠️ {p1.part_code}: outside left margin")
                if p1.y < mb:
                    errors.append(f"⚠️ {p1.part_code}: outside bottom margin")
                if p1.x + p1.actual_width() > sheet.width - mr:
                    errors.append(f"❌ {p1.part_code}: outside right margin")
                if p1.y + p1.actual_height() > sheet.height - mt:
                    errors.append(f"❌ {p1.part_code}: outside top margin")
                for j, p2 in enumerate(sheet.parts):
                    if i >= j:
                        continue
                    g = self.gap / 2
                    if not (
                        p1.x + p1.actual_width() + g <= p2.x or
                        p2.x + p2.actual_width() + g <= p1.x or
                        p1.y + p1.actual_height() + g <= p2.y or
                        p2.y + p2.actual_height() + g <= p1.y
                    ):
                        errors.append(f"❌ overlap: {p1.part_code} with {p2.part_code}")
        return errors

    def print_results(self):
        print(f"\n{'Rank':<6}{'Algorithm':<28}{'Util%':<8}{'Sheets':<8}{'Parts':<8}{'Rep':<5}{'Unique':<7}")
        print("-" * 76)
        for r in self.all_results[:12]:
            print(f"{r.rank:<6}{r.algorithm:<28}{r.utilization:<8.1f}{r.sheet_count:<8}{r.total_parts:<8}{r.max_repeat:<5}{r.unique_nests:<7}")


if __name__ == "__main__":
    from csv_handler import parse_csv, create_sample_csv
    sample = create_sample_csv()
    order, _ = parse_csv(sample)
    engine = NestingEngine()
    engine.add_remnant("Remnant-1", 1500, 800, priority=1)
    sheets = engine.run(order.parts, generations=10, time_limit=5.0)
    engine.print_results()
    errors = engine.validate(sheets)
    print("✅ Nesting Engine OK" if not errors else "\n".join(errors))
