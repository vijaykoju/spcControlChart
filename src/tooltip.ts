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
    // CUSUM: a two-arm chart — show both cumulative sums (C⁺ = value, C⁻ = −secondary) against the
    // decision interval H (= the +H limit), instead of the single-series center/UCL/LCL rows.
    if (limits.secondarySeries) {
        const cMinus = limits.secondarySeries[point.index - 1];
        const items: VisualTooltipDataItem[] = [
            { displayName: axisName || "Axis", value: point.label },
            { displayName: "CUSUM C⁺", value: fmt(point.value as number) },
        ];
        if (cMinus != null) items.push({ displayName: "CUSUM C⁻", value: fmt(-cMinus) });
        items.push({ displayName: "Decision interval (H)", value: fmt(s.ucl) });
        return items;
    }
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
    const comp = limits.companion;
    const c = comp?.limits[point.index - 1];
    const v = comp?.value[point.index - 1];
    // Keep the moving-range wording for the MR case; R/s charts use the companion's title.
    const isMr = comp?.kind === "mr";
    const valLabel = isMr ? "Moving range" : (comp?.axisTitle ?? "Value");
    const centerLabel = isMr ? "MR center (MR̄)" : `${comp?.axisTitle} center`;
    const items: VisualTooltipDataItem[] = [
        { displayName: axisName || "Axis", value: point.label },
        { displayName: valLabel, value: fmt(v as number) },
    ];
    if (c) {
        items.push(
            { displayName: centerLabel, value: fmt(c.center) },
            { displayName: isMr ? "MR UCL" : `${comp?.axisTitle} UCL`, value: fmt(c.ucl) },
        );
        if (c.lcl > 0) items.push({ displayName: `${comp?.axisTitle} LCL`, value: fmt(c.lcl) });
    }
    return items;
}
