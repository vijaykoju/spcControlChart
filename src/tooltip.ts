/**
 * Builds the built-in tooltip items for a point (axis label, value, phase, limits, fired rules).
 * Pure — no d3, no powerbi runtime — so it's harness-testable. Reads per-point limits + the phase
 * info from the chart's LimitModel. (User "Tooltip measures" extras are appended by the renderer.)
 */

import type powerbi from "powerbi-visuals-api";
import { DataPoint, PointRuleResult } from "./spc/types";
import { LimitModel } from "./spc/chartType";
import { RULES } from "./spc/rules";

type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export function buildTooltipItems(
    point: DataPoint,
    results: PointRuleResult[],
    limits: LimitModel,
    fmt: (n: number) => string,
    axisName: string,
    measureName: string,
    targetName: string
): VisualTooltipDataItem[] {
    const s = limits.perPoint[point.index - 1];
    // One row per fired rule (name → plain-language reason), so the tooltip explains *why* this
    // point is flagged right where the user is looking — not just which rule numbers tripped.
    const firedRules = (results[point.index - 1]?.firedRules ?? [])
        .map(id => RULES.find(r => r.id === id))
        .filter((r): r is typeof RULES[number] => !!r);

    const items: VisualTooltipDataItem[] = [
        { displayName: axisName || "Axis", value: point.label },
        // Only real points get a marker/tooltip, so value is non-null here.
        { displayName: measureName || "Value", value: fmt(point.value as number) },
    ];
    // Phase only means something when the chart is actually split.
    if (!limits.singlePhase && limits.phaseOf) {
        items.push({ displayName: "Phase", value: String(limits.phaseOf(point)) });
    }
    items.push(
        { displayName: "Center (x̄)", value: fmt(s.xBar) },
        { displayName: "UCL", value: fmt(s.ucl) },
        { displayName: "LCL", value: fmt(s.lcl) },
    );
    if (point.target != null) {
        items.push({ displayName: targetName || "Target", value: fmt(point.target) });
    }
    for (const r of firedRules) {
        items.push({ displayName: r.name, value: r.tooltip });
    }
    return items;
}

/**
 * Companion-panel tooltip: the point's dispersion value plus its phase's companion center / UCL.
 * Only called for points that have a companion value (the first point is filtered out upstream).
 */
export function buildMrTooltipItems(
    point: DataPoint,
    limits: LimitModel,
    fmt: (n: number) => string,
    axisName: string
): VisualTooltipDataItem[] {
    const c = limits.companion?.limits[point.index - 1];
    const items: VisualTooltipDataItem[] = [
        { displayName: axisName || "Axis", value: point.label },
        { displayName: "Moving range", value: fmt(point.movingRange as number) },
    ];
    if (c) {
        items.push(
            { displayName: "MR center (MR̄)", value: fmt(c.center) },
            { displayName: "MR UCL", value: fmt(c.ucl) },
        );
    }
    return items;
}
