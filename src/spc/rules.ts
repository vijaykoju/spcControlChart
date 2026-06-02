/**
 * The 8 Western Electric / Nelson SPC rules, phase-aware.
 * Ported from dax/measures_rules.dax (rule names from measures_helpers.dax).
 *
 * PRECONDITION: `points` must come from buildDataPoints — sorted and contiguous
 * with points[i].index === i + 1. All window and predecessor logic uses
 * array-positional access only, so correctness depends on order, never on the
 * index values; `index` is used purely as the output key.
 *
 * Equality conventions are preserved exactly from the DAX (see each rule).
 */

import { DataPoint, PhasedStatistics, PointRuleResult } from "./types";
import { statsForPoint } from "./statistics";

export type RuleCheck = (points: DataPoint[], i: number, stats: PhasedStatistics) => boolean;

export interface RuleDefinition {
    id: number;
    name: string;
    /** Returns true if this rule fires at array position i. */
    check: RuleCheck;
}

// References the hoisted rule function declarations below — single source of truth
// for the id -> (name, check) mapping.
export const RULES: RuleDefinition[] = [
    { id: 1, name: "Beyond Limits", check: rule1 },
    { id: 2, name: "Zone A", check: rule2 },
    { id: 3, name: "Zone B", check: rule3 },
    { id: 4, name: "Run Above/Below", check: rule4 },
    { id: 5, name: "Trend", check: rule5 },
    { id: 6, name: "Mixture", check: rule6 },
    { id: 7, name: "Stratification", check: rule7 },
    { id: 8, name: "Over-Control", check: rule8 },
];

/**
 * The `size` points ending at position i, or null when there isn't a full window.
 * Enforces the DAX `windowSize == N` gate — rules don't fire near the start.
 */
function fullWindow(points: DataPoint[], i: number, size: number): DataPoint[] | null {
    if (i < size - 1) return null;
    const window = points.slice(i - size + 1, i + 1);
    // A gap (blank measure) breaks consecutiveness — there is no full window of N consecutive
    // real observations, so the windowed rules (2/3/4/6/7) can't fire across it.
    if (window.some(p => p.value === null)) return null;
    return window;
}

/** Count points within Zone C (inside ±1 sigma) using each point's own phase limits. */
function countInZoneC(window: DataPoint[], stats: PhasedStatistics): number {
    let count = 0;
    for (const q of window) {
        const s = statsForPoint(stats, q);
        if (q.value! >= s.zoneBLower && q.value! <= s.zoneBUpper) count++;
    }
    return count;
}

// When the current point's phase has no variation (sigma === 0), the limits and
// zones all collapse onto x-bar, and the inclusive >=/<= comparisons in the
// zone/run rules (2,3,4,7) would flag a perfectly flat process as a violation.
// Suppress those rules in that degenerate case. DELIBERATE divergence from the DAX,
// which fires spuriously here. Rules 1 (strict >), 5/8 (direction) and 6 (mixture
// needs none-in-C, but all flat points ARE in C) are unaffected.
function noVariation(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    return statsForPoint(stats, points[i]).sigma === 0;
}

// Rule 1 — Beyond Limits: current point beyond its phase's control limits (strict).
function rule1(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    const p = points[i];
    if (p.value === null) return false; // gap slot — nothing to test
    const s = statsForPoint(stats, p);
    return p.value > s.ucl || p.value < s.lcl;
}

// Rule 2 — Zone A: 2 of 3 consecutive in Zone A or beyond, same side.
// NOTE: counts "2 of any 3" in the trailing window; does not require the current
// point itself to be in the signaling zone. Deliberate — faithful to the DAX.
function rule2(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    if (noVariation(points, i, stats)) return false;
    const window = fullWindow(points, i, 3);
    if (!window) return false;
    let above = 0;
    let below = 0;
    for (const q of window) {
        const s = statsForPoint(stats, q);
        if (q.value! >= s.zoneAUpper) above++;
        if (q.value! <= s.zoneALower) below++;
    }
    return above >= 2 || below >= 2;
}

// Rule 3 — Zone B: 4 of 5 consecutive in Zone B or beyond, same side.
// Same "k of any n" convention as rule 2 — deliberate, faithful to the DAX.
function rule3(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    if (noVariation(points, i, stats)) return false;
    const window = fullWindow(points, i, 5);
    if (!window) return false;
    let above = 0;
    let below = 0;
    for (const q of window) {
        const s = statsForPoint(stats, q);
        if (q.value! >= s.zoneBUpper) above++;
        if (q.value! <= s.zoneBLower) below++;
    }
    return above >= 4 || below >= 4;
}

// Rule 4 — Run: 7 consecutive on one side of x̄ (>= x̄ counts as above).
function rule4(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    if (noVariation(points, i, stats)) return false;
    const window = fullWindow(points, i, 7);
    if (!window) return false;
    let above = 0;
    let below = 0;
    for (const q of window) {
        const s = statsForPoint(stats, q);
        if (q.value! >= s.xBar) above++;
        else below++;
    }
    return above === 7 || below === 7;
}

// Rule 5 — Trend: 7 consecutive trending up or down. Uses direction only (phase-
// independent). Gate is windowSize >= 6 (NOT === 7): the 7-point lookback shrinks
// to 6 when it includes the excluded index-1 point (null direction).
// NOTE: counts up/down directions in the window (>= 6), not a strictly contiguous
// monotonic run — so one flat/down point among 7 can still fire. Deliberate,
// faithful to the DAX (matches the "k of any n" convention in rules 2/3).
function rule5(points: DataPoint[], i: number): boolean {
    const window = points.slice(Math.max(0, i - 6), i + 1).filter(p => p.direction !== null);
    const up = window.filter(p => p.direction === 1).length;
    const down = window.filter(p => p.direction === -1).length;
    return window.length >= 6 && (up >= 6 || down >= 6);
}

// Rule 6 — Mixture: 8 consecutive with none in Zone C.
function rule6(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    const window = fullWindow(points, i, 8);
    if (!window) return false;
    return countInZoneC(window, stats) === 0;
}

// Rule 7 — Stratification: 15 consecutive all in Zone C.
function rule7(points: DataPoint[], i: number, stats: PhasedStatistics): boolean {
    if (noVariation(points, i, stats)) return false;
    const window = fullWindow(points, i, 15);
    if (!window) return false;
    return countInZoneC(window, stats) === 15;
}

// Rule 8 — Over-Control: 14 consecutive alternating up/down. Uses direction only.
// windowSize >= 13; the inner sub-window [cur-12, cur] must hold >= 12 points, each
// compared to its immediate predecessor's direction (positional). An alternation is
// two consecutive nonzero directions of opposite sign.
function rule8(points: DataPoint[], i: number): boolean {
    const hasDir = (pos: number) => points[pos].direction !== null;
    const windowStart = Math.max(0, i - 13);
    const innerStart = Math.max(0, i - 12);

    let windowSize = 0;
    for (let pos = windowStart; pos <= i; pos++) {
        if (hasDir(pos)) windowSize++;
    }

    let innerCount = 0;
    let alternations = 0;
    for (let pos = innerStart; pos <= i; pos++) {
        if (!hasDir(pos)) continue;
        innerCount++;
        const dir = points[pos].direction;
        const prevDir = pos > 0 ? points[pos - 1].direction : null;
        if (dir !== 0 && prevDir !== null && prevDir !== 0 && dir !== prevDir) alternations++;
    }
    return windowSize >= 13 && innerCount >= 12 && alternations >= 12;
}

const ALL_RULE_IDS = new Set(RULES.map(r => r.id));

/**
 * Evaluate the enabled rules at every point. `violation` mirrors SPC_Violation
 * (the OR of all rules). Defaults to all 8 rules enabled.
 */
export function evaluateRules(
    points: DataPoint[],
    stats: PhasedStatistics,
    enabledRules: Set<number> = ALL_RULE_IDS
): PointRuleResult[] {
    // Precondition: points must come from buildDataPoints (contiguous, 1-based).
    // The window/predecessor logic depends on it — fail loudly rather than silently
    // produce wrong results if a caller passes an unprepared array.
    if (points.length > 0 && points[0].index !== 1) {
        throw new Error(
            "evaluateRules requires points from buildDataPoints (contiguous index starting at 1)."
        );
    }
    return points.map((p, i) => {
        // A gap slot (blank measure) never fires a rule. The windowed rules are already gap-safe
        // (fullWindow rejects gap windows; rule 1 guards null), but the direction-based rules
        // (5/8) would otherwise fire AT a gap over the prior run — a false violation. One guard
        // here covers all eight robustly.
        const firedRules: number[] = [];
        if (p.value !== null) {
            for (const rule of RULES) {
                if (enabledRules.has(rule.id) && rule.check(points, i, stats)) {
                    firedRules.push(rule.id);
                }
            }
        }
        return { index: p.index, firedRules, violation: firedRules.length > 0 };
    });
}
