# Phase 1 design — attribute charts (p, np, c, u)

**Status:** design (not yet implemented). Part of the [roadmap](ROADMAP.md); builds on the seam from
[phase0-design.md](phase0-design.md).

## Objective

Add the four attribute control charts as `ChartStrategy` implementations: **p** (proportion
defective), **np** (number defective), **c** (count of defects), **u** (defects per unit). This is
the first real test of the Phase 0 seam by a *second* family — and the first chart with **varying
per-point limits** (p, u), which exercises the per-point-limit generalization end to end.

**Definition of done:** the four types are selectable in the Chart card; each renders correct limits
against textbook fixtures; individuals is **unchanged**; the suite stays green; package builds.

## Decisions to make first

1. **Rule set for attribute charts.** Recommend **{1 Beyond, 4 Run}** as the default — these don't
   depend on distribution symmetry and are unambiguously valid. **Zone A/B (2, 3) are opt-in with a
   caveat:** their ±1σ/±2σ probability interpretation is derived from the *normal* distribution,
   which the binomial (p/np) and Poisson (c/u) distributions violate — skewed, especially at small
   `n·p̄` or low `c̄` — so the zones don't carry their nominal false-alarm rates and can over/under-
   signal. If exposed, gate them behind documentation (and consider a minimum-`n·p̄` guard). Exclude
   5 (Trend), 6 (Mixture), 7 (Stratification), 8 (Over-Control): direction/zone-pattern rules that
   assume a roughly-normal spread and are non-standard for attribute data.
2. **LCL floor.** Attribute statistics are non-negative, so attribute strategies should **floor LCL
   at 0 regardless of the `floorLcl` toggle** (that toggle is meaningful only for individuals with
   possibly-negative measures). *(Optional: also cap a p-chart UCL at 1.)*
3. **Phases.** Phase 1 attribute charts are **single-phase** — changepoint detection is
   individuals-tuned. Staged attribute limits can come later.
4. **np / c assume constant n / area of opportunity.** np needs a *single* `n` for `n·p̄` and σ —
   use the (assumed-constant) sample size; if the `sampleSize` column varies under np/c, emit a
   console warning and steer toward p/u rather than silently averaging. Don't leave the chosen `n`
   to implementation guesswork.
5. **Invalid sample size is a gap.** A subgroup with `nᵢ ≤ 0` or blank `n` has no defined
   proportion/σ — treat it as a **gap slot** (`value = null`), exactly like a blank measure, so it
   never produces `Infinity`/`NaN` limits that would corrupt the shared Y-scale.

## Data input model

Reuse the existing **Measurement** role as the **count** (defectives for p/np, defects for c/u) —
so existing bindings keep working — and add one new role:

- **Sample size** (`sampleSize`, Measure) — the subgroup size `nᵢ` (p/np) or units / area of
  opportunity (u). **Required for p, np, u; ignored for c and individuals.**

The visual validates the required role for the selected type and shows an empty state when missing
(e.g. *"p-chart needs a Sample size field"*). The user supplies **counts + n**; the visual computes
the plotted statistic and the limits (the SPC-tool experience) — rather than asking the user to
pre-compute proportions in DAX. (Considered and rejected: binding a pre-computed proportion — it
still needs `n` for σ and pushes math onto the user.)

## Interface extensions (small, additive)

Phase 0's `ChartStrategy` computes *limits* but assumes the plotted value is `DataPoint.value`. For
p/u the plotted value is `countᵢ / nᵢ`, so the strategy must also own the **plotted-value
transform**. Two additive changes:

```ts
// src/spc/types.ts — carry the sample size + raw count through to the strategy
interface DataPoint {
    /* …existing… */
    sampleSize?: number | null;   // nᵢ (p/np/u); null/≤0 → gap
    count?: number | null;        // raw defect/defective count, preserved so the center is exact
}

// src/spc/chartType.ts
interface ChartStrategy {
    id; applicableRules; zonesMeaningful;
    requiredRoles?: ("sampleSize")[];            // for empty-state validation
    prepare(raw: DataPoint[]): DataPoint[];      // NEW — derive the plotted series (default: identity)
    computeLimits(points, ctx): LimitModel;
}

interface LimitModel {
    /* …existing… */
    varyingLimits: boolean;   // NEW — true for p/u; drives stepped vs per-segment rendering
}
```

- **`prepare`** returns points whose `.value` is the *plotted statistic*: `countᵢ/nᵢ` for p/u,
  `countᵢ` (unchanged) for np/c, identity for individuals. It must **preserve every other field**
  (`categoryIndex`, `identity`, `label`, `target`, `tooltips`) — dropping them silently breaks
  cross-filtering, axis labels, and the target overlay; only `value`/`movingRange`/`direction` may
  change. It sets `count` = the raw count and nulls `movingRange`/`direction` for attribute charts
  (no companion; rules 5/8 excluded, so direction is unused). An `nᵢ ≤ 0`/null point becomes a gap
  (`value = null`).
- **The center is computed from `count` + `sampleSize`, never reconstructed.** `p̄ = Σcountᵢ/Σnᵢ`
  over real points — *not* `Σ(valueᵢ·nᵢ)`, which would reintroduce float drift (`c/n·n ≠ c`).
- **`varyingLimits`** lets the renderer keep individuals/np/c on the proven per-segment path and use
  a stepped path only for p/u (see Rendering).

That a very different chart family needs only two small *additive* hooks (`prepare`, `varyingLimits`)
— no reshaping of `ChartStrategy`/`LimitModel` — is the first real evidence the Phase 0 seam was
about right. Keep watching for that on Phase 2 (X̄-R), which stresses the companion model.

`prepare` runs in `visual.ts` between `buildDataPoints` and `computeLimits`:

```ts
const raw = buildDataPoints(extractSeries(dataView));   // value = count, sampleSize = n
const strategy = STRATEGIES[toChartType(...)];
const points = strategy.prepare(raw);                    // value = plotted statistic
const limits = strategy.computeLimits(points, { opts });
```

## The math (each strategy builds `perPoint` via `limitsFrom`)

`statistics.ts`'s `limitsFrom(center, mrBar, sigma, mult, floorLcl)` already turns a center + σ into
`{ucl, lcl, zoneA/B}` scaled by the sigma multiplier. **Export it** and reuse it per point with
`mrBar = 0` (unused) and the attribute σ. `p̄`/`ū` are inspection-weighted: `Σcountᵢ / Σnᵢ`.

| Chart | Plotted (`prepare`) | Center | σ | Limits vary? |
|---|---|---|---|---|
| **p** | `cᵢ/nᵢ` | `p̄ = Σcᵢ/Σnᵢ` | `√(p̄(1−p̄)/nᵢ)` | **yes** (nᵢ) |
| **np** | `cᵢ` | `n·p̄` | `√(np̄(1−p̄))` | no |
| **c** | `cᵢ` | `c̄ = mean(cᵢ)` | `√c̄` | no |
| **u** | `cᵢ/nᵢ` | `ū = Σcᵢ/Σnᵢ` | `√(ū/nᵢ)` | **yes** (nᵢ) |

Each strategy: `singlePhase: true`, `companion: null`, `segments: [one segment over all points]`,
`perPoint[i] = limitsFrom(center, 0, σᵢ, mult, /*floorLcl*/ true)`, `varyingLimits` per the table.
`p̄`/`ū` use the raw `count`/`sampleSize` over **real points only** (gaps excluded). np takes the
single (assumed-constant) `n`. A point with `nᵢ ≤ 0`/null is a gap (skipped, `value = null`).
Degenerate σ = 0 (e.g. zero defects everywhere) collapses limits onto the center — the rules'
`noVariation` guard already suppresses spurious flags. Attribute strategies **floor LCL at 0
regardless of the `floorLcl` toggle** (per decision 2); p-charts may optionally cap UCL at 1.

## Rule applicability

`applicableRules`: individuals `{1..8}` (unchanged); **p/np/c/u default `{1,4}`** — beyond-limits +
run — with Zone A/B (`{2,3}`) opt-in under the normal-approximation caveat (per decision 1). The
Phase 0 `applicableEnabledRules` intersection already enforces this — and the run rule (4) compares
each point to the constant center `p̄`/`c̄`/`ū` via the accessor, while the (opt-in) zone rules
consume the per-point varying-σ zones, both working with no rule-engine change. The format pane can
later hide the inapplicable rule toggles (polish; not required for Phase 1).

## Rendering — stepped limits/zones for `varyingLimits`

Today limits/zones render per **segment** as horizontal lines + filled rects (`drawLimitLines`,
`drawZones` over `segPixels`). For p/u the limits change every point, so:

- **`varyingLimits === false`** (individuals, np, c) → **current per-segment path, unchanged.** np/c
  are single-segment, so they render like individuals minus the MR panel — low risk, reuses proven
  code.
- **`varyingLimits === true`** (p, u) → new stepped path: draw center/UCL/LCL as `d3.line` and zones
  as `d3.area` through the `perPoint[i]` values, **with each point's limit centered on its marker** —
  the step boundaries fall at the inter-point midpoints (the same midpoint math `segPixels` already
  uses for phase boundaries), *not* `curveStepAfter`/`Before`, which would shift each limit half an
  interval off its point.

This is the **largest new surface and the main risk.** Build it strictly behind the flag so the
constant-limit charts never touch it. The companion (MR) panel is absent for all attribute charts
(`companion: null`) — Phase 0 already guards `mrEnabled && limits.companion`, so the full height goes
to the main chart automatically.

Tooltip: the built-in rows (Center/UCL/LCL) come from `perPoint` already. Consider adding **Count**
and **Sample size** rows for attribute charts so the raw inputs are visible alongside the plotted
proportion (nice-to-have).

## Settings / capabilities

- `CHART_TYPE_ITEMS` (settings.ts): add `p`, `np`, `c`, `u` with display names ("p (proportion
  defective)", …). `toChartType` (settingsMap.ts): extend `CHART_TYPES` to include them.
- `capabilities.json`: add the **`sampleSize`** data role (`{ "name": "sampleSize", "kind":
  "Measure" }`) and bind it in `dataViewMappings.values.select`.
- `extractData.ts`: read the `sampleSize` column by role and attach it to each `SeriesPoint`;
  `buildDataPoints` carries it onto `DataPoint.sampleSize`.
- Empty-state messages in `visual.ts` extended for the missing-`sampleSize` case.
- The **MR Chart** and **Phase Detection** cards are no-ops for attribute charts (no companion, no
  changepoint). Hiding them per chart type is polish — optional for Phase 1.

## File-by-file

| File | Change |
|---|---|
| `capabilities.json` | New `sampleSize` Measure role + values binding. |
| `extractData.ts` | Read `sampleSize` by role → `SeriesPoint.sampleSize`; carry the raw `count`. |
| `spc/types.ts` | `DataPoint.sampleSize?` and `DataPoint.count?` (`number \| null`). |
| `spc/statistics.ts` | `buildDataPoints` carries `sampleSize`; **export `limitsFrom`**. |
| `spc/chartType.ts` | Add `prepare` + `requiredRoles` to `ChartStrategy`; `varyingLimits` to `LimitModel`. |
| `spc/strategies/individuals.ts` | `prepare = identity`; set `varyingLimits: false`. |
| `spc/strategies/{p,np,c,u}.ts` *(new)* | The four attribute strategies. |
| `spc/strategies/index.ts` | Register the four. |
| `rendering/chart.ts` | Stepped limit/zone path behind `varyingLimits`; (optional) Count/n tooltip rows. |
| `settings.ts` / `settingsMap.ts` | Chart-type items + `toChartType`. |
| `visual.ts` | `strategy.prepare`; required-role validation + empty states. |
| `test/spc.test.ts` | Per-strategy limit fixtures; `prepare`; role validation; extended `toChartType`. |
| `pbiviz.json` | **Version → 2.0.0** (second+ chart types ship). |

## Ordered task sequence (each step compiles + suite green)

1. **Data plumbing:** `sampleSize` role (capabilities + extractData + `DataPoint` + buildDataPoints).
   *Verify:* existing tests pass; a fixture extracts `sampleSize`.
2. **Interface:** add `prepare` (default identity) + `varyingLimits` (default false); update the
   individuals strategy. *Verify:* individuals output unchanged (suite green).
3. **`limitsFrom` export** + the four strategies, registered. *Verify:* per-chart fixtures hit
   textbook `center`/`σ`/`ucl`/`lcl`.
4. **Renderer:** stepped limits + zones behind `varyingLimits`. *Verify:* individuals/np/c
   unchanged; p/u render stepped (manual).
5. **Settings + validation:** chart-type items, `toChartType`, required-role empty states.
   *Verify:* selecting p with no sample size shows the prompt; with it, renders.
6. **Docs + version + package.** *Verify:* suite green; `npm run package` clean at 2.0.0.

## Testing

The attribute formulas are exactly verifiable, so each strategy gets a known-answer fixture:
- **p:** counts `[…]`, n `[…]` → assert `p̄`, and per-point `ucl/lcl` for two different `n` (proves
  varying limits).
- **np:** constant n → assert center `np̄`, constant limits.
- **c:** counts → assert `c̄`, limits `c̄ ± 3√c̄`.
- **u:** counts + varying n → assert `ū` and two per-point limits.
- **prepare:** p/u transform `value` to `c/n` while preserving `count`/`categoryIndex`/etc.; np/c
  leave `value`; individuals identity.
- **edge — invalid n:** a point with `nᵢ = 0`/null is a gap (`value === null`), no `NaN`/`Infinity`
  in `perPoint` or the Y-domain.
- **edge — low `c̄`/`p̄`:** a near-zero-defect Poisson/binomial fixture stays finite (σ→0 path).
- **applicability:** `applicableEnabledRules` yields `{1,4}` for attribute types (2/3 only when opted in).
- Existing individuals fixtures must stay byte-identical (regression gate).

## Backward compatibility

- `chartType` defaults to individuals; `sampleSize` is additive/optional → existing reports and
  field bindings are unaffected.
- `varyingLimits` defaults false and the stepped path is flag-gated → individuals/np/c rendering is
  untouched.

## Out of scope (Phase 1)

- Subgroup charts (X̄-R/s) and the control-chart constants table — Phase 2.
- Raw-row subgrouping — Phase 2 concern; attribute charts take aggregated count + n.
- Staged/phased attribute limits; hiding inapplicable format cards (polish).
- p-chart UCL cap at 1 (optional refinement, flagged above).

## Risks

- **Stepped limits/zones rendering** is the real work and the main risk. Mitigation: flag-gate it so
  only p/u use it; np/c ride the proven per-segment path; verify against a known varying-n fixture.
- **`prepare` changes `DataPoint.value` semantics** (count → plotted statistic). Keep the transform
  in one place (the strategy) and recover counts as `value·sampleSize` where the center needs them.
- **np/c misuse with varying n** produces wrong limits silently — document, and consider a console
  warning when `sampleSize` varies under np/c.
