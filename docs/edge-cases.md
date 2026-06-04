# Edge-case checklist (manual, Power BI Desktop)

The pure SPC logic is covered by the automated suite (`npm test` — see `test/spc.test.ts`). This
checklist covers the **rendering** edges the unit tests can't exercise. Import the latest
`dist/*.pbiviz` and walk these in Power BI Desktop.

| # | Input / action | Expected |
|---|----------------|----------|
| 1 | **No fields bound** | Empty-state prompt ("Add an axis field and a measurement"); no error. |
| 2 | **Single data point** | One marker, flat control limits at the value, no rule violations; **MR panel auto-hidden** (no moving range). |
| 3 | **Two points** | Individuals line; MR panel shows a single MR point (no MR line segment). |
| 4 | **All-identical values** (constant measure) | σ=0 → UCL/LCL/center collapse to the value; **axis is sensibly scaled around the value** (not crushed into a sliver — the m14 pad fix); no spurious violations; zones flat. |
| 5 | **Small-magnitude flat data** (e.g. constant 2.5%) | Same as #4 — line centered, axis ~±10% of the value, not −97%…+102%. |
| 6 | **Negative values** | With *Floor LCL at zero* ON → LCL sits at 0, data can dip below it. Turn it OFF → LCL goes negative and tracks the data. |
| 7 | **Blanks/nulls mid-series** | **Requires "Show items with no data"** on the Axis field (Power BI drops blank-measure categories before the visual sees them — see note). With it on: the blank row is **kept as a labelled empty slot** — no marker, the individuals **and** MR lines **break** there, control limits run straight through, and no rule fires across it (the moving range is **not** bridged). An *all*-blank measure → empty-state prompt. |

> **Missing-data note:** By default Power BI omits a category whose measure is blank, so the gap
> never reaches the visual (you'll see the neighbours connected as if consecutive). To surface
> gaps, enable **"Show items with no data"** on the Axis field's dropdown in the Fields pane, or
> drive the Axis from a complete date-dimension table. The visual's gap handling only applies to
> rows Power BI actually delivers.
| 8 | **Large N (~1–5k points)** | Renders without hanging; X-axis thins ticks (≤ ~8 labels). At the **30000** cap, a truncation warning is logged to the console. |
| 9 | **Date hierarchy axis** (Year ▸ Quarter ▸ Month) | Composite tick labels; clicking a point cross-filters the **correct leaf** (composite identity). |
| 10 | **Text / categorical axis** | Points stay in delivered (observation) order — no date sort. |
| 11 | **Unsorted dates** | Points render in ascending date order; violation markers land on the right months. |
| 12 | **Tiny viewport** (shrink the visual) | MR panel auto-drops to a single full-height individuals chart (no inverted/garbage scale); below a usable size it still doesn't error. |
| 13 | **High contrast + MR on** | Both panels render in the foreground color, violations in the selected color, zone fills dropped, axis/labels legible. |
| 14 | **Report theme** | The data line (both charts) adopts the theme color; the Appearance ▸ Data line swatch matches; limits stay red, zones traffic-light. |
| 15 | **Selection across charts** | Clicking a point on either the individuals or MR chart dims the unselected markers + both lines on both panels; background click clears; right-click → context menu. |
| 16 | **Rule reference on** (Rule Reference ▸ Show) | A side panel (Right/Left per the Position dropdown) **reserves a strip beside the chart and never covers it**; the chart's plot shrinks to make room. Panel shows a "SPC rules" title + **all enabled rules** (name + fuller description), with a thin divider between it and the chart. Descriptions wrap to the strip width. |
| 17 | **Rule reference + short viewport** (rules exceed the height) | Panel **scrolls natively** (real scrollbar; wheel, drag, touch) so every rule stays reachable — nothing is silently clipped. Scrolling the panel does **not** clear the chart's selection. |
| 18 | **Rule reference + very narrow viewport** | If reserving the strip would leave the plot too narrow, the panel **auto-hides** (chart keeps a usable width) rather than crushing the chart. |
| 19 | **Rule reference + legend on the same side** | Legend and panel **stack** (panel outermost); neither overlaps the other or the plot. |
| 20 | **Rule reference + high contrast** | Panel text + divider use the HC foreground; legible (no filled background to fight the theme). |
| 21 | **Rule reference + all rules disabled** | Nothing renders (no enabled rules to list); no error. |
| 22 | **Export to PDF / PowerPoint with the panel on** | Panel renders in the exported output (it's an HTML `foreignObject` layer — confirm it isn't blank in the export). |
| 23 | **Chart type = p / u** (Chart ▸ Chart type) with **Count** + **Sample size** bound | Plots `count/n`; control limits **step per point** (varying n), centered under each marker; no MR panel; rules limited to Beyond + Run. |
| 24 | **Chart type = np / c** | Constant limits (single segment), no MR panel. np/c assume constant n / area. |
| 25 | **Attribute chart missing Sample size** (p/np/u) | Empty-state prompt ("p-chart needs a Sample size field"); no error, no wrong limits. |
| 26 | **Attribute chart with a 0 / blank sample size row** | That row is a **gap** (no marker, limits stay finite — no NaN/Infinity breaking the Y-scale). |
| 27 | **Switch chart type back to Individuals** | Renders identically to before (X-mR + MR panel); the Sample size binding is ignored. |
| 28 | **Chart type = X̄-R / X̄-s** (Measurement = subgroup mean, Subgroup range/std-dev bound, Sample size = m) | X̄ chart with `x̄̄ ± A₂R̄` (or `A₃s̄`) limits + full WE rules; companion **R/s panel** with its own center/UCL/**LCL** (LCL drawn only when > 0, i.e. m ≥ 7 for R); a range/std-dev beyond either limit flags. |
| 29 | **X̄-R/X̄-s missing Subgroup range/std-dev or Sample size** | Empty-state prompt for the missing role; no wrong limits. |
| 30 | **X̄-R/X̄-s with subgroup size m outside 2–25 (or non-integer)** | "Subgroup size must be a whole number from 2 to 25" prompt. |
| 31 | **Individuals MR panel after Phase 2** | Unchanged — the companion panel still shows "Moving range", no LCL line (LCL = 0), same tooltip wording. |
| 32 | **Chart type = EWMA / Moving average** (Measurement = individual reading; λ / window in Chart Parameters) | Smoothed value line; limits are a **smoothly-widening connected envelope** (not a staircase); **no zone shading**, no MR panel; only Beyond Limits flags. |
| 33 | **EWMA/MA with a blank reading mid-series** | The gap point plots nothing; EWMA carries its value forward and MA averages the available window — limits stay finite (no NaN). |
| 34 | **Bad EWMA λ (≤0 or >1) or MA window (<2)** | Empty-state prompt ("EWMA weight (λ) must be between 0 and 1" / "Moving-average window must be a whole number 2 or more"). |
| 35 | **EWMA/MA raw-reading overlay** (default on) | Faint dots mark each original reading behind the smoothed line; they swing wider than the line yet stay inside the Y-axis (domain includes them). The dots take no tooltip/selection — hovering/clicking still hits the smoothed point on top. **Chart Parameters ▸ Show raw readings off** removes them and the axis re-tightens to the smoothed line. The toggle is a no-op on individuals/attribute/subgroup charts (no raw overlay there). |
| 36 | **Chart type = CUSUM** (Measurement = individual reading; k / h in Chart Parameters) | **Two** cumulative-sum arms about a zero centerline — C⁺ above, C⁻ below — with flat decision lines at **±H** (= h·σ); no zone shading, no MR panel. A sustained shift makes the relevant arm climb and cross H, where a violation marker appears **on that arm** (upper marker on the C⁺ line, lower on the C⁻ line). No Western Electric rules; the rule-reference panel lists nothing for CUSUM. Tooltip (on the C⁺ points) shows C⁺, C⁻, and H. |
| 37 | **CUSUM + *Floor LCL at zero* on** | The **−H decision line does not move** — it stays at −H regardless of the Floor-LCL toggle (the interval is symmetric about 0). The lower arm and its signals are unaffected. |
| 38 | **CUSUM raw readings / target** | **No** raw-reading dots (the overlay is EWMA/MA-only), and the y-axis stays centered on 0 — the raw readings (≈ process mean) do **not** stretch the cumulative scale. A bound **Target** is ignored (no target line on the ±H scale). |
| 39 | **CUSUM with a blank reading mid-series** | The gap point plots nothing on either arm; both sums hold across it and resume after — limits stay finite (no NaN). |
| 40 | **Bad CUSUM k or h (≤ 0)** | Empty-state prompt ("CUSUM reference value k and decision interval h must be greater than 0"). |
