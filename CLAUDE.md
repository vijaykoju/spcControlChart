# CLAUDE.md — spcControlChart

Project-specific guidance for working in this repo. Merge with the global `~/.claude/CLAUDE.md`
principles. This file captures conventions that are **not** obvious from the code.

## What this is

A Power BI custom visual: a multi-family **SPC control-chart** package (TypeScript + D3 v7, pbiviz,
API 5.11.0). Current families: individuals (X-mR), attribute (p/np/c/u), subgroup (X̄-R/X̄-s),
time-weighted (EWMA/MA/CUSUM). Version **2.3.0.0**.

## Mission boundary — read first

This is a **charting** package, **not** a statistical-analysis workbench. In scope: drawing SPC
control charts and their direct signals. **Out of scope** (do not propose or build without an explicit
decision): Gage R&R / MSA, DOE, ANOVA, regression analysis, hypothesis testing, and similar.

- **Capability (Cp/Cpk/Pp/Ppk + histogram)** — deferred as borderline scope creep. If ever built, it's
  a *separate, guard-railed visual*, not a mode of this one. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
- When a feature sits near the charting/analysis line, surface the tension and ask — don't silently
  build it.

## Architecture — the ChartStrategy seam

Every chart family is a `ChartStrategy` (`src/spc/chartType.ts`) with a single
**`build(raw, ctx) → { points, limits }`** method plus metadata (`applicableRules`, `zonesMeaningful`,
`requiredRoles`, optional `validate`, `valueLabel`/`valueFormat`). Strategies live in
`src/spc/strategies/` and are registered in `strategies/index.ts`.

- **Adding a family = add a strategy + register it.** The renderer (`src/rendering/chart.ts`) and the
  rule engine consume the strategy's `LimitModel` and **never branch on chart type**. Keep it that way.
- `build` computes base stats (x̄/μ₀, σ = MR̄/d₂) **once** and shares them between the plotted series and
  the limits. It must be **total** — never throw on all-gap or invalid-param input (the caller in
  `visual.ts` gates it past empty/missing-role, then shows a message on the all-null/validate gates).
- `src/spc/` is pure logic — **no d3 / powerbi imports** there (keeps it unit-testable under Node).

## Testing

- `npm test` — a **dependency-free, no-framework** suite (`test/spc.test.ts`, plain `check()`
  assertions). Every chart family has **known-answer fixtures** (limit math is exactly verifiable).
- The suite must **stay green**; for refactors it must pass **unchanged** (that's the equivalence proof).
- **Rendering is not unit-tested** (`chart.ts`/`visual.ts`). Verify render changes manually against
  [`docs/edge-cases.md`](docs/edge-cases.md) in Power BI Desktop — especially degenerate inputs.

## Working rhythm (what's worked here)

1. Non-trivial features start with a **design note in `docs/`**, run through `/critical-review`, fixes
   applied, *then* implemented; the implementation gets its own `/critical-review` pass.
2. Verify in **Power BI Desktop** before merging. For a clean re-import, bump the **build digit**
   (4th component) of `pbiviz.json`; revert it for a behavior-identical change.
3. Then branch off `main`, commit, open a PR, merge (`gh pr merge N --merge --delete-branch`), sync.
   Commit/PR only when the user asks.
4. **Version:** minor bump per new chart family (e.g. 2.2.0 EWMA/MA, 2.3.0 CUSUM); no bump for pure
   refactors. Keep the `pbiviz.json` description + `README.md` family list in sync when a family lands.

## Backward compatibility (non-negotiable)

The chart-type default stays **Individuals**, so existing reports render identically. New chart types,
roles, and settings are additive.

## Pointers

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — family roadmap, deferred items, design debt status.
- `docs/*-design.md` — point-in-time design records (don't rewrite to "current state").
- [`docs/rules.md`](docs/rules.md) — rule definitions + per-chart applicability.
- [`docs/edge-cases.md`](docs/edge-cases.md) — the manual render-verification checklist.
