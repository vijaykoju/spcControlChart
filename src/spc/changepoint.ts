/**
 * Single mean-shift changepoint detection for the SPC chart.
 * Ports the Candidates/BestSplit/DetectedCP scan in
 * power_query/spc_data_transform.m and the PhaseChangePoint Value override logic
 * in dax/measures_baseline.dax.
 *
 * PRECONDITION: `points` come from buildDataPoints (sorted, contiguous, 1-based).
 *
 * Deliberate divergences from the source (per project decisions):
 *  1. Statistic: proper Welch t (sample variance, /(N-1)) instead of the M's
 *     population-variance form. Numerically within a few percent for n ~ 20-30.
 *  2. Threshold: 3.0 is a heuristic sensitivity cutoff (higher = more
 *     conservative), NOT a calibrated significance level. The statistic is the
 *     maximum over correlated candidate splits, so its null is not the per-test t;
 *     we make no family-wise/Bonferroni p-value claim, we just threshold it.
 *  3. Override precedence: a manual changepoint always wins, even when
 *     auto-detection finds nothing — unlike the DAX, where detecting nothing
 *     disables the override. (See resolveChangepoint.)
 *
 * Detection is index-based and ignores date spacing — valid for evenly-subgrouped
 * SPC data, the visual's intended use.
 */

import { DataPoint } from "./types";
import { MIN_PHASE_SIZE } from "./statistics";

export const DEFAULT_THRESHOLD = 3.0;
// Detection's minimum segment is tied to the statistics layer's phase-size floor:
// a detected phase smaller than MIN_PHASE_SIZE would fall back to whole-dataset
// stats in computePhasedStatistics, so its limits would not be phase-specific —
// making the split pointless. Single source of truth; never lowered past this.
export const DEFAULT_MIN_SEGMENT = MIN_PHASE_SIZE;

export interface ChangepointOptions {
    enableDetection?: boolean;          // default true
    significanceThreshold?: number;     // default 3.0
    minSegment?: number;                // default 10
    manualChangepoint?: number | null;  // 1-based first phase-2 index; default null
}

export interface DetectionResult {
    /** First phase-2 index, or n+1 when no split is significant / no candidates. */
    changeAt: number;
    /** Strongest candidate split (null when there are no candidates). */
    bestSplit: number | null;
    /** Welch t at bestSplit (0 when there are no candidates). */
    bestStatistic: number;
    significant: boolean;
}

function mean(xs: number[]): number {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (divides by len - 1). Caller guarantees xs.length >= 2. */
function sampleVariance(xs: number[], m: number): number {
    let sumSq = 0;
    for (const x of xs) sumSq += (x - m) * (x - m);
    return sumSq / (xs.length - 1);
}

/**
 * Scan every candidate split and return the strongest by Welch t-statistic,
 * flagged significant when it meets the threshold. cp is the 1-based first phase-2
 * index (== changeAt): before = rows 1..cp-1, after = rows cp..n.
 */
export function detectChangepoint(
    points: DataPoint[],
    significanceThreshold: number = DEFAULT_THRESHOLD,
    minSegment: number = DEFAULT_MIN_SEGMENT
): DetectionResult {
    // Floor at MIN_PHASE_SIZE (which is >= 2, so sample variance is always defined):
    // a smaller segment would trigger the whole-dataset fallback in
    // computePhasedStatistics, defeating the detected split. Callers may raise
    // minSegment, never lower it past this.
    const seg = Math.max(MIN_PHASE_SIZE, minSegment);
    const singlePhase: DetectionResult = {
        changeAt: points.length + 1, bestSplit: null, bestStatistic: 0, significant: false,
    };

    // Detection runs over REAL observations only (gap slots have no value); the split index is
    // mapped back to the gap-aware point index at the end. minSegment is in real-point terms.
    const real = points.filter(p => p.value !== null);
    const n = real.length;

    // No candidate fits two segments of `seg` — the M would error here; we don't.
    if (n < 2 * seg) return singlePhase;

    const values = real.map(p => p.value as number);
    let bestSplit = -1;
    let bestStatistic = -Infinity;

    for (let cp = seg + 1; cp <= n - seg + 1; cp++) {
        const before = values.slice(0, cp - 1);
        const after = values.slice(cp - 1);
        const meanB = mean(before);
        const meanA = mean(after);
        const se = Math.sqrt(
            sampleVariance(before, meanB) / before.length +
            sampleVariance(after, meanA) / after.length
        );
        // se === 0 only when both segments are perfectly constant. The 1e-4 floor
        // (from the M) yields t = |Δ|·1e4 — a genuine step is still detected, but the
        // magnitude is arbitrary and not meaningfully comparable to the threshold.
        const t = Math.abs(meanA - meanB) / (se === 0 ? 1e-4 : se);
        if (t > bestStatistic) { // strict > keeps the earliest cp on ties
            bestStatistic = t;
            bestSplit = cp;
        }
    }

    // Map the split position within `real` back to the gap-aware point index (the first
    // phase-2 real point); changeAt drives the phase split, which is index-based.
    const mappedSplit = real[bestSplit - 1].index;
    const significant = bestStatistic >= significanceThreshold;
    return {
        changeAt: significant ? mappedSplit : points.length + 1,
        bestSplit: mappedSplit, bestStatistic, significant,
    };
}

/**
 * Resolve the changeAt for the chart, applying the format-pane options.
 * Precedence: manual override > auto-detection > single-phase.
 */
export function resolveChangepoint(points: DataPoint[], options: ChangepointOptions = {}): number {
    const n = points.length;
    const {
        enableDetection = true,
        significanceThreshold,
        minSegment,
        manualChangepoint = null,
    } = options;

    if (manualChangepoint != null && Number.isFinite(manualChangepoint)) {
        // Round to an integer index and clamp so phase 1 keeps >= 1 point; n+1 means
        // single-phase. A non-finite override is ignored (falls through to detection).
        return Math.min(Math.max(Math.round(manualChangepoint), 2), n + 1);
    }
    if (enableDetection) {
        return detectChangepoint(points, significanceThreshold, minSegment).changeAt;
    }
    return n + 1;
}
