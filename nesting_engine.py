"""
FIROO CAM — Nesting Engine v6.0  Industrial Memetic Algorithm + BFDH Strip Packing
═══════════════════════════════════════════════════════════════════════════════════

Root-cause fix vs v5.0
───────────────────────
Solid Edge achieves 92 %+ on 9 sheets by using BFDH (Best-Fit Decreasing Height)
strip packing.  MaxRects — while theoretically optimal for a given ordering — does
not group parts into height-uniform rows.  For cabinet/MDF panels (many parts with
the same door height, shelf height, etc.) height-uniform rows fill rows completely
and yield 20-25 % higher utilisation than MaxRects on the same ordering.

What is BFDH?
─────────────
Algorithm (O(n log n)):
  1. Sort parts by height descending (tallest first).
  2. For each part:
     a. Find every existing shelf where  part.h ≤ shelf.h  AND
        part.w ≤ shelf.remaining_width.
     b. Among those shelves pick the one with MINIMUM remaining width
        after placing (Best Fit = least wasted gap).
     c. If no shelf qualifies: open a new shelf whose height = part.h.
  3. Shelves are stacked bottom-to-top.

Why BFDH beats MaxRects for cabinet panels:
  • All 600 mm-tall parts land in the same shelf → shelf fills to ~95 % width.
  • MaxRects BAF can spread same-height parts across different height levels,
    leaving unusable slivers.
  • BFDH* (with rotation) is even better: a 1200×300 part can become 300×1200,
    fitting perfectly in a tall 300-wide strip.

New in v6.0
───────────
1. _pack_sheet_bfdh — dedicated BFDH strip packing for one sheet.
2. _evaluate_bfdh   — full sheet-set evaluation using BFDH.
3. _eval_full now runs BOTH MaxRects variants AND BFDH, takes best.
4. _eval_fast has 30% chance to probe BFDH (instead of two MaxRects).
5. height_group_sort operator in _make_neighbor: sorts a random segment
   of the ordering by height → creates BFDH-friendly input for MaxRects too.
6. Initial population: height-sorted order is candidate #1 (not #8).
7. All v5.0 improvements kept: OX crossover, elite archive, convergence
   restart, late_reloc, large_forward, Skyline variants, global_util scoring.
"""
from __future__ import annotations

import time
import random
import math
import threading
from typing import List, Optional, Tuple
from dataclasses import dataclass, field
from copy import deepcopy

from rectpack import (newPacker, PackingMode,
                      SORT_AREA, SORT_LSIDE, SORT_RATIO,
                      SORT_PERI, SORT_SSIDE, SORT_DIFF)
try:
    from rectpack import SORT_NONE
except Exception:
    def SORT_NONE(rects):           # noqa: E306
        return rects

from rectpack import MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf, MaxRectsBl
from rectpack import SkylineMwf, SkylineBl

# Optional Guillotine variants
_G: list = []
try:
    import rectpack as _rp
    for _n in ("GuillotineBafSas",  "GuillotineBafLas",
               "GuillotineBssfSas", "GuillotineBssfLas",
               "GuillotineBlsfSas", "GuillotineBlsfLas"):
        _cls = getattr(_rp, _n, None)
        if _cls is not None:
            _G.append(_cls)
except Exception:
    pass

from data_models import Part, Sheet
from config import config


# ──────────────────────────────────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class SheetDef:
    name:       str   = "Sheet"
    width:      float = 2800.0
    height:     float = 1220.0
    thickness:  float = 18.0
    material:   str   = "MDF"
    quantity:   int   = 999
    priority:   int   = 3   # 1 = Highest … 5 = Lowest
    is_remnant: bool  = False

    def __str__(self):
        tag = "🔸Remnant" if self.is_remnant else "📦Sheet"
        return f"{tag} {self.name} {self.width}×{self.height} P{self.priority}"


@dataclass
class NestResult:
    sheets:       List[Sheet] = field(default_factory=list)
    utilization:  float = 0.0   # global utilisation (total_part_area / total_sheet_area)
    total_parts:  int   = 0
    sheet_count:  int   = 0
    algorithm:    str   = ""
    generation:   int   = 0
    time_ms:      float = 0.0
    rank:         int   = 0
    strategy:     str   = "best_efficiency"
    fitness:      float = 0.0
    unique_nests: int   = 0
    max_repeat:   int   = 1

    def score(self) -> float:
        if self.fitness:
            return self.fitness
        return self.total_parts * 100_000 + self.utilization * 100 - self.sheet_count * 1_000

    def __str__(self):
        return (f"Rank:{self.rank:2} | GlobalUtil:{self.utilization:5.1f}% | "
                f"Sheets:{self.sheet_count} | Parts:{self.total_parts} | "
                f"Repeat:{self.max_repeat} | Unique:{self.unique_nests} | "
                f"Gen:{self.generation} | {self.algorithm}")


# ──────────────────────────────────────────────────────────────────────────
# Engine
# ──────────────────────────────────────────────────────────────────────────

class NestingEngine:
    PACK_ALGOS = [MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf, MaxRectsBl]

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
    # Public API
    # ──────────────────────────────────────────────────────────

    def run(self, parts: List[Part], generations=20, population=15,
            time_limit=8.0) -> List[Sheet]:
        """Backward-compatible shim."""
        stop_event = threading.Event()
        return self.run_continuous(
            parts=parts, stop_event=stop_event, on_progress=None,
            time_limit=float(time_limit),
            population=max(6, min(10, int(population or 8))),
        )

    def run_continuous(self, parts: List[Part], stop_event,
                       on_progress=None, time_limit: Optional[float] = None,
                       population: int = 10,
                       progress_interval: float = 1.0,
                       cpu_yield: float = 0.006,
                       deep_search: bool = False) -> List[Sheet]:
        """
        Memetic Algorithm + BFDH Strip Packing.

        Phase 1: Warm start — evaluate ≥10 candidate orderings with full
                 eval (MaxRects + BFDH both tried), seed elite archive.
        Phase 2: 3 SA walkers + OX crossover pulse + convergence restart.
                 Every step: _eval_fast tries MaxRects OR BFDH.
                 Every improvement: _eval_full tries both, keeps best.
        """
        if not parts:
            self.all_results = []
            self.best_result = None
            return []

        self.all_results = []
        self.best_result = None
        self._start_time = time.time()
        gen              = 0
        no_improve       = 0
        last_progress    = 0.0
        last_best_e      = float("inf")

        population = max(6, min(12 if deep_search else 10, int(population or 8)))
        variants   = self._pack_variants(deep_search=deep_search)

        # ── Phase 1: Warm start ──────────────────────────────────
        pop = self._create_population(parts, population)

        best_order  = None
        best_energy = float("inf")
        best_result = None

        ELITE_SIZE = 6
        elite: list = []

        def _add_to_elite(energy, order):
            elite.append([energy, list(order)])
            elite.sort(key=lambda x: x[0])
            while len(elite) > ELITE_SIZE:
                elite.pop()

        for order in pop:
            if self._should_stop(stop_event, time_limit):
                break
            e, r = self._eval_full(order, gen, variants)
            self._add_result(r)
            _add_to_elite(e, order)
            if e < best_energy:
                best_energy, best_order, best_result = e, list(order), r
                self.best_result = r

        if self.best_result and on_progress:
            now = time.time()
            on_progress(0, self.best_result.utilization,
                        self.best_result.sheet_count,
                        now - self._start_time, 0)
            last_progress = now
            last_best_e   = best_energy

        if best_order is None:
            self._finalise_results()
            return self.best_result.sheets if self.best_result else []

        # ── Phase 2: Multi-walker SA setup ───────────────────────
        W_T_INIT    = [0.25, 1.0, 3.0]
        STEPS_CYCLE = 18
        ILS_THRESH  = 5
        ACCEPT_WIN  = 28
        TARGET_LO   = 0.08
        TARGET_HI   = 0.32

        CROSS_INTERVAL = 30
        CONV_INTERVAL  = 60
        cross_tick     = 0
        conv_tick      = 0

        walkers = []
        for wi in range(3):
            src = pop[min(wi, len(pop) - 1)]
            walkers.append({
                "order":   list(best_order) if wi == 0 else list(src),
                "energy":  best_energy,
                "T":       W_T_INIT[wi],
                "T_init":  W_T_INIT[wi],
                "acc_win": [],
                "steps":   0,
                "no_imp":  0,
            })

        # ── Phase 2: Main loop ────────────────────────────────────
        while not self._should_stop(stop_event, time_limit):

            # ── 2a. Advance every walker one SA step ──────────────
            for w in walkers:
                if self._should_stop(stop_event, time_limit):
                    break

                neighbor        = self._make_neighbor(w["order"])
                n_energy, n_res = self._eval_fast(neighbor, gen, variants)
                self._add_result(n_res)

                delta    = n_energy - w["energy"]
                accepted = (delta < 0 or
                            random.random() < math.exp(-delta / max(w["T"], 1e-9)))

                w["acc_win"].append(1 if accepted else 0)
                if len(w["acc_win"]) > ACCEPT_WIN:
                    w["acc_win"].pop(0)
                    rate = sum(w["acc_win"]) / ACCEPT_WIN
                    if rate > TARGET_HI:
                        w["T"] = max(0.001, w["T"] * 0.90)
                    elif rate < TARGET_LO:
                        w["T"] = min(w["T_init"] * 2.5, w["T"] * 1.12)

                if accepted:
                    w["order"]  = neighbor
                    w["energy"] = n_energy

                    if n_energy < best_energy:
                        fe, fr = self._eval_full(neighbor, gen, variants)
                        self._add_result(fr)
                        _add_to_elite(fe, neighbor)
                        if fe < best_energy:
                            best_energy      = fe
                            best_order       = list(neighbor)
                            best_result      = fr
                            self.best_result = fr
                            w["no_imp"]      = 0

                w["steps"] += 1

                if w["steps"] >= STEPS_CYCLE:
                    w["steps"]  = 0
                    w["no_imp"] += 1

                    if w["no_imp"] >= ILS_THRESH:
                        w["no_imp"] = 0
                        perturbed   = self._perturb(best_order)
                        pe, pr      = self._eval_full(perturbed, gen, variants)
                        self._add_result(pr)
                        _add_to_elite(pe, perturbed)
                        if pe < best_energy:
                            best_energy, best_order = pe, list(perturbed)
                            best_result             = pr
                            self.best_result        = pr
                        w["order"]   = perturbed
                        w["energy"]  = pe
                        w["acc_win"].clear()
                        w["T"]       = w["T_init"]

                    elif w is walkers[0]:
                        w["order"]  = list(best_order)
                        w["energy"] = best_energy

            # ── 2b. OX Crossover pulse ─────────────────────────────
            cross_tick += 1
            if cross_tick >= CROSS_INTERVAL:
                cross_tick = 0

                if len(elite) >= 2:
                    p2_idx = random.randrange(1, len(elite))
                    child  = self._crossover_ox(best_order, elite[p2_idx][1])
                    ce, cr = self._eval_fast(child, gen, variants)
                    self._add_result(cr)

                    if ce < best_energy * 1.08:
                        fe, fr = self._eval_full(child, gen, variants)
                        self._add_result(fr)
                        _add_to_elite(fe, child)
                        if fe < best_energy:
                            best_energy      = fe
                            best_order       = list(child)
                            best_result      = fr
                            self.best_result = fr

                    if random.random() < 0.40:
                        child2   = self._crossover_ox(walkers[1]["order"],
                                                      walkers[2]["order"])
                        fe2, fr2 = self._eval_full(child2, gen, variants)
                        self._add_result(fr2)
                        _add_to_elite(fe2, child2)
                        if fe2 < best_energy:
                            best_energy      = fe2
                            best_order       = list(child2)
                            best_result      = fr2
                            self.best_result = fr2

            # ── 2c. Convergence detection → diversity restart ──────
            conv_tick += 1
            if conv_tick >= CONV_INTERVAL:
                conv_tick = 0
                if len(elite) >= 3:
                    energies = [w["energy"] for w in walkers]
                    e_spread = ((max(energies) - min(energies)) /
                                (abs(best_energy) + 1e-9))
                    if e_spread < 0.005:
                        for w_idx in (1, 2):
                            re_idx = random.randrange(1, len(elite))
                            w = walkers[w_idx]
                            w["order"]   = self._perturb(elite[re_idx][1])
                            w["energy"]  = elite[re_idx][0]
                            w["T"]       = w["T_init"] * 1.8
                            w["acc_win"].clear()
                            w["no_imp"]  = 0

            if cpu_yield and cpu_yield > 0:
                time.sleep(float(cpu_yield))

            now = time.time()
            if (self.best_result and on_progress and
                    now - last_progress >= float(progress_interval)):
                gen += 1
                if best_energy >= last_best_e:
                    no_improve += 1
                else:
                    no_improve  = 0
                    last_best_e = best_energy
                last_progress = now
                on_progress(gen, self.best_result.utilization,
                            self.best_result.sheet_count,
                            now - self._start_time, no_improve)

        self._finalise_results()

        if self.best_result and on_progress:
            on_progress(gen, self.best_result.utilization,
                        self.best_result.sheet_count,
                        time.time() - self._start_time, no_improve)

        return self.best_result.sheets if self.best_result else []

    # ──────────────────────────────────────────────────────────
    # Optimizer helpers
    # ──────────────────────────────────────────────────────────

    def _should_stop(self, stop_event, time_limit):
        if stop_event is not None and stop_event.is_set():
            return True
        return bool(time_limit is not None and
                    (time.time() - self._start_time) >= float(time_limit))

    def _sort_key_design(self, p):
        return str(getattr(p, "design_code", "cd0") or "cd0").lower()

    def _area(self, p):
        return float(getattr(p, "width", 0) or 0) * float(getattr(p, "height", 0) or 0)

    # ── Initial population ──────────────────────────────────────

    def _create_population(self, parts, size):
        base = list(parts)

        def area(p):   return self._area(p)
        def lside(p):  return max(float(p.width), float(p.height))
        def sside(p):  return min(float(p.width), float(p.height))
        def perim(p):  return float(p.width) + float(p.height)
        def design(p): return self._sort_key_design(p)

        def stripe_sort(lst):
            s = sorted(lst, key=area, reverse=True)
            out, lo, hi = [], 0, len(s) - 1
            while lo <= hi:
                out.append(s[lo]); lo += 1
                if lo <= hi:
                    out.append(s[hi]); hi -= 1
            return out

        def strip_sort(lst, n_bands=4):
            if not lst:
                return []
            max_h = max(float(p.height) for p in lst) + 1e-9
            bsz   = max_h / n_bands
            return sorted(lst, key=lambda p: (int(float(p.height) / bsz), -float(p.width)),
                          reverse=True)

        pop = []
        # #0: HEIGHT-SORTED (primary BFDH-friendly seed — most important for cabinet parts)
        pop.append(sorted(base, key=lambda p: (-float(p.height), -float(p.width))))
        # #1: original order (preserves strategy sort)
        pop.append(list(base))
        # #2: largest area first (classic NFD — best single heuristic for bin packing)
        pop.append(sorted(base, key=area, reverse=True))
        # #3: longest side first
        pop.append(sorted(base, key=lside, reverse=True))
        # #4: short side first (sometimes exposes wide strips)
        pop.append(sorted(base, key=sside, reverse=True))
        # #5: perimeter first
        pop.append(sorted(base, key=perim, reverse=True))
        # #6: interleaved large/small
        pop.append(stripe_sort(list(base)))
        # #7: FFDH band sort
        pop.append(strip_sort(list(base)))
        # #8: design group + height sort (repeat-aware)
        pop.append(sorted(base, key=lambda p: (design(p), -float(p.height), -float(p.width))))
        # #9: material group + height sort
        pop.append(sorted(base, key=lambda p: (
            str(getattr(p, "material", "")).lower(), -float(p.height), -float(p.width))))

        if self.strategy == "prefer_repeats":
            pop.append(sorted(base, key=lambda p: (
                design(p), str(getattr(p, "part_code", "")), -area(p))))
        elif self.strategy == "balanced_repeats":
            pop.append(sorted(base, key=lambda p: (
                design(p), -lside(p), -area(p))))

        while len(pop) < size:
            s = list(base)
            if random.random() < 0.45:
                groups = {}
                for p in s:
                    groups.setdefault(design(p), []).append(p)
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

    # ── Neighbor operators ──────────────────────────────────────

    def _make_neighbor(self, order):
        n = len(order)
        if n < 2:
            return list(order)

        s    = list(order)
        move = random.random()

        if move < 0.20:
            # Swap two random positions
            i, j = random.sample(range(n), 2)
            s[i], s[j] = s[j], s[i]

        elif move < 0.34:
            # 2-opt: reverse a segment
            i, j = sorted(random.sample(range(n), 2))
            if j > i:
                s[i:j + 1] = s[i:j + 1][::-1]

        elif move < 0.45:
            # Or-opt1: relocate one element
            i    = random.randrange(n)
            elem = s.pop(i)
            j    = random.randrange(len(s) + 1)
            s.insert(j, elem)

        elif move < 0.55 and n >= 4:
            # Or-opt2: relocate two consecutive elements
            i    = random.randrange(n - 1)
            pair = [s[i], s[i + 1]]
            del s[i:i + 2]
            j = random.randrange(len(s) + 1)
            s = s[:j] + pair + s[j:]

        elif move < 0.63 and n >= 5:
            # Or-opt3: relocate three consecutive elements
            i      = random.randrange(n - 2)
            triple = s[i:i + 3]
            del s[i:i + 3]
            j = random.randrange(len(s) + 1)
            s = s[:j] + triple + s[j:]

        elif move < 0.69 and n >= 6:
            # Or-opt4: relocate four consecutive elements
            i    = random.randrange(n - 3)
            quad = s[i:i + 4]
            del s[i:i + 4]
            j = random.randrange(len(s) + 1)
            s = s[:j] + quad + s[j:]

        elif move < 0.76:
            # height_group_sort (v6.0): sort a random segment by height desc.
            # Creates height-uniform sub-sequences that both BFDH and
            # Skyline use efficiently (rows of same-height parts).
            seg_len = max(3, n // 4)
            start   = random.randrange(n - seg_len + 1)
            seg     = s[start:start + seg_len]
            seg.sort(key=lambda p: (-float(p.height), -float(p.width)))
            s[start:start + seg_len] = seg

        elif move < 0.83:
            # late_reloc: move a part from last 25% to first 40%
            lo = int(n * 0.75)
            if lo < n:
                src  = random.randrange(lo, n)
                elem = s.pop(src)
                dst  = random.randrange(max(1, int(n * 0.40)))
                s.insert(dst, elem)

        elif move < 0.88:
            # large_forward: push a large part from second half to first quarter
            half = n // 2
            if half < n:
                max_a = max(self._area(p) for p in s)
                threshold  = max_a * 0.35
                candidates = [half + i for i, p in enumerate(s[half:])
                              if self._area(p) >= threshold]
                src = (random.choice(candidates) if candidates
                       else random.randrange(half, n))
                elem = s.pop(src)
                s.insert(random.randrange(max(1, n // 4)), elem)

        elif move < 0.94:
            # Group-insert: consolidate all same-design parts (large first)
            d    = self._sort_key_design(random.choice(s))
            idxs = [k for k, p in enumerate(s) if self._sort_key_design(p) == d]
            if len(idxs) > 1:
                block = sorted([s[k] for k in idxs], key=lambda p: (-float(p.height), -self._area(p)))
                rest  = [p for k, p in enumerate(s) if k not in set(idxs)]
                j = random.randrange(len(rest) + 1)
                s = rest[:j] + block + rest[j:]

        else:
            # Block-move: move same-design block to random position
            d    = self._sort_key_design(random.choice(s))
            idxs = [k for k, p in enumerate(s) if self._sort_key_design(p) == d]
            if len(idxs) > 1:
                block = [s[k] for k in idxs]
                rest  = [p for k, p in enumerate(s) if k not in set(idxs)]
                j = random.randrange(len(rest) + 1)
                s = rest[:j] + block + rest[j:]

        return s

    # ── OX Crossover ───────────────────────────────────────────

    def _crossover_ox(self, parent_a: list, parent_b: list) -> list:
        """Order Crossover (OX): copies a segment from A, fills from B."""
        n = len(parent_a)
        if n < 4:
            return list(parent_a)
        i, j = sorted(random.sample(range(n), 2))
        seg_ids        = {id(p) for p in parent_a[i:j + 1]}
        child          = [None] * n
        child[i:j + 1] = parent_a[i:j + 1]
        b_filtered = [p for p in parent_b if id(p) not in seg_ids]
        pos = 0
        for k in range(n):
            if child[k] is None:
                child[k] = b_filtered[pos]; pos += 1
        return child

    # ── ILS perturbation ───────────────────────────────────────

    def _perturb(self, order) -> list:
        """Double-bridge: [A|B|C|D] → [A|C|B|D]."""
        n = len(order)
        s = list(order)
        if n < 8:
            mid = n // 2
            i = random.randrange(max(1, n - mid))
            chunk = s[i:i + mid]; random.shuffle(chunk)
            s[i:i + mid] = chunk
            return s
        cuts = sorted(random.sample(range(1, n), 3))
        a, b, c = cuts
        return s[:a] + s[b:c] + s[a:b] + s[c:]

    # ──────────────────────────────────────────────────────────
    # BFDH Strip Packing  (v6.0 core addition)
    # ──────────────────────────────────────────────────────────

    def _pack_sheet_bfdh(self, parts_enum: List[Tuple], sheet_def: SheetDef,
                         sheet_id: int):
        """
        Best-Fit Decreasing Height (BFDH) for one sheet.

        parts_enum: [(original_index, Part), …]
        Returns: (Sheet, [unplaced_original_indices])

        Algorithm:
          1. Sort by height desc (or max-dim desc if rotation allowed).
          2. For each part:
             a. Find shelves where part fits (height ≤ shelf.h, width ≤ remaining).
             b. Pick shelf with MINIMUM remaining width after placement (best fit).
             c. If no shelf: open new shelf at current y (height = part.height).
          3. Rotation (if auto_rotate): try both orientations; prefer the one that
             fits in an existing shelf; otherwise prefer the taller orientation
             (opens a taller new shelf → subsequent smaller parts can reuse it).
        """
        ml = getattr(self, "margin_left",   self.margin)
        mr = getattr(self, "margin_right",  self.margin)
        mt = getattr(self, "margin_top",    self.margin)
        mb = getattr(self, "margin_bottom", self.margin)

        uw = float(sheet_def.width)  - ml - mr
        uh = float(sheet_def.height) - mt - mb

        sheet = Sheet(sheet_id=sheet_id, width=sheet_def.width,
                      height=sheet_def.height, thickness=sheet_def.thickness,
                      material=sheet_def.material)
        sheet.source_sheet_name = sheet_def.name
        sheet.is_remnant        = sheet_def.is_remnant
        sheet.priority          = sheet_def.priority

        if uw <= 0 or uh <= 0:
            return sheet, [i for i, _ in parts_enum]

        def candidates_for(p):
            """Return [(pw, ph, rotated)] that might fit somewhere."""
            w0 = float(p.width)  + self.gap
            h0 = float(p.height) + self.gap
            opts = []
            if w0 <= uw + 1e-9 and h0 <= uh + 1e-9:
                opts.append((w0, h0, False))
            if self.auto_rotate:
                w1, h1 = h0, w0   # swap
                if (w1, h1) != (w0, h0) and w1 <= uw + 1e-9 and h1 <= uh + 1e-9:
                    opts.append((w1, h1, True))
            return opts

        def sort_key(item):
            _, p = item
            if self.auto_rotate:
                return -max(float(p.height) + self.gap, float(p.width) + self.gap)
            return -(float(p.height) + self.gap)

        sorted_parts = sorted(parts_enum, key=sort_key)

        # shelves: {'y': float, 'h': float, 'x_next': float, 'rem': float}
        # y       = bottom y (local coords, 0 = bottom of usable area)
        # h       = shelf height (fixed when opened)
        # x_next  = next x to place in (local, 0 = left edge)
        # rem     = remaining usable width in this shelf
        shelves: list = []
        total_h       = 0.0   # sum of shelf heights so far
        placed        = set()

        for orig_i, p in sorted_parts:
            opts = candidates_for(p)
            if not opts:
                continue

            best_shelf_idx = -1
            best_rot       = False
            best_pw        = 0.0
            best_ph        = 0.0
            best_waste     = float("inf")

            # Try to fit in an existing shelf (BFDH best-fit criterion)
            for si, shelf in enumerate(shelves):
                sh = shelf["h"]
                rem = shelf["rem"]
                for (pw, ph, rot) in opts:
                    if ph <= sh + 1e-9 and pw <= rem + 1e-9:
                        waste = rem - pw
                        if waste < best_waste:
                            best_waste     = waste
                            best_shelf_idx = si
                            best_rot       = rot
                            best_pw        = pw
                            best_ph        = ph

            if best_shelf_idx >= 0:
                shelf = shelves[best_shelf_idx]
                x_pos = shelf["x_next"]
                y_pos = shelf["y"]
            else:
                # Open a new shelf — prefer the orientation that opens the
                # tallest shelf (more parts can reuse it later).
                valid = [(pw, ph, rot) for pw, ph, rot in opts
                         if total_h + ph <= uh + 1e-9]
                if not valid:
                    continue
                # tallest first (BFDH descending-height policy)
                best_pw, best_ph, best_rot = max(valid, key=lambda x: x[1])
                x_pos = 0.0
                y_pos = total_h
                shelves.append({"y": y_pos, "h": best_ph,
                                "x_next": 0.0, "rem": uw})
                total_h += best_ph
                best_shelf_idx = len(shelves) - 1

            # Place the part
            p_copy = deepcopy(p)
            p_copy.x        = x_pos + ml
            p_copy.y        = y_pos + mb
            p_copy.sheet_id = sheet_id
            p_copy.rotated  = best_rot
            p_copy.status   = "nested"
            sheet.parts.append(p_copy)

            shelf = shelves[best_shelf_idx]
            shelf["x_next"] += best_pw
            shelf["rem"]    -= best_pw
            placed.add(orig_i)

        unplaced = [i for i, _ in parts_enum if i not in placed]
        return sheet, unplaced

    def _evaluate_bfdh(self, order: list, gen: int) -> NestResult:
        """Full multi-sheet evaluation using BFDH strip packing."""
        result = NestResult(algorithm="BFDH/StripPack",
                            generation=gen, strategy=self.strategy)
        t0 = time.time()

        parts_enum    = list(enumerate(order))
        remaining_idx = list(range(len(order)))
        sheets_used   = []
        sheet_counter = 1

        limited   = [s for s in self.sheet_defs if s.quantity < 999]
        unlimited = [s for s in self.sheet_defs if s.quantity >= 999]

        for sd in limited:
            for _ in range(int(sd.quantity)):
                if not remaining_idx:
                    break
                cands = [(i, order[i]) for i in remaining_idx]
                sheet, unplaced = self._pack_sheet_bfdh(cands, sd, sheet_counter)
                if sheet.parts:
                    self._apply_direction_transform(sheet, sd)
                    sheets_used.append(sheet)
                    sheet_counter += 1
                remaining_idx = unplaced

        while remaining_idx and unlimited:
            sd    = unlimited[0]
            cands = [(i, order[i]) for i in remaining_idx]
            sheet, unplaced = self._pack_sheet_bfdh(cands, sd, sheet_counter)
            if sheet.parts:
                self._apply_direction_transform(sheet, sd)
                sheets_used.append(sheet)
                sheet_counter += 1
                if len(unplaced) == len(remaining_idx):
                    break  # no progress
            else:
                break
            remaining_idx = unplaced

        result.sheets      = sheets_used
        result.sheet_count = len(sheets_used)
        result.total_parts = sum(s.part_count() for s in sheets_used)
        result.time_ms     = (time.time() - t0) * 1000.0

        if sheets_used:
            total_placed = sum(
                float(p.actual_width()) * float(p.actual_height())
                for s in sheets_used for p in s.parts
            )
            total_sheet = sum(float(s.width) * float(s.height)
                              for s in sheets_used)
            result.utilization = (total_placed / total_sheet * 100.0
                                  if total_sheet > 0 else 0.0)

        self._apply_repeat_stats(result)
        result.fitness = self._score_result(result, total_required=len(order))
        return result

    # ── Packing variant list (MaxRects / Skyline) ───────────────

    def _pack_variants(self, deep_search: bool = False):
        if not deep_search:
            variants = [
                (MaxRectsBaf,  SORT_NONE,  "MaxRectsBaf/Order"),
                (MaxRectsBaf,  SORT_AREA,  "MaxRectsBaf/Area"),
                (MaxRectsBssf, SORT_NONE,  "MaxRectsBssf/Order"),
                (MaxRectsBlsf, SORT_LSIDE, "MaxRectsBlsf/LongSide"),
                (MaxRectsBl,   SORT_AREA,  "MaxRectsBl/Area"),
                (SkylineMwf,   SORT_NONE,  "SkylineMwf/Order"),
            ]
            if _G:
                variants.append((_G[0], SORT_AREA, f"{_G[0].__name__}/Area"))
            return variants

        mr_sorts  = [("Order", SORT_NONE), ("Area", SORT_AREA),
                     ("LongSide", SORT_LSIDE), ("Peri", SORT_PERI)]
        sky_sorts = [("Order", SORT_NONE), ("Area", SORT_AREA)]
        g_sorts   = [("Area", SORT_AREA), ("LongSide", SORT_LSIDE)]

        variants = []
        for algo in [MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf, MaxRectsBl]:
            for sname, sfunc in mr_sorts:
                variants.append((algo, sfunc, f"{algo.__name__}/{sname}"))
        for algo in [SkylineMwf, SkylineBl]:
            for sname, sfunc in sky_sorts:
                variants.append((algo, sfunc, f"{algo.__name__}/{sname}"))
        for g in _G[:3]:
            for sname, sfunc in g_sorts:
                variants.append((g, sfunc, f"{g.__name__}/{sname}"))
        return variants

    # ── Eval helpers ────────────────────────────────────────────

    def _eval_fast(self, order, gen, variants):
        """
        Fast eval: 30% chance to probe BFDH, otherwise try 2 MaxRects variants.
        BFDH is cheaper than MaxRects for many parts (O(n log n) vs O(n²)) and
        produces strip-packed solutions that MaxRects may miss.
        """
        if random.random() < 0.30:
            r = self._evaluate_bfdh(order, gen)
            return -r.score(), r

        chosen = random.sample(variants, min(2, len(variants)))
        best_e, best_r = float("inf"), None
        for algo, sfunc, name in chosen:
            r = self._evaluate(order, algo, gen, sort_func=sfunc, algo_name=name)
            e = -r.score()
            if e < best_e:
                best_e, best_r = e, r
        return best_e, best_r

    def _eval_full(self, order, gen, variants):
        """
        Full eval: all MaxRects/Skyline variants + BFDH (with height-sorted input).
        Returns the single best result across all strategies.
        """
        best = None

        # MaxRects + Skyline variants
        for algo, sfunc, name in variants:
            r = self._evaluate(order, algo, gen, sort_func=sfunc, algo_name=name)
            if best is None or r.score() > best.score():
                best = r

        # BFDH with original order
        r_bfdh = self._evaluate_bfdh(order, gen)
        if r_bfdh.score() > (best.score() if best else -float("inf")):
            best = r_bfdh

        # BFDH with height-sorted order (canonical strip-packing input)
        h_order = sorted(order, key=lambda p: (-float(p.height), -float(p.width)))
        if h_order != order:
            r_hbfdh = self._evaluate_bfdh(h_order, gen)
            if r_hbfdh.score() > best.score():
                best = r_hbfdh

        return -best.score(), best

    # ──────────────────────────────────────────────────────────
    # MaxRects evaluation (unchanged from v5.0)
    # ──────────────────────────────────────────────────────────

    def _evaluate(self, parts, algo_cls, gen,
                  sort_func=SORT_NONE, algo_name=None) -> NestResult:
        result = NestResult(
            algorithm=algo_name or algo_cls.__name__,
            generation=gen, strategy=self.strategy,
        )
        t0 = time.time()

        remaining     = list(parts)
        sheets_used   = []
        sheet_counter = 1

        limited   = [s for s in self.sheet_defs if s.quantity < 999]
        unlimited = [s for s in self.sheet_defs if s.quantity >= 999]

        for sd in limited:
            for _ in range(int(sd.quantity)):
                if not remaining:
                    break
                sheet, remaining = self._pack_sheet(
                    remaining, sd, sheet_counter, algo_cls, sort_func)
                if sheet.parts:
                    self._apply_direction_transform(sheet, sd)
                    sheets_used.append(sheet)
                    sheet_counter += 1

        while remaining and unlimited:
            sd = unlimited[0]
            sheet, remaining = self._pack_sheet(
                remaining, sd, sheet_counter, algo_cls, sort_func)
            if sheet.parts:
                self._apply_direction_transform(sheet, sd)
                sheets_used.append(sheet)
                sheet_counter += 1
            else:
                break

        result.sheets      = sheets_used
        result.sheet_count = len(sheets_used)
        result.total_parts = sum(s.part_count() for s in sheets_used)
        result.time_ms     = (time.time() - t0) * 1000.0

        if sheets_used:
            total_placed = sum(
                float(p.actual_width()) * float(p.actual_height())
                for s in sheets_used for p in s.parts
            )
            total_sheet = sum(float(s.width) * float(s.height)
                              for s in sheets_used)
            result.utilization = (total_placed / total_sheet * 100.0
                                  if total_sheet > 0 else 0.0)

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
        sheet.source_sheet_name = sheet_def.name
        sheet.is_remnant        = sheet_def.is_remnant
        sheet.priority          = sheet_def.priority

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
            if (pw <= uw and ph <= uh or
                    (self.auto_rotate and ph <= uw and pw <= uh)):
                packer.add_rect(pw, ph, rid=i)

        packer.pack()

        placed = set()
        for rect in packer.rect_list():
            _b, x, y, w, h, rid = rect
            src = parts[rid]
            p   = deepcopy(src)
            p.sheet_id = sheet_id
            p.x        = x + ml
            p.y        = y + mb

            orig_w    = float(getattr(src, "width", 0) or 0) + self.gap
            p.rotated = abs(float(w) - orig_w) > 0.01
            p.status  = "nested"
            sheet.parts.append(p)
            placed.add(rid)

        remaining = [p for i, p in enumerate(parts) if i not in placed]
        return sheet, remaining

    # ──────────────────────────────────────────────────────────
    # Industrial scoring  (unchanged from v5.0)
    # ──────────────────────────────────────────────────────────

    def _sheet_signature_for_repeats(self, sheet):
        sig = []
        for p in getattr(sheet, "parts", []) or []:
            sig.append((
                round(float(getattr(p, "x", 0) or 0), 1),
                round(float(getattr(p, "y", 0) or 0), 1),
                round(float(p.actual_width()), 1),
                round(float(p.actual_height()), 1),
                bool(getattr(p, "rotated", False)),
                str(getattr(p, "design_code", "cd0") or "cd0").lower(),
            ))
        return (round(float(sheet.width), 1),
                round(float(sheet.height), 1),
                tuple(sorted(sig)))

    def _apply_repeat_stats(self, result: NestResult):
        counts = {}
        for s in result.sheets:
            sig = self._sheet_signature_for_repeats(s)
            counts[sig] = counts.get(sig, 0) + 1
        result.unique_nests = len(counts)
        result.max_repeat   = max(counts.values()) if counts else 0

    def _score_result(self, result: NestResult, total_required: int) -> float:
        if not result.sheets:
            return -10 ** 12

        per_sheet_utils = [float(s.utilization()) for s in result.sheets]
        min_util  = min(per_sheet_utils) if per_sheet_utils else 0.0
        last_util = per_sheet_utils[-1]  if per_sheet_utils else 0.0

        global_util  = result.utilization
        sheet_count  = result.sheet_count
        nested       = result.total_parts
        not_nested   = max(0, total_required - nested)
        remnant_used = sum(1 for s in result.sheets
                          if getattr(s, "is_remnant", False))

        score  = nested    * 1_000_000
        score -= not_nested * 3_000_000
        score -= sheet_count * 100_000
        score += global_util * 8_000
        score += last_util   * 3_500
        if last_util < 40.0:
            score -= (40.0 - last_util) * 2_000
        score += min_util * 1_500
        score += sum(5_000 for u in per_sheet_utils if u >= 88.0)
        score += remnant_used * 8_000

        if self.strategy == "balanced_repeats":
            repeat_gain  = max(0, result.max_repeat - 1)
            unique_nests = result.unique_nests or sheet_count
            score += repeat_gain  * 32_000
            score -= unique_nests *  9_000
            score += self._util_balance_bonus(per_sheet_utils) * 350
        elif self.strategy == "prefer_repeats":
            repeat_gain  = max(0, result.max_repeat - 1)
            unique_nests = result.unique_nests or sheet_count
            score += repeat_gain  * 80_000
            score -= unique_nests * 24_000
            score += min_util     *  1_000
        else:
            score += global_util * 2_000
            score -= (result.unique_nests or sheet_count) * 2_500

        return score

    @staticmethod
    def _util_balance_bonus(utils):
        if not utils:
            return 0.0
        avg      = sum(utils) / len(utils)
        variance = sum((u - avg) ** 2 for u in utils) / len(utils)
        return max(0.0, 100.0 - math.sqrt(variance))

    # ──────────────────────────────────────────────────────────
    # Memory management
    # ──────────────────────────────────────────────────────────

    def _add_result(self, r: NestResult):
        self.all_results.append(r)
        if len(self.all_results) > 250:
            self.all_results.sort(key=lambda x: -x.score())
            self.all_results = self.all_results[:120]

    def _finalise_results(self):
        self.all_results.sort(
            key=lambda r: (-r.score(), -r.total_parts,
                           r.sheet_count, -r.utilization, r.unique_nests)
        )
        for i, r in enumerate(self.all_results):
            r.rank = i + 1
        if self.all_results:
            self.best_result = self.all_results[0]

    # ──────────────────────────────────────────────────────────
    # Direction transform
    # ──────────────────────────────────────────────────────────

    def _apply_direction_transform(self, sheet: Sheet, sheet_def: SheetDef):
        direction = getattr(self, "direction", None) or "bottom_left"
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

    # ──────────────────────────────────────────────────────────
    # Validation / diagnostics
    # ──────────────────────────────────────────────────────────

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
                        p1.x + p1.actual_width()  + g <= p2.x or
                        p2.x + p2.actual_width()  + g <= p1.x or
                        p1.y + p1.actual_height() + g <= p2.y or
                        p2.y + p2.actual_height() + g <= p1.y
                    ):
                        errors.append(f"❌ overlap: {p1.part_code} ↔ {p2.part_code}")
        return errors

    def print_results(self):
        print(f"\n{'Rank':<6}{'Algorithm':<26}{'GlobalUtil%':<13}"
              f"{'Sheets':<8}{'Parts':<8}{'Rep':<5}{'Unique':<7}")
        print("-" * 80)
        for r in self.all_results[:12]:
            print(f"{r.rank:<6}{r.algorithm:<26}{r.utilization:<13.1f}"
                  f"{r.sheet_count:<8}{r.total_parts:<8}{r.max_repeat:<5}"
                  f"{r.unique_nests:<7}")


if __name__ == "__main__":
    from csv_handler import parse_csv, create_sample_csv
    sample = create_sample_csv()
    order, _ = parse_csv(sample)
    engine = NestingEngine()
    engine.add_remnant("Remnant-1", 1500, 800, priority=1)
    sheets = engine.run(order.parts, generations=10, time_limit=5.0)
    engine.print_results()
    errors = engine.validate(sheets)
    print("✅ Nesting Engine v6.0 OK" if not errors else "\n".join(errors))
