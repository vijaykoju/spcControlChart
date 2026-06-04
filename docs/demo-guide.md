# Demo `.pbix` — chart list & field bindings

Build the AppSource demo from **[`test-data/demo-sample.csv`](test-data/demo-sample.csv)** — one wide
table, 30 daily rows on a shared `Date` axis. Every column reflects the **same story**: a process
that's in control through 2026-03-21, then **shifts up on 2026-03-23** (location moves; dispersion
stays stable). There's also a single pre-shift **outlier on 2026-03-14** (Reading = 109) for a clean
beyond-limits violation.

Import the CSV (`Date` as a date column), then drop these visuals onto a report page. For each, set
**Format → Chart → Chart type** and bind the listed fields.

| # | Chart type | Axis | Measurement | Sample size | Subgroup range/std dev | What it shows |
|---|-----------|------|-------------|-------------|------------------------|----------------|
| 1 | **Individuals (X-mR)** | Date | Reading | — | — | Phase/**changepoint split** at 03-23 + phase-change line; **MR companion panel**; a **rule-1 violation** at the 03-14 outlier; run rules across the shift. *(Hero shot.)* |
| 2 | **EWMA** | Date | Reading | — | — | Smoothed line crossing its widening limits as the small shift accumulates; faint **raw-reading overlay** behind it. |
| 3 | **CUSUM** | Date | Reading | — | — | Two arms about zero; **C⁺ crosses +H** after 03-23; lower arm quiet. *(k=0.5, h=5 defaults.)* |
| 4 | **p (proportion)** | Date | Defectives | InspectedUnits | — | Proportion defective rising from ~3% to ~7.5%; **stepped per-point limits** (varying n); points beyond UCL post-shift. |
| 5 | **c (defect count)** | Date | Defects | — | — | Constant limits; defect counts climb past UCL after the shift. |
| 6 | **X̄-R (mean & range)** | Date | SubgroupMean | SubgroupSize | SubgroupRange | **X̄ chart flags the mean shift**; the **R companion panel stays in control** (dispersion unchanged) — the classic "location moved, spread didn't" picture. |

**Optional extras** (same table, more breadth): **X̄-s** (as #6 but bind *SubgroupStdDev* to Subgroup
range/std dev), **Moving average** (Reading, window 5), **u** (Defects + InspectedUnits).

## Maps to the screenshot shot-list (see [`appsource-submission.md`](appsource-submission.md))
1. **Hero** → chart #1 with the 03-14 violation flagged + a tooltip showing the rule reason.
2. **Rule reference** → chart #1 with **Rule Reference → Show** on.
3. **Breadth** → chart #4 (p) or chart #6 (X̄-R + companion).
4. **Advanced** → chart #3 (CUSUM) or #2 (EWMA with raw overlay).
5. **Configurable / no-DAX** → the Format pane on any visual, showing the Chart-type selector + Chart Parameters.

## Notes
- **Changepoint detection is on by default**, so chart #1 should auto-split into two phases at the
  shift. To instead show a single-phase chart with a run-rule violation across the shift, turn off
  *Phase Detection → Enable detection*.
- The **subgroup rows are pre-aggregated** (one row per subgroup: mean + range/std-dev + size). The
  `SubgroupSize` is a constant 5, as the X̄-R/X̄-s charts require.
- For a *pristine* CUSUM screenshot (in-control baseline, single clean signal), the dedicated
  [`test-data/cusum-clean-sample.csv`](test-data/cusum-clean-sample.csv) is less noisy than the shared
  `Reading` column.
