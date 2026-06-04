/**
 * Core data and statistics types for the SPC control chart.
 * Mirrors the columns produced by the Power Query transform and the
 * per-phase statistics defined in the dax/ measures.
 */

import type powerbi from "powerbi-visuals-api";

/** A user "Tooltip measures" field value for a point (raw; formatted at render time). */
export interface TooltipField {
    displayName: string;
    value: powerbi.PrimitiveValue;
    format?: string;
}

/** A single measured point. Derived fields mirror the Power Query precompute columns. */
export interface DataPoint {
    /** 1-based observation index in series order (first point is 1). */
    index: number;
    /** X-axis tick label (formatted axis-field value). */
    label: string;
    /** Measured value; null = a present axis row with a blank measure (a gap slot). */
    value: number | null;
    /** |value - previous value|; null for the first point. */
    movingRange: number | null;
    /** Previous point's value; null for the first point. */
    prevValue: number | null;
    /** 1 = up, -1 = down, 0 = equal vs previous; null for the first point. */
    direction: 1 | -1 | 0 | null;
    /** User "Tooltip measures" field values for this point (display-only; SPC ignores). */
    tooltips?: TooltipField[];
    /** Bound "Target" field value for this point; null = no target here (display-only). */
    target?: number | null;
    /** Original categorical row index (pre-sort, pre-filter) — for the selection id. */
    categoryIndex: number;
    /** Power BI selection id for cross-filtering; attached in visual.ts (interaction-only). */
    identity?: powerbi.visuals.ISelectionId;
    /** Attribute charts: subgroup size / units / area of opportunity (nᵢ). null/≤0 → gap. */
    sampleSize?: number | null;
    /** Attribute charts: raw defect/defective count, preserved by `prepare` so the center is exact. */
    count?: number | null;
    /** Subgroup charts: the subgroup's range (X̄-R) or std dev (X̄-s). null = blank. */
    spread?: number | null;
}

/** Control-chart statistics for one phase (or the whole-dataset fallback). */
export interface SpcStatistics {
    xBar: number;        // center line
    mrBar: number;       // mean moving range
    sigma: number;       // estimated sigma = mrBar / d2
    ucl: number;         // upper control limit (xBar + 3 sigma)
    lcl: number;         // lower control limit (xBar - 3 sigma, floored at 0)
    zoneAUpper: number;  // xBar + 2 sigma
    zoneALower: number;  // xBar - 2 sigma (floored at 0)
    zoneBUpper: number;  // xBar + 1 sigma
    zoneBLower: number;  // xBar - 1 sigma (floored at 0)
}

/** Phase-split statistics: phase 1 (before changepoint) and phase 2 (from changepoint). */
export interface PhasedStatistics {
    phase1: SpcStatistics;
    phase2: SpcStatistics;
    /** 1-based index of the first phase-2 point. Greater than the point count means single-phase. */
    changeAt: number;
    /** True when there is no phase split (changeAt is past the last point). */
    singlePhase: boolean;
}

/** Which SPC rules fired at a single point. */
export interface PointRuleResult {
    /** 1-based, matches DataPoint.index. */
    index: number;
    /** Ids (1-8) of the rules that fired at this point. */
    firedRules: number[];
    /** True when any rule fired. */
    violation: boolean;
}

/** Configurable chart colors (driven by the format pane; defaults live in chart.ts). */
export interface ChartColors {
    line: string;
    violation: string;
    limit: string;
    center: string;
    zoneA: string;
    zoneB: string;
    zoneC: string;
}
