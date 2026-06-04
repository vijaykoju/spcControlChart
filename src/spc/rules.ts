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

import { DataPoint, PointRuleResult } from "./types";
import { LimitsAccessor } from "./chartType";

export type RuleCheck = (points: DataPoint[], i: number, limitsAt: LimitsAccessor) => boolean;

export interface RuleDefinition {
    id: number;
    name: string;
    /** Short one-liner for the violation tooltip (kept terse; no em-dashes). */
    tooltip: string;
    /** Fuller explanation for the on-chart rule-reference panel (no em-dashes). */
    description: string;
    /** Returns true if this rule fires at array position i. */
    check: RuleCheck;
}

// Per chart type, only a subset of these apply (see each ChartStrategy.applicableRules): individuals
// and the X̄ subgroup charts use all 8; attribute charts (p/np/c/u) use {1,4}; dispersion companions
// (MR/R/s) use beyond-limit only.
// References the hoisted rule function declarations below — single source of truth for the
// id -> (name, tooltip, description, check) mapping. `tooltip` is the terse wording shown on a
// flagged point; `description` is the fuller panel wording. docs/rules.md is the deeper reference.
export const RULES: RuleDefinition[] = [
    { id: 1, name: "Beyond Limits", check: rule1,
        tooltip: "One point beyond the control limits (±3σ).",
        description: "One point lies outside the control limits (beyond ±3σ). A large, improbable deviation." },
    { id: 2, name: "Zone A", check: rule2,
        tooltip: "2 of 3 in Zone A or beyond, same side.",
        description: "2 of 3 points in a row in Zone A or beyond, on the same side. A moderate shift toward one limit." },
    { id: 3, name: "Zone B", check: rule3,
        tooltip: "4 of 5 in Zone B or beyond, same side.",
        description: "4 of 5 points in a row in Zone B or beyond, on the same side. A smaller but more sustained shift off center." },
    { id: 4, name: "Run Above/Below", check: rule4,
        tooltip: "7 in a row on one side of the center line.",
        description: "7 points in a row on the same side of the center line. The process mean has likely shifted." },
    { id: 5, name: "Trend", check: rule5,
        tooltip: "7 in a row steadily rising or falling.",
        description: "7 points in a row steadily rising or falling. A sustained drift in one direction." },
    { id: 6, name: "Mixture", check: rule6,
        tooltip: "8 in a row with none in Zone C.",
        description: "8 points in a row with none in Zone C (all beyond ±1σ). Points avoid the center, often two mixed processes." },
    { id: 7, name: "Stratification", check: rule7,
        tooltip: "15 in a row all inside Zone C.",
        description: "15 points in a row all inside Zone C (within ±1σ). Points hug the center, often because limits are too wide." },
    { id: 8, name: "Over-Control", check: rule8,
        tooltip: "14 in a row alternating up and down.",
        description: "14 points in a row alternating up and down. Systematic oscillation, often from over-adjustment." },
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

/** Count points within Zone C (inside ±1 sigma) using each point's own limits. */
function countInZoneC(window: DataPoint[], limitsAt: LimitsAccessor): number {
    let count = 0;
    for (const q of window) {
        const s = limitsAt(q);
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
function noVariation(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    return limitsAt(points[i]).sigma === 0;
}

// Rule 1 — Beyond Limits: current point beyond its phase's control limits (strict).
function rule1(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    const p = points[i];
    if (p.value === null) return false; // gap slot — nothing to test
    const s = limitsAt(p);
    return p.value > s.ucl || p.value < s.lcl;
}

// Rule 2 — Zone A: 2 of 3 consecutive in Zone A or beyond, same side.
// The current point must ITSELF be in the signaling zone on the side that reaches the
// 2-of-3 count, so the violation lands on the out-of-zone point — not on an in-control
// point that merely trails two extremes (which the old "2 of any 3" count did, flagging
// a point sitting on the centre line).
function rule2(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    if (noVariation(points, i, limitsAt)) return false;
    const window = fullWindow(points, i, 3);
    if (!window) return false;
    let above = 0;
    let below = 0;
    for (const q of window) {
        const s = limitsAt(q);
        if (q.value! >= s.zoneAUpper) above++;
        if (q.value! <= s.zoneALower) below++;
    }
    const cur = points[i];
    const cs = limitsAt(cur);
    const curAbove = cur.value! >= cs.zoneAUpper;
    const curBelow = cur.value! <= cs.zoneALower;
    return (curAbove && above >= 2) || (curBelow && below >= 2);
}

// Rule 3 — Zone B: 4 of 5 consecutive in Zone B or beyond, same side.
// Same current-point-must-be-in-zone requirement as rule 2.
function rule3(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    if (noVariation(points, i, limitsAt)) return false;
    const window = fullWindow(points, i, 5);
    if (!window) return false;
    let above = 0;
    let below = 0;
    for (const q of window) {
        const s = limitsAt(q);
        if (q.value! >= s.zoneBUpper) above++;
        if (q.value! <= s.zoneBLower) below++;
    }
    const cur = points[i];
    const cs = limitsAt(cur);
    const curAbove = cur.value! >= cs.zoneBUpper;
    const curBelow = cur.value! <= cs.zoneBLower;
    return (curAbove && above >= 4) || (curBelow && below >= 4);
}

// Rule 4 — Run: 7 consecutive on one side of x̄ (>= x̄ counts as above).
function rule4(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    if (noVariation(points, i, limitsAt)) return false;
    const window = fullWindow(points, i, 7);
    if (!window) return false;
    let above = 0;
    let below = 0;
    for (const q of window) {
        const s = limitsAt(q);
        if (q.value! >= s.xBar) above++;
        else below++;
    }
    return above === 7 || below === 7;
}

// Rule 5 — Trend: 7 consecutive points strictly trending up or down. Uses direction
// only (phase-independent). A 7-point trend is the 6 transitions ending at i (the
// directions of points i-5..i, which span points i-6..i) all sharing one nonzero sign.
// Requiring a contiguous monotonic run — not "6 of any 7 directions" — stops a single
// reversal inside the window (a zig-zag) from being read as a trend.
function rule5(points: DataPoint[], i: number): boolean {
    if (i < 6) return false; // need 7 points (i-6..i)
    let up = true;
    let down = true;
    for (let pos = i - 5; pos <= i; pos++) {
        const d = points[pos].direction;
        if (d !== 1) up = false;
        if (d !== -1) down = false;
    }
    return up || down;
}

// Rule 6 — Mixture: 8 consecutive with none in Zone C.
function rule6(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    const window = fullWindow(points, i, 8);
    if (!window) return false;
    return countInZoneC(window, limitsAt) === 0;
}

// Rule 7 — Stratification: 15 consecutive all in Zone C.
function rule7(points: DataPoint[], i: number, limitsAt: LimitsAccessor): boolean {
    if (noVariation(points, i, limitsAt)) return false;
    const window = fullWindow(points, i, 15);
    if (!window) return false;
    return countInZoneC(window, limitsAt) === 15;
}

// Rule 8 — Over-Control: 14 consecutive points strictly alternating up/down. Uses
// direction only. The 14 points i-13..i alternate iff their 13 inner transitions
// (the directions of points i-12..i) are all nonzero AND each is opposite the previous.
// Requiring strict alternation — not "12 of ~13 alternations" — stops one non-alternating
// step from tripping the rule (the same leniency that was fixed in the trend rule).
function rule8(points: DataPoint[], i: number): boolean {
    if (i < 13) return false; // need 14 points (i-13..i)
    for (let pos = i - 12; pos <= i; pos++) {
        const dir = points[pos].direction;
        if (dir === null || dir === 0) return false;
        if (pos > i - 12 && dir === points[pos - 1].direction) return false; // not opposite → run broken
    }
    return true;
}

const ALL_RULE_IDS = new Set(RULES.map(r => r.id));

/**
 * Evaluate the enabled rules at every point. `violation` mirrors SPC_Violation
 * (the OR of all rules). Defaults to all 8 rules enabled.
 */
export function evaluateRules(
    points: DataPoint[],
    limitsAt: LimitsAccessor,
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
                if (enabledRules.has(rule.id) && rule.check(points, i, limitsAt)) {
                    firedRules.push(rule.id);
                }
            }
        }
        return { index: p.index, firedRules, violation: firedRules.length > 0 };
    });
}
