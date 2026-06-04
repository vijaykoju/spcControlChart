# Phase 3 design — time-weighted charts (EWMA, moving average, CUSUM)

**Status:** design (not yet implemented). Part of the [roadmap](ROADMAP.md); builds on the seam from
[phase0-design.md](phase0-design.md) and the strategy pattern from Phases 1–2.

## Objective

Add the time-weighted control charts that detect **small, sustained shifts** the individuals chart
misses: **EWMA** (exponentially-weighted moving average), **Moving Average** (MA), and **CUSUM**
(cumulative sum). All operate on individual readings (one value per point) and reuse the X-mR sigma
estimate; none use the Western Electric run/zone rules (their points are autocorrelated by
construction). Individuals / attribute / subgroup charts stay unchanged.

**Definition of done:** EWMA and MA selectable, limits match textbook fixtures, individuals
unchanged, suite green. CUSUM either lands behind a dual-series rendering addition or is split to a
follow-up PR (see Decision 1).

## The new wrinkle: the plotted statistic is *derived from the series*

Every chart so far computes the plotted value from a single row (p = count/n) or plots the value
as-is (subgroup mean). EWMA/MA/CUSUM compute the plotted value from the **ordered series and a
parameter** (λ, window w, or k/h). Two consequences for the seam:

1. **`prepare` needs the chart's parameters.** Today `prepare(raw)` has no access to settings. EWMA
   needs λ, MA needs w. → extend to **`prepare(raw, ctx)`** (additive; existing strategies that
   ignore the second arg still satisfy the type).
2. **The limits need the *raw* individuals after `prepare` has overwritten `value`.** The center
   (x̄) and σ (= MR̄/d₂) come from the raw readings, but `prepare` replaces `value` with the smoothed
   statistic. → `prepare` **preserves the raw reading in `DataPoint.baseValue`** and leaves
   `movingRange` intact (it was computed from the raw values in `buildDataPoints`), so `computeLimits`
   recovers x̄ from `baseValue` and MR̄ from `movingRange`. (Same "preserve the source" pattern as the
   attribute `count` field.) `prepare` must **preserve every other field** (`index`, `identity`,
   `categoryIndex`, `target`, `tooltips`) — only `value`/`baseValue`/`movingRange`/`direction` change
   — or it breaks the rule-engine precondition and cross-filtering (the Phase 1 trap).

> **Note (design debt):** this is the *third* "preserve the source" field (`count` → `baseValue`),
> and x̄ now gets computed in both `prepare` (for `z₀`) and `computeLimits` (center/σ). The
> `prepare`/`computeLimits` split is straining for derived-series charts. Before a fourth family
> piles on, consider collapsing them into one `build(raw, ctx) → { points, limits }`, or at least a
> shared base-stats helper. Out of scope for Phase 3, but flagged.

## Decisions to make first

1. **CUSUM needs a second on-chart series; EWMA/MA don't.** EWMA and MA are a single plotted series
   with per-point limits — they fit the seam directly. Tabular CUSUM plots **two** cumulative sums
   (C⁺ above, C⁻ below) against a ±H decision interval, which the single-`value` model can't express.
   **Recommendation:** ship **EWMA + MA first**, then add CUSUM behind a small rendering extension
   (`LimitModel.secondarySeries`) — likely a separate PR within Phase 3. Don't block EWMA/MA on it.
2. **Parameters live in the format pane** (no data-role equivalent): EWMA **λ** (default 0.2), MA
   **window** (default 5, min 2), CUSUM **k** (default 0.5) and **h** (default 5). A new "Chart
   parameters" card; each control is a no-op for chart types that don't use it (consistent with the
   existing no-op cards).
3. **Center = the process mean x̄** (single-phase, v1). Using a bound **Target** as the reference μ₀
   is a sensible future option but conflates the target overlay with the center — deferred.
4. **Rules: beyond-limit only ({1}).** EWMA/MA/CUSUM points are autocorrelated, so WE run/zone rules
   are invalid; zones are not drawn (`zonesMeaningful: false`). No companion panel.

## The math

σ = MR̄ / d₂ from the raw individuals (d₂ = 1.128, the existing `D2`); x̄ = mean of `baseValue`;
`L` = the sigma multiplier (default 3).

**EWMA** (λ ∈ (0,1]):
- `z₀ = x̄`, `zᵢ = λ·xᵢ + (1−λ)·zᵢ₋₁` (plotted).
- `σ_zᵢ = σ · √( (λ/(2−λ)) · (1 − (1−λ)^{2i}) )` → limits **start narrow and widen to a steady
  state**, so they're per-point (`varyingLimits: true`).
- `UCLᵢ/LCLᵢ = x̄ ± L·σ_zᵢ`.

**Moving Average** (window w):
- `MAᵢ = mean(x_{i−w+1..i})`; for `i < w`, the mean of the `i` available points (plotted).
- `UCLᵢ/LCLᵢ = x̄ ± L·σ/√(min(i, w))` → wider for the first `w−1` points, then constant
  (`varyingLimits: true`).

**CUSUM** (tabular; k, h):
- `K = k·σ`, `H = h·σ`, `μ₀ = x̄`.
- `C⁺ᵢ = max(0, xᵢ − (μ₀+K) + C⁺ᵢ₋₁)`, `C⁻ᵢ = max(0, (μ₀−K) − xᵢ + C⁻ᵢ₋₁)`.
- Plot C⁺ (up) and **−C⁻** (down) about 0, with flat decision lines at **±H**; signal when
  `C⁺ᵢ > H` or `C⁻ᵢ > H`. (This is the dual-series case from Decision 1.)

Reuse `limitsFrom(x̄, 0, σ_eq, mult, floorLcl)` per point where a symmetric ±limit applies (EWMA:
`σ_eq = σ_zᵢ`; MA: `σ_eq = σ/√(min(i,w))`), with `floorLcl` honoring the toggle (individual readings
can be negative). Zones come out of `limitsFrom` but aren't drawn (`zonesMeaningful: false`).

**Gaps (blank readings) must not poison the recursion.** A null `xᵢ` would NaN-propagate through
`zᵢ`, the MA window, and the CUSUM sums, corrupting the Y-scale. Defined behavior:
- **EWMA:** carry forward — `zᵢ = zᵢ₋₁` at a gap; `σ_zᵢ` uses the count of *real* points so far.
- **MA:** average the non-null values within the window (skip gaps); a window with no real values is a gap.
- **CUSUM:** hold `C⁺`/`C⁻` across the gap.
- In all three the gap point itself plots nothing (`value = null`), exactly like elsewhere.

## Interface extensions (additive)

- **`ChartStrategy.prepare(raw, ctx)`** — `prepare` gains the context (for λ / w / k,h). Existing
  strategies are unaffected (they ignore the extra arg).
- **`DataPoint.baseValue?: number | null`** — the raw reading preserved by `prepare` (mirrors
  `count`/`spread`).
- **`ChartContext`** gains optional `ewmaLambda`, `maWindow`, `cusumK`, `cusumH`.
- EWMA/MA/CUSUM strategies set `varyingLimits: true`, `zonesMeaningful: false`, `companion: null`,
  `applicableRules: {1}`, and a `valueLabel` ("EWMA", "Moving average", "CUSUM").
- **`LimitModel.smoothLimits?: boolean`** — when true (EWMA/MA), the varying-limit renderer draws the
  limit lines with `d3.curveLinear` instead of `d3.curveStep`. The p/u limits stay stepped (discrete
  per-`n` levels); EWMA/MA limits widen *smoothly*, so a staircase would misrepresent the envelope.
- **CUSUM only:** `LimitModel.secondarySeries?: (number | null)[]` (the C⁻ line) — null/absent for
  every other chart, so the renderer change is isolated.

## Rendering

- **EWMA / MA** reuse the **Phase 1 varying-limit path** (`varyingLimits: true`) but with
  **`smoothLimits: true`** so the limit lines use `d3.curveLinear` (a connected, smoothly-widening
  envelope) rather than the `curveStep` staircase used for p/u. The smoothed value line is already
  linear. With `zonesMeaningful: false`, `drawSteppedZones` is skipped (lines only). No companion
  (`companion: null`) → full height to the main chart. Overlaying the raw points faintly is a
  deferred nice-to-have. → `drawSteppedLimits` gains a curve parameter driven by `smoothLimits`.
- **CUSUM** needs the new bit: plot `value` (C⁺) **and** `secondarySeries` (−C⁻) as two lines about a
  centerline of 0, with flat ±H limit lines (constant → the per-segment path). **Violations are
  computed by CUSUM over *both* series** (C⁺ > H or C⁻ > H) — *not* via rule 1, which only inspects
  `value` and would miss every downward shift. Use a dedicated two-series check (à la
  `companionViolations`). The secondary-line draw + this violation check are the only genuinely new
  code in the CUSUM follow-up.

## Settings / capabilities

- `CHART_TYPE_ITEMS` (settings.ts) + `CHART_TYPES` (settingsMap.ts): add `ewma`, `ma`, `cusum`.
- New **Chart parameters** card: `ewmaLambda` (NumUpDown, 0–1), `maWindow` (NumUpDown, min 2),
  `cusumK`, `cusumH`; mapped into `ChartContext` in `visual.ts`. No new data roles (EWMA/MA/CUSUM use
  the existing Measurement = individual reading).
- `visual.ts`: pass the params into the context; `prepare(rawPoints, ctx)`.
- **Parameter validation via the Phase 2 `validate` hook** (now `validate(points, ctx)`): EWMA
  requires λ ∈ (0, 1]; MA requires an integer w ≥ 2, clamped to ≤ n; bad values show an empty-state
  message (mirroring the subgroup-size check) rather than rendering a degenerate chart (λ = 0 →
  zero-width limits; w = 1 → MA = the raw series).

## File-by-file

| File | Change |
|---|---|
| `spc/types.ts` | `DataPoint.baseValue?: number \| null`. |
| `spc/chartType.ts` | `ChartType` += `ewma`/`ma`/`cusum`; `prepare(raw, ctx)`; `validate(points, ctx)`; `ChartContext` params; `LimitModel.smoothLimits?` + `secondarySeries?` (CUSUM). |
| `rendering/chart.ts` | Skip zones when `!zonesMeaningful`; `drawSteppedLimits` curve from `smoothLimits`; (CUSUM) draw `secondarySeries` + ±H. |
| `spc/strategies/timeWeighted.ts` *(new)* | `ewmaStrategy`, `maStrategy` (+ `cusumStrategy` in the follow-up), each with a `validate`. |
| `spc/strategies/index.ts` | Register the new strategies. |
| `settings.ts` / `settingsMap.ts` | Chart-type items + a Chart-parameters card + `toChartType`. |
| `visual.ts` | Read params into `ChartContext`; `prepare(rawPoints, ctx)`. |
| `test/spc.test.ts` | EWMA/MA limit + value fixtures (incl. a gap), validation; CUSUM C⁺/C⁻; individuals unchanged. |
| `pbiviz.json` | Version → **2.2.0** when EWMA/MA ship; **2.3.0** when CUSUM lands (if a separate PR). |

## Ordered task sequence (each step compiles + suite green)

1. **Interface:** `prepare(raw, ctx)`, `DataPoint.baseValue`, `ChartContext` params, `zonesMeaningful`
   honored in the renderer. *Verify:* individuals/p/np/c/u/X̄ unchanged.
2. **EWMA strategy** + Chart-parameters card (λ). *Verify:* fixture matches the `z`/`σ_z` formulas.
3. **MA strategy** (window w). *Verify:* fixture matches MA + widening-then-constant limits.
4. **(Follow-up) CUSUM:** `LimitModel.secondarySeries` + the dual-series/±H renderer + the strategy.
   *Verify:* C⁺/C⁻ fixture; the secondary line + H lines render.
5. **Docs + version + package.**

## Testing

- **EWMA:** a small series + λ → assert the `z` sequence and the widening `σ_zᵢ` limits at i = 1, 2,
  and a large i (steady-state `σ√(λ/(2−λ))`).
- **MA:** assert `MAᵢ` for `i < w` (partial) and `i ≥ w`, and the limit widening (`/√i` → `/√w`).
- **CUSUM:** a series with a step → assert `C⁺`/`C⁻` accumulate and cross `H`.
- **Beyond-limit signaling:** a clearly out-of-limit smoothed point flags rule 1; nothing else fires
  (rules intersected to {1}).
- **Regression:** individuals and the other families unchanged (the `prepare(ctx)` signature change
  and `zonesMeaningful` gating must not alter them).

## Backward compatibility

- `prepare` gaining a second arg is source-compatible (existing one-arg impls still type-check and
  behave identically).
- New chart types, `baseValue`, and the params are additive; `chartType` defaults to individuals.
- `zonesMeaningful` already exists (Phase 0) and is `true` for every current chart, so gating zone
  drawing on it is a no-op for them.

## Out of scope (Phase 3)

- Target/μ₀ from the bound Target role (use x̄); phases on time-weighted charts; overlaying raw
  points on the EWMA/MA line.
- V-mask CUSUM (tabular only); ARL-based parameter guidance.
- Hiding the Chart-parameters controls that don't apply to the selected type (polish).

## Risks

- **Gap handling in the recursions** is the subtle one — get it wrong and a single blank reading NaNs
  the chart. Covered by the gap rules above + a gap test fixture; keep it on the regression gate.
- **CUSUM's dual series + own violation check** is the only structural addition; keeping it behind
  `LimitModel.secondarySeries` (null everywhere else) isolates the renderer change. If it proves
  messy, ship EWMA/MA and treat CUSUM as its own phase.
- **Autocorrelation misuse:** users may expect the WE run rules; the rule set is correctly limited to
  {1}, and the rule-reference panel will reflect that — document why.
