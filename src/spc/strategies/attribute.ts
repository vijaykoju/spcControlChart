/**
 * Attribute-chart strategies: p (proportion defective), np (number defective), c (count of
 * defects), u (defects per unit). All single-phase, no companion. p/u have per-point limits
 * (varying nᵢ); np/c are constant. Default rule set is {1 Beyond, 4 Run} — the run/limit rules that
 * don't depend on distribution symmetry (zone rules 2/3 are excluded by default; see docs/rules.md
 * and docs/phase1-design.md for the normal-approximation caveat on skewed attribute data).
 */

import type { ChartStrategy, LimitModel } from "../chartType";
import { DataPoint } from "../types";
import { PhaseSegment, limitsFrom } from "../statistics";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const validN = (p: DataPoint) => p.sampleSize != null && p.sampleSize > 0;
const real = (points: DataPoint[]) => points.filter(p => p.value !== null);

/** Carry the raw count, clear the (unused) companion/direction fields, preserve everything else. */
const basePrepare = (p: DataPoint): DataPoint =>
    ({ ...p, count: p.value, movingRange: null, prevValue: null, direction: null });

/** p/u plot count/n; an nᵢ ≤ 0 / null point becomes a gap (proportion undefined). */
const ratioPrepare = (raw: DataPoint[]): DataPoint[] => raw.map(p => {
    const ok = p.value !== null && validN(p);
    return { ...basePrepare(p), value: ok ? (p.value as number) / (p.sampleSize as number) : null };
});

/** Build a single-phase attribute LimitModel from a constant center + per-point sigma. */
function attributeModel(
    points: DataPoint[], mult: number, center: number,
    sigmaAt: (p: DataPoint) => number, varyingLimits: boolean
): LimitModel {
    // Attribute statistics are non-negative → always floor LCL at 0 (regardless of the format toggle).
    const perPoint = points.map(p => limitsFrom(center, 0, p.value === null ? 0 : sigmaAt(p), mult, true));
    const n = points.length;
    // Single segment; stats from the last REAL point so right-edge zone labels use its zones.
    let rep = n - 1;
    while (rep > 0 && points[rep].value === null) rep--;
    const segments: PhaseSegment[] = n
        ? [{ stats: perPoint[rep], startIndex: points[0].index, endIndex: points[n - 1].index }]
        : [];
    return { perPoint, segments, singlePhase: true, companion: null, varyingLimits };
}

const mult = (ctx: { opts: { sigmaMultiplier?: number } }) => ctx.opts.sigmaMultiplier ?? 3;

/** p-chart: center p̄ = Σc/Σn (constant); σᵢ = √(p̄(1−p̄)/nᵢ) (varies with nᵢ). */
export const pStrategy: ChartStrategy = {
    id: "p", applicableRules: new Set([1, 4]), zonesMeaningful: true, requiredRoles: ["sampleSize"],
    valueLabel: "Proportion", valueFormat: "0.0%",
    prepare: ratioPrepare,
    computeLimits(points, ctx) {
        const reals = real(points).filter(validN);
        const totalN = sum(reals.map(p => p.sampleSize as number));
        const pBar = totalN > 0 ? sum(reals.map(p => p.count as number)) / totalN : 0;
        const sigmaAt = (p: DataPoint) => {
            const n = p.sampleSize as number;
            return n > 0 && pBar > 0 && pBar < 1 ? Math.sqrt((pBar * (1 - pBar)) / n) : 0;
        };
        return attributeModel(points, mult(ctx), pBar, sigmaAt, true);
    },
};

/** u-chart: center ū = Σc/Σn (constant); σᵢ = √(ū/nᵢ) (varies with nᵢ). */
export const uStrategy: ChartStrategy = {
    id: "u", applicableRules: new Set([1, 4]), zonesMeaningful: true, requiredRoles: ["sampleSize"],
    valueLabel: "Defects per unit",
    prepare: ratioPrepare,
    computeLimits(points, ctx) {
        const reals = real(points).filter(validN);
        const totalN = sum(reals.map(p => p.sampleSize as number));
        const uBar = totalN > 0 ? sum(reals.map(p => p.count as number)) / totalN : 0;
        const sigmaAt = (p: DataPoint) => {
            const n = p.sampleSize as number;
            return n > 0 && uBar > 0 ? Math.sqrt(uBar / n) : 0;
        };
        return attributeModel(points, mult(ctx), uBar, sigmaAt, true);
    },
};

/** np-chart: center n·p̄ = mean count (constant n assumed); σ = √(np̄(1−p̄)). */
export const npStrategy: ChartStrategy = {
    id: "np", applicableRules: new Set([1, 4]), zonesMeaningful: true, requiredRoles: ["sampleSize"],
    prepare: raw => raw.map(basePrepare), // np plots the count itself
    computeLimits(points, ctx) {
        const reals = real(points);
        // np assumes a constant subgroup size; use the first real n. (A varying n means a p-chart
        // is the right tool — documented in docs/phase1-design.md.)
        const ns = points.filter(validN).map(p => p.sampleSize as number);
        const n = ns.length ? ns[0] : 0;
        const cBar = reals.length ? sum(reals.map(p => p.value as number)) / reals.length : 0; // = np̄
        const pBar = n > 0 ? cBar / n : 0;
        const sigma = Math.sqrt(Math.max(0, cBar * (1 - pBar)));
        return attributeModel(points, mult(ctx), cBar, () => sigma, false);
    },
};

/** c-chart: center c̄ = mean count; σ = √c̄ (constant). No sample size needed. */
export const cStrategy: ChartStrategy = {
    id: "c", applicableRules: new Set([1, 4]), zonesMeaningful: true,
    prepare: raw => raw.map(basePrepare),
    computeLimits(points, ctx) {
        const reals = real(points);
        const cBar = reals.length ? sum(reals.map(p => p.value as number)) / reals.length : 0;
        const sigma = Math.sqrt(Math.max(0, cBar));
        return attributeModel(points, mult(ctx), cBar, () => sigma, false);
    },
};
