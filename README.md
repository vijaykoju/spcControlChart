# SPC Control Chart — Power BI custom visual

An X-mR (individuals & moving-range) **statistical process control** chart for Power BI. Bind an
*Axis (date or category)* field and a *Measurement* and the visual computes everything internally —
no DAX required.

## Features
- Phased control limits with automatic **changepoint detection** (Welch-t mean-shift) or a manual override
- All **8 Western Electric / Nelson rules**, phase-aware, individually toggleable
- Zone shading (A/B/C), center line, control limits, violation markers
- **Moving-range (MR) companion panel** — phase-aware MR̄/UCL with beyond-UCL violations
- Native tooltips (value/center/UCL/LCL, phase, fired rules) + a **Tooltip measures** field well
- Bound **Target** line (stepped; handles time-varying targets) and a phase-change indicator
- Click **cross-filtering** + context menu, **report-theme** color default, **high-contrast** support
- A positionable **legend** with renameable entries
- Gap-aware missing values (blank rows kept as slots; line breaks, MR not bridged)

## Develop
```bash
npm install
npm start            # pbiviz start — dev server with hot reload
npm test             # dependency-free unit suite (statistics, rules, changepoint, extraction)
npm run package      # pbiviz package — builds the .pbiviz into dist/
```

## Structure
```
src/
├── spc/             # pure SPC logic (types, statistics, rules, changepoint)
├── extractData.ts   # Power BI dataView → series
├── rendering/       # D3 chart + MR panel
├── settings.ts      # format-pane model
└── visual.ts        # IVisual entry point
test/                # committed unit tests (run via npm test)
docs/                # roadmap, rule reference, target-measure patterns, edge-case checklist, AppSource/cert checklist
```

## Tech
TypeScript + D3.js v7, built with the Power BI Visuals SDK (`powerbi-visuals-tools`). API 5.11.0.

See [`docs/appsource-submission.md`](docs/appsource-submission.md) for the AppSource listing and
certification checklist.
