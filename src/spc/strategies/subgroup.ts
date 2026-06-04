/**
 * Subgroup-chart strategies: X̄-R (mean + range) and X̄-s (mean + std dev). Pre-aggregated input —
 * one row per subgroup with the mean (Measurement), the dispersion (spread role), and the subgroup
 * size m (sampleSize role). v1 assumes a constant m. Single-phase, varyingLimits false.
 *
 * X̄ limits reuse limitsFrom: A2/A3 are 3-sigma constants, so sigma_eq = A·spread̄/3 = σ_X̄, which
 * reproduces x̄̄ ± A·spread̄ at mult = 3 AND gives the correct ±σ_X̄ / ±2σ_X̄ zones. The companion
 * (R or s) is a CompanionModel with its own center/UCL/LCL (D₄R̄/D₃R̄ or B₄s̄/B₃s̄).
 */

import type { ChartStrategy, ChartContext, LimitModel, CompanionModel, CompanionPoint } from "../chartType";
import { DataPoint } from "../types";
import { PhaseSegment, limitsFrom } from "../statistics";
import { constantsFor } from "../constants";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const realOf = (pts: DataPoint[]) => pts.filter(p => p.value !== null);
/** Constant subgroup size from the sampleSize role (first valid value; v1 assumes it's constant). */
const subgroupSize = (pts: DataPoint[]): number => {
    const m = pts.find(p => p.sampleSize != null && p.sampleSize > 0)?.sampleSize;
    return m != null ? Math.round(m) : 0;
};

const VALIDATE = (points: DataPoint[]): string | null => {
    // Over real subgroups: every subgroup size must be a valid in-range integer AND the same
    // (constant-m assumption — varying m would need pooled estimates, deferred), and at least one
    // subgroup must carry a dispersion value.
    const reals = realOf(points);
    const ms = reals.map(p => (p.sampleSize != null ? Math.round(p.sampleSize) : NaN));
    if (ms.some(m => !constantsFor(m))) return "Subgroup size must be a whole number from 2 to 25";
    if (ms.some(m => m !== ms[0])) return "Subgroup size must be constant across subgroups";
    if (!reals.some(p => p.spread != null)) return "No valid subgroup ranges or std devs";
    return null;
};

/** Shared X̄ + companion model for both X̄-R ("r") and X̄-s ("s"). */
function subgroupModel(points: DataPoint[], ctx: ChartContext, kind: "r" | "s"): LimitModel {
    const mult = ctx.opts.sigmaMultiplier ?? 3;
    const reals = realOf(points);
    const k = constantsFor(subgroupSize(points));

    const xBarBar = mean(reals.map(p => p.value as number));
    const spreadBar = mean(reals.filter(p => p.spread != null).map(p => p.spread as number));

    // A2/A3 are 3-sigma constants → 1-sigma equivalent (standard error of the mean) is A·spread̄/3.
    const A = kind === "r" ? k?.A2 ?? 0 : k?.A3 ?? 0;
    const sigmaEq = (A * spreadBar) / 3;
    // LCL flooring follows the global toggle — consistently with individuals/EWMA/MA (the whole
    // mean family). Only the inherently-non-negative attribute charts always floor.
    const xbarStats = limitsFrom(xBarBar, 0, sigmaEq, mult, ctx.opts.floorLcl ?? true);
    const perPoint = points.map(() => xbarStats);

    const ucl = (kind === "r" ? k?.D4 ?? 0 : k?.B4 ?? 0) * spreadBar;
    const lcl = (kind === "r" ? k?.D3 ?? 0 : k?.B3 ?? 0) * spreadBar; // ≥ 0 by construction
    const cp: CompanionPoint = { center: spreadBar, ucl, lcl };
    const companion: CompanionModel = {
        kind,
        value: points.map(p => p.spread ?? null),
        limits: points.map(() => cp),
        axisTitle: kind === "r" ? "Range" : "Std dev",
    };

    const n = points.length;
    let rep = n - 1;
    while (rep > 0 && points[rep].value === null) rep--;
    const segments: PhaseSegment[] = n
        ? [{ stats: perPoint[rep], startIndex: points[0].index, endIndex: points[n - 1].index }]
        : [];
    return { perPoint, segments, singlePhase: true, companion, varyingLimits: false };
}

export const xbarRStrategy: ChartStrategy = {
    id: "xbar-r", applicableRules: new Set([1, 2, 3, 4, 5, 6, 7, 8]), zonesMeaningful: true,
    requiredRoles: ["spread", "sampleSize"],
    validate: VALIDATE,
    prepare: raw => raw,
    computeLimits: (points, ctx) => subgroupModel(points, ctx, "r"),
};

export const xbarSStrategy: ChartStrategy = {
    id: "xbar-s", applicableRules: new Set([1, 2, 3, 4, 5, 6, 7, 8]), zonesMeaningful: true,
    requiredRoles: ["spread", "sampleSize"],
    validate: VALIDATE,
    prepare: raw => raw,
    computeLimits: (points, ctx) => subgroupModel(points, ctx, "s"),
};
