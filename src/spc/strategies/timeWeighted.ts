/**
 * Time-weighted strategies: EWMA (exponentially-weighted moving average) and MA (moving average).
 * Both plot a statistic *derived from the ordered series* (so `prepare` takes ctx for the params and
 * preserves the raw reading in `baseValue`), against the X-mR sigma (σ = MR̄/d₂) of the individuals.
 * Single-phase, no companion, smooth (linear) widening limits, beyond-limit rule only ({1}) — their
 * points are autocorrelated, so WE run/zone rules don't apply.
 */

import type { ChartStrategy, ChartContext, LimitModel } from "../chartType";
import { DataPoint, SpcStatistics } from "../types";
import { PhaseSegment, limitsFrom, D2 } from "../statistics";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const reals = (pts: DataPoint[], pick: (p: DataPoint) => number | null | undefined): number[] =>
    pts.map(pick).filter((v): v is number => v != null);

/** Single-phase, no-companion model with a smooth (linear) widening limit envelope. */
function timeWeightedModel(points: DataPoint[], perPoint: SpcStatistics[]): LimitModel {
    const n = points.length;
    let rep = n - 1;
    while (rep > 0 && points[rep].value === null) rep--;
    const segments: PhaseSegment[] = n
        ? [{ stats: perPoint[rep], startIndex: points[0].index, endIndex: points[n - 1].index }]
        : [];
    return { perPoint, segments, singlePhase: true, companion: null, varyingLimits: true, smoothLimits: true };
}

export const ewmaStrategy: ChartStrategy = {
    id: "ewma", applicableRules: new Set([1]), zonesMeaningful: false,
    valueLabel: "EWMA",
    validate: (_pts, ctx) => {
        const l = ctx.ewmaLambda ?? 0.2;
        return l > 0 && l <= 1 ? null : "EWMA weight (λ) must be between 0 and 1";
    },
    build: (raw, ctx) => {
        const lambda = ctx.ewmaLambda ?? 0.2;
        const mult = ctx.opts.sigmaMultiplier ?? 3;
        const floor = ctx.opts.floorLcl ?? true;
        // Base stats once — x̄ is both the center and z₀.
        const xBar = mean(reals(raw, p => p.value));
        const sigma = mean(reals(raw, p => p.movingRange)) / D2;
        let z = xBar; // z₀ = x̄
        const points = raw.map(p => {
            if (p.value === null) return { ...p, baseValue: null, direction: null }; // gap: carry z, plot nothing
            z = lambda * (p.value as number) + (1 - lambda) * z;
            return { ...p, baseValue: p.value, value: z, direction: null };
        });
        let k = 0; // count of real points so far → drives the widening σ_z
        const perPoint = points.map(p => {
            if (p.value !== null) k++;
            const kk = Math.max(1, k);
            const sigmaZ = sigma * Math.sqrt((lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * kk)));
            return limitsFrom(xBar, 0, sigmaZ, mult, floor);
        });
        return { points, limits: timeWeightedModel(points, perPoint) };
    },
};

const window = (ctx: ChartContext) => Math.max(2, Math.round(ctx.maWindow ?? 5));

/** Shared CUSUM base stats — one source of truth for both arms and the threshold. μ₀ from the raw
 *  readings (in `value`), σ = MR̄/d₂, K = k·σ, H = h·σ (all in the raw measurement's units). */
function cusumStats(points: DataPoint[], ctx: ChartContext) {
    const k = ctx.cusumK ?? 0.5;
    const h = ctx.cusumH ?? 5;
    const mu0 = mean(reals(points, p => p.value));
    const sigma = mean(reals(points, p => p.movingRange)) / D2;
    return { mu0, sigma, K: k * sigma, H: h * sigma };
}

export const cusumStrategy: ChartStrategy = {
    id: "cusum", applicableRules: new Set(), zonesMeaningful: false,
    valueLabel: "CUSUM", // the axis title — the chart plots BOTH arms, so don't label it "C⁺"
    validate: (_pts, ctx) => {
        const k = ctx.cusumK ?? 0.5, h = ctx.cusumH ?? 5;
        return Number.isFinite(k) && k > 0 && Number.isFinite(h) && h > 0
            ? null : "CUSUM reference value k and decision interval h must be greater than 0";
    },
    build: (raw, ctx) => {
        const mult = ctx.opts.sigmaMultiplier ?? 3;
        const { mu0, K, H } = cusumStats(raw, ctx); // base stats once, from the raw value
        let cPlus = 0;
        const points = raw.map(p => {
            // Gap: hold C⁺ across it, plot nothing. Strip target (raw-scale → meaningless on ±H).
            if (p.value === null) return { ...p, baseValue: null, target: null, direction: null };
            cPlus = Math.max(0, (p.value as number) - (mu0 + K) + cPlus);
            return { ...p, baseValue: p.value, value: cPlus, target: null, direction: null };
        });
        let cMinus = 0;
        const secondarySeries = raw.map(p => {
            if (p.value === null) return null; // gap: hold C⁻, plot nothing
            cMinus = Math.max(0, (mu0 - K) - (p.value as number) + cMinus);
            return -cMinus; // plotted below the zero centerline
        });
        // ±H decision interval about 0, flooring OFF — the lower line is intrinsically −H, so we must
        // NOT thread ctx.opts.floorLcl (the default floors it to 0 and breaks the lower arm).
        const stats = limitsFrom(0, 0, H / mult, mult, false);
        const perPoint = points.map(() => stats);
        const n = points.length;
        const segments: PhaseSegment[] = n
            ? [{ stats, startIndex: points[0].index, endIndex: points[n - 1].index }]
            : [];
        return { points, limits: { perPoint, segments, singlePhase: true, companion: null, varyingLimits: false, secondarySeries } };
    },
};

export const maStrategy: ChartStrategy = {
    id: "ma", applicableRules: new Set([1]), zonesMeaningful: false,
    valueLabel: "Moving average",
    validate: (_pts, ctx) => {
        const w = ctx.maWindow ?? 5;
        return Number.isFinite(w) && Math.round(w) >= 2 ? null : "Moving-average window must be a whole number 2 or more";
    },
    build: (raw, ctx) => {
        const w = window(ctx);
        const mult = ctx.opts.sigmaMultiplier ?? 3;
        const floor = ctx.opts.floorLcl ?? true;
        const xBar = mean(reals(raw, p => p.value));
        const sigma = mean(reals(raw, p => p.movingRange)) / D2;
        const points = raw.map((p, i) => {
            if (p.value === null) return { ...p, baseValue: null, direction: null };
            const win: number[] = [];
            for (let j = Math.max(0, i - w + 1); j <= i; j++) {
                const v = raw[j].value;
                if (v !== null) win.push(v as number);
            }
            return { ...p, baseValue: p.value, value: win.length ? mean(win) : null, direction: null };
        });
        const perPoint = points.map((_p, i) => {
            let cnt = 0; // real values in this point's window → limit widens by 1/√cnt
            for (let j = Math.max(0, i - w + 1); j <= i; j++) if (points[j].baseValue != null) cnt++;
            return limitsFrom(xBar, 0, sigma / Math.sqrt(Math.max(1, cnt)), mult, floor);
        });
        return { points, limits: timeWeightedModel(points, perPoint) };
    },
};
