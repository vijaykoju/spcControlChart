# CUSUM design — the time-weighted follow-up

**Status:** design (not yet implemented). The deferred third member of [Phase 3](phase3-design.md)
(EWMA + moving average shipped in 2.2.0). Targets version **2.3.0**. Builds on the `ChartStrategy`
seam and reuses the EWMA/MA scaffolding (`prepare(raw, ctx)`, `baseValue`, σ = MR̄/d₂, no zones,
no WE run rules).

## Objective

Add the **tabular CUSUM** chart — the cumulative-sum chart that detects small sustained shifts
fastest of the family. It plots **two** accumulating arms (C⁺ above, C⁻ below) about a zero
centerline, against a flat **decision interval ±H**, and signals when either arm crosses H.

**Definition of done:** `cusum` selectable; C⁺/C⁻ match a textbook fixture; the two arms + ±H
render on one panel; signals mark the arm that crossed; EWMA/MA/individuals/attribute/subgroup
unchanged; suite green.

## Why CUSUM is the most divergent chart so far

Every chart to date plots **one** value series (`DataPoint.value`) with per-point limits, and signals
via the shared rule engine (`evaluateRules` over `value` vs limits). CUSUM breaks both:

1. **Two plotted series, same panel, same scale.** C⁺ and C⁻ both emanate from 0 each point. This is
   not the companion panel (that's a separate stacked chart with its own y-scale, for MR/R/s) — both
   arms belong *together* on the primary panel. → a genuine second-series rendering addition.
2. **The signal is two-armed and bespoke.** A WE "beyond limit" on `value` alone would catch upward
   shifts (C⁺ > H) and miss every downward shift (C⁻ > H). → signals computed over both arms, not via
   the WE rules.

These are the two — and the only two — new pieces. Everything else (the ±H lines, the centerline,
the value/secondary line draws, the per-point `LimitModel`) reuses existing machinery.

## The model: tabular CUSUM (not V-mask)

We implement the **tabular (algorithmic) CUSUM**, the modern standard, *not* the V-mask. The V-mask
is the older graphical equivalent: harder to render, harder to read, and parameterized awkwardly
(lead distance + half-angle). Tabular CUSUM with a decision interval H is what Montgomery and every
current text teach, and it drops cleanly onto flat ±H limit lines we already know how to draw.

## The math

σ = MR̄ / d₂ from the raw individuals (the existing `D2 = 1.128`); μ₀ = x̄ = mean of `baseValue`
(same single-phase reference as EWMA/MA). Two parameters, both in σ units:

- **k** — the reference value / slack, **default 0.5** (half the shift to detect; k = 0.5 tunes for a
  1σ shift). `K = k·σ`.
- **h** — the decision interval, **default 5**. `H = h·σ`. (k = 0.5, h = 5 → in-control ARL ≈ 465;
  h = 4 → ≈ 168. 5 is the conservative textbook default.)

Tabular recursions, `C⁺₀ = C⁻₀ = 0`:

- `C⁺ᵢ = max(0, xᵢ − (μ₀ + K) + C⁺ᵢ₋₁)`  — accumulates upward drift
- `C⁻ᵢ = max(0, (μ₀ − K) − xᵢ + C⁻ᵢ₋₁)`  — accumulates downward drift (kept ≥ 0)

**Plot** `value = C⁺ᵢ` (≥ 0, above) and `secondarySeries = −C⁻ᵢ` (≤ 0, below), centerline 0, flat
lines at ±H. **Signal** at point i when `C⁺ᵢ > H` (upper) or `C⁻ᵢ > H` (lower).

**No auto-reset (v1).** Textbook tabular CUSUM does not reset the accumulators after a signal — a
passive chart doesn't model the corrective action that a reset represents. A sustained shift therefore
shows a *persistent run* of signals (correct: still out of control), and the arm drains naturally once
the process returns toward μ₀. Resetting to 0 (or FIR headstart C₀ = H/2 for faster startup
detection) is a documented future option, not v1. See Decision 1.

**Gaps** (blank readings) hold both sums across the gap (`C⁺ᵢ = C⁺ᵢ₋₁`, `C⁻ᵢ = C⁻ᵢ₋₁`); the gap
point plots nothing on either arm — same rule as EWMA's carry-forward.

## Signal integration (the bespoke arm)

CUSUM sets `applicableRules: new Set()` — **no WE rules** (the points are autocorrelated *and* the
signal is two-armed). So `evaluateRules` returns no violations, and the WE machinery is untouched.

The signal is a generic "either arm beyond its limit" check — it needs no CUSUM-specific constants,
because H is already encoded as ±the per-point limits. Add a helper beside `companionViolations`
that takes the points (for the upper arm's `value`) and the model (for `secondarySeries` + limits):

```ts
// chartType.ts — per-point {upper, lower} beyond-limit flags for a two-arm (CUSUM) model.
export const secondaryBeyond = (points: DataPoint[], m: LimitModel): { upper: boolean; lower: boolean }[] =>
    m.perPoint.map((s, i) => ({
        upper: points[i].value != null && (points[i].value as number) > s.ucl,   // C⁺ > H
        lower: m.secondarySeries?.[i] != null && (m.secondarySeries[i] as number) < s.lcl, // −C⁻ < −H
    }));
```

The CUSUM render branch draws a violation marker on **each arm that crossed** — at `y(value)` for an
upper signal, at `y(secondary)` for a lower one (a point can flag both). This is the only marker logic
that doesn't go through `drawMarkers` (which assumes a single `value`-positioned marker).

## Interface extensions (additive, all null/absent for every non-CUSUM chart)

- **`LimitModel.secondarySeries?: (number | null)[]`** — the C⁻ arm, plotted as `−C⁻`. Already
  reserved in the Phase 3 design; absent everywhere else, so the renderer change is isolated.
- **`ChartContext`** gains `cusumK?: number`, `cusumH?: number`.
- **`secondaryBeyond(points, model)`** helper (above) — the two-arm signal source.
- CUSUM strategy sets `varyingLimits: false` (flat ±H → the existing per-segment limit path),
  `zonesMeaningful: false`, `companion: null`, `applicableRules: new Set()`, `valueLabel: "CUSUM"`
  (the axis title — the chart plots *both* arms, so don't label it "C⁺").

No change to `DataPoint`, `prepare`'s signature, or the rule engine.

## The strategy (`strategies/timeWeighted.ts`, alongside ewma/ma)

**One source of truth for the base stats.** Both arms and the threshold depend on the same μ₀ and σ:
C⁺ (in `prepare`) needs μ₀ and `K = k·σ`; C⁻ and H (in `computeLimits`) need the same μ₀ and σ. To
stop the two functions from recomputing them independently (and drifting — e.g. different gap
handling), factor a shared helper `cusumStats(points, ctx) → { mu0, sigma, K, H }` and call it from
both. μ₀ = mean of the raw readings, σ = mean(`movingRange`)/D2.

> **Design debt:** this is the fourth derived-series family, and the first where a *threshold* and a
> *second series* both hang off the base stats — the strongest case yet for collapsing
> `prepare`/`computeLimits` into one `build(raw, ctx) → { points, limits }` (flagged since Phase 3).
> The shared `cusumStats` helper is the minimum mitigation within the current seam.

- **`prepare(raw, ctx)`**: compute `C⁺ᵢ` (using `cusumStats`), set `value = C⁺ᵢ`. **Set `baseValue =
  raw reading`** (it's how `computeLimits`/`cusumStats` recover μ₀/σ after `value` is overwritten; the
  raw-overlay is kept off for CUSUM by gating, see below, *not* by withholding `baseValue`). Set
  `direction: null`. **Strip `target`** (`target: null`) — a bound Target is on the raw scale and would
  draw a nonsense flat line on the ±H scale. Preserve every other field (`index`, `identity`,
  `categoryIndex`, `tooltips`). C⁻ is not stored on the point (no field for it) — it's computed in
  `computeLimits` where it becomes `secondarySeries`.
- **`computeLimits(points, ctx)`**: take `{ mu0, sigma, K, H }` from `cusumStats`; build `C⁻` by the
  recursion; `secondarySeries[i] = −C⁻ᵢ`; one segment (single-phase). **Build the ±H `perPoint` with
  LCL flooring OFF** — `{ center: 0, ucl: H, lcl: −H, …zones }`, e.g. `limitsFrom(0, 0, H/mult, mult,
  false)`. **Do not** thread `ctx.opts.floorLcl` here as the other mean-family strategies do:
  `limitsFrom` floors the LCL at 0 when the toggle is on (the default), which would collapse the −H
  decision line to 0 and make the lower arm signal on every downward step. The decision interval is
  intrinsically symmetric about 0.

> **Overlay gating (two consumers).** The raw-reading overlay is wired to the `showRaw` *toggle*, not
> to chart type — in `chart.ts` both the **overlay draw** (`points.filter(p => p.baseValue != null)`)
> and the **Y-domain expansion** (`baseMin`/`baseMax`, gated on `showRaw`) read `baseValue`. Since
> CUSUM now also sets `baseValue` (raw readings, ≈ μ₀), leaving these as-is would draw raw dots *and*
> stretch the ±H-scaled y-axis to include ≈ μ₀, shoving the zero-centered chart off-center. Gate
> **both** call sites on an `allowRawOverlay` (chart-type) flag — true only for ewma/ma — and update
> the now-stale `chart.ts` comment ("baseValue is unset elsewhere"). Must land in the same PR.

## Rendering (`rendering/chart.ts`)

A CUSUM branch keyed off `limits.secondarySeries != null`:

1. **±H + centerline:** reuse the constant-limit path — `varyingLimits: false` with `perPoint`
   {ucl: H, lcl: −H, center: 0} makes `drawLimitLines` draw exactly the decision interval and zero
   line. Zones skipped (`zonesMeaningful: false`).
2. **C⁺ line + points:** the existing `value` line/point draw, unchanged — these carry the point
   identity, so tooltip + selection stay bound to them.
3. **C⁻ line + points (new):** a second `d3.line` over `secondarySeries` (class `spc-line-secondary`)
   + its points, `.defined` breaking at gaps — a near-copy of the value-line block. **Non-signal C⁻
   points are display-only in v1** (no tooltip/selection), and the selection-dimming set isn't extended
   to the secondary line (so a click dims C⁺ but not C⁻). A conscious cut — see Decision 5. (The
   *signal* markers, item 4, are tooltip-wired — they sit atop the C⁺ points and would otherwise block
   the hover.)
4. **Signal markers (new):** from `secondaryBeyond(points, limits)`, draw a violation marker on each
   crossing arm (upper at `y(value)`, lower at `y(secondary)`).
5. **Y-domain:** extend the existing min/max to include `secondarySeries` (the C⁻ arm reaches −H and
   below) alongside `perPoint` ±H — and, per the gating note, **exclude `baseValue`** from the domain
   for CUSUM (the `baseMin`/`baseMax` terms must be off, or the raw readings ≈ μ₀ distort the scale).
6. **Raw overlay off** for CUSUM — both the dots and the Y-domain `baseValue` terms (see gating note).

## Tooltips

The smoothed-point tooltip (on the C⁺ points — the only ones bound to the tooltip, see Rendering item
3) should, for CUSUM, show **C⁺**, **C⁻** (= −secondary), and the **decision interval H**, plus a
Signal row (upper / lower / none). The tooltip builder already takes the model + services; add a
CUSUM-specific item list (mirrors the MR-panel tooltip helper). Minimal v1: C⁺, C⁻, H.

## Settings / capabilities

- `CHART_TYPE_ITEMS` (settings.ts) + `CHART_TYPES` (settingsMap.ts) + `toChartType`: add `cusum`;
  `CHART_TYPE_LABELS` (visual.ts) += "CUSUM".
- **Chart Parameters card:** add `cusumK` (NumUpDown, default 0.5) and `cusumH` (NumUpDown, default
  5). The `Min` validator only enforces ≥ (value 0 = ≥ 0), so set a small positive spinner `min`
  (e.g. 0.1) and rely on the `validate` hook for the strict `> 0` check (mirrors EWMA's λ guard). They
  join `ewmaLambda`/`maWindow`/raw-overlay controls — each a no-op for chart types that don't use it
  (the established no-op-card pattern). The raw-overlay controls are likewise no-ops for CUSUM.
- `capabilities.json`: `chartParameters` += `cusumK`, `cusumH` (numeric).
- `visual.ts`: read both into `ChartContext`.

## Validation (the `validate` hook)

CUSUM requires finite `k > 0` and `h > 0`; otherwise an empty-state message
("CUSUM reference value k and decision interval h must be greater than 0"), mirroring the EWMA/MA
parameter checks — never render a degenerate chart (k ≤ 0 → C⁺ never resets; h ≤ 0 → everything
signals).

## File-by-file

| File | Change |
|---|---|
| `spc/chartType.ts` | `ChartType` += `cusum`; `ChartContext` += `cusumK`/`cusumH`; `LimitModel.secondarySeries?`; `secondaryBeyond` helper. |
| `spc/strategies/timeWeighted.ts` | `cusumStats` shared helper (μ₀/σ/K/H); `cusumStrategy` (prepare → C⁺ + baseValue + strip target; computeLimits → C⁻/±H **with floor off**/secondarySeries; validate). |
| `spc/strategies/index.ts` | Register `cusumStrategy`. |
| `rendering/chart.ts` | CUSUM branch: secondary line + points, two-arm signal markers, Y-domain incl. secondary **and excl. baseValue**; gate the overlay draw **and** the Y-domain `baseValue` terms on `allowRawOverlay` (ewma/ma only); update the stale "baseValue is unset elsewhere" comment. |
| `settings.ts` / `settingsMap.ts` | `cusum` item + `cusumK`/`cusumH` slices + `toChartType`. |
| `visual.ts` | `cusum` label; params into `ChartContext`; `allowRawOverlay` (ewma/ma) flag into the model. |
| `tooltip.ts` | CUSUM tooltip items (C⁺, C⁻, H). |
| `capabilities.json` | `cusumK`, `cusumH` under `chartParameters`. |
| `test/spc.test.ts` | C⁺/C⁻ recursion fixture (incl. a step + a gap); ±H; signal on the right arm; individuals/EWMA/MA unchanged. |
| `pbiviz.json` | Version → **2.3.0.0**. |
| `docs/` | ROADMAP (mark CUSUM done), rules.md (CUSUM = its own H signal, no WE rules), edge-cases.md (new rows). |

## Ordered task sequence (each step compiles + suite green)

1. **Interface:** `cusum` type, `ChartContext` params, `LimitModel.secondarySeries`, `secondaryBeyond`.
   *Verify:* every other chart unchanged (additive, all absent).
2. **`cusumStrategy`** (+ shared `cusumStats`) + Chart-Parameters k/h + validate. *Verify:* C⁺/C⁻
   fixture matches the recursion; ±H = h·σ **with `lcl = −H` not floored**; gap holds the sums.
3. **Renderer branch:** secondary line/points, two-arm signal markers, Y-domain (incl. secondary,
   excl. baseValue), overlay gating on `allowRawOverlay`. *Verify:* in Desktop — two arms about 0, ±H
   lines, a stepped-up series crosses H and flags the upper arm only; *Floor LCL* toggle doesn't move
   the −H line; no raw dots and the axis stays centered on 0.
4. **Tooltip** (C⁺/C⁻/H) + **docs + version + package.**

## Testing

- **C⁺/C⁻ recursion:** a flat-then-step series → assert both sums accumulate from 0, C⁺ crosses H
  after the step, C⁻ stays 0; a downward step mirrors it.
- **±H:** assert `perPoint.ucl = h·σ`, `lcl = −h·σ`, `center = 0`.
- **Signal arm:** `secondaryBeyond` flags `upper` (not `lower`) on the upward step, and vice-versa.
- **Gap:** a blank reading holds both sums (no NaN, no spurious signal across it).
- **Regression:** individuals/EWMA/MA/attribute/subgroup unchanged — the additive interface and the
  `secondarySeries != null` render branch must not touch single-series charts.

## Decisions

1. **No auto-reset after a signal (confirmed).** The chart is a passive display — it can't observe the
   investigate-and-fix workflow that a reset models, and resetting would make a still-shifted process
   look recovered. A sustained shift therefore shows a persistent run of signals (a faithful "still
   out of control"), and the accumulator drains naturally once readings return toward μ₀. Reset-to-0
   and the FIR headstart (C₀ = H/2) are documented future options, not v1.
2. **μ₀ = x̄, single-phase.** No phases on time-weighted charts; bound-Target-as-μ₀ deferred — same
   as the EWMA/MA decision. **Caveat specific to CUSUM:** a sustained shift present in the data pulls
   x̄ toward it, biasing μ₀ and blunting the small-shift detection CUSUM exists for (the individuals
   chart tolerates a biased center far better). So a clean-baseline / bound-Target μ₀ is a *more*
   valuable future option here than for the other families — flagged, not built.
3. **Tabular, not V-mask** (see above).
4. **Signal as a bespoke two-arm check, not a WE rule** (`applicableRules` empty). Honest semantics;
   the rule-reference panel simply lists nothing for CUSUM in v1 (a synthetic "decision interval"
   entry is optional polish).
5. **C⁻ arm is display-only in v1** *(except signal markers).** Selection + selection-dimming stay on
   the C⁺ points (which carry the point identity); the secondary line and non-signal C⁻ points render
   but aren't interactive. The **signal markers on both arms are tooltip-wired** (they overlay the C⁺
   points and would otherwise block the hover; lower-arm signals gain a tooltip too). Full selection
   on the C⁻ arm is deferred polish.

## Out of scope (v1)

- V-mask; ARL-based k/h guidance; auto-reset / FIR headstart; bound-Target μ₀; phases on CUSUM;
  a rule-reference entry for the H signal; raw readings on the cumulative scale (suppressed).

## Risks

- **Two-arm marker + Y-domain** are the only structural renderer additions; both are gated on
  `secondarySeries != null`, so single-series charts are provably untouched.
- **LCL flooring trap.** Reusing `limitsFrom` with `ctx.opts.floorLcl` (the family idiom, default
  *on*) floors the −H line to 0 and breaks the lower arm. CUSUM must build ±H with flooring off —
  covered by the ±H test (`lcl = −h·σ`).
- **`baseValue` now set by CUSUM** means the overlay gating must cover **both** consumers — the dot
  draw and the Y-domain `baseValue` terms (both keyed on `showRaw`, not chart type) — or CUSUM draws
  raw dots and the ±H y-axis stretches to ≈ μ₀. Must land in the same PR.
- **Recursion + gap** is the same subtlety as EWMA/MA; covered by a gap fixture on the regression gate.
