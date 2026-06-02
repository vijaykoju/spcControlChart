/**
 * Builds the built-in tooltip items for a point (axis label, value, phase, limits,
 * fired rules). Pure — no d3, no powerbi runtime — so it's harness-testable.
 * (User "Tooltip measures" extras are appended by the renderer's callback.)
 */

import type powerbi from "powerbi-visuals-api";
import { DataPoint, PhasedStatistics, PointRuleResult } from "./spc/types";
import { statsForPoint, D4 } from "./spc/statistics";
import { RULES } from "./spc/rules";

type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export function buildTooltipItems(
    point: DataPoint,
    results: PointRuleResult[],
    phased: PhasedStatistics,
    fmt: (n: number) => string,
    axisName: string,
    measureName: string,
    targetName: string
): VisualTooltipDataItem[] {
    const s = statsForPoint(phased, point);
    const phase = point.index < phased.changeAt ? 1 : 2;
    const firedNames = (results[point.index - 1]?.firedRules ?? [])
        .map(id => RULES.find(r => r.id === id)?.name)
        .filter((n): n is string => !!n);

    const items: VisualTooltipDataItem[] = [
        { displayName: axisName || "Axis", value: point.label },
        // Only real points get a marker/tooltip, so value is non-null here.
        { displayName: measureName || "Value", value: fmt(point.value as number) },
    ];
    // Phase only means something when the chart is actually split.
    if (!phased.singlePhase) {
        items.push({ displayName: "Phase", value: String(phase) });
    }
    items.push(
        { displayName: "Center (x̄)", value: fmt(s.xBar) },
        { displayName: "UCL", value: fmt(s.ucl) },
        { displayName: "LCL", value: fmt(s.lcl) },
    );
    if (point.target != null) {
        items.push({ displayName: targetName || "Target", value: fmt(point.target) });
    }
    if (firedNames.length > 0) {
        items.push({ displayName: "Rule violations", value: firedNames.join(", ") });
    }
    return items;
}

/**
 * MR-panel tooltip (m13): the point's moving range plus its phase's MR center / UCL.
 * Only called for points that have a moving range (the first point is filtered out upstream).
 */
export function buildMrTooltipItems(
    point: DataPoint,
    phased: PhasedStatistics,
    fmt: (n: number) => string,
    axisName: string
): VisualTooltipDataItem[] {
    const s = statsForPoint(phased, point);
    return [
        { displayName: axisName || "Axis", value: point.label },
        { displayName: "Moving range", value: fmt(point.movingRange as number) },
        { displayName: "MR center (MR̄)", value: fmt(s.mrBar) },
        { displayName: "MR UCL", value: fmt(D4 * s.mrBar) },
    ];
}
