# Design note — consolidate `prepare` + `computeLimits` into `build(raw, ctx)`

**Status:** design (not yet implemented). Pays down the derived-series design debt flagged since
[`phase3-design.md`](phase3-design.md) and again in [`cusum-design.md`](cusum-design.md). A pure
refactor — **no behavior change, no version bump** — best done *before* Phase 4 adds a fifth family.

## Objective

Replace the two-method `ChartStrategy` pipeline (`prepare` then `computeLimits`) with a single
**`build(raw, ctx) → { points, limits }`** per strategy, so a chart family's base statistics
(x̄/μ₀, σ = MR̄/d₂) are computed **once** and shared between the plotted series and its limits.

**Definition of done:** every strategy implements `build`; `prepare`/`computeLimits` are gone from
the interface; `visual.ts` and the test suite call `build`; **the existing 122 tests pass unchanged**
(plus a new totality test); the packaged visual renders identically for every chart type.

## The debt, precisely

`prepare(raw, ctx)` derives the plotted series (overwrites each point's `value`); `computeLimits`
then computes the limits. For the **derived-series** families (EWMA, MA, CUSUM) both halves depend on
the same base stats — but `prepare` has overwritten `value`, so `computeLimits` can't see the raw
readings. Two workarounds resulted:

1. **Recompute the base stats in both methods.** EWMA computes x̄ in `prepare` (for z₀) *and* in
   `computeLimits` (the center); CUSUM needs μ₀/K in `prepare` (C⁺) and μ₀/σ/K/H in `computeLimits`
   (C⁻ and ±H). They must agree *exactly*, including gap handling — for CUSUM a threshold (H) and a
   whole second series hang off it, so a divergence would put the two arms on different centers. We
   band-aided CUSUM with a shared `cusumStats` helper; the structure still invites the bug.
2. **A hidden two-step contract.** `prepare` must run first; `computeLimits` assumes its output shape;
   `validate` sits between them. The interface presents two independent methods, but they're really
   one pipeline with invariants the types don't express.

`build` removes (1) entirely — base stats are computed once in one scope — and removes the hidden
ordering of (2). **What it does *not* remove:** points still must carry their structural fields
(`index`, `identity`, `categoryIndex`, `target`, `tooltips`, and `baseValue` for the EWMA/MA raw
overlay) through to the renderer + rule engine. That round-trip is inherent to the data model, not to
the split — but `baseValue` stops being an *internal recompute channel* and is set purely for
rendering.

## The new interface (`chartType.ts`)

```ts
export interface ChartStrategy {
    id: ChartType;
    applicableRules: Set<number>;
    zonesMeaningful: boolean;
    requiredRoles?: ("sampleSize" | "spread")[];
    validate?(points: DataPoint[], ctx: ChartContext): string | null;
    valueLabel?: string;
    valueFormat?: string;
    /** Derive the plotted points AND their limits in one pass (base stats computed once). Replaces
     *  the old prepare + computeLimits. MUST be total — see the totality contract below. */
    build(raw: DataPoint[], ctx: ChartContext): { points: DataPoint[]; limits: LimitModel };
}
```

`validate` keeps its current signature and is still called on the **built points** (`build().points`)
— unchanged, minimal churn. Everything else on the interface is untouched.

## Caller (`visual.ts`)

`prepare` + `computeLimits` (lines ~123 and ~137) collapse to one `build` call. **Run `build` only
after the empty + role gates** — those two checks read `rawPoints`/`dataView`, not `points`, so they
don't need `build` and shouldn't pay for it (and `build` should never see truly-empty input):

```ts
if (!rawPoints.some(p => p.value !== null))      → emptyMessage          // before build
else if (missingRole)                            → role prompt           // before build
else {
    const { points, limits } = strategy.build(rawPoints, ctx);
    if (!points.some(p => p.value !== null))      → "No valid sample sizes"
    else if (strategy.validate?.(points, ctx))    → validation message
    else                                          → evaluateRules(points, limitsFromModel(limits), …) + render
}
```

Only the all-null and validate gates need `points`, so `build` sits just above them. The identity
attachment and `measureName`/services setup already live in the render branch, so nothing else moves.
Limits computed on a path that ends in a message are discarded — cheap, and `build`'s totality (below)
makes it safe.

## Totality contract (the one new requirement)

Today `computeLimits` runs **only** in the final `else` — after empty/role/all-null/validate all pass
— so it has *never been exercised* on degenerate input. With `build` running just above the all-null
and validate gates, it now is. So **`build` must be total** — never throw on:

- **all-gap-after-derivation** `points` (raw has values but the derived `value` is null for every
  point — e.g. a p-chart with all sample sizes ≤ 0), and
- **invalid params** (subgroup `m` out of 2–25, bad λ/window/k/h).

(Gating `build` behind the empty + role checks means it does **not** need to handle truly-empty
`rawPoints` — that case never reaches it.) On these inputs `build` returns finite-but-meaningless
limits; the all-null/validate gates show a message instead of rendering them. The strategies already
*look* total here (optional chaining on `constantsFor`, `mean([]) === 0`, the `n === 0 → segments: []`
guard in `timeWeightedModel`) — but since these paths were previously unreachable, **the refactor
exercises them for the first time**, so they must be verified, not assumed (see Testing).

## Per-strategy shape

Each strategy's `build` is a mechanical merge of its existing two methods:

- **individuals** — `build: (raw) => ({ points: raw, limits: modelFromPhased(raw, computePhasedStatistics(...)) })`. (`modelFromPhased` stays an internal helper — it's used by tests too.)
- **attribute (p/np/c/u)** — derive `value = count/n` (or count) and compute the per-point limits from the same `pbar`/`n`, in one pass.
- **subgroup (X̄-R/X̄-s)** — `prepare` is already identity, so `build` is essentially today's `computeLimits` returning `{ points: raw, limits }`.
- **time-weighted (EWMA/MA/CUSUM)** — the real win: compute base stats once (the existing `cusumStats` generalizes to a shared `baseStats(points) → { xBar, sigma }` for EWMA/MA too), then derive the series and the limits from it. CUSUM's `prepare`-vs-`computeLimits` μ₀/σ duplication disappears — and concretely, **`cusumStats` drops its `getRaw` accessor**: it only needed it to read `p.value` in `prepare` and `p.baseValue` in `computeLimits`, but `build` computes the base stats once from the raw `value` before it's overwritten, so it reads `value` directly. (That accessor's existence is the clearest symptom of the debt this refactor removes.)

## Migration order (each step compiles + green)

The interface change touches every strategy + the caller + tests at once, so stage it behind a shim:

1. **Add `build?` as optional** to `ChartStrategy`, plus a module helper
   `runStrategy(strategy, raw, ctx)` that returns `build(raw, ctx)` if present, else the legacy
   `const p = prepare(raw, ctx); return { points: p, limits: computeLimits(p, ctx) };` (compute
   `prepare` **once**). Point `visual.ts` (restructured per the Caller section) and the three test
   helpers (`attr`, `sub`, `tw`) + the direct `computeLimits` call at test:241 through `runStrategy`.
   *Verify:* the new totality test (below) passes **and** a Desktop pass on degenerate inputs — this is
   the step where limit computation starts running on all-gap/invalid input via the shim, and that
   risk lives on the render path the unit suite does **not** cover.
2. **Convert strategies to native `build`, one family at a time** — individuals → attribute →
   subgroup → time-weighted. The shim covers the not-yet-converted ones, so each conversion is its own
   green commit. Fold the derived-family base stats into one computation as you go.
3. **Make `build` required; delete `prepare`/`computeLimits`** from the interface, the strategies, and
   `runStrategy` (inline it or drop it). *Verify:* suite green; package; diff a couple of chart types
   in Desktop against the pre-refactor build to confirm pixel-identical output.

## Testing

- The pure-logic suite confirms **limit/value equivalence** — it **must pass unchanged**. Update only
  the three fixture helpers + the one direct `computeLimits` call to go through `build`/`runStrategy`;
  assertions stay byte-for-byte. (A green suite proves the *math* is unchanged — it does **not** prove
  render-path totality; see below.)
- **New totality test** (the genuinely new surface): assert `build` returns finite limits without
  throwing on (a) an **all-gap p-chart** (all sample sizes ≤ 0) and (b) **invalid params** (subgroup
  `m` out of range, bad k/h). These paths were unreachable before and so untested.
- **Render-path check (manual, not the suite):** since rendering isn't unit-tested, walk
  `edge-cases.md` rows for the degenerate inputs — **#1** (no fields → empty state), **#26** (0/blank
  sample size), **#30** (subgroup m out of range), **#34** (bad λ/window) — and confirm each shows its
  message with no console error. This is what actually validates `build`'s totality.

## Scope / non-goals

- **No new features, no version bump, no capability changes.** Purely internal.
- Does **not** remove `baseValue` or the structural-field round-trip (inherent to the data model).
- Does **not** touch the renderer, rule engine, tooltip, or settings.

## Risks

- **Totality on degenerate input** is the only real risk — bounded to ~5 `build` functions, most
  already total. The catch: it lives on the **render path the unit suite doesn't cover**, so it's
  guarded by the new direct totality test + the manual edge-case pass (not by "suite green").
- **Silent behavior drift** during the per-strategy conversion (step 2) is caught by the unchanged
  known-answer fixtures — any divergence in a limit or plotted value fails a test immediately.
