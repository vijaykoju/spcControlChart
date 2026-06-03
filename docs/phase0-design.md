# Phase 0 design — the chart-type seam + per-point limits

**Status:** design (not yet implemented). Part of the [roadmap](ROADMAP.md).

## Objective

Establish the architecture that lets every later chart family plug in, **without changing any
visible behavior**. After Phase 0 the visual still renders exactly the X-mR chart it does today, but:

1. Limits are resolved **per point** instead of per phase.
2. The X-mR logic lives behind a **`ChartStrategy`** interface.
3. A **chart-type dropdown** exists in the format pane (with "Individuals (X-mR)" as the only entry).

**Definition of done:** the existing unit suite passes unchanged (after mechanical call-site
updates), and a before/after render of the same data is pixel-identical.

## Why per-point limits is the load-bearing change

Today `statsForPoint(phased, point)` returns the point's *phase* limits — constant within a phase.
Attribute charts (`p`, `u`) have limits that depend on each point's sample size `nᵢ`, so they
**change every point**. The whole family fits cleanly only if the model treats limits as per-point,
with "constant within a phase" as the special case. Phase 0 introduces that generalization while the
only strategy (individuals) still produces phase-constant limits — so output is unchanged.

## Validate the seam before locking it (do this first)

The point of Phase 0 is to get the abstraction right, and an interface designed against a *single*
implementation is usually the wrong one. **Before writing code, pressure-test the interface below on
paper against two later strategies that stress it differently:**

- **p-chart** — varying per-point limits (`p̄ ± 3√(p̄(1−p̄)/nᵢ)`), no companion. Confirms `perPoint`
  and the no-companion path.
- **X̄-R** — a **companion dispersion chart (R)** whose center/limits (`R̄`, `D₄R̄`, `D₃R̄`) are
  **not** expressible as the primary `SpcStatistics`. Confirms the `CompanionModel` (below) is real,
  not a placeholder.

If either can't be expressed in the interface without reshaping it, reshape it *now*. This is the
cheapest moment to be wrong.

## The seam

### Types (new — `src/spc/chartType.ts`)

```ts
import { DataPoint, SpcStatistics } from "./types";
import { PhaseSegment } from "./statistics";   // reuse — do NOT introduce a duplicate type
import { StatsOptions } from "./statistics";

export type ChartType = "individuals"; // Phase 1+ adds "p" | "np" | "c" | "u" | "xbar-r" | ...

/** Center + control limits for one point of a companion (dispersion) chart. Modeled separately
 *  from the primary SpcStatistics because R/s charts have their own limit structure (D4·R̄ etc.). */
export interface CompanionPoint { center: number; ucl: number; lcl: number; }

export interface CompanionModel {
    kind: "mr" | "r" | "s";
    /** value[i] is the plotted dispersion statistic for points[i] (movingRange / range / stddev);
     *  null where undefined (e.g. the first MR). */
    value: (number | null)[];
    /** Per-point companion limits, aligned to points. */
    limits: CompanionPoint[];
    axisTitle: string;            // "Moving Range" | "Range" | "Std Dev"
}

/** Per-point primary limits + the contiguous runs that share identical limits. */
export interface LimitModel {
    /** perPoint[i] applies to points[i] (1-based index i+1). */
    perPoint: SpcStatistics[];
    /** Runs of adjacent points with identical limits — one segment per phase for individuals.
     *  For varying-limit charts this degrades to one segment per point (stepped rendering). */
    segments: PhaseSegment[];
    /** 1 or 2 for individuals; undefined for chart types with no phase concept. */
    phaseOf?: (p: DataPoint) => number;
    /** Drives the tooltip "Phase" row and the phase-change line. */
    singlePhase: boolean;
    /** Companion dispersion chart, or null (attribute charts have none). */
    companion: CompanionModel | null;
}

/** Everything a strategy needs that isn't the points themselves. Opaque to the caller — strategies
 *  read only what they use, so individuals-only concepts (changepoint) don't leak into the signature. */
export interface ChartContext { opts: StatsOptions; }

export interface ChartStrategy {
    id: ChartType;
    /** Rules valid for this chart type (subset of 1-8). Individuals = all 8. */
    applicableRules: Set<number>;
    /** Whether A/B/C zones are meaningful (drives zone shading + zone-rule eligibility). */
    zonesMeaningful: boolean;
    /** Compute per-point limits (+ segments + companion) for the prepared points. */
    computeLimits(points: DataPoint[], ctx: ChartContext): LimitModel;
}

export const STRATEGIES: Record<ChartType, ChartStrategy> = { individuals: individualsStrategy };
```

Notes on the fixes baked in here:

- **Companion is a model, not a tag.** Individuals fills it from `mrBar`; X̄-R will fill it from
  `R̄`/`D₄`/`D₃`. The renderer reads `companion.value`/`companion.limits` and never touches `mrBar`
  directly again. (Fixes the "companion not modeled" gap.)
- **No `changeAt` in the signature.** The strategy owns phase resolution: the individuals strategy
  calls `resolveChangepoint` itself. `visual.ts` no longer computes `changeAt`. (Fixes the
  individuals-only leakage.)
- **`PhaseSegment` is reused**, not duplicated.

### The individuals strategy (new — `src/spc/strategies/individuals.ts`)

A thin adapter over current logic — this is what proves the seam with zero behavior change:

```ts
export const individualsStrategy: ChartStrategy = {
    id: "individuals",
    applicableRules: new Set([1,2,3,4,5,6,7,8]),
    zonesMeaningful: true,
    computeLimits(points, ctx) {
        const changeAt = resolveChangepoint(points, ctx.changepoint); // strategy owns phases
        const phased = computePhasedStatistics(points, changeAt, ctx.opts); // unchanged
        const segments = splitPhases(points, phased);                       // unchanged
        const perPoint = points.map(p => statsForPoint(phased, p));         // unchanged
        const companion: CompanionModel = {
            kind: "mr",
            value: points.map(p => p.movingRange),
            limits: perPoint.map(s => ({ center: s.mrBar, ucl: D4 * s.mrBar, lcl: 0 })),
            axisTitle: "Moving Range",
        };
        return { perPoint, segments, companion,
                 phaseOf: p => (p.index < phased.changeAt ? 1 : 2),
                 singlePhase: phased.singlePhase };
    },
};
```

(`ChartContext` carries the changepoint options too — extend it to `{ opts, changepoint }`.) Nothing
in `statistics.ts` or `changepoint.ts` changes; `D4`, `computePhasedStatistics`, `splitPhases`,
`statsForPoint`, `resolveChangepoint` are all already exported.

## Consuming per-point limits

### Rules (`src/spc/rules.ts`) — full ripple

The accessor switch is **not** a one-liner. All of the following change:

1. `RuleCheck` type (line 16): `stats: PhasedStatistics` → `limitsAt: (p: DataPoint) => SpcStatistics`.
2. `evaluateRules` signature (the `stats` param) → `limitsAt`.
3. Rule fns that read stats — `rule1, rule2, rule3, rule4, rule6, rule7` — swap `statsForPoint(stats, q)`
   for `limitsAt(q)`. **`rule5` and `rule8` take no stats** (direction-only); they're unaffected
   beyond the type signature.
4. Helpers `countInZoneC(window, stats)` and `noVariation(points, i, stats)` → take/use `limitsAt`.
5. The `RULES[].check(points, i, stats)` invocation inside `evaluateRules` → pass `limitsAt`.

Provide an adapter so call sites (and tests) change minimally:

```ts
export const limitsFromModel = (m: LimitModel) => (p: DataPoint) => m.perPoint[p.index - 1];
```

For individuals this returns the point's phase stats, so fired-rule outputs are **byte-identical**.
Window rules look up each window point `q` via `limitsAt(q)`, so stair-stepped limits work later
with no further change.

`visual.ts` intersects the user's enabled rules with the strategy's `applicableRules` before calling
`evaluateRules` (so a chart type can't fire an inapplicable rule). For individuals the intersection
is all 8.

### Rendering (`src/rendering/chart.ts`) — every `phased` site to migrate

`ChartModel.phased: PhasedStatistics` → `ChartModel.limits: LimitModel`. Concrete call sites
(verified by line):

| Line(s) | Today | Phase 0 |
|---|---|---|
| 178 | `!phased.singlePhase` | `!limits.singlePhase` |
| **254–255** | `Math.min(phased.phase1.lcl, phased.phase2.lcl, …)` / `Math.max(phased.phase1.ucl, phased.phase2.ucl, …)` | **min/max over `limits.perPoint` (lcl/ucl)** plus data/target — *the load-bearing change; no `perPoint` replacement existed in the old plan* |
| 262 | `splitPhases(points, phased)` | use `limits.segments` |
| 275 | `!phased.singlePhase && segPixels.length > 1` | `!limits.singlePhase && …` |
| 309/499/515 | `drawDataLabels(…, phased, …)` → `statsForPoint(phased, p).xBar` | pass accessor; `limits.perPoint[p.index-1].xBar` |
| 325/700/727 | `drawMrChart(…, phased, …)`; stepped MR center/UCL from `seg.s.mrBar`; `!phased.singlePhase` | drive from `limits.companion` (value + limits) and `limits.singlePhase` |
| 332 | `buildMrTooltipItems(p, phased, …)` | pass companion limits / accessor |
| 594 | `buildTooltipItems(p, …, model.phased, …)` | `model.limits` |
| 746 | `evaluateMrViolations(points, phased)` | compare `companion.value[i]` to `companion.limits[i].ucl` (generalized) |

The Y-domain (254–255) is the one that *forces* a rewrite the moment `phased` leaves `ChartModel` —
specify it as min/max over `perPoint`.

### Tooltip (`src/tooltip.ts`) — both builders

- `buildTooltipItems(point, results, phased, …)`: "Phase" row from `phaseOf`/`singlePhase`;
  center/UCL/LCL from `perPoint[point.index-1]`.
- **`buildMrTooltipItems(point, phased, …)`** (don't miss this one): MR center/UCL from
  `companion.limits[index]`.

## Wiring (`src/visual.ts`)

```ts
const strategy = STRATEGIES[toChartType(s.chart.chartType.value.value)]; // only "individuals" now
const limits = strategy.computeLimits(points, { opts: statsOpts, changepoint: cp });
const enabled = intersect(toEnabledRules(s.rules.ruleToggles.map(t => t.value)), strategy.applicableRules);
const results = evaluateRules(points, limitsFromModel(limits), enabled);
renderChart(svg, { points, limits, results, zonesMeaningful: strategy.zonesMeaningful, ... }, w, h, services);
```

`resolveChangepoint` moves *into* the strategy, so the `changeAt` line leaves `visual.ts`.

## Format pane (`settings.ts`, `capabilities.json`, `settingsMap.ts`)

- New **Chart** card with a `chartType` `ItemDropdown`; Phase 0 ships a single item, "Individuals
  (X-mR)", as the default — existing reports persist nothing new and render identically.
- `capabilities.json`: add a `chart` object with `chartType` (`{ "enumeration": [] }`, items from
  settings — same pattern as `legend.position`).
- `settingsMap.ts`: `toChartType(value): ChartType` guarding unknown → `"individuals"` (mirrors
  `toLegendPosition` / `toSidePosition`).
- Place the **Chart** card first in the `cards` array (it's the top-level mode selector).

## Ordered task sequence (each step compiles + suite green before the next)

1. **Add `chartType.ts`** (types + empty `STRATEGIES`). *Verify:* compiles; nothing imports it yet.
2. **Add `individualsStrategy`** delegating to current functions; register it. *Verify:* a unit test
   asserts `computeLimits` returns a `LimitModel` whose `perPoint`/`segments`/`companion` are
   internally consistent for a fixture.
3. **Generalize `rules.ts`** to the `limitsAt` accessor + add `limitsFromModel`. Update rule-test
   call sites to `evaluateRules(points, limitsFromModel(individualsStrategy.computeLimits(points, ctx)), …)`.
   *Verify:* every existing rule assertion passes byte-identical.
4. **Migrate `tooltip.ts`** (both builders) to `LimitModel`. *Verify:* tooltip tests pass.
5. **Migrate `chart.ts`** `ChartModel` + all sites in the table above (Y-domain included). *Verify:*
   build passes; manual pixel-identical check on a sample report.
6. **Add the Chart card + capabilities + `toChartType`**; wire `visual.ts` through the strategy.
   *Verify:* `toChartType` guard test; visual renders X-mR as before; chart-type dropdown shows one
   option defaulting to Individuals.
7. **Full suite + package.** *Verify:* `npm test` green; `npm run package` clean.

## Testing strategy

- **Primary guard (real):** the existing suite stays green after steps 3–5 — the rule-firing and
  tooltip fixtures are genuine end-to-end regression coverage.
- **Optional extra:** snapshot `evaluateRules` output on the current fixtures *before* the refactor
  and assert byte-identical *after*. (Do **not** assert `perPoint === points.map(statsForPoint…)` —
  that's tautological; it just restates how the strategy computes `perPoint`.)
- `toChartType` guard test (mirrors the other settings-map guards).

## Backward compatibility

- `chartType` defaults to `"individuals"` → existing reports render identically and persist nothing
  new until the user changes it.
- No data-role changes in Phase 0 (Count/Sample-size/Subgroup roles arrive in Phases 1–2), so no
  existing field bindings break.

## Explicitly out of scope for Phase 0

- Any new chart type or data role.
- Stepped/per-point limit *rendering* (designed for via `segments` degrading to one-per-point;
  built with the first varying-limit chart in Phase 1).
- The control-chart constants table (`A₂`, `D₄`, …) — lands in Phase 1/2 when first needed.
- Renaming the visual / version bump to 2.0.0 — happens when a second chart type ships.

## Risk notes

- **Hot-path refactor (rules + rendering + tooltip).** Mitigation: the ordered steps above each keep
  the suite green; pixel-identical manual check before merge; one focused PR, no feature added.
- **`evaluateRules` signature change ripples to tests** — mechanical, but review each call site.
- Keep `statistics.ts` and `changepoint.ts` untouched (surgical-change discipline); resist tidying
  while in there.
