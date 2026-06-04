# SPC Control Chart — Power BI custom visual

A multi-family **statistical process control** chart for Power BI. Bind an *Axis (date or category)*
and a *Measurement* (plus a couple of extra fields for some chart types) and the visual computes
everything internally — **no DAX required**. Pick the chart type in the Format pane.

## Chart families
Chosen via **Format → Chart → Chart type** (default: Individuals, so existing reports are unchanged):

- **Individuals (X-mR)** — individuals chart with a **moving-range companion panel**; phased limits + automatic changepoint detection.
- **Attribute** — **p** (proportion), **np** (count defective), **c** (defect count), **u** (defects per unit). p/u have per-point limits for varying sample size.
- **Subgroup** — **X̄-R** (mean & range) and **X̄-s** (mean & std dev), each with an **R/s dispersion companion panel**.
- **Time-weighted** — **EWMA**, **Moving average** (both with a smoothly-widening limit envelope and an optional faint raw-reading overlay), and **CUSUM** (two-arm tabular, decision interval ±H).

## Features
- **Western Electric / Nelson rules**, individually toggleable, with applicability per chart type: all 8 on individuals & subgroup; Beyond + Run on attribute charts; Beyond-only on EWMA/MA; CUSUM uses its own two-arm ±H signal (no WE rules).
- Phased control limits with **changepoint detection** (Welch-t mean-shift) or a manual override (individuals).
- Zone shading (A/B/C) where meaningful, center line, control limits, violation markers.
- Dispersion **companion panels** (moving range / range / std dev) with their own limits + violations.
- **Chart Parameters** for the time-weighted charts: EWMA λ, MA window, CUSUM k / h, and raw-overlay color/opacity/size.
- Configurable **data-point size, opacity, and marker shape** across all chart types.
- An on-chart, scrollable, positionable **rule-reference panel** (lists the enabled rules + plain-language reasons).
- Native tooltips (value/center/UCL/LCL, phase, fired rules) + a **Tooltip measures** field well.
- Bound **Target** line (stepped; handles time-varying targets — see [`docs/target-measures.md`](docs/target-measures.md)) and a phase-change indicator.
- Click **cross-filtering** + context menu, **report-theme** color default, **high-contrast** support.
- A positionable **legend** with renameable entries.
- Gap-aware missing values (blank rows kept as slots; lines break, dispersion not bridged), and an empty-state landing page when no fields are bound.

## Data roles
- **Axis** (date or category) and **Measurement** — required for every chart type.
- **Sample size** — required for attribute (p/np/u) and subgroup charts.
- **Subgroup range or std dev** — required for X̄-R / X̄-s.
- **Target** and **Tooltips** — optional, any chart type.

## Develop
```bash
npm install
npm start            # pbiviz start — dev server with hot reload
npm test             # dependency-free unit suite (statistics, rules, changepoint, strategies, extraction)
npm run package      # pbiviz package — builds the .pbiviz into dist/
```

## Structure
```
src/
├── spc/                  # pure SPC logic (no d3/powerbi imports)
│   ├── chartType.ts      # the ChartStrategy seam: build(raw, ctx) → { points, limits }
│   ├── strategies/       # one strategy per chart family (individuals, attribute, subgroup, timeWeighted)
│   ├── statistics.ts     # limits, sigma, phases; constants.ts — A2/A3/D3/D4/B3/B4 by subgroup size
│   ├── rules.ts          # Western Electric / Nelson rules
│   └── changepoint.ts    # Welch-t mean-shift detection
├── extractData.ts        # Power BI dataView → series
├── rendering/            # D3 chart + companion panel
├── settings.ts           # format-pane model
└── visual.ts             # IVisual entry point
test/                     # committed unit tests (run via npm test)
docs/                     # roadmap, rule reference, design notes, target-measure patterns, edge-case checklist, AppSource/cert checklist
```

Adding a chart family = add a `ChartStrategy` (a `build` method + rule/zone metadata) and register it;
the renderer and rule engine consume the strategy's `LimitModel` and never branch on chart type.

## Tech
TypeScript + D3.js v7, built with the Power BI Visuals SDK (`powerbi-visuals-tools`). API 5.11.0.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the chart-family roadmap and
[`docs/appsource-submission.md`](docs/appsource-submission.md) for the AppSource listing and
certification checklist.
