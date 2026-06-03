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
