/**
 * SPC statistics for the X-mR (individuals & moving range) control chart.
 * Ported from dax/measures_baseline.dax, measures_phase1.dax,
 * measures_phase2.dax, and measures_active.dax.
 */

import { DataPoint, SpcStatistics, PhasedStatistics, TooltipField } from "./types";

/** X-mR individuals-chart constants (subgroup span = 2). */
export const D2 = 1.128;            // unbiasing constant for the moving range
export const SIGMA_MULTIPLIER = 3;  // control-limit width in sigmas

/** Minimum points a phase needs before it falls back to whole-dataset stats. */
export const MIN_PHASE_SIZE = 10;

function mean(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function floorAtZero(value: number): number {
    return value < 0 ? 0 : value;
}

/**
 * Build DataPoints from raw (date, value) pairs, deriving the moving range,
 * previous value, and direction — the same precompute the Power Query does.
 * Input is assumed already sorted ascending by date.
 */
export function buildDataPoints(
    raw: { label: string; value: number | null; tooltips?: TooltipField[]; target?: number | null; sampleSize?: number | null; categoryIndex: number }[]
): DataPoint[] {
    // Input is in observation order (extractData sorts date/number axes; text axes keep delivered
    // order). EVERY row is kept as a slot, including blank-measure rows (value === null = a gap):
    // the gap shows on the axis with no marker, the line breaks, and it breaks the SPC math too.
    // The moving range / direction are defined only between two ADJACENT real observations, so a
    // gap (and the point right after it) has no moving range — it is NOT bridged across the gap.
    return raw.map((r, i) => {
        const prev = i === 0 ? null : raw[i - 1].value;
        const realPair = r.value !== null && prev !== null;
        const prevValue = realPair ? prev : null;
        const movingRange = realPair ? Math.abs((r.value as number) - (prev as number)) : null;
        const direction = !realPair ? null
            : (r.value as number) > (prev as number) ? 1 : (r.value as number) < (prev as number) ? -1 : 0;
        return { index: i + 1, label: r.label, value: r.value, movingRange, prevValue, direction, tooltips: r.tooltips, target: r.target, sampleSize: r.sampleSize, categoryIndex: r.categoryIndex };
    });
}

/** Center-line stats (xBar, mrBar, sigma) from a set of values and moving ranges. */
function centerStats(values: number[], movingRanges: number[]): { xBar: number; mrBar: number; sigma: number } {
    const mrBar = mean(movingRanges);
    return { xBar: mean(values), mrBar, sigma: mrBar / D2 };
}

/** Tunable statistics options (from the format pane); defaults reproduce the dashboard. */
export interface StatsOptions {
    /** Control-limit width in sigmas (default 3). Zones scale as thirds of this. */
    sigmaMultiplier?: number;
    /** Floor LCL / lower zone bounds at 0 for non-negative metrics (default true). */
    floorLcl?: boolean;
}

/**
 * Derive full limits/zones from a center line and sigma.
 * Zones are thirds of the control-limit band: zoneB at mult/3·σ, zoneA at 2·mult/3·σ,
 * limit at mult·σ. At mult = 3 these are exactly 1σ/2σ/3σ.
 */
export function limitsFrom(
    xBar: number, mrBar: number, sigma: number, mult: number, floorLcl: boolean
): SpcStatistics {
    const floor = floorLcl ? floorAtZero : (v: number) => v;
    const zoneB = (mult / 3) * sigma;
    const zoneA = (2 * mult / 3) * sigma;
    const limit = mult * sigma;
    return {
        xBar,
        mrBar,
        sigma,
        ucl: xBar + limit,
        lcl: floor(xBar - limit),
        zoneAUpper: xBar + zoneA,
        zoneALower: floor(xBar - zoneA),
        zoneBUpper: xBar + zoneB,
        zoneBLower: floor(xBar - zoneB),
    };
}

/**
 * Statistics for one phase from its values and moving ranges, falling back to
 * whole-dataset stats when the phase is too small (mirrors the _All fallback in
 * the DAX). The xBar fallback is gated on the phase value count; mrBar/sigma on
 * the moving-range count — matching the separate COUNTROWS guards in
 * measures_phase1/phase2.dax. The caller decides which moving ranges belong to
 * the phase (see computePhasedStatistics for the boundary exclusion).
 */
function phaseStatistics(
    all: { xBar: number; mrBar: number; sigma: number },
    phaseValues: number[],
    phaseMovingRanges: number[],
    mult: number,
    floorLcl: boolean
): SpcStatistics {
    const xBar = phaseValues.length < MIN_PHASE_SIZE ? all.xBar : mean(phaseValues);

    let mrBar: number;
    let sigma: number;
    if (phaseMovingRanges.length < MIN_PHASE_SIZE) {
        mrBar = all.mrBar;
        sigma = all.sigma;
    } else {
        mrBar = mean(phaseMovingRanges);
        sigma = mrBar / D2;
    }
    return limitsFrom(xBar, mrBar, sigma, mult, floorLcl);
}

/**
 * Compute phase-split statistics. Points with index < changeAt belong to phase 1,
 * the rest to phase 2. When changeAt is past the last point, phase 2 is empty and
 * everything renders as a single phase (phase 2 falls back to whole-dataset stats).
 *
 * The moving range at the first phase-2 point spans the changepoint
 * (|value[changeAt] - value[changeAt-1]|) and reflects the shift itself rather
 * than within-phase variation, so it is excluded from phase 2's sigma. This
 * diverges deliberately from the DAX (MR_Bar_Phase2 includes it) in favour of
 * standard X-mR practice.
 */
export function computePhasedStatistics(
    points: DataPoint[], changeAt: number, opts: StatsOptions = {}
): PhasedStatistics {
    const mult = opts.sigmaMultiplier ?? SIGMA_MULTIPLIER;
    const floorLcl = opts.floorLcl ?? true;
    const movingRangeOf = (p: DataPoint) => p.movingRange as number;
    const hasMovingRange = (p: DataPoint) => p.movingRange !== null;
    // Real (non-gap) values only — gap slots (value === null) contribute nothing to the stats.
    const valuesOf = (ps: DataPoint[]) => ps.filter(p => p.value !== null).map(p => p.value as number);

    // Whole-dataset fallback (single-phase conception, so no boundary to exclude).
    const all = centerStats(valuesOf(points), points.filter(hasMovingRange).map(movingRangeOf));

    const phase1 = points.filter(p => p.index < changeAt);
    const phase2 = points.filter(p => p.index >= changeAt);

    const phase1MovingRanges = phase1.filter(hasMovingRange).map(movingRangeOf);
    const phase2MovingRanges = phase2
        .filter(p => hasMovingRange(p) && p.index !== changeAt)
        .map(movingRangeOf);

    return {
        phase1: phaseStatistics(all, valuesOf(phase1), phase1MovingRanges, mult, floorLcl),
        phase2: phaseStatistics(all, valuesOf(phase2), phase2MovingRanges, mult, floorLcl),
        changeAt,
        singlePhase: changeAt > points.length,
    };
}

/** Return the statistics that apply to a given point (phase-switching). */
export function statsForPoint(stats: PhasedStatistics, point: DataPoint): SpcStatistics {
    return point.index < stats.changeAt ? stats.phase1 : stats.phase2;
}

/** Moving-range chart factor (subgroup span 2): MR UCL = D4 * MR̄. */
export const D4 = 3.267;

/** MR-chart limits for one phase: center = MR̄, UCL = D4·MR̄, LCL = 0. */
export function mrLimits(stats: SpcStatistics): { center: number; ucl: number; lcl: number } {
    return { center: stats.mrBar, ucl: D4 * stats.mrBar, lcl: 0 };
}

/** A contiguous run of points sharing one phase's statistics (for the stepped render). */
export interface PhaseSegment {
    stats: SpcStatistics;
    /** 1-based index of the first point in this phase. */
    startIndex: number;
    /** 1-based index of the last point in this phase. */
    endIndex: number;
}

/**
 * Split the points into phase segments for rendering: one segment in single-phase,
 * two (before/from the changepoint) otherwise. Pure — the renderer maps each segment's
 * index range to pixels. Returns [] for empty input.
 */
export function splitPhases(points: DataPoint[], stats: PhasedStatistics): PhaseSegment[] {
    if (points.length === 0) return [];
    const firstIndex = points[0].index;
    const lastIndex = points[points.length - 1].index;
    if (stats.singlePhase) {
        return [{ stats: stats.phase1, startIndex: firstIndex, endIndex: lastIndex }];
    }
    return [
        { stats: stats.phase1, startIndex: firstIndex, endIndex: stats.changeAt - 1 },
        { stats: stats.phase2, startIndex: stats.changeAt, endIndex: lastIndex },
    ];
}
