"""
FIROO CAM - Nesting Engine v2
Genetic Algorithm + MaxRects
"""
import time, random, math
from typing import List, Tuple, Optional
from dataclasses import dataclass, field
from copy import deepcopy
from rectpack import newPacker, PackingMode, SORT_AREA, SORT_LSIDE, SORT_RATIO
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
        tag = "🔸پرتی" if self.is_remnant else "📦"
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

    def score(self) -> float:
        return self.total_parts * 1000 + self.utilization * 10 - self.sheet_count * 5

    def __str__(self):
        return (f"Rank:{self.rank:2} | Util:{self.utilization:5.1f}% | "
                f"Sheets:{self.sheet_count} | Parts:{self.total_parts} | "
                f"Gen:{self.generation} | {self.algorithm}")

class NestingEngine:
    PACK_ALGOS = [MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf]

    def __init__(self):
        self.gap           = config.part_gap
        self.margin        = config.edge_margin  # fallback uniform margin
        self.margin_top    = config.edge_margin
        self.margin_left   = config.edge_margin
        self.margin_right  = config.edge_margin
        self.margin_bottom = config.edge_margin
        self.auto_rotate   = config.get("nesting","auto_rotation")
        self.direction     = "bottom_left"
        self.sheet_defs: List[SheetDef] = []
        self.all_results: List[NestResult] = []
        self.best_result: Optional[NestResult] = None
        self._add_default_sheet()

    def _add_default_sheet(self):
        self.sheet_defs = [SheetDef(
            name="Default", width=config.sheet_width,
            height=config.sheet_height, priority=3, quantity=999
        )]

    def set_sheets(self, sheet_defs: List[SheetDef]):
        self.sheet_defs = sorted(
            sheet_defs, key=lambda s: (0 if s.is_remnant else 1, s.priority))

    def add_remnant(self, name, width, height, priority=1):
        self.sheet_defs.insert(0, SheetDef(
            name=name, width=width, height=height,
            priority=priority, quantity=1, is_remnant=True))

    def run(self, parts: List[Part], generations=20, population=15,
            time_limit=8.0) -> List[Sheet]:
        if not parts:
            return []
        self.all_results = []
        start = time.time()
        pop = self._create_population(parts, population)
        best_ever = None
        for gen in range(generations):
            if time.time() - start > time_limit:
                break
            gen_results = []
            for order in pop:
                for algo in self.PACK_ALGOS:
                    t0 = time.time()
                    result = self._evaluate(order, algo, gen)
                    result.time_ms = (time.time()-t0)*1000
                    gen_results.append((result, order))
                    self.all_results.append(result)
            gen_results.sort(key=lambda x: -x[0].score())
            if not best_ever or gen_results[0][0].score() > best_ever.score():
                best_ever = gen_results[0][0]
            top = [x[1] for x in gen_results[:max(2, population//3)]]
            pop = top + self._mutate(top, population - len(top), parts)
        self.all_results.sort(key=lambda r: (-r.total_parts, -r.utilization, r.sheet_count))
        for i,r in enumerate(self.all_results): r.rank = i+1
        if self.all_results:
            self.best_result = self.all_results[0]
            return self.best_result.sheets
        return []

    # ── SA constants ──────────────────────────────────────────
    SA_T_INIT   = 1.0     # starting temperature
    SA_T_MIN    = 0.004   # minimum temperature before reheat
    SA_COOLING  = 0.975   # per-step cooling factor
    SA_CYCLE    = 120     # SA steps between progress reports / reheats

    def run_continuous(self, parts: List[Part], stop_event,
                       on_progress=None) -> List[Sheet]:
        """Simulated Annealing + MaxRects, runs until stop_event is set.

        Neighbor moves: random swap / 2-opt reverse / reinsertion.
        Each SA step evaluates one random MaxRects variant (fast).
        Every SA_CYCLE steps: full 3-variant evaluation, reheat, report.
        Direction transform is applied inside _evaluate via self.direction.
        """
        if not parts:
            return []
        self.all_results = []
        start = time.time()

        # ── Warm start: pick best ordering from initial population ─
        pop = self._create_population(parts, 8)
        best_order, best_energy, best_result = None, float("inf"), None
        for order in pop:
            if stop_event.is_set():
                break
            e, r = self._sa_eval_full(order)
            self.all_results.append(r)
            if e < best_energy:
                best_energy      = e
                best_order       = list(order)
                best_result      = r
                self.best_result = r  # expose to worker immediately

        if best_order is None:
            return []

        current_order  = list(best_order)
        current_energy = best_energy

        T              = self.SA_T_INIT
        step_in_cycle  = 0
        gen            = 0          # reported cycle count
        no_improve     = 0          # cycles since global best improved

        while not stop_event.is_set():
            # ── SA step ───────────────────────────────────────────
            neighbor = list(current_order)
            n = len(neighbor)
            if n >= 2:
                r = random.random()
                if r < 0.50:
                    # Swap two random positions
                    i, j = random.sample(range(n), 2)
                    neighbor[i], neighbor[j] = neighbor[j], neighbor[i]
                elif r < 0.75:
                    # 2-opt: reverse a random segment
                    i, j = sorted(random.sample(range(n), 2))
                    if j > i:
                        neighbor[i:j + 1] = neighbor[i:j + 1][::-1]
                else:
                    # Reinsertion: remove one element, insert elsewhere
                    i = random.randrange(n)
                    j = random.randrange(n - 1)
                    elem = neighbor.pop(i)
                    neighbor.insert(j, elem)

            # Fast single-algo energy estimate during exploration
            n_energy, n_result = self._sa_eval_fast(neighbor)
            self.all_results.append(n_result)

            delta = n_energy - current_energy
            if delta < 0 or random.random() < math.exp(-delta / max(T, 1e-10)):
                current_order  = neighbor
                current_energy = n_energy
                # Update global best (verify with full 3-algo eval)
                if n_energy < best_energy:
                    full_e, full_r = self._sa_eval_full(neighbor)
                    self.all_results.append(full_r)
                    if full_e < best_energy:
                        best_energy      = full_e
                        best_order       = list(neighbor)
                        best_result      = full_r
                        self.best_result = full_r  # live read by worker callback
                        no_improve       = 0

            T = max(self.SA_T_MIN, T * self.SA_COOLING)
            step_in_cycle += 1

            if step_in_cycle >= self.SA_CYCLE or stop_event.is_set():
                step_in_cycle = 0
                gen += 1
                no_improve += 1

                # Reheat: restart current state from global best
                current_order    = list(best_order)
                current_energy   = best_energy
                self.best_result = best_result  # always fresh for worker to read
                T = self.SA_T_INIT

                if on_progress and best_result:
                    on_progress(gen, best_result.utilization,
                                best_result.sheet_count,
                                time.time() - start, no_improve)

        self._finalise_results()
        return self.best_result.sheets if self.best_result else []

    def _sa_eval_fast(self, order):
        """Single random-algo evaluation — used during SA exploration."""
        algo = random.choice(self.PACK_ALGOS)
        r = self._evaluate(order, algo, 0)
        return -r.score(), r

    def _sa_eval_full(self, order):
        """All 3 algos, return best — used at cycle checkpoints."""
        best = None
        for algo in self.PACK_ALGOS:
            r = self._evaluate(order, algo, 0)
            if best is None or r.score() > best.score():
                best = r
        return -best.score(), best

    def _finalise_results(self):
        self.all_results.sort(
            key=lambda r: (-r.total_parts, -r.utilization, r.sheet_count))
        for i, r in enumerate(self.all_results):
            r.rank = i + 1
        if self.all_results:
            self.best_result = self.all_results[0]

    def _create_population(self, parts, size):
        pop = []
        base = list(parts)
        pop.append(list(base))                                                     # strategy-sorted order (from caller)
        pop.append(sorted(base, key=lambda p: p.width * p.height, reverse=True))  # area DESC
        pop.append(sorted(base, key=lambda p: max(p.width, p.height), reverse=True))
        pop.append(sorted(base, key=lambda p: min(p.width, p.height), reverse=True))
        while len(pop) < size:
            s = list(base); random.shuffle(s); pop.append(s)
        return pop[:size]

    def _mutate(self, top, count, parts):
        mutated = []
        base = list(parts)
        for _ in range(count):
            s = list(random.choice(top))
            if len(s) > 2:
                i,j = random.sample(range(len(s)), 2)
                s[i],s[j] = s[j],s[i]
            mutated.append(s)
        return mutated

    def _evaluate(self, parts, algo_cls, gen) -> NestResult:
        result = NestResult(algorithm=algo_cls.__name__, generation=gen)
        remaining = list(parts)
        sheets_used = []
        sheet_counter = 1
        limited = [s for s in self.sheet_defs if s.quantity < 999]
        unlimited = [s for s in self.sheet_defs if s.quantity >= 999]
        for sd in limited:
            for _ in range(sd.quantity):
                if not remaining: break
                sheet, remaining = self._pack_sheet(remaining, sd, sheet_counter, algo_cls)
                if sheet.parts:
                    self._apply_direction_transform(sheet, sd)
                    sheets_used.append(sheet); sheet_counter += 1
        while remaining and unlimited:
            sd = unlimited[0]
            sheet, remaining = self._pack_sheet(remaining, sd, sheet_counter, algo_cls)
            if sheet.parts:
                self._apply_direction_transform(sheet, sd)
                sheets_used.append(sheet); sheet_counter += 1
            else: break
        result.sheets = sheets_used
        result.sheet_count = len(sheets_used)
        result.total_parts = sum(s.part_count() for s in sheets_used)
        if sheets_used:
            utils = [s.utilization() for s in sheets_used]
            result.utilization = sum(utils)/len(utils)
        return result

    def _pack_sheet(self, parts, sheet_def, sheet_id, algo_cls):
        # Use individual 4-side margins
        ml = getattr(self, "margin_left",   self.margin)
        mr = getattr(self, "margin_right",  self.margin)
        mt = getattr(self, "margin_top",    self.margin)
        mb = getattr(self, "margin_bottom", self.margin)

        # Available packing area after margins
        uw = sheet_def.width  - ml - mr
        uh = sheet_def.height - mt - mb

        packer = newPacker(mode=PackingMode.Offline, pack_algo=algo_cls,
                           rotation=self.auto_rotate, sort_algo=SORT_AREA)
        packer.add_bin(uw, uh, count=1)
        for i,p in enumerate(parts):
            packer.add_rect(p.width+self.gap, p.height+self.gap, rid=i)
        packer.pack()
        sheet = Sheet(sheet_id=sheet_id, width=sheet_def.width,
                      height=sheet_def.height, thickness=sheet_def.thickness,
                      material=sheet_def.material)
        placed = set()
        for rect in packer.rect_list():
            b,x,y,w,h,rid = rect
            p = deepcopy(parts[rid])
            p.sheet_id = sheet_id
            p.x = x + ml   # offset by left margin
            p.y = y + mb   # offset by bottom margin
            p.rotated = (w != parts[rid].width + self.gap)
            p.status  = "nested"
            sheet.parts.append(p)
            placed.add(rid)
        remaining = [p for i,p in enumerate(parts) if i not in placed]
        return sheet, remaining

    def _apply_direction_transform(self, sheet: "Sheet", sheet_def: SheetDef):
        """Mirror packed coordinates so the start corner matches the chosen direction."""
        if self.direction == "bottom_left":
            return
        W, H = sheet_def.width, sheet_def.height
        for part in sheet.parts:
            pw = part.actual_width()
            ph = part.actual_height()
            if self.direction == "bottom_right":
                part.x = W - part.x - pw
            elif self.direction == "top_left":
                part.y = H - part.y - ph
            elif self.direction == "top_right":
                part.x = W - part.x - pw
                part.y = H - part.y - ph

    def validate(self, sheets: List[Sheet]) -> List[str]:
        ml = getattr(self, "margin_left",   self.margin)
        mr = getattr(self, "margin_right",  self.margin)
        mt = getattr(self, "margin_top",    self.margin)
        mb = getattr(self, "margin_bottom", self.margin)
        errors = []
        for sheet in sheets:
            for i,p1 in enumerate(sheet.parts):
                if p1.x < ml: errors.append(f"⚠️ {p1.part_code}: از لبه چپ خارج")
                if p1.y < mb: errors.append(f"⚠️ {p1.part_code}: از لبه پایین خارج")
                if p1.x+p1.actual_width() > sheet.width-mr:
                    errors.append(f"❌ {p1.part_code}: از لبه راست خارج")
                if p1.y+p1.actual_height() > sheet.height-mt:
                    errors.append(f"❌ {p1.part_code}: از لبه بالا خارج")
                for j,p2 in enumerate(sheet.parts):
                    if i >= j: continue
                    g = self.gap/2
                    if not (p1.x+p1.actual_width()+g <= p2.x or
                            p2.x+p2.actual_width()+g <= p1.x or
                            p1.y+p1.actual_height()+g <= p2.y or
                            p2.y+p2.actual_height()+g <= p1.y):
                        errors.append(f"❌ تداخل: {p1.part_code} با {p2.part_code}")
        return errors

    def print_results(self):
        print(f"\n{'Rank':<6}{'Algorithm':<20}{'Util%':<8}{'Sheets':<8}{'Parts':<8}")
        print("-"*50)
        for r in self.all_results[:8]:
            print(f"{r.rank:<6}{r.algorithm:<20}{r.utilization:<8.1f}{r.sheet_count:<8}{r.total_parts:<8}")

if __name__ == "__main__":
    from csv_handler import parse_csv, create_sample_csv
    sample = create_sample_csv()
    order, _ = parse_csv(sample)
    engine = NestingEngine()
    engine.add_remnant("پرتی-۱", 1500, 800, priority=1)
    sheets = engine.run(order.parts, generations=10, time_limit=5.0)
    engine.print_results()
    for sheet in sheets:
        print(f"\nشیت {sheet.sheet_id}: {sheet.part_count()} قطعه — {sheet.utilization():.1f}%")
    errors = engine.validate(sheets)
    print(f"\n{'✅ بدون خطا' if not errors else chr(10).join(errors)}")
    print("✅ Nesting Engine OK")
