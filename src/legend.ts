/**
 * Reference-key (legend) item logic — which SPC elements to list and how to draw each glyph.
 * Pure (no d3/powerbi) so it's harness-testable; the renderer (chart.ts) draws the items.
 *
 * Items are CONDITIONAL: an element is listed only when it's actually visible/bound, so the key
 * always matches what's on the chart. Each entry's label can be overridden (m17) — an empty
 * override falls back to the default (the data-line default is the bound measure's name).
 */

import { ChartColorSet } from "./theme";

export type LegendGlyph = "line" | "dashed" | "band" | "marker";

/** Stable per-entry key, used to map format-pane label overrides to entries. */
export type LegendKey =
    "dataLine" | "center" | "limits" | "zoneA" | "zoneB" | "zoneC" | "violation" | "target" | "phaseChange";

export interface LegendItem {
    label: string;
    color: string;
    glyph: LegendGlyph;
}

export interface LegendInput {
    colors: ChartColorSet;
    showZones: boolean;
    hasTarget: boolean;
    hasPhaseChange: boolean;
    isHighContrast: boolean;
    /** Default label for the data-line entry (the bound measure's display name). */
    measureName: string;
    /** Per-entry label overrides; an empty/blank value falls back to the default. */
    labels?: Partial<Record<LegendKey, string>>;
}

export function buildLegendItems(input: LegendInput): LegendItem[] {
    const { colors, labels } = input;
    // Override wins only when non-empty (trimmed); else the default.
    const label = (key: LegendKey, def: string) => (labels?.[key] ?? "").trim() || def;

    const items: LegendItem[] = [
        { label: label("dataLine", input.measureName), color: colors.line, glyph: "line" },
        { label: label("center", "Center (x̄)"), color: colors.center, glyph: "dashed" },
        { label: label("limits", "Control limits"), color: colors.limit, glyph: "dashed" },
    ];
    // Zone shading is dropped in high contrast, so its swatch would be meaningless there.
    if (input.showZones && !input.isHighContrast) {
        items.push(
            { label: label("zoneA", "Zone A"), color: colors.zoneA, glyph: "band" },
            { label: label("zoneB", "Zone B"), color: colors.zoneB, glyph: "band" },
            { label: label("zoneC", "Zone C"), color: colors.zoneC, glyph: "band" },
        );
    }
    items.push({ label: label("violation", "Violation"), color: colors.violation, glyph: "marker" });
    if (input.hasTarget) {
        items.push({ label: label("target", "Target"), color: colors.target, glyph: "dashed" });
    }
    if (input.hasPhaseChange) {
        items.push({ label: label("phaseChange", "Phase change"), color: colors.phaseChange, glyph: "dashed" });
    }
    return items;
}
