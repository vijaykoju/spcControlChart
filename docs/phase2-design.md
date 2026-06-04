# Phase 2 design — subgroup charts (X̄-R, X̄-s)

**Status:** design (not yet implemented). Part of the [roadmap](ROADMAP.md); builds on the seam from
[phase0-design.md](phase0-design.md) and the strategy pattern from [phase1-design.md](phase1-design.md).

## Objective

Add the two subgroup control charts: **X̄-R** (subgroup mean + range) and **X̄-s** (subgroup mean +
standard deviation). This is the first family with a **non-trivial companion chart** — the R/s
dispersion panel has its *own* center and limits (`D₄R̄`, `D₃R̄` / `B₄s̄`, `B₃s̄`), so it's the real
test of the Phase 0 `CompanionModel` and the moment to finish migrating the companion panel off the
MR-specific shortcuts (the Phase 0 review's standing debt). Individuals and the attribute charts stay
unchanged.

**Definition of done:** X̄-R and X̄-s selectable; X̄ + companion limits *and zones* match textbook
fixtures; individuals/p/np/c/u **unchanged**; suite green; package builds.

## Decisions to make first

1. **Data input: pre-aggregated.** The user supplies one row per subgroup with the **mean** and the
   **range or std dev** already computed (DAX/M). The visual does *not* bucket raw observations — raw
   subgrouping stays out of scope (it needs a multi-row-per-subgroup dataView shape that's fiddly in
   Power BI; deferred until there's demand, and only after a spike).
2. **Subgroup size comes from the data, via the `sampleSize` role.** The constants (A₂, D₃, D₄, A₃,
   B₃, B₄) are looked up by subgroup size *m*. Reuse the Phase 1 **Sample size** role to carry *m*
   per subgroup row — so *m* stays **tied to the ranges it was computed from**, not a separate
   format-pane number that can silently drift out of sync. v1 **assumes constant m** (validated; a
   varying *m* uses the first and is treated as approximate — the unequal-subgroup R̄/s̄ pooling is the
   real future work, not the plumbing).
3. **Single-phase (v1).** Changepoint detection is individuals-tuned; subgroup charts render as one
   phase. Staged limits later.
4. **Rules.** The **X̄ chart uses all 8** rules — subgroup means are ~normal (CLT), the classic WE
   use case. The **R/s companion uses beyond-limit only**, now on **both** bounds (a range below LCL
   is a real signal, unlike MR where LCL = 0).

## Data input model

One row per subgroup. Reuse two existing roles plus one new role:

- **Measurement** = the subgroup **mean** (the plotted X̄ value).
- **Sample size** (`sampleSize`, existing) = the subgroup size **m** (used for the constants).
- **Subgroup range or std dev** (`spread`, Measure, **new**) = the per-subgroup dispersion. The chart
  type says whether it's a range (X̄-R) or std dev (X̄-s) — the role name is deliberately generic so
  users remember to rebind when switching type.

Both `spread` and `sampleSize` are **required** for X̄-R/X̄-s → distinct empty-state prompts when
missing. *m* must be a constant integer within the constants table (2–25); out-of-range or all-blank
*m* → empty state. (If *m* varies across rows, v1 uses the first real value and the result is
approximate — documented, like np's constant-*n* assumption.)

## Constants table (new pure module)

`src/spc/constants.ts` — a lookup of the X̄-R/X̄-s control-chart constants by subgroup size *m*
(2–25): **A₂, A₃, D₃, D₄, B₃, B₄**. Textbook values, e.g.:

| m | A₂ | D₃ | D₄ | A₃ | B₃ | B₄ |
|---|----|----|----|----|----|----|
| 2 | 1.880 | 0 | 3.267 | 2.659 | 0 | 3.267 |
| 5 | 0.577 | 0 | 2.114 | 1.427 | 0 | 2.089 |
| 7 | 0.419 | 0.076 | 1.924 | 1.182 | 0.118 | 1.882 |

Pure and exactly verifiable → unit-tested against the table (cite the source in the module). The
lookup reports invalid for *m* outside 2–25, which drives the empty state.

## The math

`x̄̄` = mean of subgroup means; `R̄` = mean of ranges; `s̄` = mean of std devs (over real subgroups);
*m* = the (constant) subgroup size read from `sampleSize`.

| Chart | Plotted (X̄) | X̄ center / limits | Companion | Companion center / UCL / LCL |
|---|---|---|---|---|
| **X̄-R** | subgroup mean | `x̄̄ ± A₂R̄` | Range | `R̄` / `D₄R̄` / `D₃R̄` |
| **X̄-s** | subgroup mean | `x̄̄ ± A₃s̄` | Std dev | `s̄` / `B₄s̄` / `B₃s̄` |

**Reuse `limitsFrom` for the X̄ chart** by converting the A-constant half-width to an equivalent
1-sigma: `A₂` (and `A₃`) are **3-sigma** constants, so `sigma_eq = A₂R̄ / 3` (the standard error of
the mean, `= R̄/(d₂√m)`), and `limitsFrom(x̄̄, 0, sigma_eq, mult, floorLcl)` reproduces `x̄̄ ± A₂R̄` at
`mult = 3` while making the **zones** the correct `±σ_X̄`, `±2σ_X̄`. **Use the literal `3` in the
conversion** (A₂ is intrinsically 3-sigma); the sigma-multiplier setting then scales as usual.

**The X̄ chart does NOT floor LCL** — subgroup means aren't non-negative and the X̄ convention is
two-sided limits, so pass `floorLcl = false` regardless of the global toggle (flooring at 0 would
clip a legitimate lower limit for a low-magnitude process). The companion LCL (`D₃R̄`/`B₃s̄`) is ≥ 0
by construction.

The companion is expressed in the **existing `CompanionModel`** (`kind: "r" | "s"`, `value` = the
spread series, `limits` = per-point `{center, ucl, lcl}`, `axisTitle`). No new limit structure — the
Phase 0 model already fits, which is the point.

## Interface extensions (small)

- **`DataPoint.spread?: number | null`** — the per-subgroup dispersion, carried by `extractData` /
  `buildDataPoints` (mirrors `sampleSize`/`count`).
- **`requiredRoles`** union extended to `("sampleSize" | "spread")[]`; X̄-R/X̄-s require both.
- `ChartStrategy.prepare` for subgroup charts is **identity** (the mean is plotted as-is); the
  companion is built in `computeLimits` from `spread` + the constants for *m* (read from the points'
  `sampleSize`). `varyingLimits: false` (constant *m*).
- No `ChartContext.subgroupSize` — *m* lives in the data, so no new context field or format-pane
  control is needed.
- A subgroup is a gap if its mean is null; if only `spread` is null, the X̄ point still plots and that
  companion point is skipped.

## Rendering — finish the companion panel (pays off the Phase 0 debt)

The Phase 0 review flagged that `drawMrChart` still plotted `point.movingRange` and drew only
center + UCL (LCL hardcoded to the 0 baseline). R/s charts force the completion — and every change is
designed to leave **individuals byte-identical** (for the MR companion, `companion.value === movingRange`,
`lcl === 0`, `axisTitle === "Moving Range"`):

- **Plot `companion.value[i]`** (the spread series), not `point.movingRange`.
- **Gate the panel on the companion**, not moving range: the `mrEnabled` check becomes
  `limits.companion?.value.some(v => v != null)` (today it keys on `points.some(p => p.movingRange != null)`,
  which only works for the MR case by coincidence and mis-gates a single-subgroup chart).
- **Draw the companion LCL line** from `seg.companion.lcl` **only when `lcl > 0`** — so MR (lcl = 0)
  is untouched, and R/s (m ≥ 7) get their lower limit.
- **Companion violations on both bounds:** `companionViolations` becomes `value > ucl || value < lcl`
  (MR unaffected since its values are ≥ 0 and lcl = 0).
- **Axis title from `companion.axisTitle`** ("Range" / "Std dev"), not the hardcoded "Moving Range".
- **Tooltip:** `buildMrTooltipItems` reads `companion.value[i]` + `companion.axisTitle` instead of
  `point.movingRange` + a hardcoded label (individuals still shows "Moving range").

The X̄ chart itself has constant limits (constant *m*) → it rides the **existing per-segment path**
(`drawLimitLines`/`drawZones`), exactly like individuals — no new main-chart rendering.

## Rules

`applicableRules`: X̄-R / X̄-s → **{1..8}** on the X̄ chart (full WE set; means are ~normal). The R/s
companion is beyond-limit only, handled by the (now two-sided) `companionViolations`. The rule engine
is unchanged — it reads the X̄ per-point limits (and zones) through the Phase 0 accessor.

## Settings / capabilities

- `CHART_TYPE_ITEMS` (settings.ts) + `CHART_TYPES` (settingsMap.ts): add `xbar-r`, `xbar-s`.
- **`capabilities.json`:** new `spread` Measure role + values binding + `{ "max": 1 }` condition.
  (`sampleSize` already exists from Phase 1 — reused, no new control.)
- `extractData.ts`: read the `spread` column by role → `SeriesPoint.spread`; `buildDataPoints` carries
  it.
- `visual.ts`: required-role validation (`spread` + `sampleSize`) and a valid-*m* check, with
  empty-state messages. No "Subgroup size" control to add.

## File-by-file

| File | Change |
|---|---|
| `capabilities.json` | `spread` Measure role + binding/condition. |
| `spc/constants.ts` *(new)* | A₂/A₃/D₃/D₄/B₃/B₄ table (m = 2–25) + lookup. |
| `extractData.ts` | Read `spread` by role → `SeriesPoint.spread`. |
| `spc/types.ts` | `DataPoint.spread?: number \| null`. |
| `spc/statistics.ts` | `buildDataPoints` carries `spread`. |
| `spc/chartType.ts` | `ChartType` += `xbar-r`/`xbar-s`; `requiredRoles` += `"spread"`; `companionViolations` two-sided. |
| `spc/strategies/subgroup.ts` *(new)* | `xbarRStrategy`, `xbarSStrategy` (m from `sampleSize`; `floorLcl = false`). |
| `spc/strategies/index.ts` | Register the two. |
| `rendering/chart.ts` | `mrEnabled` gate → companion; companion panel: plot `companion.value`, draw LCL (when > 0), axis title from model. |
| `tooltip.ts` | `buildMrTooltipItems` → `companion.value` + `axisTitle`. |
| `settings.ts` / `settingsMap.ts` | Chart-type items + `toChartType`. |
| `visual.ts` | `spread` + `sampleSize` + valid-*m* validation; empty states. |
| `test/spc.test.ts` | Constants table; X̄-R/X̄-s limit **and zone** fixtures; companion both-bound violation; individuals MR unchanged. |
| `pbiviz.json` | Version → 2.1.0. |

## Ordered task sequence (each step compiles + suite green)

1. **Constants module** + tests against the textbook table.
2. **Data plumbing:** `spread` role (capabilities + extractData + `DataPoint` + buildDataPoints).
   *Verify:* existing tests pass; a fixture extracts `spread`.
3. **Companion-panel completion** (`mrEnabled` → companion; `drawMrChart` plots `companion.value`, LCL
   when > 0, axis title; two-sided `companionViolations`; tooltip). *Verify:* **individuals MR
   byte-identical** (regression gate) — the MR fixtures and a manual render must be unchanged.
4. **Interface:** `DataPoint.spread`, `requiredRoles` += spread.
5. **`subgroup.ts` strategies** (m from `sampleSize`, `floorLcl = false`) + register. *Verify:*
   X̄-R/X̄-s fixtures hit textbook `x̄̄ ± A₂R̄`, the zones, and the R/s companion `D₄R̄`/`D₃R̄` etc.
6. **Settings + validation:** chart-type items, `spread`/`sampleSize`/valid-*m* empty states.
7. **Docs + version + package.** *Verify:* suite green; `npm run package` clean at 2.1.0.

## Testing

- **Constants:** spot-check several *m* against the table (e.g. m=5 → A₂=0.577, D₄=2.114, A₃=1.427,
  B₄=2.089).
- **X̄-R** fixture: known means + ranges (+ a constant *m* via `sampleSize`) → assert `x̄̄`,
  `x̄̄ ± A₂R̄`, the **X̄ zones** (`zoneAUpper`/`zoneBUpper` from `σ_X̄ = A₂R̄/3`), and R companion
  `D₄R̄`/`D₃R̄`.
- **X̄-s** fixture: known means + std devs → assert `x̄̄ ± A₃s̄`, zones, s companion `B₄s̄`/`B₃s̄`.
- **Zone-rule firing on X̄:** a 2-of-3 in Zone A flags (guards the conversion the limit tests miss).
- **Both-bound companion violation:** an R below `D₃R̄` (m ≥ 7) flags; an MR can never (lcl = 0).
- **Validation:** missing `spread`/`sampleSize`, and an out-of-range/non-constant *m*, hit the
  empty-state path.
- **Regression:** individuals MR fixtures + render unchanged after the companion-panel completion.

## Backward compatibility

- `chartType` defaults to individuals; `spread` is additive and `sampleSize` already exists → existing
  reports unaffected.
- The companion-panel changes are written so the MR case is identical (`companion.value === movingRange`,
  `lcl === 0` line suppressed, "Moving range" label, gate non-empty for ≥ 2 points) — individuals
  must not change.

## Out of scope (Phase 2)

- **Variable subgroup size** — the *plumbing* is now present (*m* per row via `sampleSize`), but the
  unequal-subgroup R̄/s̄ pooling and per-point varying limits are deferred; v1 validates *m* constant.
- **Raw-row subgrouping** (the visual computing mean/range/std dev from raw observations) — needs the
  multi-row dataView spike; deferred.
- Phases/changepoint on subgroup charts; hiding inapplicable format cards (polish).

## Risks

- **Companion-panel completion touches the shared MR renderer.** Mitigation: every change keeps the
  MR case identical by construction; gate on the individuals MR fixtures + a manual before/after.
- **Constants transcription errors** silently produce wrong limits. Mitigation: unit-test multiple
  *m* against the published table; cite the source in the module.
- **Wrong sigma conversion** (using the multiplier instead of the literal 3) would pass the limit
  tests but ship broken zones. Mitigation: the zone fixture + zone-rule test above.
- **Unequal subgroups** misused under the constant-*m* assumption produce subtly wrong limits — like
  np's constant-*n*; *m* now lives in the data so it can at least be detected/validated and warned.
