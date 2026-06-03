# Roadmap — SPC control-chart family for Power BI

## North star

Build the most complete and polished **SPC control-chart family** available as a Power BI custom
visual: one visual, a chart-type selector, every standard control chart done well. This is a
**charting package**, deliberately **not** a statistical-analysis workbench.

### Guardrails (scope boundaries)

**In scope** — anything that is "compute limits from a data stream, draw a line + limits + zones,
run the applicable rules":

- Individuals **X-mR** *(shipped)*
- Attribute charts: **p, np, c, u**
- Subgroup charts: **X̄-R, X̄-s**
- Time-weighted: **EWMA, CUSUM, moving average**
- Process-capability **display**: Cp/Cpk/Pp/Ppk + capability histogram

**Out of scope (hard no — resist the creep):** Gage R&R / MSA, DOE, ANOVA, regression, hypothesis
testing, distribution fitting as an analysis session. Rule of thumb: if a feature produces a
*results table from an analysis session* rather than *a chart from a data stream*, it does not
belong in this visual. Those are better served by the user's stats tool or an R/Python visual.

## The one architectural change that unlocks everything

Limits today are **per-phase** (`SpcStatistics` is constant within a phase; `statsForPoint` returns
the phase's limits). Attribute charts with a varying sample size (`p`, `u`) have limits that change
**every point** (stair-stepped). So the foundational generalization is:

> **Per-point limits.** Each plotted point resolves its own `{center, ucl, lcl, zones, sigma}`. A
> constant-within-phase chart is the trivial case where neighbouring points share limits.

Around that, a **ChartType strategy** is the seam every chart family plugs into. The existing
pipeline (`extractSeries → buildDataPoints → computePhasedStatistics → evaluateRules → renderChart`)
becomes *the `individuals` strategy*. See [`phase0-design.md`](phase0-design.md) for the detailed
design of this refactor.

## Data input model (the key design decision)

Most effort goes into how each family's data enters Power BI's aggregated `dataView`:

- **Attribute charts** — add a **Count** role and an optional **Sample size** role.
  `p = count/n`, `u = count/n` (varying `n` → per-point limits); `np`/`c` use constant `n`. Low
  friction.
- **Subgroup charts (X̄-R / X̄-s)** — two options, not equal on this platform:
  - **(A) Pre-aggregated (default for v1):** user supplies subgroup **mean + range (or stddev) +
    n** as measures. Robust, deterministic, trivial `dataView`; more DAX for the user.
  - **(B) Raw rows + a Subgroup grouping role (stretch):** the visual buckets raw observations and
    computes the subgroup stats itself. The "real SPC tool" feel, but getting *N raw rows per
    subgroup* out of Power BI's aggregated model is fiddly. **Prototype before committing.**

The visual validates the roles required by the selected chart type and shows a helpful empty state
(e.g., "p-chart needs a Count and a Sample size").

## Chart families: math, rules, companion

| Chart | Center / limits | Companion | Rules that apply |
|---|---|---|---|
| Individuals *(shipped)* | x̄ ± 3·(MR̄/d₂) | MR (beyond-limit only) | all 8 |
| X̄-R | x̄̄ ± A₂R̄ | R: D₄R̄ / D₃R̄ | full on X̄; beyond-limit on R |
| X̄-s | x̄̄ ± A₃s̄ | s: B₄s̄ / B₃s̄ | full on X̄; beyond-limit on s |
| p | p̄ ± 3√(p̄(1−p̄)/nᵢ) | none | beyond-limit + runs |
| np | np̄ ± 3√(np̄(1−p̄)) | none | beyond-limit + runs |
| c | c̄ ± 3√c̄ | none | beyond-limit + runs |
| u | ū ± 3√(ū/nᵢ) | none | beyond-limit + runs |
| EWMA | zᵢ = λxᵢ + (1−λ)zᵢ₋₁; ± 3σ√(λ/(2−λ)·(1−(1−λ)²ⁱ)) | none | beyond-(EWMA)-limit only |
| CUSUM | cumulative deviation; decision interval H | none | beyond-H only |
| Moving average | MA(w); center ± 3σ/√w | none | beyond-limit |

Two implications:

- A **control-chart constants table** (`A₂, A₃, D₃, D₄, B₃, B₄, d₂, c₄` for subgroup size n≈2–25) is
  a new pure module — exactly verifiable against a textbook, so cheap to test.
- **Rules become chart-type-aware:** zone/run/trend rules are valid on individuals & X̄; dispersion
  (R/s/MR) and time-weighted charts get a curated subset. The format pane shows only the applicable
  rule toggles. The MR companion panel generalizes into a **dispersion companion** (MR / R / s).

## Phased delivery (each phase ships on its own)

- **Phase 0 — Foundation (enabler, no new chart).** Per-point limits; `ChartStrategy` seam; port
  X-mR behind it with **zero behavior change**; constants-table module; chart-type dropdown
  (Individuals only). *Done when the full existing suite passes unchanged.* See
  [`phase0-design.md`](phase0-design.md).
- **Phase 1 — Attribute charts (p, np, c, u).** Count + Sample-size roles; four strategies;
  per-point limits for p/u; role validation + empty states; per-formula tests. *Highest
  value-per-effort.*
- **Phase 2 — Subgroup charts (X̄-R, X̄-s).** Pre-aggregated input first; dispersion companion;
  constants by n; full rules on X̄. (Spike the raw-row grouping path in parallel.)
- **Phase 3 — Time-weighted (EWMA, CUSUM, moving average).** Own statistic + signal logic; renderer
  tweaks (CUSUM is cumulative).
- **Phase 4 — Capability display (Cp/Cpk/Pp/Ppk + histogram).** Most divergent rendering and inputs
  (USL/LSL spec limits). **Decision:** likely a *separate visual* in this project rather than a mode
  of the control chart.

## Cross-cutting (every phase)

- **Backward compatibility (non-negotiable):** chart-type default stays **Individuals** so existing
  reports render identically.
- **Settings:** the chart-type dropdown drives which cards/roles are relevant (hide the irrelevant).
- **capabilities.json:** roles are additive (can't swap per dropdown value); the visual interprets +
  validates them per type.
- **Testing:** every chart type gets known-answer fixtures — the limit math is exactly verifiable,
  which is the safety net through the Phase 0 refactor.
- **Naming / versioning:** broaden the display name to "SPC Control Charts"; **2.0.0** when the
  selector lands, minor bumps per added chart. AppSource re-cert per release.
- **Docs:** per-chart rule applicability in `rules.md`; a new `chart-types.md`; `edge-cases.md` rows
  per type.

## Decisions to make before coding

1. **Subgroup input:** pre-aggregated only for v1, or invest in the raw-grouping spike? *(Lean
   pre-agg.)*
2. **Capability:** separate visual *(rec)* vs. a mode of this one?
3. **Release cadence:** ship per chart type (faster feedback, more re-certs) vs. batch a "2.0
   family." *(Lean incremental.)*

## First move

Precede Phase 0 with a small **subgroup-data spike** to settle decision #1 (it shapes the data-role
design everything inherits), then execute Phase 0. Phase 0 + Phase 1 alone already make the visual
"covers individuals + all attribute charts" — a real, marketable leap.
