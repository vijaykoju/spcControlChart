/**
 * The chart-type seam. Each control-chart family is a `ChartStrategy` that turns prepared points
 * into a `LimitModel` (per-point limits + segments + optional dispersion companion). The renderer
 * and rule engine consume the `LimitModel` and never reach for phase-specific stats directly, so
 * adding a chart type means adding a strategy — not editing the hot path.
 *
 * Phase 0 ships only the `individuals` strategy (see strategies/individuals.ts); the interface is
 * shaped to also carry varying per-point limits (p/u charts) and an independent companion limit
 * structure (R/s charts), so later families plug in without reshaping it.
 */

import { DataPoint, SpcStatistics } from "./types";
import { PhaseSegment, StatsOptions } from "./statistics";
import { ChangepointOptions } from "./changepoint";

export type ChartType = "individuals"; // Phase 1+ adds "p" | "np" | "c" | "u" | "xbar-r" | ...

/** Resolve the limits that apply to a given point — the single accessor the rule engine uses. */
export type LimitsAccessor = (p: DataPoint) => SpcStatistics;

/** Center + control limits for one point of a companion (dispersion) chart. Modeled separately
 *  from the primary SpcStatistics because R/s charts have their own limit structure (D4·R̄ etc.). */
export interface CompanionPoint {
    center: number;
    ucl: number;
    lcl: number;
}

/** The dispersion companion panel (moving range / range / std dev). */
export interface CompanionModel {
    kind: "mr" | "r" | "s";
    /** value[i] is the plotted dispersion statistic for points[i]; null where undefined (e.g. the
     *  first moving range). */
    value: (number | null)[];
    /** Per-point companion limits, aligned to points. */
    limits: CompanionPoint[];
    /** Y-axis title for the companion panel. */
    axisTitle: string;
}

/** Per-point primary limits plus the contiguous runs that share identical limits. */
export interface LimitModel {
    /** perPoint[i] applies to points[i] (1-based index i+1). */
    perPoint: SpcStatistics[];
    /** Runs of adjacent points sharing one SpcStatistics — one segment per phase for individuals;
     *  degrades to one-per-point for varying-limit charts (stepped rendering, Phase 1+). */
    segments: PhaseSegment[];
    /** Phase number for a point (1 or 2 for individuals); undefined when the chart has no phases. */
    phaseOf?: (p: DataPoint) => number;
    /** Drives the tooltip "Phase" row and the phase-change line. */
    singlePhase: boolean;
    /** Companion dispersion chart, or null (attribute charts have none). */
    companion: CompanionModel | null;
}

/** Everything a strategy needs beyond the points. Opaque to the caller, so individuals-only
 *  concepts (changepoint detection) don't leak into the shared signature. `changepoint` is optional
 *  — chart types without phases ignore it. */
export interface ChartContext {
    opts: StatsOptions;
    changepoint?: ChangepointOptions;
}

export interface ChartStrategy {
    id: ChartType;
    /** Rule ids (1-8) valid for this chart type. Individuals = all 8. */
    applicableRules: Set<number>;
    /** Whether A/B/C zones are meaningful (drives zone shading + zone-rule eligibility). */
    zonesMeaningful: boolean;
    /** Compute per-point limits (+ segments + companion) for the prepared points. */
    computeLimits(points: DataPoint[], ctx: ChartContext): LimitModel;
}

/** Adapt a LimitModel to the rule engine's accessor. Relies on the contiguous 1-based index that
 *  buildDataPoints guarantees (perPoint is aligned to points). */
export const limitsFromModel = (m: LimitModel): LimitsAccessor => (p) => m.perPoint[p.index - 1];

/** Dispersion-companion violations: value beyond its UCL (beyond-limit only — run rules are invalid
 *  on autocorrelated dispersion stats). Aligned to points; the single source for MR/R/s violations. */
export const companionViolations = (c: CompanionModel): boolean[] =>
    c.value.map((v, i) => v != null && v > c.limits[i].ucl);
