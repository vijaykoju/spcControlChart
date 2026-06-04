/**
 * Pure mappers from format-pane values to the engine option objects.
 * No d3 / powerbi imports, so they're unit-testable in the Node harness.
 */

import { StatsOptions } from "./spc/statistics";
import { ChangepointOptions } from "./spc/changepoint";
import { ChartType } from "./spc/chartType";

const CHART_TYPES: ChartType[] = ["individuals", "p", "np", "c", "u", "xbar-r", "xbar-s"];

/** Chart card → chart type. Guards an unknown dropdown value to "individuals". */
export function toChartType(value: string): ChartType {
    return (CHART_TYPES as string[]).includes(value) ? (value as ChartType) : "individuals";
}

/** Control-limits card → statistics options. Guards a non-positive multiplier. */
export function toStatsOpts(sigmaMultiplier: number, floorLcl: boolean): StatsOptions {
    return { sigmaMultiplier: sigmaMultiplier > 0 ? sigmaMultiplier : 3, floorLcl };
}

/** Phase-detection card → changepoint options. Manual override applies only when toggled on. */
export function toChangepointOptions(
    enableDetection: boolean,
    significanceThreshold: number,
    minSegment: number,
    useManualChangepoint: boolean,
    manualChangepoint: number
): ChangepointOptions {
    return {
        enableDetection,
        significanceThreshold,
        minSegment,
        manualChangepoint: useManualChangepoint ? manualChangepoint : null,
    };
}

/** Rules card → the set of enabled rule ids. toggles[i] is rule (i+1). */
export function toEnabledRules(toggles: boolean[]): Set<number> {
    const enabled = new Set<number>();
    toggles.forEach((on, i) => { if (on) enabled.add(i + 1); });
    return enabled;
}

/** Restrict the user-enabled rules to those the selected chart type supports. */
export function applicableEnabledRules(enabled: Set<number>, applicable: Set<number>): Set<number> {
    return new Set([...enabled].filter(id => applicable.has(id)));
}

/** Annotations card → data-label mode. Guards an unexpected dropdown value to "off". */
export function toDataLabelMode(value: string): "off" | "all" | "violations" {
    return value === "all" || value === "violations" ? value : "off";
}

/** MR Chart card → options. Height ratio clamped to a sane [0.1, 0.5] of the plot height. */
export function toMrChartOptions(show: boolean, ratio: number): { show: boolean; ratio: number } {
    const r = Number.isFinite(ratio) ? Math.min(0.5, Math.max(0.1, ratio)) : 0.25;
    return { show, ratio: r };
}

/** Legend card → position. Guards an unexpected dropdown value to "top". */
export function toLegendPosition(value: string): "top" | "bottom" | "left" | "right" {
    return value === "bottom" || value === "left" || value === "right" ? value : "top";
}

export type SidePosition = "left" | "right";

/** Rule-reference card → side. Guards an unexpected dropdown value to "right". */
export function toSidePosition(value: string): SidePosition {
    return value === "left" ? "left" : "right";
}
